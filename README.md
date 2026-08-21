# 👻 LogicGhost (লজিকগোস্ট)
> **Stealth Physical-to-Digital AI Automation Bridge & Hardware Keyboard Emulator**  
> *গুগল জেমিনাই ২.৫ ফ্ল্যাশ এআই, মাল্টি-এপিআই রোটেশন, অর্গানিক হিউম্যান টাইপিং ও ফুল-স্ক্রিন মোবাইল HUD*

<p align="center">
  <a href="https://github.com/Ashik-Siddike/Logic-Ghost/releases/download/v1.0.0-on-publish/LogicGhost-v1.0.apk">
    <img src="https://img.shields.io/badge/Download_APK-LogicGhost_v1.0_Android-00E5FF?style=for-the-badge&logo=android&logoColor=black" alt="Download LogicGhost APK" />
  </a>
  <a href="https://github.com/Ashik-Siddike/Logic-Ghost/releases">
    <img src="https://img.shields.io/badge/Release-v1.0.0--Production-00FF66?style=for-the-badge&logo=github" alt="GitHub Release" />
  </a>
</p>

---

## 🌟 প্রধান বৈশিষ্ট্যসমূহ (Key Features)

* **⚡ Gemini 2.5 Flash Multi-API Round-Robin Rotation:**
  * একাধিক ফ্রি এপিআই কী স্বয়ংক্রিয়ভাবে চক্রাকারে (Round-Robin) ঘুরে ঘুরে ব্যবহৃত হয়, ফলে রেট লিমিট ছাড়াই নিরবচ্ছিন্নভাবে এআই ভিশন কাজ করে।
  * কোনো এপিআই কী লিমিট হিট করলে অটো-ফেলওভার (Auto-Failover) হয়ে পরবর্তী সুস্থ কীতে চলে যায়।
* **⌨️ Organic Human Keystroke Jitter (হিউম্যান-লাইক টাইপিং):**
  * কোনো পেস্ট (Paste/Clipboard) নয়! প্রতিটি অক্ষর ফিজিক্যাল কীবোর্ড ইভেন্টে একটি একটি করে টাইপ হয়।
  * প্রতিটি অক্ষরের মাঝে মানুষের স্বাভাবিক টাইপিংয়ের মতো র্যান্ডম মিলি-সেকেন্ড ডিলে এবং মাইক্রো-পজ থাকে, যা কোনো অ্যান্টি-চিট বা প্রোক্টরিং সফটওয়্যার ধরতে পারে না।
* **🎛️ Glassmorphic Desktop Web Dashboard (`http://localhost:5000`):**
  * লাইভ কানেকশন স্ট্যাটাস, টাইপিং স্পিড রেঞ্জ স্লাইডার, ১-ক্লিক স্টিলথ উইন্ডো হাইড/শো এবং লাইভ এআই ফিড।
* **📱 Full-Screen Holographic Android Viewfinder:**
  * এজ-টু-এজ ক্যামেরা, হলোগ্রাফিক ক্রসহেয়ার, ১-ক্লিক টেথারিং ও ইন্টারেক্টিভ অনবোর্ডিং গাইড।
* **🔌 Zero-Config USB Debugging Mode (ADB Reverse Tunnel):**
  * কোনো আইপি অ্যাড্রেস টাইপ করার দরকার নেই, ক্যাবল লাগালেই `http://127.0.0.1:5000` দিয়ে স্বয়ংক্রিয়ভাবে কানেক্টেড।
* **🛠️ 1-Click Automated Setup (`setup.bat`):**
  * নতুন যেকোনো পিসিতে ১-ক্লিকে স্বয়ংক্রিয়ভাবে সমস্ত ডিপেনডেন্সি ও প্যাকেজ ইন্সটল হয়ে যায়।

---

## 📋 প্রয়োজনীয় পূর্বশর্ত (Prerequisites)

অন্য যেকোনো পিসিতে প্রজেক্টটি চালানোর আগে শুধু নিচের দুটি সফটওয়্যার পিসিতে থাকতে হবে:

