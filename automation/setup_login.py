import os
import sys
import time
import json
from playwright.sync_api import sync_playwright

USER_DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "user_data"))
GEMINI_URL = "https://accounts.google.com/ServiceLogin?service=bard&continue=https://gemini.google.com/app"

def reset_window_coords():
    pref_path = os.path.join(USER_DATA_DIR, "Default", "Preferences")
    if os.path.exists(pref_path):
        try:
            with open(pref_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if "browser" in data and "window_placement" in data["browser"]:
                data["browser"]["window_placement"] = {
                    "bottom": 900, "left": 100, "maximized": False, "right": 1380, "top": 80
                }
            with open(pref_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except Exception:
            pass

def main():
    print("=================================================================")
    print(" [LogicGhost] Google Gemini Interactive Login Setup")
    print("=================================================================")
    print(" Opening Chrome browser window...")
    print(" 1. Sign in to your Google Account.")
    print(" 2. When you see Gemini Pro chat with your profile picture, close Chrome.")
    print("=================================================================")

    reset_window_coords()
    os.makedirs(USER_DATA_DIR, exist_ok=True)

    with sync_playwright() as p:
        browser_context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            headless=False,
            args=[
                "--start-maximized",
                "--disable-blink-features=AutomationControlled",
                "--no-default-browser-check"
            ],
            no_viewport=True
        )

        page = browser_context.pages[0] if browser_context.pages else browser_context.new_page()
        page.goto(GEMINI_URL)

        print("\n >> Chrome is OPEN! Please log in now.")
        print(" >> Once logged in, simply CLOSE the Chrome window.\n")

        # Keep alive until user closes the window
        while len(browser_context.pages) > 0:
            try:
                if browser_context.pages[0].is_closed():
                    break
                time.sleep(1)
            except Exception:
                break

        print("\n [LogicGhost] Google Gemini session saved successfully in user_data!")

if __name__ == '__main__':
    main()
