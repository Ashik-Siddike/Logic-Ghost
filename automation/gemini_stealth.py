import os
import sys
import io
import time
import re
import json
import collections
import traceback
import queue
import threading
import ctypes
from ctypes import wintypes
import pyperclip
import pyautogui
from flask import Flask, request, jsonify
from PIL import Image, ImageEnhance, ImageFilter

# Force UTF-8 unbuffered stdout & stderr on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

# File Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", ".env"))
CONTEXT_FILE = os.path.join(BASE_DIR, "custom_context.txt")
CONTEXT_CONFIG_FILE = os.path.join(BASE_DIR, "context_config.json")
SPEED_CONFIG_FILE = os.path.join(BASE_DIR, "speed_config.json")

# Multi-API Key Manager with Smart Round-Robin Rotation, Instant Failover & Dead-Key Quarantine
class ApiKeyRotator:
    def __init__(self):
        self.all_keys = []
        self.active_queue = collections.deque()
        self.quarantined = {} # {key: {"error": str, "time": float, "masked": str}}
        self.lock = threading.Lock()
        self.load_keys()

    @property
    def keys(self):
        with self.lock:
            return list(self.all_keys)

    def load_keys(self):
        with self.lock:
            self.all_keys = []
            if os.path.exists(ENV_PATH):
                try:
                    with open(ENV_PATH, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith("#") and "=" in line:
                                k, v = line.split("=", 1)
                                k = k.strip()
                                v = v.strip().strip('"').strip("'")
                                if k in ["GEMINI_API_KEYS", "GEMINI_API_KEY"]:
                                    for part in v.split(","):
                                        part = part.strip()
                                        if part and part not in self.all_keys:
                                            self.all_keys.append(part)
                except Exception as e:
                    print(f"[Rotator Warning] Could not read .env: {e}", flush=True)

            self.active_queue = collections.deque(self.all_keys)
            self.quarantined = {}
            print(f"[Smart API Rotator] Initialized with {len(self.all_keys)} active Gemini API Key(s).", flush=True)

    def save_keys_to_env(self, key_list):
        with self.lock:
            self.all_keys = [k.strip() for k in key_list if k.strip()]
            self.active_queue = collections.deque(self.all_keys)
            self.quarantined = {}
            try:
                content = "# LogicGhost Gemini Configuration\n"
                content += f"GEMINI_API_KEYS={','.join(self.all_keys)}\n"
                with open(ENV_PATH, "w", encoding="utf-8") as f:
                    f.write(content)
                print(f"[Smart API Rotator] Saved {len(self.all_keys)} keys to .env.", flush=True)
            except Exception as e:
                print(f"[Rotator Error] Could not save to .env: {e}", flush=True)

    def get_next_key(self):
        """Pops the next healthy key from the front of the queue and rotates it to the back."""
        with self.lock:
            # Check if any quarantined key can be restored after cooldown
            if not self.active_queue:
                now = time.time()
                restored = []
                for k, info in list(self.quarantined.items()):
                    if now - info["time"] > 600: # 10 min cooldown
                        self.active_queue.append(k)
                        del self.quarantined[k]
                        restored.append(k)
                if restored:
                    print(f"[Smart API Rotator] Restored {len(restored)} keys after cooldown.", flush=True)

                if not self.active_queue and self.all_keys:
                    self.active_queue = collections.deque(self.all_keys)
                    self.quarantined = {}
                    print("[Smart API Rotator] Emergency Pool Reset: Re-activated all keys.", flush=True)

            if not self.active_queue:
                return None

            key = self.active_queue.popleft()
            self.active_queue.append(key)
            return key

    def mark_key_failed(self, key, error):
        """Immediately removes/quarantines a failing or exhausted key from the active queue."""
        with self.lock:
            masked = f"{key[:6]}...{key[-4:]}" if len(key) > 10 else "***"
            err_str = str(error)
            
            # Remove from active_queue
            new_queue = collections.deque([k for k in self.active_queue if k != key])
            self.active_queue = new_queue
            
            self.quarantined[key] = {
                "error": err_str[:120],
                "time": time.time(),
                "masked": masked
            }
            print(f"[Smart API Rotator] ⚠️ QUARANTINED failing key: {masked} | Reason: {err_str[:80]} | Active remaining: {len(self.active_queue)}/{len(self.all_keys)}", flush=True)

    def reset_quarantine(self):
        """Manually un-quarantines all keys."""
        with self.lock:
            self.active_queue = collections.deque(self.all_keys)
            self.quarantined = {}
            print(f"[Smart API Rotator] Quarantine reset. All {len(self.all_keys)} keys active.", flush=True)

    def get_active_count(self):
        with self.lock:
            return len(self.active_queue)

    def get_all_keys_masked(self):
        with self.lock:
            masked = []
            for i, k in enumerate(self.all_keys):
                if len(k) > 10:
                    m = f"{k[:6]}...{k[-4:]}"
                else:
                    m = "******"
                is_active = k in self.active_queue
                q_info = self.quarantined.get(k)
                status = "ACTIVE" if is_active else ("QUARANTINED: " + q_info["error"] if q_info else "INACTIVE")
                masked.append({"index": i + 1, "masked": m, "raw": k, "status": status, "is_active": is_active})
            return masked

    def get_status(self):
        with self.lock:
            return {
                "total_keys": len(self.all_keys),
                "active_keys": len(self.active_queue),
                "quarantined_keys": len(self.quarantined),
                "quarantine_list": [
                    {"masked": v["masked"], "error": v["error"], "time_ago_sec": int(time.time() - v["time"])}
                    for v in self.quarantined.values()
                ]
            }

rotator = ApiKeyRotator()

# Custom Reference Knowledgebase & Rulebook Context Manager
class KnowledgeContextManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.enabled = False
        self.text = ""
        self.filename = ""
        self.load()

    def load(self):
        with self.lock:
            if os.path.exists(CONTEXT_CONFIG_FILE):
                try:
                    with open(CONTEXT_CONFIG_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self.enabled = data.get("enabled", False)
                        self.filename = data.get("filename", "")
                except Exception as e:
                    print(f"[Context Warning] Failed to load context config: {e}", flush=True)

            if os.path.exists(CONTEXT_FILE):
                try:
                    with open(CONTEXT_FILE, "r", encoding="utf-8") as f:
                        self.text = f.read()
                except Exception as e:
                    print(f"[Context Warning] Failed to read context text: {e}", flush=True)

    def save(self, text, enabled=True, filename=""):
        with self.lock:
            self.text = text or ""
            self.enabled = enabled
            if filename:
                self.filename = filename
            try:
                with open(CONTEXT_FILE, "w", encoding="utf-8") as f:
                    f.write(self.text)
                with open(CONTEXT_CONFIG_FILE, "w", encoding="utf-8") as f:
                    json.dump({"enabled": self.enabled, "filename": self.filename}, f)
                print(f"[Context Engine] Saved {len(self.text.split())} words of custom context (Enabled={self.enabled}).", flush=True)
            except Exception as e:
                print(f"[Context Error] Failed to save context: {e}", flush=True)

    def clear(self):
        with self.lock:
            self.text = ""
            self.enabled = False
            self.filename = ""
            try:
                if os.path.exists(CONTEXT_FILE):
                    os.remove(CONTEXT_FILE)
                with open(CONTEXT_CONFIG_FILE, "w", encoding="utf-8") as f:
                    json.dump({"enabled": False, "filename": ""}, f)
                print("[Context Engine] Cleared custom context completely.", flush=True)
            except Exception as e:
                print(f"[Context Error] Failed to clear context: {e}", flush=True)

    def get_info(self):
        with self.lock:
            words = len(self.text.split()) if self.text else 0
            chars = len(self.text) if self.text else 0
            return {
                "enabled": self.enabled,
                "text": self.text,
                "filename": self.filename,
                "word_count": words,
                "char_count": chars
            }

    def extract_text_from_file(self, file_path, original_filename=""):
        ext = os.path.splitext(file_path)[1].lower()
        extracted = ""
        if ext == ".pdf":
            try:
                import pypdf
                reader = pypdf.PdfReader(file_path)
                pages_text = []
                for i, page in enumerate(reader.pages):
                    t = page.extract_text()
                    if t:
                        pages_text.append(f"--- PAGE {i+1} ---\n{t}")
                extracted = "\n\n".join(pages_text)
            except Exception as e:
                print(f"[PDF Extract Error] {e}", flush=True)
                raise Exception(f"Failed to read PDF: {e}")
        else:
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    extracted = f.read()
            except Exception as e:
                raise Exception(f"Failed to read text file: {e}")

        clean_text = extracted.strip()
        if not clean_text:
            raise Exception("No readable text could be extracted from this document.")

        self.save(clean_text, enabled=True, filename=original_filename or os.path.basename(file_path))
        return self.get_info()

context_manager = KnowledgeContextManager()

# Persistent Typing Speed Configuration
class TypingSpeedManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.min_delay_ms = 25
        self.max_delay_ms = 55
        self.preset_name = "normal"
        self.load()

    def load(self):
        with self.lock:
            if os.path.exists(SPEED_CONFIG_FILE):
                try:
                    with open(SPEED_CONFIG_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self.min_delay_ms = int(data.get("min_delay_ms", 25))
                        self.max_delay_ms = int(data.get("max_delay_ms", 55))
                        self.preset_name = data.get("preset_name", "normal")
                except Exception as e:
                    print(f"[Speed Config Warning] {e}", flush=True)

    def set_speed(self, min_ms, max_ms, preset_name="custom", save=True):
        with self.lock:
            self.min_delay_ms = max(2, int(min_ms))
            self.max_delay_ms = max(self.min_delay_ms, int(max_ms))
            self.preset_name = preset_name
            if save:
                try:
                    with open(SPEED_CONFIG_FILE, "w", encoding="utf-8") as f:
                        json.dump({
                            "min_delay_ms": self.min_delay_ms,
                            "max_delay_ms": self.max_delay_ms,
                            "preset_name": self.preset_name
                        }, f)
                    print(f"[Speed Config] Saved speed config ({self.preset_name}: {self.min_delay_ms}-{self.max_delay_ms}ms).", flush=True)
                except Exception as e:
                    print(f"[Speed Config Error] {e}", flush=True)

    def get_info(self):
        with self.lock:
            return {
                "min_delay_ms": self.min_delay_ms,
                "max_delay_ms": self.max_delay_ms,
                "preset_name": self.preset_name
            }

speed_manager = TypingSpeedManager()

AI_MODEL_CONFIG_FILE = os.path.join(os.path.dirname(__file__), "ai_model_config.json")

class AIModelManager:
    """
    Manages AI Model Selection and Gemini 2.5 Thinking Budget.
    Provides Ultra Instant (0s thinking) for ultra-fast latency (<1s response).
    """
    def __init__(self):
        self.lock = threading.Lock()
        self.presets = {
            "ultra_instant": {
                "name": "⚡ Ultra Instant (0s Thinking ~0.6s - 1.0s) [Ultra Fast]",
                "model": "gemini-2.5-flash",
                "thinking_budget": 0,
                "description": "Zero thinking overhead. Direct instant answers in under a second!"
            },
            "fast_turbo": {
                "name": "🚀 Fast Turbo (Light Reasoning ~1.2s - 2.0s)",
                "model": "gemini-2.5-flash",
                "thinking_budget": 512,
                "description": "Minimal thinking budget for fast yet checked logic."
            },
            "balanced": {
                "name": "⚖️ Balanced Reasoning (~2.0s - 3.5s)",
                "model": "gemini-2.5-flash",
                "thinking_budget": 1024,
                "description": "Standard balanced reasoning for coding challenges."
            },
            "deep_thinking": {
                "name": "🧠 Deep Thinking (~4.0s - 7.0s)",
                "model": "gemini-2.5-flash",
                "thinking_budget": -1,
                "description": "Full dynamic reasoning for complex proofs and hard algorithms."
            },
            "pro_expert": {
                "name": "🌟 Gemini 2.5 Pro Expert",
                "model": "gemini-2.5-pro",
                "thinking_budget": -1,
                "description": "Flagship Pro model for multi-file system architecture."
            }
        }
        self.current_preset = "ultra_instant"
        self.load()

    def load(self):
        with self.lock:
            if os.path.exists(AI_MODEL_CONFIG_FILE):
                try:
                    with open(AI_MODEL_CONFIG_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        preset = data.get("current_preset", "ultra_instant")
                        if preset in self.presets:
                            self.current_preset = preset
                except Exception as e:
                    print(f"[AI Model Config Warning] {e}", flush=True)

    def save(self):
        try:
            with open(AI_MODEL_CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump({"current_preset": self.current_preset}, f, indent=2)
        except Exception as e:
            print(f"[AI Model Config Error] {e}", flush=True)

    def set_preset(self, preset_key):
        with self.lock:
            if preset_key in self.presets:
                self.current_preset = preset_key
                self.save()
                print(f"[AI Model Config] Active preset changed to: {self.current_preset} ({self.presets[self.current_preset]['name']})", flush=True)
                return True
            return False

    def get_info(self):
        with self.lock:
            info = self.presets.get(self.current_preset, self.presets["ultra_instant"])
            return {
                "current_preset": self.current_preset,
                "name": info["name"],
                "model": info["model"],
                "thinking_budget": info["thinking_budget"],
                "description": info["description"],
                "presets": self.presets
            }

    def get_generate_config(self):
        with self.lock:
            info = self.presets.get(self.current_preset, self.presets["ultra_instant"])
            budget = info.get("thinking_budget", 0)
            if not HAS_GENAI:
                return None
            if budget == 0:
                return types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(thinking_budget=0)
                )
            elif budget > 0:
                return types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(thinking_budget=budget)
                )
            else:
                return types.GenerateContentConfig()

model_manager = AIModelManager()

# Thread-safe Emergency Typing Abort Controller
class TypingAbortController:
    def __init__(self):
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self.pause_event.set()
        self.is_typing = False
        self.is_paused = False
        self.lock = threading.Lock()

    def start_typing(self):
        with self.lock:
            self.stop_event.clear()
            self.pause_event.set()
            self.is_typing = True
            self.is_paused = False

    def pause_typing(self):
        with self.lock:
            self.is_paused = True
            self.pause_event.clear()
            print("[Typing Controller] ⏸️ Typing PAUSED at current character index.", flush=True)

    def resume_typing(self):
        with self.lock:
            self.is_paused = False
            self.pause_event.set()
            print("[Typing Controller] ▶️ Typing RESUMED from current character index.", flush=True)

    def toggle_pause(self):
        with self.lock:
            if self.is_paused:
                self.is_paused = False
                self.pause_event.set()
                print("[Typing Controller] ▶️ Typing RESUMED.", flush=True)
            else:
                self.is_paused = True
                self.pause_event.clear()
                print("[Typing Controller] ⏸️ Typing PAUSED.", flush=True)
            return self.is_paused

    def stop_typing(self):
        with self.lock:
            self.stop_event.set()
            self.pause_event.set()
            self.is_typing = False
            self.is_paused = False
            print("[Typing Abort] EMERGENCY STOP SIGNAL TRIGGERED! Halting active typing.", flush=True)

    def should_stop(self):
        return self.stop_event.is_set()

    def wait_if_paused(self):
        while self.is_paused and not self.should_stop():
            time.sleep(0.04)

    def finish_typing(self):
        with self.lock:
            self.is_typing = False
            self.is_paused = False
            self.pause_event.set()

typing_controller = TypingAbortController()

try:
    from google import genai
    from google.genai import types
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

app = Flask(__name__)

# Constants
GEMINI_URL = "https://gemini.google.com/app"
USER_DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "user_data"))

# Elite Problem-Solving & AI Evaluation Master Prompt with Intelligent Intent Detection
BASE_MASTER_PROMPT = (
    "You are an elite coding expert, AI benchmark evaluator, RLHF specialist, and technical assistant.\n"
    "Your task is to analyze the image or input, AUTOMATICALLY DETECT the exact type of question/task, and SOLVE it with 100% precision.\n"
    "DO NOT repeat the question. DO NOT summarize the question unnecessarily.\n\n"
    "AUTOMATIC TASK INTENT DETECTION & OUTPUT PROTOCOLS:\n\n"
    "PROTOCOL 1: ORAL / READING / INTERVIEW / CONCEPTUAL / VIVA QUESTIONS (PREFIX: [VOICE])\n"
    "Detect if the question is conceptual, theoretical, behavioral, viva, or an interview question (e.g. 'Explain...', 'What is...', 'Why...', 'How does...', 'Difference between...', or spoken audio):\n"
    "• Prefix your response with: [VOICE]\n"
    "• STRUCTURE & SPOKEN HUMAN DELIVERY (CRITICAL FOR LIVE INTERVIEWS):\n"
    "  1. Start with 1 natural, conversational opening sentence (e.g. 'Basically, in simple terms...', 'In practical projects, the core idea is...', 'To break this down simply...').\n"
    "  2. Follow with EXACTLY 3 direct, punchy bullet points (• Point 1, • Point 2, • Point 3) highlighting the key concept, role, and practical benefit.\n"
    "  3. End with 1 short, confident takeaway sentence (10-14 words).\n"
    "• VOCABULARY & NATURAL TONE RULES:\n"
    "  - Speak like a friendly, experienced human software engineer explaining to a peer, NOT a textbook or dictionary.\n"
    "  - Use simple, plain, everyday conversational English that is very easy to pronounce.\n"
    "  - STRICTLY FORBIDDEN: Complex, rare, archaic, pretentious, or difficult-to-pronounce words (e.g. DO NOT use words like 'juxtaposition', 'quintessential', 'obfuscate', 'ubiquitous', 'paradigm', 'egregious', 'idiosyncratic', 'circumvent', 'insurmountable', 'aforementioned', etc.).\n"
    "  - Use common, familiar words so non-native speakers (such as Bangladeshi students) can read it aloud fluently without stuttering, stumbling, or fumbling.\n"
    "  - Standard industry technical terms (e.g. API, function, array, database, loop, memory, cache, thread, server, async) are completely fine.\n"
    "  - Keep sentences short, crisp, and punchy (10 to 14 words per sentence) so they can be spoken comfortably in one breath.\n"
    "  - Total length: 50 to 80 words max.\n\n"
    "PROTOCOL 2: STANDARD CODING / PURE PROGRAMMING PROBLEM (PREFIX: [TYPE])\n"
    "When asked to write a program, algorithm, script, query, or solve a coding challenge in a single file/box:\n"
    "• Prefix with: [TYPE]\n"
    "• ANTI-AI CODE SIGNATURES (CRITICAL TO AVOID SUSPICION):\n"
    "  - Output ONLY clean, standard, production-ready code with natural variable names.\n"
    "  - STRICTLY FORBIDDEN: Redundant AI essay comments (e.g. DO NOT write '// Step 1: Initialize variables', '// Time Complexity: O(N)', '// Optimal two pointer approach', '# Helper function to calculate...').\n"
    "  - Write code exactly as a senior human engineer writes under live interview conditions.\n"
    "  - DO NOT output markdown code block fences (```) or conversational filler text.\n\n"
    "PROTOCOL 3: MULTI-PART EVALUATION / RLHF / BUG FIXING / CODE COMPARISON\n"
    "When a task requires writing code AND providing an explanation/critique or rating:\n"
    "You MUST structure your output using these exact tags:\n"
    "<<<SLOT:RATING>>>\n"
    "Concise verdict (e.g. 'Model A is significantly better (5/5 vs 2/5)' or 'Verdict: Root Cause Identified')\n"
    "<<<SLOT:CODE>>>\n"
    "Clean, 100% production-ready bugfix or solution code (No AI boilerplate comments)\n"
    "<<<SLOT:EXPLANATION>>>\n"
    "Clear, natural human explanation covering:\n"
    "• Root Cause / Critique: Why original code failed or comparison breakdown.\n"
    "• The Fix: What was changed and why in simple words.\n"
    "• Complexity: Short time & space summary.\n"
    "<<<SLOT:AUDIT>>>\n"
    "(If applicable: Hallucination status, fake libraries detected, valid official alternatives)\n\n"
    "PROTOCOL 4: MULTIPLE CHOICE / CHECKBOX QUESTIONS (PREFIX: [CHECK])\n"
    "• Prefix with: [CHECK] followed by the correct option letter and text.\n"
    "  Example: [CHECK] Option B: O(n log n)\n\n"
    "PROTOCOL 5: DIRECT COMPARISON / BEST OPTION QUESTIONS (PREFIX: [COMPARE])\n"
    "• Prefix with: [COMPARE] BEST: <Selected Option> | WHY: <Clear, simple 1-sentence reason>."
)

def build_effective_master_prompt():
    """Injects custom PDF/Text rulebook knowledge into the master prompt if active."""
    ctx = context_manager.get_info()
    if ctx["enabled"] and ctx["text"].strip():
        rules = ctx["text"].strip()
        return (
            f"{BASE_MASTER_PROMPT}\n\n"
            f"CRITICAL REFERENCE RULES & EXAM GUIDELINES (STRICTLY OBEY ALL RULES BELOW):\n"
            f"=======================================================================\n"
            f"{rules}\n"
            f"=======================================================================\n"
            f"TASK: Solve the problem shown in the image strictly adhering to and applying the reference rules and guidelines provided above."
        )
    return BASE_MASTER_PROMPT

# Win32 API Window Manipulation
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_APPWINDOW = 0x00010000
SW_SHOWNORMAL = 1
HWND_TOP = 0
SWP_SHOWWINDOW = 0x0040

def get_chromium_hwnds():
    if sys.platform != "win32":
        return []
    user32 = ctypes.windll.user32
    found = []
    def callback(hwnd, extra):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                title = buff.value.lower()
                if "gemini" in title or "chrome" in title or "chromium" in title:
                    found.append(hwnd)
        return True
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(WNDENUMPROC(callback), 0)
    return found

def hide_browser_stealth():
    """Moves Chromium off-screen and removes it from Windows Taskbar."""
    if sys.platform != "win32":
        return
    try:
        user32 = ctypes.windll.user32
        hwnds = get_chromium_hwnds()
        for hwnd in hwnds:
            style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            new_style = (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, new_style)
            user32.SetWindowPos(hwnd, 0, 10000, 10000, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020)
            print(f"[Stealth Mode] Window {hwnd} hidden from taskbar and placed off-screen.", flush=True)
    except Exception as e:
        print(f"[Stealth Warning] {e}", flush=True)

def show_browser_onscreen():
    """Brings Chromium to center of screen and restores taskbar presence."""
    if sys.platform != "win32":
        return
    try:
        user32 = ctypes.windll.user32
        hwnds = get_chromium_hwnds()
        for hwnd in hwnds:
            style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            new_style = (style & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, new_style)
            user32.ShowWindow(hwnd, SW_SHOWNORMAL)
            user32.SetWindowPos(hwnd, HWND_TOP, 100, 80, 1280, 850, SWP_SHOWWINDOW)
            user32.SetForegroundWindow(hwnd)
            print(f"[Visible Mode] Window {hwnd} brought to center screen (100, 80).", flush=True)
    except Exception as e:
        print(f"[Visible Warning] {e}", flush=True)

# Win32 SendInput Structures & Driver-Level Keystroke Injection
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_SCANCODE = 0x0008

class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p)
    ]

