<div align="center">
  <img src="assets/logo.svg" alt="ghostty-launcher" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-0.2.5-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-VSCode%20Extension-0078D4)](https://code.visualstudio.com/)

  [English](README.md)
</div>

# Ghostty Launcher

VSCode 一键唤起 Ghostty 终端的小扩展——状态栏一点，或侧边栏面板一目了然（主侧边栏与副侧边栏同时可用）。

## 功能

- **状态栏 👻 按钮**：点击一下——
  - Ghostty 正在运行 → 激活已有窗口（置前）；
  - Ghostty 未运行 → 启动，并自动 `cd` 到当前工作区目录。
- **命令 `Ghostty: New Terminal Window (in workspace)`**：始终新开一个 Ghostty 窗口，落在当前工作区目录（命令面板 ⌘⇧P 搜索 ghostty）。
- **👻 侧边栏面板（主侧边栏与副侧边栏各一个，可同时打开）**：主侧边栏从左侧活动栏 👻 图标点开，副侧边栏打开后同样有 👻 图标，两处同时常驻互不影响——
  - 顶部 **New Window** 按钮：新开窗口、落在当前工作区目录，并把新窗口切到最前（同时激活 Ghostty）；
  - 所有已打开 Ghostty 窗口的实时列表（标题 + 工作目录，每 3 秒自动刷新），点击任一项把对应窗口拉到前台。

## 依赖

- macOS + [Ghostty](https://ghostty.org/)（`/Applications/Ghostty.app`）
- VSCode 1.104+（副侧边栏容器入口系 1.104 引入；旧版下主侧边栏面板、状态栏按钮与命令不受影响）
- 侧边栏窗口面板通过 Ghostty 自带的 AppleScript 接口通信，需要 **Ghostty 1.2+**（在 1.3.1 上实测）。旧版本下状态栏按钮与命令不受影响，仅窗口列表不可用。

## 诊断

- 每次点击（New Window / 激活某个窗口）与每次 Ghostty 调用（含耗时、结果、错误）都会写进 Output 面板的「Ghostty Launcher」通道（菜单「查看 → 输出」，右上角下拉选 Ghostty Launcher）——怀疑「点了没反应」时先看这里。
- New Window 或激活窗口失败时，面板顶部会直接给出提示（例如「窗口已不存在（可能刚被关闭）」「新窗口创建失败：<原因>」），不会静默失败。
- 置前（把 Ghostty 窗口切到最前）每次都会**实测结果**：没成功就自动换 `open -a` 路径兜底再试一次；两次都没上去会明确提示「未能切到前台：…请用 ⌘-Tab 手动切换」——macOS 的防抢焦点策略偶尔会拒绝程序发起的自动置前，这时窗口往往已经建好、只是停在后台，而不是什么都没发生。

## 为什么做

内置终端（xterm.js）在高速输出场景体验不佳。如果你已配好外部 Ghostty 工作流（⇧⌘C 直通 + 全局热键抽屉），本扩展补上缺的「鼠标一键」入口——点一下，工作流起点留在 VSCode 内。

## 版权与署名

版权所有 (c) 2026 All Contributors，基于 [MIT 许可证](LICENSE.md)发布。

署名方式：使用或引用本项目时，请保留版权声明并注明来源：[ghostty-launcher](https://github.com/xhqing/ghostty-launcher)。
