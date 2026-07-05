@echo off
title StickyWrite setup
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python is not installed. Get it from https://www.python.org/downloads/
  echo During install, check "Add python.exe to PATH", then run this again.
  pause
  exit /b 1
)
python scripts\setup.py
echo.
echo Setup finished. Double-click Start-StickyWrite.bat to launch.
pause
