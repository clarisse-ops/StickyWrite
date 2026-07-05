# StickyWrite

A private, local Grammarly-style writing assistant. Everything runs on your own machine: no accounts, no cloud, no text ever leaving your computer.

## How it works

StickyWrite is a web app with three checking engines, layered:

| Engine | What it does | Where it runs | Required? |
|---|---|---|---|
| **Harper** | Spelling, grammar, punctuation, style. Instant. | Inside the browser (WebAssembly) | Always on, ships with the repo |
| **LanguageTool** | Deeper grammar and style rules | Local Java server on port 8081 | Optional, installed by `setup.py` |
| **Local AI (Ollama)** | Tone detection, clarity rewrites, shorten/simplify/formal/casual rewrites | Local Ollama server on port 11434 | Optional |

The app detects which engines are running and lights up the pills in the top bar. With none of the optional tiers installed it still works fully on Harper.

Documents autosave to the browser's local storage. Suggestions show as colored underlines (red = correctness, blue = clarity, green = engagement, purple = delivery), same idea as Grammarly. Click an underline or a card to accept a fix, dismiss it, or add a word to your personal dictionary.

## First-time setup

Requirements: Python 3.9+ (for the two scripts, nothing else).

```
python scripts/setup.py    # one time: downloads LanguageTool + a portable Java if needed (~350MB)
python scripts/start.py    # every time: starts everything and opens the browser
```

For the AI tier (optional):

1. Install Ollama from https://ollama.com/download
2. Pull a model: `ollama pull gemma3:4b` is a good fit for laptops without a discrete GPU. With a discrete GPU, `ollama pull qwen3:8b` gives stronger rewrites. Pick the model in Settings either way.

That's it. `start.py` serves the app at http://localhost:4700 and starts LanguageTool automatically if it's installed.

## Moving to another machine (Mac or Windows)

1. Push this repo to GitHub (or copy the folder).
2. On the new machine: clone it, install Python 3, run `python scripts/setup.py`, then `python scripts/start.py`.
3. Optional: install Ollama and pull a model for the AI tier.

Nothing is machine-specific. The big downloads (LanguageTool, Java) are gitignored and re-fetched by `setup.py` on each machine.

Note: documents live in the browser's local storage, so they don't move with the repo. Use the download button (⬇) to export anything you want to carry over.

## Hosting it as a website

The app is fully static, so it works on GitHub Pages as-is:

1. Push the repo to GitHub.
2. Settings → Pages → deploy from the `master` branch, root folder.

Visitors get the Harper engine running inside their own browser, so the hosted version is exactly as private as the local one. The LanguageTool and AI tiers light up automatically for any visitor who happens to run those servers locally; for everyone else those pills simply stay off.

## Project layout

```
index.html            The app shell
css/app.css           All styling
js/editor.js          Plain-text editor + underline painting (CSS Custom Highlight API)
js/main.js            App logic: linting, cards, docs, settings
js/engines/           One file per engine (Harper, LanguageTool, Ollama)
js/stats.js           Word counts, readability, overall score
js/store.js           localStorage persistence
vendor/harper/        Harper WebAssembly build (committed, ~18MB)
scripts/setup.py      One-time downloads (LanguageTool, portable JRE)
scripts/start.py      Launches everything
```

## License notes

Harper is Apache-2.0 (Automattic). LanguageTool is LGPL-2.1 and runs as a separate server process, not linked into this code. Ollama is MIT; model licenses vary by model.