1. **Python 3.10 বা তার উপরের ভার্সন:**
   * ডাউনলোড লিঙ্ক: [https://www.python.org/downloads/](https://www.python.org/downloads/)
   * ⚠️ *ইন্সটল করার সময় অবশ্যই **"Add Python to PATH"** বক্সে টিক চিহ্ন দিবেন।*
2. **Node.js (LTS Version):**
   * ডাউনলোড লিঙ্ক: [https://nodejs.org/](https://nodejs.org/)

---

## 🚀 নতুন পিসিতে ১-ক্লিক সেটআপ গাইড (Step-by-Step Setup)

### ধাপ ১: স্বয়ংক্রিয় ডিপেনডেন্সি ইন্সটল
প্রজেক্ট ফোল্ডারে থাকা **`setup.bat`** ফাইলে ডাবল ক্লিক করুন।  
*(এটি আপনার পিসিতে পাইথন প্যাকেজ, প্লে-রাইট ব্রাউজার ও নোড সার্ভার ডিপেনডেন্সি স্বয়ংক্রিয়ভাবে সেটআপ করে দেবে।)*

### ধাপ ২: সার্ভার ও ড্যাশবোর্ড চালু করা
প্রজেক্ট ফোল্ডারে থাকা **`start.bat`** ফাইলে ডাবল ক্লিক করুন।  
*(সাথে সাথে ল্যাপটপের ব্রাউজারে `http://localhost:5000` ড্যাশবোর্ড খুলে যাবে এবং সার্ভার ব্যাকগ্রাউন্ডে সচল হয়ে যাবে।)*

### ধাপ ৩: ফোনে অ্যাপ ইন্সটল করা
* সরাসরি ১-ক্লিক ডাউনলোড লিঙ্ক থেকে ফোনে APK ইন্সটল করুন:  
  📲 **[Download LogicGhost-v1.0.apk (Direct Download)](https://github.com/Ashik-Siddike/Logic-Ghost/releases/download/v1.0.0-on-publish/LogicGhost-v1.0.apk)**  
  *(অথবা প্রজেক্টের `release/` ফোল্ডারে থাকা `LogicGhost-v1.0.apk` ফাইলটি ফোনে নিয়ে ইন্সটল করুন।)*

---

## 🔑 একাধিক Gemini API Key সেটআপ ও রোটেশন (Multi-API Setup)

LogicGhost-এ একাধিক ফ্রি API Key ব্যবহার করে আনলিমিটেড স্পিড পাওয়া যায়:

1. **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**-তে গিয়ে ১ বা একাধিক ফ্রি API Key বানিয়ে নিন।
2. ল্যাপটপের ড্যাশবোর্ডে (**`http://localhost:5000`**) গিয়ে **"Multi-API Key Round-Robin Manager"** বক্সে কমা দিয়ে পেস্ট করুন:
   ```text
   AIzaSyKey1..., AIzaSyKey2..., AIzaSyKey3...
   ```
3. **`Save & Update Keys`** বাটনে ক্লিক করুন। সিস্টেম স্বয়ংক্রিয়ভাবে কীগুলো রোটেশনে চালু করে দেবে!

---

## 📱 ফোন কানেক্ট করার পদ্ধতি (Connecting Your Mobile)

### 🥇 পদ্ধতি ১: USB Debugging Mode (সবচেয়ে সহজ ও সেরা)
1. **Samsung বা যেকোনো ফোনে Developer Mode অন করুন:**
   * ফোনের `Settings` ➔ `About phone` ➔ `Software information` ➔ **`Build number`**-এর ওপর পরপর ৭ বার ট্যাপ করুন।
   * এবার `Settings` ➔ `Developer options`-এ ঢুকে **`USB debugging`** অন করুন।
2. ডাটা ক্যাবল দিয়ে ফোন ল্যাপটপে যুক্ত করুন।
3. ফোনে **LogicGhost** অ্যাপ ওপেন করলেই ডিফল্টভাবে **`http://127.0.0.1:5000`** দিয়ে সরাসরি **SERVER: ONLINE 🟢** দেখতে পাবেন।

### 🥈 পদ্ধতি ২: USB Tethering Mode
* অ্যাপের উপরের **`🔌 TETHER`** বাটনে চাপ দিয়ে USB Tethering অন করে দিন।

### 🥉 পদ্ধতি ৩: Bluetooth HID Hardware Keyboard Mode
* অ্যাপের **`BT: UNPAIRED`** বাটনে চাপ দিয়ে আপনার ল্যাপটপের ব্লুটুথের সাথে পেয়ার করুন। এতে ফোনটি সরাসরি এক্সটার্নাল হার্ডওয়্যার কীবোর্ড হিসেবে কাজ করবে।

---

## ⌨️ টাইপিং স্পিড ও অর্গানিক জিটার কনফিগারেশন

ড্যাশবোর্ডে (**`http://localhost:5000`**) আপনি টাইপিং স্পিডের স্লাইডার ইচ্ছামতো পরিবর্তন করতে পারবেন:
* **⚡ Ultra (5-15ms):** কোডিং স্পিড টেস্টের জন্য দ্রুততম টাইপিং।
* **🏃 Fast Human (18-45ms):** সাধারণ দ্রুত টাইপিং।
* **🚶 Realistic Human (35-85ms):** মানুষের স্বাভাবিক হাতের টাইপিং স্পিড।
* **🐢 Ultra Stealth (80-180ms):** কড়া প্রোক্টরিং বা এক্সাম সফটওয়্যারের নজর এড়ানোর জন্য ন্যাচারাল টাইপিং।

---

## 📁 প্রজেক্ট স্ট্রাকচার (Project Structure)

```text
LogicGhost/
├── app/                  # অ্যান্ড্রয়েড নেটিভ সোর্স কোড (Java, CameraX, Bluetooth HID)
├── automation/           # পাইথন এআই ইঞ্জিন (Gemini 2.5 Flash, Key Rotator, Win32 Typing)
├── server/               # Node.js Express সার্ভার ও গ্লাসফরমিক ওয়েব ড্যাশবোর্ড
├── release/              # প্রাক-বিল্ট LogicGhost-v1.0.apk
├── setup.bat             # নতুন পিসির জন্য ১-ক্লিক ডিপেনডেন্সি ইনস্টলার
├── start.bat             # ১-ক্লিক সার্ভার ও ড্যাশবোর্ড লঞ্চার
├── .env.example          # এপিআই কী কনফিগারেশন টেমপ্লেট
└── README.md             # সম্পূর্ণ ব্যবহারকারী সহায়িকা
```

---

## 🛡️ লাইসেন্স ও নিরাপত্তা (License & Security)
* এই প্রজেক্টের কোনো সংবেদনশীল ফাইল বা এপিআই কী গিটহাবে পুশ হয় না (`.gitignore` দিয়ে সুরক্ষিত)।
* সম্পূর্ণ সোর্স কোড শিক্ষণীয় এবং পার্সোনাল অটোমেশন উদ্দেশ্যে তৈরি।