class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD)
    ]

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p)
    ]

class INPUT_UNION(ctypes.Union):
    _fields_ = [
        ("ki", KEYBDINPUT),
        ("mi", MOUSEINPUT),
        ("hi", HARDWAREINPUT)
    ]

class INPUT(ctypes.Structure):
    _fields_ = [
        ("type", wintypes.DWORD),
        ("union", INPUT_UNION)
    ]

def send_input_unicode(char_code, key_hold_time=0.005):
    """Sends a Unicode character via driver-level SendInput API."""
    user32 = ctypes.windll.user32
    inp_down = INPUT()
    inp_down.type = INPUT_KEYBOARD
    inp_down.union.ki.wVk = 0
    inp_down.union.ki.wScan = char_code
    inp_down.union.ki.dwFlags = KEYEVENTF_UNICODE
    inp_down.union.ki.time = 0
    inp_down.union.ki.dwExtraInfo = None

    inp_up = INPUT()
    inp_up.type = INPUT_KEYBOARD
    inp_up.union.ki.wVk = 0
    inp_up.union.ki.wScan = char_code
    inp_up.union.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
    inp_up.union.ki.time = 0
    inp_up.union.ki.dwExtraInfo = None

    user32.SendInput(1, ctypes.byref(inp_down), ctypes.sizeof(INPUT))
    if key_hold_time > 0:
        time.sleep(key_hold_time)
    user32.SendInput(1, ctypes.byref(inp_up), ctypes.sizeof(INPUT))

