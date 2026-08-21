import os
import sys
import time
import requests
from PIL import Image, ImageDraw, ImageFont

def create_test_image():
    img_path = os.path.abspath("test_screen_capture.jpg")
    img = Image.new('RGB', (800, 400), color=(15, 20, 28))
    d = ImageDraw.Draw(img)
    
    text = (
        "[CODING PROBLEM]\n\n"
        "Write a JavaScript function named isPrime(n)\n"
        "that returns true if n is a prime number,\n"
        "otherwise returns false.\n\n"
        "Example: isPrime(7) -> true, isPrime(4) -> false"
    )
    
    d.text((40, 40), text, fill=(0, 255, 102))
    img.save(img_path, quality=95)
    print(f"Created test image: {img_path}")
    return img_path

def test_full_pipeline():
    print("==================================================")
    print(" LOGICGHOST FULL AUTOMATED PIPELINE TEST")
    print("==================================================")
    
    # 1. Test Server Health
    try:
        r = requests.get("http://127.0.0.1:5000/health", timeout=5)
        print(f"[1] Server Health Check: HTTP {r.status_code} - {r.json()}")
    except Exception as e:
        print(f"[!] Server Health Check FAILED: {e}")
        return False

    # 2. Test Image Capture & Gemini Processing
    img_path = create_test_image()
    print("\n[2] Sending image to http://127.0.0.1:5000/capture...")
    start_t = time.time()
    try:
        with open(img_path, 'rb') as f:
            files = {'image': (os.path.basename(img_path), f, 'image/jpeg')}
            r = requests.post("http://127.0.0.1:5000/capture", files=files, timeout=120)
        
        elapsed = time.time() - start_t
        print(f"[2] Gemini Capture Result in {elapsed:.2f}s: HTTP {r.status_code}")
        data = r.json()
        print(f"    - Success: {data.get('success')}")
        print(f"    - Tag: {data.get('tag')}")
        print(f"    - Payload:\n{data.get('payload')}\n")
    except Exception as e:
        print(f"[!] Gemini Capture FAILED: {e}")
        return False
        
    # 3. Test Direct Server Typing Injection
    print("\n[3] Testing Direct Keystroke Typing Injection via http://127.0.0.1:5000/type...")
    try:
        r = requests.post("http://127.0.0.1:5000/type", json={"text": "// LogicGhost Direct Typing Pipeline Verified OK\n"}, timeout=10)
        print(f"[3] Direct Typing Response: HTTP {r.status_code} - {r.json()}")
    except Exception as e:
        print(f"[!] Direct Typing FAILED: {e}")
        return False

    print("\n==================================================")
    print(" ALL PIPELINE TESTS PASSED SUCCESSFULLY! ")
    print("==================================================")
    return True

if __name__ == '__main__':
    test_full_pipeline()
