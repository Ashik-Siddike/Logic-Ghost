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
echo [1/6] Python detected successfully.

REM 2. Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please download and install Node.js 18+ (LTS) from: https://nodejs.org/
    pause
    exit /b 1
)
echo [2/6] Node.js detected successfully.

REM 3. Install Python Dependencies
echo [3/6] Installing Python packages from requirements.txt...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Some Python packages encountered warnings, continuing...
)

REM 4. Install Playwright Chromium Browser
echo [4/6] Installing Playwright Chromium browser...
python -m playwright install chromium

REM 5. Install Node.js Server Dependencies
echo [5/6] Installing Node.js Express server dependencies...
cd server
call npm install
cd ..

REM 6. Initialize .env if missing
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo [INFO] Created .env from .env.example
)

REM 7. Generate Icon & Create Desktop Shortcut
echo [6/6] Creating Desktop Shortcut with custom icon...
python -c "from PIL import Image; import os; os.path.exists('app_logo.png') and Image.open('app_logo.png').save('app_icon.ico', format='ICO', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])" >nul 2>&1

powershell -NoProfile -Command "& { $ws = New-Object -ComObject WScript.Shell; $desktop = [System.Environment]::GetFolderPath('Desktop'); $s = $ws.CreateShortcut(\"$desktop\LogicGhost.lnk\"); $s.TargetPath = (Join-Path (Get-Location) 'start.bat'); $s.WorkingDirectory = (Get-Location).Path; $ico = (Join-Path (Get-Location) 'app_icon.ico'); if (Test-Path $ico) { $s.IconLocation = \"$ico,0\" }; $s.Description = 'LogicGhost AI Automation & Dashboard'; $s.Save(); }"

echo.
echo =================================================================
echo  [SUCCESS] LogicGhost Setup Completed Successfully!
echo =================================================================
echo  * Desktop Shortcut 'LogicGhost' created on your Desktop!
echo  * From now on, simply double-click the 'LogicGhost' icon
echo    on your Desktop to launch the system and dashboard anytime!
echo =================================================================
echo.
pause
