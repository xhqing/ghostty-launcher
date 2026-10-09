# Changelog

## 未发布

### 新增（测试：Issue #8「置前被 macOS 静默否决」先行用例）

- **为什么改**：用户 2026-10-09 实测报缺陷（Issue #8）——VSCode 里点面板 **New Window** 界面无反应（没弹窗、也没切前台），但扩展日志全绿（`✓ 新窗口创建成功`）、窗口列表计数 +1：窗口建出来了、没被置前。根因：置前请求在 AppKit 之下被 macOS 否决（系统日志 `CPS: Rejecting expired request`——请求来源时间早于该应用最近一次被激活时间即拒，失败那次 15 条拒绝逐条对应 12 次点击），而 `activate window` 底层 `NSApp.activate(ignoringOtherApps:)` **异步无返回值**、拿不到拒收结果，所以日志全绿而实际没置前；属条件性否决、表现为偶发不置前（同日再试、人刚操作过 Ghostty 时同一路径放行）。这不是 Issue #5 修复的回归，而是它的覆盖缺口。修复触及 `lib/ghostty.js` 与 `extension.js` 的置前判定，按 dev-workflow 测试先行：测试 Agent 在功能分支先出题、自跑确认红，开发再实现到绿。
- **改了什么**（2026-10-09）：`test/ghostty.test.js` 新增 10 条用例（文件总 34 条），并定下协议——新增 `ensureForeground({ isFrontmost, activateApp, log, wait })`：置前不再只信 AppleScript 返回值，而是实测「是否已在前台」；已在前台 → `{ ok:true, method:'none' }` 且不调 `activateApp`；不在前台 → 走 LaunchServices 兜底（真机 `open -a Ghostty.app`）一次并复查，复查在前台 → `{ ok:true, method:'launchservices' }`，仍不在前台 → `{ ok:false, method:'launchservices', error }`（可展示的中文原因）；查询 / 兜底动作抛错都不得向上抛（不 reject），且每次查询前调用注入的 `wait`；成功 / 兜底 / 失败各写可辨识日志（不静默）。新增 `foregroundNoticeText({ created, error })`：面板与状态栏复用的失败提示文案（含「新窗口已创建」「未能切到前台」「⌘-Tab」指引与传入原因）。覆盖：①已在前台不多余动作；②兜底后成功；③兜底后仍失败（不谎报成功）；④置前查询抛错（不 reject、记日志、继续兜底）；⑤复查抛错（报失败而非谎报）；⑥兜底动作抛错（不 reject）；⑦`wait` 每次查询前调用；⑧⑨⑩提示文案两分支与 error 缺省边界。不改 Issue #5 锁定的既有契约（创建成功 `ok:true`、失败只重试一次、绝不回退 `open -na`）。
- **自跑**（2026-10-09，先红）：`npm run check` 全过；`npm test` 41 条中 10 红 31 绿——10 红全为新增 Issue #8 用例（实现尚不存在，`ghostty.ensureForeground / foregroundNoticeText is not a function`），既有 31 条保持绿。
- **自检**（2026-10-09，`tmp/` 沙箱，不进仓库）：按接口契约在 `tmp/` 写参考实现拼接 lib 副本对跑，34/34 全绿（排除永真断言）；四类变异（已在前台也调兜底 / 兜底失败谎报成功 / 查询异常向上抛 / 文案误称窗口已创建）各自恰好被对应用例抓住（各红 1 条）。

### 修复（Issue #8：置前不再只信脚本返回值——实测结果 + LaunchServices 兜底 + 失败可见）

