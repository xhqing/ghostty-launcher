# ghostty-launcher · 项目硬约束

身份与角色见本仓库根 `AGENTS.md`；团队通用规则见全局 `~/.pi/agent/AGENTS.md`，此处不重述。

## 本项目是什么

VSCode 状态栏扩展：点击 👻 按钮一键唤起外部 Ghostty 终端——Ghostty 在运行则激活已有窗口，未运行则带当前工作区目录启动；另提供命令面板命令强制新开窗口。零依赖、仅 macOS。

## 硬约束

- **零依赖**：不引入任何 npm 运行时依赖，扩展只用 VSCode 内置 API + Node 标准库。新增依赖前必须先在汇报里说明理由。
- **只做「拉起外部 Ghostty」这一件事**：不内嵌终端模拟（内置 xterm.js 在高速输出场景体验不佳，用户已配好外部 Ghostty 工作流）。任何「顺手加个终端面板」的想法都属于跑偏。
- **仅 macOS**：不做跨平台兼容代码，也不要为了「兼容 Windows」增加判断分支。
- **改动必须记 `CHANGELOG.md`**：写清为什么改 + 改了什么。
- **版本号以 `VERSION` 为唯一权威**：`package.json`、CHANGELOG、README 徽章与它保持一致；不在功能分支上 bump。
- **临时产物放项目 `tmp/`**（已忽略），不落到 `src/` / `media/` 等正式目录。

## 验证要求

- 改动后在 VS Code 扩展开发宿主（F5）里实机点一遍状态栏按钮与命令面板命令，确认两种路径（Ghostty 在跑 / 未跑）都符合预期。
- 涉及扩展激活 / 命令注册的改动，额外检查「扩展已启用」的边界条件。

## 测试文件对 Worker 只读（2026-11-13 立）

测试由 **Leader（dev-agent / Atlas 的会话）在实现开工前**写好，以功能分支上的本地 commit 形式存在。你（Worker）对测试文件**只能读、只能运行**：

- **禁止新建 / 修改 / 删除 / 移动**任何测试文件与测试基础设施：本项目的测试位置是 `test/`（`*.test.js`）；含 fixtures / helpers / conftest 等伴生文件（跑测试缺了也不自己补）。
- **碰到测试跑不通、断言与 Issue 预期不符 → 终止开发、上报 Leader（`Atlas`）或用户裁决**，绝不改测试迁就实现——这是 LLM 的典型失败模式（改不动代码就放宽断言）。
- **`# TEST_CASES_WRITE_OK` 标记的签发权在 Leader**，你不加；被 `test-cases-guard` 拦下时不要绕过。
- 例外：测试运行自产的缓存与构建产物（`__pycache__`、`.pytest_cache`、coverage 输出、`out/` 等）可清理，走授权标记通道。

## 详细说明

开发与发布约定见项目根 `DEVELOPMENT.md`；通用工作规则（读取优先、增改查优先慎用删除、汇报前验证、敏感信息不进会被 git 跟踪的文件）见全局 `~/.pi/agent/AGENTS.md`。
