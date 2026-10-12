# ghostty-launcher 项目指南

## 负责工程师：Atlas

本项目由 **Atlas**（FullStackEngineerAgent，用户的全栈开发工程师）负责维护。Atlas 负责本项目的全部开发工作——VSCode 扩展工程、构建发布流水线等。在本项目内的开发 / 维护需求，由 Atlas 统一处理（Atlas 的角色定义与工作原则见 FullStackEngineerAgent 项目的 `CLAUDE.md`）。

ghostty-launcher 是一个 VSCode 状态栏扩展：点击 👻 按钮一键唤起外部 Ghostty 终端——Ghostty 在运行则激活已有窗口，未运行则带当前工作区目录启动；另提供命令面板命令强制新开窗口（落在当前工作区目录）。零依赖、仅 macOS。项目背景：内置终端（xterm.js）在高速输出场景体验不佳，用户已配好外部 Ghostty 工作流（⇧⌘C 直通 + 全局热键抽屉 + 本扩展的鼠标一键入口），扩展只做「拉起外部 Ghostty」这一件事，不内嵌终端模拟。


（本文件 2026-10-12 由原 `CLAUDE.md` 的项目指南迁入；按新规，非 Agent 项目不再保留 CLAUDE.md / AGENTS.md 等智能体专属文件。）
