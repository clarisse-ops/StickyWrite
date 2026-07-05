#!/bin/bash
# Mac launcher. If double-clicking says "permission denied", run once in
# Terminal:  chmod +x start-stickywrite.command
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed. Get it from https://www.python.org/downloads/"
  read -r -p "Press Enter to close."
  exit 1
fi
python3 scripts/start.py
