import os
import sys
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
from PIL import Image

# Force unbuffered stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)

# File Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", ".env"))
CONTEXT_FILE = os.path.join(BASE_DIR, "custom_context.txt")
CONTEXT_CONFIG_FILE = os.path.join(BASE_DIR, "context_config.json")
SPEED_CONFIG_FILE = os.path.join(BASE_DIR, "speed_config.json")

# Multi-API Key Manager with Round-Robin Rotation & Auto-Failover
class ApiKeyRotator:
    def __init__(self):
        self.keys = []
        self.queue = collections.deque()
        self.lock = threading.Lock()
        self.load_keys()

    def load_keys(self):
        with self.lock:
            self.keys = []
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
                                        if part and part not in self.keys:
                                            self.keys.append(part)
                except Exception as e:
                    print(f"[Rotator Warning] Could not read .env: {e}", flush=True)

            self.queue = collections.deque(self.keys)
            print(f"[API Rotator] Initialized with {len(self.keys)} active Gemini API Key(s).", flush=True)

    def save_keys_to_env(self, key_list):
        with self.lock:
            self.keys = [k.strip() for k in key_list if k.strip()]
            self.queue = collections.deque(self.keys)
            try:
                content = "# LogicGhost Gemini Configuration\n"
                content += f"GEMINI_API_KEYS={','.join(self.keys)}\n"
                with open(ENV_PATH, "w", encoding="utf-8") as f:
                    f.write(content)
                print(f"[API Rotator] Saved {len(self.keys)} keys to .env.", flush=True)
            except Exception as e:
                print(f"[Rotator Error] Could not save to .env: {e}", flush=True)

    def get_next_key(self):
        with self.lock:
            if not self.queue:
                return None
            key = self.queue.popleft()
            self.queue.append(key)
            return key

    def get_all_keys_masked(self):
        with self.lock:
            masked = []
            for i, k in enumerate(self.keys):
                if len(k) > 10:
                    m = f"{k[:6]}...{k[-4:]}"
                else:
                    m = "******"
                masked.append({"index": i + 1, "masked": m, "raw": k})
            return masked

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
        self.min_delay_ms = 45
        self.max_delay_ms = 90
        self.preset_name = "normal"
        self.load()

    def load(self):
        with self.lock:
            if os.path.exists(SPEED_CONFIG_FILE):
                try:
                    with open(SPEED_CONFIG_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self.min_delay_ms = int(data.get("min_delay_ms", 45))
                        self.max_delay_ms = int(data.get("max_delay_ms", 90))
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

# Thread-safe Emergency Typing Abort Controller
class TypingAbortController:
    def __init__(self):
        self.stop_event = threading.Event()
        self.is_typing = False
        self.lock = threading.Lock()

    def start_typing(self):
        with self.lock:
            self.stop_event.clear()
            self.is_typing = True

    def stop_typing(self):
        with self.lock:
            self.stop_event.set()
            self.is_typing = False
            print("[Typing Abort] EMERGENCY STOP SIGNAL TRIGGERED! Halting active typing.", flush=True)

    def should_stop(self):
        return self.stop_event.is_set()

    def finish_typing(self):
        with self.lock:
            self.is_typing = False

typing_controller = TypingAbortController()

try:
    from google import genai
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

app = Flask(__name__)

# Constants
GEMINI_URL = "https://gemini.google.com/app"
USER_DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "user_data"))

