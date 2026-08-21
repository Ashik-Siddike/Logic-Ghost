@echo off
TITLE LogicGhost - 1-Click Automated Setup & Installation

echo =================================================================
echo  [LogicGhost] 1-Click Automated Environment Setup
echo =================================================================
echo.

REM 1. Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please download and install Python 3.10+ from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)
echo [1/5] Python detected successfully.

REM 2. Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please download and install Node.js 18+ (LTS) from: https://nodejs.org/
    pause
    exit /b 1
)
echo [2/5] Node.js detected successfully.

REM 3. Install Python Dependencies
echo [3/5] Installing Python packages from requirements.txt...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Some Python packages encountered warnings, continuing...
)

REM 4. Install Playwright Chromium Browser
echo [4/5] Installing Playwright Chromium browser...
python -m playwright install chromium

REM 5. Install Node.js Server Dependencies
echo [5/5] Installing Node.js Express server dependencies...
cd server
call npm install
cd ..

REM 6. Initialize .env if missing
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo [INFO] Created .env from .env.example
)

echo.
echo =================================================================
echo  [SUCCESS] LogicGhost Setup Completed Successfully!
echo =================================================================
echo  1. Add your Gemini API Keys in the Web Dashboard or in .env
echo  2. Connect your phone via USB Cable (or Bluetooth)
echo  3. Run 'start.bat' to launch the entire system!
echo =================================================================
echo.
pause
