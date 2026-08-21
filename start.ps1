# LogicGhost - Stealth Physical-to-Digital Automation Bridge (PowerShell Startup)

# 0. Check and Apply ADB Reverse for USB Debugging Mode
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adbPath) {
    & $adbPath reverse tcp:5000 tcp:5000 2>$null
    Write-Host "[LogicGhost] USB Debugging Tunnel mapped: http://localhost:5000" -ForegroundColor Cyan
}

# 1. Terminate any previous instances running on Ports 5000 and 5001
Write-Host "[LogicGhost] Cleaning up previous processes on ports 5000 and 5001..." -ForegroundColor Yellow
Get-NetTCPConnection -LocalPort 5000, 5001 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}

if (Test-Path "server.log") { Remove-Item "server.log" -Force }
if (Test-Path "automation.log") { Remove-Item "automation.log" -Force }

Write-Host "[LogicGhost] Starting Python Stealth Automation Engine on port 5001..." -ForegroundColor Green
$pythonProc = Start-Process python -ArgumentList "automation/gemini_stealth.py" -NoNewWindow -PassThru -RedirectStandardOutput "automation.log" -RedirectStandardError "automation_err.log"

Start-Sleep -Seconds 1

Write-Host "[LogicGhost] Starting Node.js Express Server on port 5000..." -ForegroundColor Green
$serverProc = Start-Process node -ArgumentList "server/server.js" -NoNewWindow -PassThru -RedirectStandardOutput "server.log" -RedirectStandardError "server_err.log"

Write-Host "[LogicGhost] All background processes initialized successfully." -ForegroundColor Cyan
Write-Host "Express Server PID: $($serverProc.Id)" -ForegroundColor Gray
Write-Host "Python Stealth PID: $($pythonProc.Id)" -ForegroundColor Gray