# Elite Problem-Solving & AI Evaluation Master Prompt
BASE_MASTER_PROMPT = (
    "You are an elite coding expert, AI benchmark evaluator, RLHF specialist, and technical assistant.\n"
    "Your task is to analyze and SOLVE the coding problem, side-by-side model comparison, bug fixing/refactoring task, database schema/query, API integration, or multi-turn RLHF conversation shown in the image completely.\n"
    "DO NOT repeat the question. DO NOT summarize the question unnecessarily.\n\n"
    "STRICT OUTPUT PROTOCOLS:\n\n"
    "PROTOCOL 1: EVALUATION / BUG FIXING / CODE COMPARISON / MULTI-PART TASKS\n"
    "When a task requires writing code AND providing an explanation/justification or rating:\n"
    "You MUST structure your output with these exact tags:\n"
    "<<<SLOT:RATING>>>\n"
    "Your concise verdict/rating (e.g. 'Model A is significantly better (5/5 vs 2/5)' or 'Verdict: Root Cause Identified')\n"
    "<<<SLOT:CODE>>>\n"
    "Only the clean, 100% production-ready bugfix or solution code (ready to paste in code editor)\n"
    "<<<SLOT:EXPLANATION>>>\n"
    "Detailed Markdown explanation covering:\n"
    "• Root Cause / Critique: Why original code failed or comparison breakdown.\n"
    "• The Fix / Justification: What was changed and architectural rationale.\n"
    "• Complexity / Optimization: Time and Space complexity improvements.\n"
    "<<<SLOT:AUDIT>>>\n"
    "(If applicable: Hallucination status, fake libraries/methods detected, official docs link with valid replacement)\n\n"
    "PROTOCOL 2: STANDARD CODING / PURE PROGRAMMING PROBLEM (Single Code Box)\n"
    "Write ONLY the complete, working implementation code. Prefix with [TYPE]. Example:\n"
    "[TYPE]\n"
    "function solve(input) {\n"
    "  // code here\n"
    "}\n\n"
    "PROTOCOL 3: MULTIPLE CHOICE / CHECKBOX QUESTIONS\n"
    "Prefix with [CHECK] followed by option letter and answer. Example:\n"
    "[CHECK] Option B: O(n log n)\n\n"
    "PROTOCOL 4: DIRECT COMPARISON / BEST OPTION QUESTIONS\n"
    "Prefix with [COMPARE]. Example:\n"
    "[COMPARE] BEST: Option C | WHY: More efficient time complexity.\n\n"
    "PROTOCOL 5: GENERAL / INTERVIEW / SPOKEN / CONCEPTUAL QA\n"
    "When asked a conceptual, system design, architectural, or technical interview question:\n"
    "Prefix with [VOICE]. Provide a natural, fluent, first-person answer structured in 3 to 4 concise sentences (maximum 45-60 words).\n"
    "Craft it specifically to sound confident, articulate, and conversational when spoken aloud in an interview or video call, without filler words or preamble."
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

def inject_keystrokes_to_active_window(text, min_delay_ms=None, max_delay_ms=None):
    """
    Types text character-by-character into active foreground window on Windows.
    Simulates real human physical typing with non-uniform keypress intervals and micro-pauses.
    Allows instant emergency abort via typing_controller.
    """
    import random
    if sys.platform != "win32":
        return False

    typing_controller.start_typing()

    speed_info = speed_manager.get_info()
    min_ms = min_delay_ms if min_delay_ms is not None else speed_info["min_delay_ms"]
    max_ms = max_delay_ms if max_delay_ms is not None else speed_info["max_delay_ms"]
    min_ms = max(2, min_ms)
    max_ms = max(min_ms, max_ms)

    user32 = ctypes.windll.user32
    KEYEVENTF_KEYUP = 0x0002
    KEYEVENTF_UNICODE = 0x0004
    VK_RETURN = 0x0D
    VK_TAB = 0x09

    print(f"[Organic Human Typing] Typing {len(text)} characters (Random Range: {min_ms}ms - {max_ms}ms)...", flush=True)

    try:
        pyperclip.copy(text)
    except Exception:
        pass

    try:
        for char in text:
            if typing_controller.should_stop():
                print(f"[Organic Human Typing] Instantly halted by user abort command.", flush=True)
                return False

            if char == '\r':
                continue

            code = ord(char)
            # Random physical key contact time
            key_hold_time = random.uniform(0.010, 0.026) if min_ms < 150 else random.uniform(0.020, 0.055)
            # Random inter-key delay
            char_delay = random.uniform(min_ms, max_ms) / 1000.0

            # Organic human pauses on special characters, spaces, and brackets
            if char in ['\n', ' ', '{', '}', '(', ')', ';', '=']:
                extra = random.uniform(0.020, 0.060) if min_ms < 150 else random.uniform(0.080, 0.250)
                char_delay += extra

            if char == '\n':
                user32.keybd_event(VK_RETURN, 0x1C, 0, 0)
                time.sleep(key_hold_time)
                user32.keybd_event(VK_RETURN, 0x1C, KEYEVENTF_KEYUP, 0)
                time.sleep(char_delay)
                continue

            if char == '\t':
                user32.keybd_event(VK_TAB, 0x0F, 0, 0)
                time.sleep(key_hold_time)
                user32.keybd_event(VK_TAB, 0x0F, KEYEVENTF_KEYUP, 0)
                time.sleep(char_delay)
                continue

            user32.keybd_event(0, code, KEYEVENTF_UNICODE, 0)
            time.sleep(key_hold_time)
            user32.keybd_event(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0)
            time.sleep(char_delay)

        print(f"[Organic Human Typing] Successfully finished typing {len(text)} characters.", flush=True)
        return True
    finally:
        typing_controller.finish_typing()

def clean_code_snippet(text):
    match = re.search(r'```(?:javascript|python|java|cpp|c|typescript|html|css|sql|bash|sh|json)?\n?(.*?)\n?```', text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return text

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

def analyze_with_rotated_gemini_api(image_path):
    """
    Executes vision analysis with Round-Robin Key Rotation & Auto-Failover.
    """
    total_keys = len(rotator.keys)
    if total_keys == 0:
        raise Exception("No Gemini API Keys configured in .env or rotator.")

    last_err = None
    img = Image.open(image_path)
    prompt = build_effective_master_prompt()
    ctx_info = context_manager.get_info()
    if ctx_info["enabled"]:
        print(f"[Context Engine] Attaching {ctx_info['word_count']} words of reference guidelines to prompt.", flush=True)

    for attempt in range(total_keys):
        api_key = rotator.get_next_key()
        masked_key = f"{api_key[:6]}...{api_key[-4:]}" if len(api_key) > 10 else "***"
        print(f"[API Rotator] (Attempt {attempt+1}/{total_keys}) Using Key: {masked_key}...", flush=True)

        try:
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=[prompt, img]
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
                "engine": "gemini-2.5-flash-api",
                "key_used": masked_key,
                "rules_active": ctx_info["enabled"]
            }
        except Exception as e:
            last_err = e
            print(f"[API Rotator Warning] Key {masked_key} encountered error: {e}. Rotating to next key...", flush=True)
            time.sleep(0.5)

    raise Exception(f"All {total_keys} API keys failed. Last error: {last_err}")

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

@app.route('/type', methods=['POST'])
def handle_type():
    data = request.json or {}
    text = data.get('text', '')
    if not text:
        return jsonify({"error": "No text provided to type"}), 400

    min_delay = data.get('min_delay_ms')
    max_delay = data.get('max_delay_ms')

    ok = inject_keystrokes_to_active_window(text, min_delay_ms=min_delay, max_delay_ms=max_delay)
    return jsonify({"success": ok, "characters_typed": len(text), "min_delay_ms": min_delay, "max_delay_ms": max_delay})

@app.route('/api/type/stop', methods=['POST'])
def handle_stop_typing():
    typing_controller.stop_typing()
    return jsonify({"success": True, "message": "Typing aborted successfully", "is_typing": False})

@app.route('/api/type/status', methods=['GET'])
def handle_typing_status():
    return jsonify({"is_typing": typing_controller.is_typing})

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
    return jsonify({
        "total": len(rotator.keys),
        "keys": rotator.get_all_keys_masked()
    })

@app.route('/api/keys', methods=['POST'])
def handle_save_keys():
    data = request.json or {}
    keys = data.get('keys', [])
    if isinstance(keys, str):
        keys = [k.strip() for k in keys.split(',') if k.strip()]
    rotator.save_keys_to_env(keys)
    return jsonify({
        "success": True,
        "total": len(rotator.keys),
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
    app.run(host='127.0.0.1', port=5001, debug=False)
