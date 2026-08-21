@echo off
TITLE LogicGhost - Google Account Login Setup

echo =================================================================
echo  [LogicGhost] Google Gemini Login Setup
echo =================================================================

taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1
timeout /t 1 /nobreak >nul

python "%~dp0automation\setup_login.py"

pause
