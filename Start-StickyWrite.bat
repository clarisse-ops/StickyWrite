@echo off
title StickyWrite
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python is not installed. Get it from https://www.python.org/downloads/
  echo During install, check "Add python.exe to PATH", then run this again.
  pause
  exit /b 1
)
python scripts\start.py
if errorlevel 1 pause
