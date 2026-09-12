<div align="center">
  <img src="assets/logo.svg" alt="ghostty-launcher" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-0.2.0-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-VSCode%20Extension-0078D4)](https://code.visualstudio.com/)

  [简体中文](README_cn.md)
</div>

# Ghostty Launcher

A tiny VSCode extension that summons the external [Ghostty](https://ghostty.org/) terminal from VSCode — one click from the status bar, or from an Activity Bar panel.

## Features

- **Status bar 👻 button** — one click:
  - Ghostty is running → activate the existing window (bring to front);
  - Ghostty is not running → launch it, automatically opening the current workspace directory.
- **Command `Ghostty: New Terminal Window (in workspace)`** — always open a new Ghostty window in the current workspace directory (find it in the Command Palette ⌘⇧P by searching "ghostty").
- **Activity Bar 👻 panel** — a side panel with:
  - a **New Window** button at the top (opens a new Ghostty window in the current workspace directory);
  - a live list of all open Ghostty windows (title + working directory, auto-refreshed every 2 s) — click an entry to bring that window to the front.

## Requirements

- macOS + [Ghostty](https://ghostty.org/) (`/Applications/Ghostty.app`)
- The Activity Bar window panel talks to Ghostty via its built-in AppleScript interface, which requires **Ghostty 1.2+** (tested with 1.3.1). Without it, the status bar button and commands still work; only the window list is unavailable.

## Why

The built-in terminal (xterm.js) struggles with high-throughput output. If you already run an external Ghostty workflow (⇧⌘C passthrough, global hotkey drawer), this extension adds the missing mouse entry point — one click, and the workflow starts inside VSCode.

## License & Attribution

Copyright (c) 2026 All Contributors. Released under the [MIT License](LICENSE.md).

Attribution: if you use or reference this project, please keep the copyright notice and credit the source: [ghostty-launcher](https://github.com/xhqing/ghostty-launcher).