def send_input_vk(vk, scancode, key_hold_time=0.005):
    """Sends a Virtual Key with hardware scan code via SendInput API."""
    user32 = ctypes.windll.user32
    inp_down = INPUT()
    inp_down.type = INPUT_KEYBOARD
    inp_down.union.ki.wVk = vk
    inp_down.union.ki.wScan = scancode
    inp_down.union.ki.dwFlags = 0
    inp_down.union.ki.time = 0
    inp_down.union.ki.dwExtraInfo = None

    inp_up = INPUT()
    inp_up.type = INPUT_KEYBOARD
    inp_up.union.ki.wVk = vk
    inp_up.union.ki.wScan = scancode
    inp_up.union.ki.dwFlags = KEYEVENTF_KEYUP
    inp_up.union.ki.time = 0
    inp_up.union.ki.dwExtraInfo = None

    user32.SendInput(1, ctypes.byref(inp_down), ctypes.sizeof(INPUT))
    if key_hold_time > 0:
        time.sleep(key_hold_time)
    user32.SendInput(1, ctypes.byref(inp_up), ctypes.sizeof(INPUT))

# Serialization lock to prevent simultaneous keystroke collisions
typing_lock = threading.Lock()

# Realistic Standard US QWERTY Adjacent Key Map for Simulated Human Typos
QWERTY_NEIGHBORS = {
    'a': ['q', 'w', 's', 'z'],
    'b': ['v', 'g', 'h', 'n'],
    'c': ['x', 'd', 'f', 'v'],
    'd': ['s', 'e', 'r', 'f', 'c', 'x'],
    'e': ['w', 's', 'd', 'r'],
    'f': ['d', 'r', 't', 'g', 'v'],
    'g': ['f', 't', 'y', 'h', 'b', 'v'],
    'h': ['g', 'y', 'u', 'j', 'b'],
    'i': ['u', 'j', 'k', 'o'],
    'j': ['h', 'u', 'i', 'k', 'n'],
    'k': ['j', 'i', 'o', 'l', 'm'],
    'l': ['k', 'o', 'p'],
    'm': ['n', 'j', 'k'],
    'n': ['b', 'h', 'j', 'm'],
    'o': ['i', 'k', 'l', 'p'],
    'p': ['o', 'l'],
    'q': ['w', 'a'],
    'r': ['e', 'd', 'f', 't'],
    's': ['a', 'w', 'e', 'd', 'x', 'z'],
    't': ['r', 'f', 'g', 'y'],
    'u': ['y', 'h', 'j', 'i'],
    'v': ['c', 'f', 'g', 'b'],
    'w': ['q', 'a', 's', 'e'],
    'x': ['z', 's', 'd', 'c'],
    'y': ['t', 'g', 'h', 'u'],
    'z': ['a', 's', 'x']
}

