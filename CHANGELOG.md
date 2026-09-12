# Changelog

## 0.1.0（2026-09-12）

### 新增

- 初版：状态栏 👻 按钮一键唤起 Ghostty（在跑则激活已有窗口，未跑则带当前工作区目录启动）。
- 命令 `Ghostty: New Terminal Window (in workspace)`：强制新窗口并落在当前工作区目录。
- 背景：内置终端（xterm.js）高速输出场景体验不佳，用户已配好外部 Ghostty 工作流（⇧⌘C 直通 + 全局热键抽屉），本扩展补上「鼠标一键」入口，工作流起点留在 VSCode 内。

### 变更

- **交由 Atlas（FullStackEngineerAgent）管理，成为其子项目**（`.claude/`）。为什么改：用户决定本项目归属全栈工程师 Atlas 维护，按团队「Agent 项目与子项目 `.claude/` 超集关系」规则落地。改了什么：①新建 `.claude/CLAUDE.md`（项目指南 + FullStackEngineerAgent CLAUDE.md 全文随附，保证内容超集）；②Atlas 项目的子项目清单、全局注册表映射表同步登记本项目。