- **为什么改**：同节上条的先行用例要落地到实现。根因（2026-10-09 实测）：`activate window` 底层 `NSApp.activate(ignoringOtherApps:)` 异步无返回值，macOS 防抢焦点策略在 AppKit 之下静默否决时（系统日志 `CPS: Rejecting expired request`）扩展一无所知——于是「日志全绿、屏幕没变化」。本次让扩展自己实测结果，不再把「请求已发出」当成「已经在前台」。
- **改了什么**（2026-10-09）：
  - `lib/ghostty.js` 新增两个导出（纯逻辑，外部副作用全部注入）：`ensureForeground({ isFrontmost, activateApp, log, wait })` —— 先实测是否已在前台（是 → `{ ok:true, method:'none' }`，不做多余动作）；不在就换 LaunchServices 路径兜底一次（真机 `open -a Ghostty.app`）并复查（成功 → `{ ok:true, method:'launchservices' }`；仍不在 → `{ ok:false, method:'launchservices', error }`）；查询与兜底分别出错都不向上抛，只如实写日志与返回值；每次查询前调注入的 `wait`（给系统处理激活请求留时间，避免刚发出就查的假阴性）。`foregroundNoticeText({ created, error })` —— 面板与状态栏复用的失败文案，`created` 决定说不说「新窗口已创建」（不得把「建了但没上来」与「没建」混为一谈）。
  - `extension.js`：新增 `isGhosttyFrontmost()`（问 Ghostty 自己 `frontmost`，走已有的 AE 通道、不需辅助功能权限）、`activateExistingApp()`（`open -a`，绝不用 `-n`）、`settle()`（250ms 等待）与 `ensureForegroundNow()`；**三条路径全部接上实测**——面板 New Window（失败时提示「新窗口已创建，但未能切到前台…」）、列表行激活（失败时提示未能切到前台）、状态栏 👻 / 命令面板（失败时写日志 + 警告提示）。失败不再静默，也不再让用户对着「日志说成功、屏幕没动静」发呆。
  - 双语 README 诊断节各补一条：置前每次都实测结果、失败会明确提示并给 ⌘-Tab 指引。
- **验证**（2026-10-09）：
  - 本地门禁：`npm run check` 全过；`npm test` **41/41 全绿**（含测试 Agent 先写的 10 条 Issue #8 用例，实现前红、实现后绿；既有 31 条保持绿）。
  - 真机验证（走真实依赖：真 osascript 查询 + 真 `open -a`）：①「已在前台」路径——`isFrontmost()` 返回 true → `ensureForeground` 直接 `{ ok:true, method:'none' }`、无副作用；②「后台兜底」路径——先把 Ghostty 挤到后台（`isFrontmost()` 实测 false）→ 日志出现「↻ … LaunchServices 兜底一次：open -a Ghostty.app」→ 复查 true → `{ ok:true, method:'launchservices' }`，系统日志同步显示该激活请求被接受（`Making … the front process`）。
  - 边界说明：macOS 防抢焦点拒绝激活的条件（请求来源时间早于该应用最近一次被激活时间）至今未找到可稳定复现的方法，所以「两条路径都被拒」的真实分支以单测锁定（兜底后仍不在前台 → `ok:false` + 可展示原因 + 警告日志），真机验证覆盖前两条路径。

## 0.2.2（2026-10-01）

### 新增（测试：Issue #5「New Window 建出的窗口不置前」先行用例）