COMMON_BURST_KEYWORDS = {
    'function', 'return', 'const', 'import', 'export', 'async', 'await',
    'for', 'if', 'while', 'else', 'true', 'false', 'null', 'undefined',
    'class', 'def', 'self', 'let', 'var', 'public', 'private', 'static',
    'void', 'int', 'string', 'boolean', 'package', 'new', 'try', 'catch',
    'func', 'chan', 'defer', 'select', 'impl', 'mut', 'trait', 'enum',
    'override', 'object', 'SELECT', 'FROM', 'WHERE', 'JOIN'
}

def is_python_code(code_text):
    """Detects whether the code snippet is Python (requires 4-space indents, not tabs)."""
    if not code_text:
        return False
    has_py_kw = bool(re.search(r'\b(def|elif|lambda|pass|assert|except|finally)\b', code_text))
    has_braces = '{' in code_text and '}' in code_text
    return has_py_kw or (not has_braces and ':' in code_text)

def humanize_code_for_typing(code_text):
    """
    Universal Multi-Language Deterministic Code Humanizer (0.1ms):
    1. Converts indents safely: Smart 4-space burst for Python (prevents TabError) & Tab for others.
    2. Protects string literals and keywords across 15+ programming languages.
    3. Naturally varies ~20-30% of binary operators and control syntax for realistic human coding aesthetics.
    """
    if not code_text or not code_text.strip():
        return code_text

    import random
    is_py = is_python_code(code_text)
    lines = code_text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    humanized_lines = []

    # Comprehensive multi-language keywords covering JS/TS, Python, Java, C/C++, C#, Go, Rust, Kotlin, SQL, Swift, PHP, Ruby
    KEYWORDS = (
        r'\b(let|const|var|return|def|class|int|float|double|char|long|short|byte|boolean|bool|'
        r'public|private|protected|static|void|import|from|export|new|throw|typeof|instanceof|'
        r'yield|package|struct|fn|val|fun|elif|except|finally|raise|with|as|lambda|assert|pass|'
        r'func|chan|defer|select|go|interface|impl|mut|trait|enum|pub|match|where|override|object|'
        r'constexpr|nullptr|auto|template|typename|using|namespace|'
        r'SELECT|FROM|WHERE|JOIN|GROUP|ORDER|INSERT|UPDATE|DELETE|CREATE|TABLE|ALTER|DROP|HAVING|LIMIT)\b'
    )

    for line in lines:
        if not line:
            humanized_lines.append('')
            continue

        # 1. Smart Indentation handling
        l_stripped = line.lstrip(' ')
        leading_spaces = len(line) - len(l_stripped)
        tab_count = leading_spaces // 4
        rem_spaces = leading_spaces % 4

        if is_py:
            # For Python: maintain 4-space blocks to strictly prevent TabError
            indent = ('    ' * tab_count) + (' ' * rem_spaces)
        else:
            # For other languages: use 1 Tab per 4 spaces
            indent = ('\t' * tab_count) + (' ' * rem_spaces)

        # 2. Tokenize line into Strings, Comments, and Code (Supporting //, /* */, #, --, <!-- -->)
        parts = re.split(r'(".*?"|\'.*?\'|`.*?`|//.*$|#.*$|--.*$|<!--.*?-->)', l_stripped)
        transformed_parts = []

        for part in parts:
            if not part:
                continue
            # If this part is a string literal or comment, leave it 100% UNTOUCHED
            if (part.startswith('"') or part.startswith("'") or part.startswith('`') or 
                part.startswith('//') or part.startswith('#') or part.startswith('--') or part.startswith('<!--')):
                transformed_parts.append(part)
            else:
                code_part = part

                # A. Control Flow keyword spacing (e.g. 'for (' -> 'for(', 'if (' -> 'if(') with ~35% chance
                if random.random() < 0.35:
                    code_part = re.sub(r'\b(for|if|while|switch|catch)\s+\(', r'\1(', code_part)

                # B. Assignment spacing (e.g. 'diff = target' -> 'diff=target', 'seen[n] = i' -> 'seen[n]=i') with ~30% chance
                def compact_assign(m):
                    if random.random() < 0.30:
                        return f'{m.group(1)}={m.group(2)}'
                    return m.group(0)
                code_part = re.sub(r'([a-zA-Z0-9_\]\)])\s+=\s+([a-zA-Z0-9_\[\(\'"])', compact_assign, code_part)

                # C. Binary operator spacing (e.g. 'target - n' -> 'target-n', 'x + 1' -> 'x+1') with ~25% chance
                def compact_op(m):
                    if random.random() < 0.25:
                        return f'{m.group(1)}{m.group(2)}{m.group(3)}'
                    return m.group(0)
                code_part = re.sub(r'([a-zA-Z0-9_\]\)])\s*([\+\-\*\/])\s*([a-zA-Z0-9_\[\(\'"])', compact_op, code_part)

                # D. Comparison operator spacing (e.g. 'i < n' -> 'i<n', 'a == b' -> 'a==b') with ~25% chance
                def compact_comp(m):
                    if random.random() < 0.25:
                        return f'{m.group(1)}{m.group(2)}{m.group(3)}'
                    return m.group(0)
                code_part = re.sub(r'([a-zA-Z0-9_\]\)])\s+(<=|>=|==|!=|<|>)\s+([a-zA-Z0-9_\[\(\'"])', compact_comp, code_part)

                # Safety Check: Ensure mandatory keywords never lost their trailing space
                code_part = re.sub(f'{KEYWORDS}([a-zA-Z0-9_])', r'\1 \2', code_part)

                transformed_parts.append(code_part)

        humanized_lines.append(indent + ''.join(transformed_parts))

    return '\n'.join(humanized_lines)

