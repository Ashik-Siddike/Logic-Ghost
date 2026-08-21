@echo off
TITLE LogicGhost - Stealth Physical-to-Digital Automation Bridge

echo =================================================================
echo  [LogicGhost] Launching System Services & Web Dashboard...
echo =================================================================

REM Clean up any previous server instances on ports 5000 and 5001
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000, 5001 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

REM ADB Reverse Port Forwarding for USB Debugging Mode
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
    "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" reverse tcp:5000 tcp:5000 >nul 2>&1
    echo [LogicGhost] USB Debugging Reverse Tunnel: http://localhost:5000
)

if exist server.log del /f /q server.log
if exist automation.log del /f /q automation.log

REM Run background startup script via PowerShell
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"

REM Open Web Control Dashboard in default browser
timeout /t 2 /nobreak >nul
start http://localhost:5000

echo =================================================================
echo  [LogicGhost] All Services & Web Dashboard are Active!
echo  Desktop Dashboard: http://localhost:5000
echo =================================================================
