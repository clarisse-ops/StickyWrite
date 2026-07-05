#!/usr/bin/env python3
"""StickyWrite setup: downloads the optional LanguageTool tier.

Run once per machine:  python scripts/setup.py

Downloads (into vendor/, gitignored, ~350MB total):
  - A portable Java runtime (Temurin JRE 21), only if Java 17+ isn't already installed
  - The LanguageTool server

Harper needs no setup at all (it ships with the repo). The AI tier needs
Ollama, which has its own installer: https://ollama.com/download
"""

import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
import tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, "vendor")
JRE_DIR = os.path.join(VENDOR, "jre")
LT_DIR = os.path.join(VENDOR, "languagetool")

LT_URL = "https://languagetool.org/download/LanguageTool-stable.zip"


def log(msg):
    print(f"[setup] {msg}", flush=True)


def download(url, dest):
    log(f"Downloading {url}")
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "StickyWrite-setup/1.0"})
    with urllib.request.urlopen(req) as resp, open(tmp, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                pct = min(100, done * 100 // total)
                print(f"\r[setup]   {pct}% of {total // (1024 * 1024)} MB", end="", flush=True)
    print()
    os.replace(tmp, dest)


def find_system_java():
    """Return a java executable with major version >= 17, or None."""
    candidates = [shutil.which("java")]
    if platform.system() == "Windows":
        for base in (os.environ.get("ProgramFiles", r"C:\Program Files"),):
            for vendor_dir in ("Eclipse Adoptium", "Java", "Microsoft", "Zulu"):
                d = os.path.join(base, vendor_dir)
                if os.path.isdir(d):
                    for sub in os.listdir(d):
                        candidates.append(os.path.join(d, sub, "bin", "java.exe"))
    for java in candidates:
        if not java or not os.path.exists(java):
            continue
        try:
            out = subprocess.run([java, "-version"], capture_output=True, text=True, timeout=15)
            m = re.search(r'version "(\d+)', out.stderr + out.stdout)
            if m and int(m.group(1)) >= 17:
                return java
        except Exception:
            continue
    return None


def find_vendored_java():
    if not os.path.isdir(JRE_DIR):
        return None
    exe = "java.exe" if platform.system() == "Windows" else "java"
    for dirpath, _dirs, files in os.walk(JRE_DIR):
        if exe in files and os.path.basename(dirpath) == "bin":
            return os.path.join(dirpath, exe)
    return None


def ensure_java():
    java = find_system_java() or find_vendored_java()
    if java:
        log(f"Java found: {java}")
        return java

    log("Java 17+ not found. Downloading a portable JRE (no admin rights needed)...")
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Windows":
        os_name, ext = "windows", "zip"
        arch = "aarch64" if "arm" in machine else "x64"
    elif system == "Darwin":
        os_name, ext = "mac", "tar.gz"
        arch = "aarch64" if ("arm" in machine or "aarch64" in machine) else "x64"
    else:
        os_name, ext = "linux", "tar.gz"
        arch = "aarch64" if ("arm" in machine or "aarch64" in machine) else "x64"

    url = (f"https://api.adoptium.net/v3/binary/latest/21/ga/{os_name}/{arch}"
           f"/jre/hotspot/normal/eclipse")
    archive = os.path.join(VENDOR, f"jre.{ext}")
    download(url, archive)

    os.makedirs(JRE_DIR, exist_ok=True)
    log("Extracting JRE...")
    if ext == "zip":
        with zipfile.ZipFile(archive) as z:
            z.extractall(JRE_DIR)
    else:
        with tarfile.open(archive) as t:
            t.extractall(JRE_DIR)
    os.remove(archive)

    java = find_vendored_java()
    if not java:
        sys.exit("[setup] ERROR: JRE extracted but java executable not found.")
    log(f"Portable JRE ready: {java}")
    return java


def find_lt_jar():
    if not os.path.isdir(LT_DIR):
        return None
    for dirpath, _dirs, files in os.walk(LT_DIR):
        if "languagetool-server.jar" in files:
            return os.path.join(dirpath, "languagetool-server.jar")
    return None


def ensure_languagetool():
    jar = find_lt_jar()
    if jar:
        log(f"LanguageTool found: {jar}")
        return jar

    os.makedirs(LT_DIR, exist_ok=True)
    archive = os.path.join(VENDOR, "languagetool.zip")
    download(LT_URL, archive)
    log("Extracting LanguageTool (this takes a minute)...")
    with zipfile.ZipFile(archive) as z:
        z.extractall(LT_DIR)
    os.remove(archive)

    jar = find_lt_jar()
    if not jar:
        sys.exit("[setup] ERROR: LanguageTool extracted but server jar not found.")
    log(f"LanguageTool ready: {jar}")
    return jar


def check_ollama():
    if shutil.which("ollama"):
        log("Ollama found. Pull a model with:  ollama pull qwen3:8b")
    else:
        log("Ollama not installed (optional, powers the AI tier).")
        log("  Install from https://ollama.com/download then run:  ollama pull qwen3:8b")


def main():
    os.makedirs(VENDOR, exist_ok=True)
    ensure_java()
    ensure_languagetool()
    check_ollama()
    log("Done. Start StickyWrite with:  python scripts/start.py")


if __name__ == "__main__":
    main()