def inject_keystrokes_to_active_window(text, min_delay_ms=None, max_delay_ms=None):
    """
    Types text character-by-character into active foreground window on Windows.
    Simulates real human physical typing with:
    1. Driver-level Win32 SendInput API (Zero clipboard touching, high stealth)
    2. Smart line indentation conversion (4-space burst for Python / Tab key for others)
    3. Realistic QWERTY neighbor typos & auto-correction
    4. Casual human operator spacing variations across all programming languages
    5. Muscle-memory burst typing on common programming keywords
    6. Natural thinking hesitation pauses before new lines and structural syntax
    7. Syllable cognitive micro-jitter for identifier names
    Allows instant emergency abort via typing_controller.
    """
    import random
    if sys.platform != "win32":
        return False

    if not text or not text.strip():
        return False

    # Automatically apply smart humanization (tab indents + safe casual spacing)
    text_to_type = humanize_code_for_typing(text)

    with typing_lock:
        typing_controller.start_typing()

        VK_RETURN = 0x0D
        VK_TAB = 0x09
        VK_BACK = 0x08
        VK_SPACE = 0x20

        print(f"[SendInput Stealth Engine] >>> INJECTING {len(text_to_type)} CHARACTERS (Raw Driver Input Active) <<<", flush=True)

        # Safety: Release any stuck OS modifier keys (Alt, Ctrl, Win) via SendInput
        try:
            for vk in [0x12, 0x11, 0x5B, 0x5C]: # VK_MENU, VK_CONTROL, VK_LWIN, VK_RWIN
                send_input_vk(vk, 0, key_hold_time=0)
        except Exception:
            pass

        typo_cooldown = 20 # Minimum characters before next typo can occur
        chars_since_typo = 20

        try:
            for i, char in enumerate(text_to_type):
                if typing_controller.should_stop():
                    print("[SendInput Stealth Engine] Stopped by Emergency Abort command.", flush=True)
                    return False

                # Handle instant pause/resume at current char index
                typing_controller.wait_if_paused()
                if typing_controller.should_stop():
                    return False

                # Dynamic real-time speed from settings
                speed_info = speed_manager.get_info()
                curr_min_ms = speed_info.get("min_delay_ms", 25)
                curr_max_ms = speed_info.get("max_delay_ms", 55)
                curr_min_ms = max(2, int(curr_min_ms))
                curr_max_ms = max(curr_min_ms, int(curr_max_ms))

                code = ord(char)
                key_hold_time = 0.005 if curr_min_ms < 50 else 0.015
                char_delay = random.uniform(curr_min_ms, curr_max_ms) / 1000.0

                # 1. Simulated Realistic Human Typo & Auto-Correction Engine
                # Occurs with ~2.5% probability on lowercase letters when speed is not "ultra"
                chars_since_typo += 1
                if (curr_min_ms >= 10 and chars_since_typo > typo_cooldown and 
                    char.islower() and char in QWERTY_NEIGHBORS and random.random() < 0.025):
                    
                    typo_char = random.choice(QWERTY_NEIGHBORS[char])
                    typo_code = ord(typo_char)

                    # Type the mistaken neighbor key via SendInput
                    send_input_unicode(typo_code, key_hold_time)
                    
                    # Human reaction time recognizing typo (70ms - 150ms)
                    time.sleep(random.uniform(0.07, 0.15))

                    # Press Backspace to erase typo via SendInput
                    send_input_vk(VK_BACK, 0x0E, key_hold_time)
                    
                    # Brief micro pause before typing correct character (40ms - 90ms)
                    time.sleep(random.uniform(0.04, 0.09))
                    chars_since_typo = 0

                # 2. Syntax & Structural Hesitation Delays (Real programmer thinking pauses)
                if char == '\n':
                    # Natural pause before starting a new line of logic (0.12s - 0.28s)
                    line_pause = random.uniform(0.12, 0.28) if curr_min_ms >= 15 else 0.02
                    send_input_vk(VK_RETURN, 0x1C, key_hold_time)
                    time.sleep(line_pause)
                    continue

                if char == '\t':
                    # Tab jump keystroke
                    tab_delay = random.uniform(0.012, 0.028) if curr_min_ms >= 15 else 0.005
                    send_input_vk(VK_TAB, 0x0F, key_hold_time)
                    time.sleep(tab_delay)
                    continue

                if char in ['{', '}', '(', ')', ';', '=', ',']:
                    extra = random.uniform(0.025, 0.065) if curr_min_ms >= 15 else 0.005
                    char_delay += extra

                # 3. Send Unicode character via driver-level SendInput
                send_input_unicode(code, key_hold_time)
                time.sleep(char_delay)

            print(f"[SendInput Stealth Engine] ✅ Successfully finished typing {len(text_to_type)} characters.", flush=True)
            return True
        finally:
            typing_controller.finish_typing()

def clean_code_snippet(text):
    """
    Cleans code snippet and aggressively strips markdown fences & AI watermark comments
    across all programming languages (C/C++/Java/JS //, Python/Ruby/Bash #, SQL --, HTML <!-- -->)
    so the output looks 100% written by a real human engineer in a live interview.
    """
    if not text:
        return ""
    
    cleaned = text.strip()
    # Strip markdown code blocks
    cleaned = re.sub(r'^```[a-zA-Z0-9_-]*\n?', '', cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'\n?```$', '', cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'```', '', cleaned)

    # Strip AI Watermark comments & LeetCode essay commentary across all comment styles
    ai_comment_patterns = [
        r'//\s*(?:Step\s*\d+|Time\s*Complexity|Space\s*Complexity|Time\s*:|Space\s*:|TC\s*:|SC\s*:|Optimal|Approach|Algorithm|Complexity|Note\s*:).*',
        r'#\s*(?:Step\s*\d+|Time\s*Complexity|Space\s*Complexity|Time\s*:|Space\s*:|TC\s*:|SC\s*:|Optimal|Approach|Algorithm|Complexity|Note\s*:).*',
        r'--\s*(?:Step\s*\d+|Time\s*Complexity|Space\s*Complexity|Time\s*:|Space\s*:|TC\s*:|SC\s*:|Optimal|Approach|Algorithm|Complexity|Note\s*:).*',
        r'<!--\s*(?:Step\s*\d+|Time\s*Complexity|Space\s*Complexity|LeetCode).*?-->',
        r'/\*\s*(?:Time\s*Complexity|Space\s*Complexity|LeetCode).*?\*/',
        r'//\s*LeetCode\s*.*',
        r'#\s*LeetCode\s*.*',
        r'--\s*LeetCode\s*.*'
    ]
    for pat in ai_comment_patterns:
        cleaned = re.sub(pat, '', cleaned, flags=re.IGNORECASE)

    # Clean up redundant consecutive empty lines
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    return cleaned

def parse_ai_response(raw_text):
    raw_text = (raw_text or "").strip()
    
    # Check for Multi-Slot tags
    has_slot = bool(re.search(r'<<<SLOT:(RATING|CODE|EXPLANATION|AUDIT)>>>', raw_text, re.IGNORECASE))
    if has_slot:
        rating_match = re.search(r'<<<SLOT:RATING>>>(.*?)(?=<<<SLOT:|$)', raw_text, re.DOTALL | re.IGNORECASE)
        code_match = re.search(r'<<<SLOT:CODE>>>(.*?)(?=<<<SLOT:|$)', raw_text, re.DOTALL | re.IGNORECASE)
        explanation_match = re.search(r'<<<SLOT:EXPLANATION>>>(.*?)(?=<<<SLOT:|$)', raw_text, re.DOTALL | re.IGNORECASE)
        audit_match = re.search(r'<<<SLOT:AUDIT>>>(.*?)(?=<<<SLOT:|$)', raw_text, re.DOTALL | re.IGNORECASE)
        
        rating = rating_match.group(1).strip() if rating_match else ""
        code = clean_code_snippet(code_match.group(1).strip()) if code_match else ""
        explanation = explanation_match.group(1).strip() if explanation_match else ""
        audit = audit_match.group(1).strip() if audit_match else ""
        
        # Primary payload priority: code -> explanation -> raw
        primary_payload = code if code else (explanation if explanation else raw_text)
        
        slots = {
            "rating": rating,
            "code": code,
            "explanation": explanation,
            "audit": audit
        }
        
        return "[MULTI-SLOT]", primary_payload, True, slots
    
    tag = "[TYPE]"
    payload = raw_text

    tag_match = re.search(r'\[(TYPE|CHECK|VOICE|COMPARE)\]', raw_text, re.IGNORECASE)
    if tag_match:
        tag_name = tag_match.group(1).upper()
        tag = f"[{tag_name}]"
        payload = re.sub(r'^\s*(\*{1,3})?\[' + tag_name + r'\](\*{1,3})?\s*:?\s*', '', raw_text, flags=re.IGNORECASE).strip()
    else:
        if '```' in raw_text or 'function ' in raw_text or 'def ' in raw_text or 'class ' in raw_text:
            tag = "[TYPE]"
            payload = clean_code_snippet(raw_text)
        else:
            tag = "[TYPE]"
            payload = raw_text

    if tag == "[TYPE]":
        payload = clean_code_snippet(payload)

    return tag, payload, False, {}

