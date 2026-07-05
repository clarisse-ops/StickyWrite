#!/usr/bin/env python3
"""Start StickyWrite: local web server + LanguageTool server (if installed).

  python scripts/start.py               # starts everything, opens the browser
  python scripts/start.py --no-browser  # don't open the browser
  python scripts/start.py --port 4700   # custom app port
"""

import argparse
import atexit
import http.server
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from setup import find_system_java, find_vendored_java, find_lt_jar  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LT_PORT = 8081

# Correct MIME types matter: WebAssembly streaming needs application/wasm.
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def start_languagetool():
    jar = find_lt_jar()
    if not jar:
        print("[start] LanguageTool not installed. Run: python scripts/setup.py")
        print("[start] (StickyWrite still works, on the Harper engine.)")
        return None
    if port_in_use(LT_PORT):
        print(f"[start] LanguageTool already running on port {LT_PORT}.")
        return None
    java = find_system_java() or find_vendored_java()
    if not java:
        print("[start] No Java found for LanguageTool. Run: python scripts/setup.py")
        return None
    print(f"[start] Starting LanguageTool on port {LT_PORT}...")
    proc = subprocess.Popen(
        # Note: "--allow-origin" with no value means "*". Never pass a literal "*"
        # here: the JVM on Windows glob-expands it against the working directory.
        [java, "-cp", jar, "org.languagetool.server.HTTPServer",
         "--port", str(LT_PORT), "--allow-origin"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        cwd=os.path.dirname(jar),
    )
    atexit.register(proc.terminate)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://localhost:{LT_PORT}/v2/languages", timeout=1)
            print("[start] LanguageTool is up.")
            return proc
        except Exception:
            if proc.poll() is not None:
                print("[start] WARNING: LanguageTool exited early. Harper-only mode.")
                return None
            time.sleep(1)
    print("[start] WARNING: LanguageTool didn't respond in time. Harper-only mode.")
    return proc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4700)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    threading.Thread(target=start_languagetool, daemon=True).start()

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://localhost:{args.port}"
    print(f"[start] StickyWrite running at {url}")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[start] Bye.")


if __name__ == "__main__":
    main()