- **为什么改**：用户 2026-09-30 在 v0.2.1 正式版实测报缺陷（Issue #5）——面板点 New Window 建出的窗口不置前（Ghostty 在后台时停在原前台应用后面，需手动切换）。修复触及 `lib/ghostty.js` 的 JXA 脚本生成与 `runNewWindow` 判定，属核心开发，按 dev-workflow 测试先行：测试 Agent 在功能分支先出题、自跑确认红，开发再实现到绿。
- **改了什么**（2026-09-30）：`test/ghostty.test.js` 新增 6 条用例（文件总 24 条），并定下协议——窗口创建成功但激活失败时，脚本返回可区分状态 `"activate-failed"`；`runNewWindow` 收到它按成功处理（`ok:true`）、不重试（重试会建出第二个窗口）、不回退 `open -na`，并写一条警告日志（可观测、不静默）；只有 `newWindow` 本身失败仍抛出、走上层「重试一次 → `{ok:false,error}`」路径。覆盖：①脚本在 `newWindow` 之后对刚创建的窗口对象调用 `activateWindow`（同时保留既有 JSON 转义契约）；②在 Node 沙箱里真实执行生成的脚本、断言控制流（激活抛错返回 `"activate-failed"`；创建抛错不得伪装成成功）；③`runNewWindow` 对「已创建但激活失败」的成功判定与警告日志；④非约定状态仍按创建失败重试报错（不放宽失败判定）。
- **自跑**（2026-09-30，先红）：`npm run check` 全过；`npm test` 31 条中 4 红 27 绿——4 红全为新增的 Issue #5 行为用例（实现尚不存在），新增的 2 条防回归守卫用例与既有 18 条保持绿。
- **自检**（2026-09-30，`tmp/` 沙箱，不进仓库）：按 Issue 修复方向在 `tmp/` 改一份 lib 副本对跑，24/24 全绿（排除永真断言）；四类变异（脚本不激活 / 创建失败吞成激活失败 / 不识别 `activate-failed` / 放宽成功判定）分别红 3 / 1 / 1 / 1 条，均被对应用例抓住。

### 修复（Issue #5：New Window 建出的窗口不置前）

- **为什么改**：用户 2026-09-30 在 v0.2.1 正式版实测报缺陷（Issue #5）——面板点 New Window 没有正常切换窗口：窗口确实建出来了，但没切到最上层（Ghostty 在后台时新窗口停在原前台应用后面，需手动切）。根因（源码级定位，ghostty 分叉仓库）：AppleScript `new window` handler（`AppDelegate+AppleScript.swift:171` → `TerminalController.newWindow(...)`，其内部 `TerminalController.swift:305` 只有 `DispatchQueue.main.async { c.showWindow(self) }`）**全程没有 `NSApp.activate`**；而 `activate window`（`ScriptWindow.swift:178`）才是 `makeKeyAndOrderFront` + `NSApp.activate(ignoringOtherApps: true)` 的置前路径（面板「点窗口行激活」用的就是它，实测有效）。修复触及 `lib/ghostty.js` 的 JXA 脚本生成与 `runNewWindow` 判定，按 dev-workflow 测试先行（测试已先出题并自跑见红，见上节）。
- **改了什么**（2026-09-30）：
  - `lib/ghostty.js` 的 `buildNewWindowScript`：拿到 `newWindow({ withConfiguration: cfg })` 的返回值后调用 `app.activateWindow(win)` 把新窗口置前（同时激活 Ghostty）；**激活失败不抛出**、返回可区分状态 `"activate-failed"`——抛出去会被上层当成创建失败去重试，反而多建一个窗口。
  - `runNewWindow`：识别 `"activate-failed"` → 按成功处理（`ok:true`）、不重试、不回退 `open -na`，并写一条警告日志（`⚠ 新窗口已创建，但置前激活失败…`，可观测、不静默）；只有 `newWindow` 本身失败仍走「重试一次 → `{ok:false,error}`」；非约定返回状态仍按创建失败处理（不放宽失败判定）。
  - 双语 README 同步：New Window 按钮描述补上「新窗口会切到最前（同时激活 Ghostty）」——此前只承诺「落在当前工作区目录」。
- **验证**（2026-09-30）：
  - 本地门禁：`npm run check` 全过；`npm test` **31/31 全绿**（含测试 Agent 先写的 4 条 Issue #5 用例，实现前红、实现后绿）。
  - 真机验证（走生产代码路径，借用户正在运行的实例，创建后即关闭）：`runNewWindow` 返回 `{ok:true}`、日志为「✓ 新窗口创建成功（第 1 次，287ms…）」而**不是** `activate-failed`，说明真实 AppleScript 里 `activateWindow` 接受 `newWindow` 刚返回的窗口对象；随后新窗口确为 `frontWindow()`；测试窗口已关闭、无残留。
  - 边界说明（最终确认留给用户实测）：验证时 Ghostty 恰在前台，无法在不抢用户焦点的情况下复现「Ghostty 在后台」的差异；但置前效果与「点窗口行激活」共用同一 `activate window` 实现（日常用着有效），后台场景以「VSCode 在前台点 New Window」实测为准。