def preprocess_and_optimize_image_for_gemini(image_path, max_dim=1600):
    """
    Optimizes screen capture images for Gemini Vision:
    1. Downscales large photos to max 1600px with Lanczos resampling.
    2. Applies gentle UnsharpMask and Contrast boost for razor-sharp text/code.
    3. Encodes to ultra-efficient WebP byte part.
    """
    img = Image.open(image_path)
    if img.mode != 'RGB':
        img = img.convert('RGB')

    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / float(max(w, h))
        new_w = int(w * scale)
        new_h = int(h * scale)
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Adaptive Text Sharpening & Contrast Boost
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(1.15)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=125, threshold=3))

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=85, method=6)
    webp_bytes = buf.getvalue()

    return types.Part.from_bytes(data=webp_bytes, mime_type="image/webp")

def analyze_with_rotated_gemini_api(image_path):
    """
    Executes vision analysis with Round-Robin Key Rotation, Dynamic Model, Thinking Budget & Instant Auto-Failover.
    Automatically optimizes image with WebP + Adaptive Edge Sharpening, and auto-quarantines failing keys.
    """
    total_keys = len(rotator.keys)
    if total_keys == 0:
        raise Exception("No Gemini API Keys configured in .env or rotator.")

    last_err = None
    img_part = preprocess_and_optimize_image_for_gemini(image_path)
    prompt = build_effective_master_prompt()
    ctx_info = context_manager.get_info()
    if ctx_info["enabled"]:
        print(f"[Context Engine] Attaching {ctx_info['word_count']} words of reference guidelines to prompt.", flush=True)

    curr_model_info = model_manager.get_info()
    model_name = curr_model_info.get("model", "gemini-2.5-flash")
    gen_config = model_manager.get_generate_config()
    print(f"[AI Model Engine] Selected: {curr_model_info['name']} (Budget: {curr_model_info['thinking_budget']})", flush=True)

    max_attempts = max(1, rotator.get_active_count())
    for attempt in range(max_attempts):
        api_key = rotator.get_next_key()
        if not api_key:
            break
        masked_key = f"{api_key[:6]}...{api_key[-4:]}" if len(api_key) > 10 else "***"
        print(f"[API Rotator] (Attempt {attempt+1}/{max_attempts}) Using Key: {masked_key} on {model_name}...", flush=True)

        try:
            http_opts = types.HttpOptions(timeout=10000) if hasattr(types, 'HttpOptions') else None
            client = genai.Client(api_key=api_key, http_options=http_opts) if http_opts else genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=model_name,
                contents=[prompt, img_part],
                config=gen_config
            )

            raw_text = (response.text or "").strip()
            print(f"[API Rotator] Success with key {masked_key} ({len(raw_text)} chars).", flush=True)

            tag, payload, is_multi_slot, slots = parse_ai_response(raw_text)
            return {
                "raw_answer": raw_text,
                "tag": tag,
                "payload": payload,
                "is_multi_slot": is_multi_slot,
                "slots": slots,
                "engine": f"{model_name}-api",
                "key_used": masked_key,
                "model_preset": curr_model_info['current_preset'],
                "rules_active": ctx_info["enabled"]
            }
        except Exception as e:
            last_err = e
            rotator.mark_key_failed(api_key, e)
            print(f"[API Rotator Warning] Key {masked_key} failed: {e}. Immediately rotating to next key...", flush=True)

    raise Exception(f"All API keys failed or were quarantined. Last error: {last_err}")
    
def build_effective_audio_prompt():
    base = (
        "You are an elite coding expert, AI benchmark evaluator, RLHF specialist, and technical problem solver.\n"
        "Carefully listen to and understand the user's spoken audio / question / prompt in any language (English, Bengali, Hindi, etc.).\n"
        "Transcribe and analyze what was asked or spoken in the audio, and provide the most direct, accurate, high-quality, optimal answer.\n\n"
        "STRICT OUTPUT PROTOCOLS:\n\n"
        "PROTOCOL 1: MULTI-PART / CODE + EXPLANATION / RLHF TASKS:\n"
        "When the audio asks for code along with an explanation or evaluation:\n"
        "Structure your response with:\n"
        "<<<SLOT:RATING>>>\nConcise verdict/rating\n"
        "<<<SLOT:CODE>>>\nOnly the clean, 100% production-ready solution code\n"
        "<<<SLOT:EXPLANATION>>>\nDetailed technical explanation covering root cause, logic, and complexity.\n"
        "<<<SLOT:AUDIT>>>\nEdge cases & security notes.\n\n"
        "PROTOCOL 2: STANDARD CODING OR TEXT:\n"
        "• Prefix with [TYPE] followed by the pure code or text solution to type.\n"
        "• Prefix with [CHECK] for multiple-choice or true/false questions.\n"
        "• Prefix with [VOICE] for direct spoken answers.\n"
        "Do not add conversational filler. Provide the exact solution directly."
    )
    ctx_info = context_manager.get_info()
    if ctx_info["enabled"] and ctx_info["text"]:
        base += f"\n\n### MANDATORY REFERENCE GUIDELINES & RULEBOOK:\n{ctx_info['text']}\n### END REFERENCE GUIDELINES\n"
    return base

def analyze_audio_with_rotated_gemini_api(audio_path):
    """
    Executes audio speech understanding and problem solving with Gemini API & Round-Robin Key Rotation.
    Automatically quarantines failing/exhausted keys and rotates immediately.
    """
    total_keys = len(rotator.keys)
    if total_keys == 0:
        raise Exception("No Gemini API Keys configured in .env or rotator.")

    last_err = None
    prompt = build_effective_audio_prompt()
    ctx_info = context_manager.get_info()
    if ctx_info["enabled"]:
        print(f"[Context Engine] Attaching {ctx_info['word_count']} words of reference guidelines to audio prompt.", flush=True)

    with open(audio_path, 'rb') as f:
        audio_bytes = f.read()

    mime_type = "audio/mp4"
    if audio_path.endswith(".mp3"):
        mime_type = "audio/mp3"
    elif audio_path.endswith(".wav"):
        mime_type = "audio/wav"
    elif audio_path.endswith(".ogg") or audio_path.endswith(".opus"):
        mime_type = "audio/ogg"
    elif audio_path.endswith(".m4a") or audio_path.endswith(".aac") or audio_path.endswith(".mp4"):
        mime_type = "audio/mp4"

    audio_part = types.Part.from_bytes(data=audio_bytes, mime_type=mime_type)

    curr_model_info = model_manager.get_info()
    model_name = curr_model_info.get("model", "gemini-2.5-flash")
    gen_config = model_manager.get_generate_config()

    max_attempts = max(1, rotator.get_active_count())
    for attempt in range(max_attempts):
        api_key = rotator.get_next_key()
        if not api_key:
            break
        masked_key = f"{api_key[:6]}...{api_key[-4:]}" if len(api_key) > 10 else "***"
        print(f"[API Rotator Audio] (Attempt {attempt+1}/{max_attempts}) Using Key: {masked_key} on {model_name}...", flush=True)

        try:
            http_opts = types.HttpOptions(timeout=10000) if hasattr(types, 'HttpOptions') else None
            client = genai.Client(api_key=api_key, http_options=http_opts) if http_opts else genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=model_name,
                contents=[prompt, audio_part],
                config=gen_config
            )

            raw_text = (response.text or "").strip()
            print(f"[API Rotator Audio] Success with key {masked_key} ({len(raw_text)} chars).", flush=True)

            tag, payload, is_multi_slot, slots = parse_ai_response(raw_text)
            return {
                "raw_answer": raw_text,
                "tag": tag,
                "payload": payload,
                "is_multi_slot": is_multi_slot,
                "slots": slots,
                "engine": f"{model_name}-audio",
                "key_used": masked_key,
                "model_preset": curr_model_info['current_preset'],
                "rules_active": ctx_info["enabled"]
            }
        except Exception as e:
            last_err = e
            rotator.mark_key_failed(api_key, e)
            print(f"[API Rotator Audio Warning] Key {masked_key} failed: {e}. Immediately rotating to next key...", flush=True)

    raise Exception(f"All API keys failed or were quarantined for audio. Last error: {last_err}")

