<div align="center">
  <img src="assets/logo.svg" alt="ghostty-launcher" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-0.1.0-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-VSCode%20Extension-0078D4)](https://code.visualstudio.com/)

  [English](README.md)
</div>

# Ghostty Launcher

VSCode 一键唤起 Ghostty 终端的小扩展——状态栏一点，或活动栏面板一目了然。

## 功能

- **状态栏 👻 按钮**：点击一下——
  - Ghostty 正在运行 → 激活已有窗口（置前）；
  - Ghostty 未运行 → 启动，并自动 `cd` 到当前工作区目录。
- **命令 `Ghostty: New Terminal Window (in workspace)`**：始终新开一个 Ghostty 窗口，落在当前工作区目录（命令面板 ⌘⇧P 搜索 ghostty）。
- **活动栏 👻 面板**：左侧活动栏点开即见——
  - 顶部 **New Window** 按钮：新开窗口并落在当前工作区目录；
  - 所有已打开 Ghostty 窗口的实时列表（标题 + 工作目录，每 2 秒自动刷新），点击任一项把对应窗口拉到前台。

## 依赖

- macOS + [Ghostty](https://ghostty.org/)（`/Applications/Ghostty.app`）
- 活动栏窗口面板通过 Ghostty 自带的 AppleScript 接口通信，需要 **Ghostty 1.2+**（在 1.3.1 上实测）。旧版本下状态栏按钮与命令不受影响，仅窗口列表不可用。

## 为什么做

内置终端（xterm.js）在高速输出场景体验不佳。如果你已配好外部 Ghostty 工作流（⇧⌘C 直通 + 全局热键抽屉），本扩展补上缺的「鼠标一键」入口——点一下，工作流起点留在 VSCode 内。

## 版权与署名

版权所有 (c) 2026 All Contributors，基于 [MIT 许可证](LICENSE.md)发布。

署名方式：使用或引用本项目时，请保留版权声明并注明来源：[ghostty-launcher](https://github.com/xhqing/ghostty-launcher)。
