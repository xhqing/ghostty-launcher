<div align="center">
  <img src="assets/logo.svg" alt="ghostty-launcher" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-0.2.5-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-VSCode%20Extension-0078D4)](https://code.visualstudio.com/)

  [简体中文](README_cn.md)
</div>

# Ghostty Launcher

A tiny VSCode extension that summons the external [Ghostty](https://ghostty.org/) terminal from VSCode — one click from the status bar, or from a side panel (available in both the Primary and Secondary Side Bar).

## Features

- **Status bar 👻 button** — one click:
  - Ghostty is running → activate the existing window (bring to front);
  - Ghostty is not running → launch it, automatically opening the current workspace directory.
- **Command `Ghostty: New Terminal Window (in workspace)`** — always open a new Ghostty window in the current workspace directory (find it in the Command Palette ⌘⇧P by searching "ghostty").
- **👻 side panel (one in the Primary Side Bar, one in the Secondary Side Bar — both usable at the same time)** — open it from the 👻 icon in the Activity Bar, or from the 👻 icon in the Secondary Side Bar:
  - a **New Window** button at the top (opens a new Ghostty window in the current workspace directory and brings it to the front);
  - a live list of all open Ghostty windows (title + working directory, auto-refreshed every 3 s) — click an entry to bring that window to the front.

## Requirements

- macOS + [Ghostty](https://ghostty.org/) (`/Applications/Ghostty.app`)
- VSCode 1.104+ (the Secondary Side Bar container entry was introduced in 1.104; on older versions the Primary Side Bar panel, status bar button and commands still work)
- The side panel talks to Ghostty via its built-in AppleScript interface, which requires **Ghostty 1.2+** (tested with 1.3.1). Without it, the status bar button and commands still work; only the window list is unavailable.

## Diagnostics

- Every click (New Window / activating a window) and every Ghostty call (with duration, result and error) is written to the **Ghostty Launcher** channel in the Output panel (View → Output, then pick "Ghostty Launcher" from the dropdown) — the first place to look when a click seems to do nothing.
- When **New Window** or window activation fails, the panel reports the reason right at the top — including the case where the window no longer exists — instead of failing silently.
- Bringing a window to the front is always **verified after the fact**: if the first attempt does not take effect, it retries via `open -a Ghostty`; if both attempts fail, the panel says so ("could not bring it to the front — switch with ⌘-Tab") instead of pretending success. macOS focus-stealing protection can occasionally refuse a programmatic activation; in that case the window usually exists already, it just stays in the background.

## Why

The built-in terminal (xterm.js) struggles with high-throughput output. If you already run an external Ghostty workflow (⇧⌘C passthrough, global hotkey drawer), this extension adds the missing mouse entry point — one click, and the workflow starts inside VSCode.

## License & Attribution

Copyright (c) 2026 All Contributors. Released under the [MIT License](LICENSE.md).

Attribution: if you use or reference this project, please keep the copyright notice and credit the source: [ghostty-launcher](https://github.com/xhqing/ghostty-launcher).