## 0.2.1（2026-09-30）

### 新增（测试体系：Node 内置测试框架 + 首批测试 + CI 门禁）

- **为什么改**：Issue #1（面板 New Window 偶发无反应）要补可观测性、失败可见并消除已知竞态，修复触及 `extension.js` 运行行为、属核心开发，按 dev-workflow 测试先行（测试 Agent 先出题、自跑确认红，开发后实现到绿）。本仓库此前无测试框架、无测试命令、无 CI，测试体系随本次一并建立；出题按 Issue 正文「期望行为」与评论里的接口提示（可测纯逻辑抽到 `lib/ghostty.js` / `media/panel.js`），出题时实现尚不存在。
- **改了什么**（2026-09-29）：
  - 新增 `test/ghostty.test.js`（18 用例）：New Window 决策（运行中失败 → 重试一次；两次失败 → 返回 `{ ok:false, error }` 且**绝不回退** `open -na`；未运行 → `open -na --args --working-directory` 冷启动）、激活决策（成功 / 窗口已不存在 / 调用失败）、JXA 脚本生成（列表 / 激活 / 新窗口，含 JSON 转义嵌入）、`shellQuote`、轮询间隔 `LIST_INTERVAL`（2000 → 3000）、失败与成功可观测（`log` 回调，失败不再静默）。
  - 新增 `test/panel.test.js`（7 用例）：列表 payload 稳定签名 `signatureOf`（相同数据同签名；运行状态 / 窗口数量 / id / 名称 / 目录 / 错误任一变化签名不同——「数据未变不重建 DOM」的防护基础）、状态提示文案 `hintFor`（未运行 / 列表不可用含错误原因 / 无窗口 / 正常无提示）。
  - `package.json` 新增 `scripts.test`（`node --test test/*.test.js`，零依赖走 Node 内置 `node:test`）与 `scripts.check`（全量 JS 语法检查）。
  - 新增 `.github/workflows/ci.yml`：`pull_request`（main）+ `push`（main）触发，跑语法检查 + 全量测试；按首次启用顺序，待本分支经 PR 合并进 main 后再开 main 分支保护并设 required。
  - `.vscodeignore` 排除 `test/**` 与 `.github/**`（不进 vsix）。
  - 自跑验证：`npm run check` 全过；`npm test` 全红（`lib/ghostty.js` / `media/panel.js` 尚不存在，先红验证断言有效）；另在 `tmp/` 用最小 stub 自检（25/25 全绿，排除测试自身恒红）并做三类变异（不重试 / 回退 open / 签名忽略 running，分别红 3 / 2 / 1 条，排除永真断言）。

### 修复（Issue #1 实现：可观测、失败可见、消除已知竞态）

