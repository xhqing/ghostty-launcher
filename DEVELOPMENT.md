# ghostty-launcher 项目指南

## 负责工程师：Atlas

本项目由 **Atlas**（dev-agent，用户的全栈开发工程师）负责维护。Atlas 负责本项目的全部开发工作——VSCode 扩展工程、构建发布流水线等。在本项目内的开发 / 维护需求，由 Atlas 统一处理（Atlas 的角色定义与工作原则见 dev-agent 项目的 `AGENTS.md`）。

具体任务由 Atlas 派的 **Worker 会话**在本项目的 worktree 里执行：Worker 负责改代码 / 跑测试 / 提交 / 开 PR，Atlas（Leader）负责 local main 同步、建 worktree、收尾清理与向用户汇报。本项目要 Worker 遵守的项目硬约束写在 `.pi/APPEND_SYSTEM.md`（会话启动自动加载），本文件负责详细说明。

ghostty-launcher 是一个 VSCode 状态栏扩展：点击 👻 按钮一键唤起外部 Ghostty 终端——Ghostty 在运行则激活已有窗口，未运行则带当前工作区目录启动；另提供命令面板命令强制新开窗口（落在当前工作区目录）。零依赖、仅 macOS。项目背景：内置终端（xterm.js）在高速输出场景体验不佳，用户已配好外部 Ghostty 工作流（⇧⌘C 直通 + 全局热键抽屉 + 本扩展的鼠标一键入口），扩展只做「拉起外部 Ghostty」这一件事，不内嵌终端模拟。


（本文件 2026-10-12 由原 `CLAUDE.md` 的项目指南迁入；按新规，非 Agent 项目不再保留 CLAUDE.md / AGENTS.md 等智能体专属文件。）