class GeminiAutomationEngine:
    def __init__(self):
        self.playwright = None
        self.browser_context = None
        self.page = None

    def initialize(self):
        from playwright.sync_api import sync_playwright
        print("[Playwright] Starting persistent Chromium browser off-screen...", flush=True)
        self.playwright = sync_playwright().start()

        launch_args = [
            "--window-position=10000,10000",
            "--disable-blink-features=AutomationControlled",
            "--no-default-browser-check",
            "--disable-infobars"
        ]

        os.makedirs(USER_DATA_DIR, exist_ok=True)
        self.browser_context = self.playwright.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            headless=False,
            args=launch_args,
            permissions=['clipboard-read', 'clipboard-write'],
            viewport={"width": 1280, "height": 900}
        )

        self.page = self.browser_context.pages[0] if self.browser_context.pages else self.browser_context.new_page()
        print(f"[Playwright] Navigating to Gemini session ({GEMINI_URL})...", flush=True)
        self.page.goto(GEMINI_URL, wait_until="domcontentloaded")
        time.sleep(3)

        hide_browser_stealth()
        print("[Playwright] Persistent Gemini automation session active.", flush=True)

    def process_capture(self, image_path):
        if not self.page or self.page.is_closed():
            self.page = self.browser_context.new_page()
            self.page.goto(GEMINI_URL, wait_until="domcontentloaded")
            time.sleep(2)

        prompt_box = self.page.wait_for_selector(
            'rich-textarea div[contenteditable="true"], div[aria-label*="prompt" i], div[contenteditable="true"], rich-textarea',
            timeout=15000
        )
        if not prompt_box:
            raise Exception("Could not locate Gemini prompt box.")

        upload_btn = self.page.query_selector('button[aria-label*="Upload" i], button[aria-label*="Add" i], button[aria-label*="Tools" i]')
        if upload_btn:
            try:
                upload_btn.click(force=True, timeout=3000)
                time.sleep(1)
                file_input = self.page.wait_for_selector('input[type="file"]', state='attached', timeout=5000)
                file_input.set_input_files(image_path)
                time.sleep(2)
            except Exception:
                self.page.set_input_files('input[type="file"]', image_path)
        else:
            self.page.set_input_files('input[type="file"]', image_path)
            time.sleep(2)

        prompt = build_effective_master_prompt()
        prompt_editable = self.page.query_selector('rich-textarea div[contenteditable="true"], div[aria-label*="prompt" i], div[contenteditable="true"]')
        if prompt_editable:
            prompt_editable.click()
        else:
            prompt_box.click()
            
        time.sleep(0.5)
        self.page.keyboard.insert_text(prompt)
        time.sleep(1)

        send_btn = self.page.query_selector('button[aria-label*="Send message" i], button[aria-label*="Send" i], button.send-button, [aria-label*="Submit" i]')
        if send_btn and send_btn.is_enabled():
            send_btn.click()
        else:
            self.page.keyboard.press("Enter")

        last_text = ""
        stable_count = 0
        for _ in range(45):
            time.sleep(1.5)
            current_text = self.page.evaluate('''() => {
                const selectors = ['model-response', 'message-content', '.model-response-text', 'div.markdown', '.response-container-content'];
                for (const sel of selectors) {
                    const els = document.querySelectorAll(sel);
                    if (els.length > 0) {
                        const text = (els[els.length - 1].innerText || '').trim();
                        if (text && text.length > 5) return text;
                    }
                }
                return '';
            }''') or ""

            stop_btn = self.page.query_selector('button[aria-label*="Stop" i], button.stop-generating')
            if current_text:
                if current_text == last_text and not stop_btn:
                    stable_count += 1
                    if stable_count >= 2:
                        break
                else:
                    stable_count = 0
                last_text = current_text

        raw_text = last_text.strip()
        tag, payload, is_multi_slot, slots = parse_ai_response(raw_text)

        return {
            "raw_answer": raw_text,
            "tag": tag,
            "payload": payload,
            "is_multi_slot": is_multi_slot,
            "slots": slots,
            "engine": "playwright-stealth-browser"
        }

# Task Queue Architecture
task_queue = queue.Queue()
playwright_engine = None

def worker_thread():
    global playwright_engine
    if len(rotator.keys) == 0:
        print("[Engine Selector] No API Keys configured. Initializing Playwright Stealth Browser Engine...", flush=True)
        playwright_engine = GeminiAutomationEngine()
        playwright_engine.initialize()
    else:
        print(f"[Engine Selector] {len(rotator.keys)} API Keys detected! Using Ultra-Fast Gemini 2.5 Flash API Rotator.", flush=True)

    print("[Worker Thread] Ready to process capture and keystroke tasks.", flush=True)

    while True:
        task = task_queue.get()
        if task is None:
            break

        action, args, result_holder, done_event = task
        try:
            if action == 'process':
                if len(rotator.keys) > 0 and HAS_GENAI:
                    res = analyze_with_rotated_gemini_api(args['image_path'])
                elif playwright_engine:
                    res = playwright_engine.process_capture(args['image_path'])
                else:
                    res = {
                        "raw_answer": "[VOICE] No Gemini API Key configured. Please add Gemini API Keys via dashboard or .env.",
                        "tag": "[VOICE]",
                        "payload": "Please add Gemini API Key",
                        "engine": "none"
                    }
                result_holder['result'] = res
            elif action == 'process_audio':
                if len(rotator.keys) > 0 and HAS_GENAI:
                    res = analyze_audio_with_rotated_gemini_api(args['audio_path'])
                else:
                    res = {
                        "raw_answer": "[VOICE] No Gemini API Key configured. Please add Gemini API Keys via dashboard or .env.",
                        "tag": "[VOICE]",
                        "payload": "Please add Gemini API Key",
                        "engine": "none"
                    }
                result_holder['result'] = res
            elif action == 'stealth_hide':
                hide_browser_stealth()
                result_holder['result'] = {"success": True, "mode": "hidden"}
            elif action == 'stealth_show':
                show_browser_onscreen()
                result_holder['result'] = {"success": True, "mode": "visible"}
        except Exception as e:
            result_holder['error'] = str(e)
            print(f"[Processing Error] {e}", flush=True)
            traceback.print_exc()
        finally:
            done_event.set()
            task_queue.task_done()

@app.route('/process', methods=['POST'])
def handle_process():
    data = request.json or {}
    image_path = data.get('imagePath')

    if not image_path or not os.path.exists(image_path):
        return jsonify({"error": "Valid imagePath required"}), 400

    result_holder = {}
    done_event = threading.Event()
    task_queue.put(('process', {'image_path': image_path}, result_holder, done_event))

    if not done_event.wait(timeout=120):
        return jsonify({"error": "Automation request timed out after 120s"}), 504

    if 'error' in result_holder:
        return jsonify({"error": result_holder['error']}), 500

    return jsonify(result_holder.get('result', {}))

@app.route('/process_audio', methods=['POST'])
def handle_process_audio():
    data = request.json or {}
    audio_path = data.get('audioPath')

    if not audio_path or not os.path.exists(audio_path):
        return jsonify({"error": "Valid audioPath required"}), 400

    result_holder = {}
    done_event = threading.Event()
    task_queue.put(('process_audio', {'audio_path': audio_path}, result_holder, done_event))

    if not done_event.wait(timeout=120):
        return jsonify({"error": "Audio processing timed out after 120s"}), 504

    if 'error' in result_holder:
        return jsonify({"error": result_holder['error']}), 500

    return jsonify(result_holder.get('result', {}))