- **为什么改**：Issue #1「面板 New Window 偶发无反应」的排查结论是「当前无法定位根因」——扩展自身零日志、所有失败路径静默吞掉，当时的 exthost 日志又被轮转删除；同时代码审查列出 4 条已知隐患（列表每 2 秒全量重建 DOM 会吞掉点击、面板重开有空白窗、运行中调用失败会静默回退 `open -na` 拉起第二实例、轮询无在途守卫）。本次按 Issue 的 5 条验收标准补齐实现：故障偶发、无法按需复现，验收以「可观测性 + 消除已知竞态」为准。测试由测试 Agent 先行写好（25 条，见 `test/` 与上节），本次交付实现到全绿。
- **改了什么**（2026-09-30）：
  - 新增 `lib/ghostty.js`（不依赖 VSCode 的调用层）：JXA 脚本生成（列表 / 激活 / 新窗口）、`shellQuote`、轮询间隔常量，以及三条决策流程 `runNewWindow` / `runActivate` / `runSummon`——外部副作用（osascript / open / 日志）全部注入，单测注入假实现即可断言行为。关键约束：Ghostty 运行中新建窗口失败**只重试一次**，仍失败返回 `{ok:false,error}`，**绝不回退 `open -na`**（运行中回退会拉起第二个实例，两实例窗口互不相通）；只有确认未运行才走 `open -na --args --working-directory=<dir>` 冷启动。
  - 新增 `media/panel.js`（从 `extension.js` 内联 HTML 抽出的 webview 端脚本）：`signatureOf` 列表 payload 稳定签名 + `hintFor` 状态提示文案（纯函数段带 `module.exports` 守卫，node 可直接 require），DOM 绑定区只在 webview 环境执行。核心防护：**签名不变就不重建 DOM**，消除「点击落在 mousedown/mouseup 之间赶上列表重建、被吞掉」的竞态。
  - `extension.js` 重写为接线层：①新增 Output 通道「Ghostty Launcher」，每次点击、每次 Ghostty 调用（含耗时、结果、错误；列表轮询也逐次记录，兼作「扩展是否卡住」的心跳证据）都写日志，失败不再静默；②New Window / 激活窗口失败在面板上直接提示（「窗口已不存在（可能刚被关闭）」/「新窗口创建失败：<原因>」），点按钮后即时显示「Opening a new window…」，状态栏与命令路径失败弹错误提示并带 Show Log 按钮；③面板实例缓存上次列表，webview 重新就绪时先下发缓存立即渲染（消除重开面板的空白窗）；④轮询间隔 2s → 3s，加在途刷新守卫（同一时刻最多一个请求，慢刷新不再叠加调用）；⑤CSP 改为 `script-src 'nonce-…' ${webview.cspSource};`，脚本以外部文件加载（VSCode 官方文档已改为推荐外部脚本：`https://code.visualstudio.com/api/extension-guides/webview`）。
  - 双语 README 同步：列表刷新间隔 2s → 3s，新增「诊断 / Diagnostics」小节说明 Output 日志通道。
- **验证**（2026-09-30）：
  - `npm run check` 全过；`npm test` 25/25 全绿（测试 Agent 先行写的用例，实现前全红）。
  - 接线冒烟（临时脚本在 `tmp/`，不进仓库）：用假 `vscode` 模块加载扩展 → HTML/CSP/脚本 URI 正常、主副面板各自注册与轮询、`ready` → 列表下发、日志格式正确；用假 DOM 加载 `media/panel.js` → 首次渲染建 DOM、**同数据重复下发不重建**、数据变化才重建、提示文案与点击消息正确。
  - 真实 Ghostty 全链路（借用用户正在运行的实例，只创建「自退出窗口」，不留残留、不动用户窗口）：列表脚本真实返回可解析（3 个窗口含目录）；运行中新建窗口走 AppleScript 成功（`ok` 断言、302ms、落点目录实测正确、新窗口随后出现在列表中）；`runActivate` 成功（116ms）与 notfound 失败分支（用户可见原因 + 写入日志）均实测。
  - 排查记录（供后续参考）：pi 的 bash 沙箱里 `pgrep` 看不到沙箱外的进程（对用户已运行的 Ghostty 返回假阴性；同一命令在 launchd 上下文正常）——只影响沙箱内的调试脚本，扩展跑在 VSCode 扩展宿主、不受该限制；期间在沙箱内误起的第二个 Ghostty 实例已清理（该实例无窗口，未动用户实例）。**警示：临时脚本不要带 `quit app "Ghostty"` 之类的收尾动作——用户的实例里有活着的会话。**

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
