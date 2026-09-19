# Changelog

## 0.2.0（2026-09-12）

### 变更（CLAUDE.md 删去「由 Claude Code 自动加载」说明句）

- **为什么改**：用户 2026-09-12 要求 CLAUDE.md 不再强调本文由 Claude Code 加载，团队全部项目的 CLAUDE.md 统一清理此类语句。
- **改了什么**（2026-09-12）：`CLAUDE.md` 开头角色定位行删去句尾「本文件由 Claude Code 在每次会话开头自动加载。」，角色描述本身保留。

### 新增

- **扩展图标（`assets/icon.png`，256×256 PNG）**：为什么：用户装包后发现扩展详情页（Extensions 面板）无 logo，占位灰块难看——`package.json` 从未声明 `icon` 字段（README 横幅 logo 与活动栏图标都不覆盖这个位置）。改了什么（2026-09-19）：新建 `assets/icon.svg`（512×512、rx=112 圆角方形、品牌素罗兰渐变 #8B5CF6→#5B21B6、居中白色幽灵矢量主体——与活动栏/面板同一套幽灵 glyph，不用 banner 的 emoji，避免字体依赖），rsvg-convert 渲染出 256×256 PNG，`package.json` 增加 `"icon": "assets/icon.png"`；几何实测：四角透明（无棱角）、主体居中（左右留白 64/65、上下 48/49 px）、高度占比 61.7%、眼睛镂空透出渐变。

- **副侧边栏（Secondary Side Bar）同步提供 👻 面板，与主侧边栏（活动栏）同时可用**：为什么：用户要求主侧边栏与副侧边栏要能同时都有 Ghostty 入口——左侧看项目树的同时，副侧边栏也能常驻 Ghostty 窗口列表。改了什么（2026-09-19）：①`package.json` 新增 `viewsContainers.secondarySidebar` 容器（id `ghostty-secondary`，复用同一图标）与对应 webview 视图 `ghosttyLauncher.windowsSecondary`；②`extension.js` 为两个视图各注册一个 `WindowsPanel` 实例（同一套 UI，各自独立轮询、可见才刷新）；③`engines.vscode` 由 `^1.80.0` 提到 `^1.104.0`——`secondarySidebar` 容器位置系 VSCode 1.104 引入（官方源码逐 tag 核实：1.103 无、1.104 有，官方贡献点文档尚未收录该位置；本机 1.136.1 安装包源码内已含该支持），旧版 VSCode 下该字段被忽略、主侧边栏面板不受影响；④双语 README 同步功能描述与版本要求。副侧边栏默认收起，打开后（右侧布局图标或 `Toggle Secondary Side Bar`）即见 👻 图标与面板。⑤主容器 id 定为 `ghostty-primary`（而非沿用 0.2.0 首轮的 `ghostty`）：为什么：本机实测装包后发现活动栏图标不出现，排查为 09-12 首轮 dev 测试时用户把 `ghostty` 容器拖进了副侧边栏，该「容器位置迁移」按 workspace 持久化（`workbench.auxiliarybar.viewContainersWorkspaceState`），重装/升级不会清除，导致新装后主容器仍被还原到副侧边栏、活动栏无图标；容器改名后所有旧位置状态指向不存在的 id 而失效，主容器在各 workspace 均回到默认活动栏位置，无需逐个 workspace 手动移回。

- **活动栏（Activity Bar）👻 面板**：左侧活动栏点开即见——顶部「New Window」按钮 + 所有已打开 Ghostty 窗口的实时列表（标题 + 工作目录，每 2 秒轮询刷新），点击列表项把对应窗口拉到前台（同时激活 Ghostty 应用）。为什么：状态栏按钮只能「激活整个应用」，无法列出并直达具体窗口，用户要不离开 VSCode 就看到并选中各个 Ghostty 窗口。实现走 Ghostty 自带 AppleScript 脚本字典（窗口枚举 / `activate window` / `new window`，需 Ghostty 1.2+，本机 1.3.1 实测全部行为），不需要辅助功能权限；配套新增 `assets/activitybar.svg`（24×24 单色 currentColor、全圆角幽灵造型，几何边界经渲染实测验证）。涉及文件：`package.json`（注册视图容器 + webview 视图）、`extension.js`（JXA 调用层 + WindowsPanel provider）、双语 README 同步功能描述。

### 变更

- **修复「运行中新窗口拉起第二实例」隐患**：Ghostty 已在运行时，原「新窗口」走 `open -na --args`，实测会拉起第二个 Ghostty 进程（两实例窗口互不相通，AppleScript 列表也看不到新窗口）；改为运行中走 AppleScript `new window` 并显式设置登录 shell（$SHELL 回退 /bin/zsh）与初始目录（当前工作区）——实测 surface configuration 未显式设置的字段会按空值覆盖，command 不给 shell 新窗口会秒关；未运行时仍走 open 冷启动路径（用户配置全生效）；旧版 Ghostty（<1.2，无脚本字典）自动回退旧行为。
- **打包工艺固化**：为什么改：本轮起 README 带 SVG 横幅，vsce 3.x 报「SVGs are restricted in README」且已无 `--allow-svg` 开关，补 repository 字段后又报 README.md/readme.md 大小写冲突。改了什么：①`package.json` 补 `repository` 字段（修复 README 内 LICENSE 相对链接解析）；②新建 `.vscodeignore`（排除源 README / tmp / 仓库管理文件）；③打包用 `--readme-path tmp/readme-relay.md`（中转版：当前中文 README 去 SVG 横幅，与 0.1.0 vsix 内 readme 的做法一致），中转版在 tmp/ 下打包前重新生成。

## 0.1.0（2026-09-12）

### 新增

- 初版：状态栏 👻 按钮一键唤起 Ghostty（在跑则激活已有窗口，未跑则带当前工作区目录启动）。
- 命令 `Ghostty: New Terminal Window (in workspace)`：强制新窗口并落在当前工作区目录。
- 背景：内置终端（xterm.js）高速输出场景体验不佳，用户已配好外部 Ghostty 工作流（⇧⌘C 直通 + 全局热键抽屉），本扩展补上「鼠标一键」入口，工作流起点留在 VSCode 内。
- 开源标配：双语 README（`README.md` 英文版 + `README_cn.md` 中文版）+ `assets/logo.svg` + `LICENSE.md`（版权人 All Contributors）+ GitHub About 双语描述与 topics。为什么：首次 `/commit` 后按 commit skill 第 9 步补齐项目标配。

### 变更

- **logo 布局重排（左右留白对称）**。为什么改：初版 logo 副标题过长（24px 全文实测宽 513px），右缘溢出 640px 画布 91px，左右留空严重不对称，观感不专业。改了什么：①副标题缩短为「VSCode Extension · One-Click Ghostty」并降至 22px（实测 381.5px，与标题 389.4px 宽度几乎对齐）；②emoji 与文字块整体居中重排，实测左留白 49.0 / 右留白 47.6、垂直中心均落在画布中线。

- **交由 Atlas（FullStackEngineerAgent）管理，成为其子项目**（`.claude/`）。为什么改：用户决定本项目归属全栈工程师 Atlas 维护，按团队「Agent 项目与子项目 `.claude/` 超集关系」规则落地。改了什么：①新建 `.claude/CLAUDE.md`（项目指南 + FullStackEngineerAgent CLAUDE.md 全文随附，保证内容超集）；②Atlas 项目的子项目清单、全局注册表映射表同步登记本项目。