@app.route('/type', methods=['POST'])
def handle_type():
    data = request.json or {}
    text = data.get('text', '')
    if not text:
        return jsonify({"error": "No text provided to type"}), 400

    min_delay = data.get('min_delay_ms')
    max_delay = data.get('max_delay_ms')

    # Launch keystroke injection in a daemon thread so HTTP response is returned immediately (<5ms)
    # allowing /settings/speed and /api/type/stop to process concurrently without network blocking!
    threading.Thread(
        target=inject_keystrokes_to_active_window,
        args=(text,),
        kwargs={"min_delay_ms": min_delay, "max_delay_ms": max_delay},
        daemon=True
    ).start()

    return jsonify({
        "success": True,
        "characters_typed": len(text),
        "message": f"Keystroke injection active for {len(text)} characters"
    })

@app.route('/api/type/stop', methods=['POST'])
def handle_stop_typing():
    typing_controller.stop_typing()
    return jsonify({"success": True, "message": "Typing aborted successfully", "is_typing": False, "is_paused": False})

@app.route('/api/type/pause', methods=['POST'])
def handle_pause_typing():
    typing_controller.pause_typing()
    return jsonify({"success": True, "message": "Typing paused", "is_typing": typing_controller.is_typing, "is_paused": True})

@app.route('/api/type/resume', methods=['POST'])
def handle_resume_typing():
    typing_controller.resume_typing()
    return jsonify({"success": True, "message": "Typing resumed", "is_typing": typing_controller.is_typing, "is_paused": False})

@app.route('/api/type/toggle_pause', methods=['POST'])
def handle_toggle_pause_typing():
    is_paused = typing_controller.toggle_pause()
    return jsonify({"success": True, "is_typing": typing_controller.is_typing, "is_paused": is_paused})

@app.route('/api/type/status', methods=['GET'])
def handle_typing_status():
    return jsonify({"is_typing": typing_controller.is_typing, "is_paused": typing_controller.is_paused})

@app.route('/api/type_sequence', methods=['POST'])
def handle_type_sequence():
    """
    Types multiple slots in sequence with configurable inter-slot key transitions (e.g. TAB or ENTER) and pause.
    Allows instant emergency abort at any time.
    """
    data = request.json or {}
    slots_list = data.get('slots', [])
    inter_slot_key = data.get('inter_key', 'TAB').upper()
    delay_between_slots_sec = float(data.get('inter_delay_sec', 1.0))

    if not slots_list:
        return jsonify({"error": "No slots provided"}), 400

    def run_sequence():
        import ctypes
        user32 = ctypes.windll.user32
        VK_TAB = 0x09
        VK_RETURN = 0x0D
        KEYEVENTF_KEYUP = 0x0002

        print(f"[Auto-Sequence] Starting multi-slot injection for {len(slots_list)} slots...", flush=True)
        for i, text in enumerate(slots_list):
            if typing_controller.should_stop():
                print("[Auto-Sequence] Interrupted before slot execution.", flush=True)
                break

            if text and text.strip():
                ok = inject_keystrokes_to_active_window(text.strip())
                if not ok or typing_controller.should_stop():
                    print("[Auto-Sequence] Aborted during keystroke injection.", flush=True)
                    break

                if i < len(slots_list) - 1:
                    time.sleep(0.3)
                    if typing_controller.should_stop():
                        break
                    # Send transition key (Tab or Enter)
                    vk = VK_TAB if inter_slot_key == "TAB" else VK_RETURN
                    user32.keybd_event(vk, 0, 0, 0)
                    time.sleep(0.04)
                    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
                    time.sleep(delay_between_slots_sec)
        print("[Auto-Sequence] Completed or aborted.", flush=True)

    threading.Thread(target=run_sequence, daemon=True).start()
    return jsonify({"success": True, "slots_queued": len(slots_list)})

@app.route('/settings/speed', methods=['POST'])
def handle_set_speed():
    data = request.json or {}
    min_ms = data.get('min_delay_ms')
    max_ms = data.get('max_delay_ms')
    preset_name = data.get('preset_name', 'custom')
    save_permanent = data.get('save', True)
    if min_ms is not None and max_ms is not None:
        speed_manager.set_speed(min_ms, max_ms, preset_name, save=save_permanent)
    return jsonify({"success": True, "speed": speed_manager.get_info()})

@app.route('/settings/speed', methods=['GET'])
def handle_get_speed():
    return jsonify(speed_manager.get_info())

@app.route('/settings/model', methods=['GET'])
def handle_get_model_settings():
    return jsonify(model_manager.get_info())

@app.route('/settings/model', methods=['POST'])
def handle_set_model_settings():
    data = request.json or {}
    preset_key = data.get('preset_key')
    if preset_key:
        model_manager.set_preset(preset_key)
    return jsonify({"success": True, "model": model_manager.get_info()})

# Knowledge Context Endpoints
@app.route('/api/context', methods=['GET'])
def handle_get_context():
    return jsonify(context_manager.get_info())

@app.route('/api/context', methods=['POST'])
def handle_set_context():
    data = request.json or {}
    text = data.get('text', '')
    enabled = data.get('enabled', True)
    filename = data.get('filename', '')
    context_manager.save(text, enabled=enabled, filename=filename)
    return jsonify({"success": True, "context": context_manager.get_info()})

@app.route('/api/context/clear', methods=['POST'])
def handle_clear_context():
    context_manager.clear()
    return jsonify({"success": True, "context": context_manager.get_info()})

@app.route('/api/context/upload', methods=['POST'])
def handle_upload_context():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files['file']
    if f.filename == '':
        return jsonify({"error": "Empty filename"}), 400

    temp_path = os.path.join(BASE_DIR, "temp_" + f.filename)
    f.save(temp_path)
    try:
        info = context_manager.extract_text_from_file(temp_path, original_filename=f.filename)
        return jsonify({"success": True, "context": info})
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

# API Keys Management Endpoints
@app.route('/api/keys', methods=['GET'])
def handle_get_keys():
    status = rotator.get_status()
    return jsonify({
        "total": status["total_keys"],
        "active": status["active_keys"],
        "quarantined": status["quarantined_keys"],
        "keys": rotator.get_all_keys_masked(),
        "quarantine_list": status["quarantine_list"]
    })

@app.route('/api/keys/reset', methods=['POST'])
def handle_reset_keys():
    rotator.reset_quarantine()
    return jsonify({
        "success": True,
        "message": "Quarantine reset. All keys restored to active rotation pool.",
        "active": rotator.get_active_count(),
        "keys": rotator.get_all_keys_masked()
    })

@app.route('/api/keys', methods=['POST'])
def handle_save_keys():
    data = request.json or {}
    keys = data.get('keys', [])
    if isinstance(keys, str):
        keys = [k.strip() for k in keys.split(',') if k.strip()]
    rotator.save_keys_to_env(keys)
    status = rotator.get_status()
    return jsonify({
        "success": True,
        "total": status["total_keys"],
        "active": status["active_keys"],
        "keys": rotator.get_all_keys_masked()
    })

@app.route('/stealth/hide', methods=['POST'])
def handle_stealth_hide():
    result_holder = {}
    done_event = threading.Event()
    task_queue.put(('stealth_hide', {}, result_holder, done_event))
    done_event.wait(timeout=10)
    return jsonify(result_holder.get('result', {"success": True}))

@app.route('/stealth/show', methods=['POST'])
def handle_stealth_show():
    result_holder = {}
    done_event = threading.Event()
    task_queue.put(('stealth_show', {}, result_holder, done_event))
    done_event.wait(timeout=10)
    return jsonify(result_holder.get('result', {"success": True}))

@app.route('/status', methods=['GET'])
def handle_status():
    ctx = context_manager.get_info()
    return jsonify({
        "status": "online",
        "totalKeys": len(rotator.keys),
        "engine": "gemini-2.5-flash-rotator" if len(rotator.keys) > 0 else "playwright-stealth-browser",
        "hasPlaywright": playwright_engine is not None,
        "contextEnabled": ctx["enabled"],
        "contextWordCount": ctx["word_count"]
    })

if __name__ == '__main__':
    print("=======================================================")
    print(" [LogicGhost] Starting Hybrid Multi-API AI Stealth Engine")
    print("=======================================================")
    worker = threading.Thread(target=worker_thread, daemon=True)
    worker.start()
    print(" [LogicGhost] Flask API running on http://127.0.0.1:5001")
    print("=======================================================")
    app.run(host='127.0.0.1', port=5001, debug=False, threaded=True)
