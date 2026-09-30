'use strict';

/**
 * Ghostty Launcher 扩展入口：只做 VSCode 侧接线——状态栏按钮、两个面板实例、
 * Output 日志通道；Ghostty 决策与调用逻辑在 lib/ghostty.js，面板 webview 脚本在
 * media/panel.js。
 *
 * 本文件对应 Issue #1 的期望行为：
 * 1. 可观测——每次点击、每次 Ghostty 调用（含耗时 / 结果 / 错误）写入 Output 面板的
 *    「Ghostty Launcher」通道（列表轮询逐次记录，正常一次约 0.4~0.5s）；
 * 2. 失败可见——New Window / 激活窗口失败时面板上给出明确提示，状态栏与命令路径弹
 *    错误提示（带 Show Log 按钮）；
 * 3. 不再静默拉起第二实例——运行中 New Window 失败只重试一次，仍失败就报错，
 *    绝不回退 open -na（由 lib/ghostty.js 保证）；
 * 4. 列表渲染——数据未变化不重建 DOM、面板重开先用缓存立即渲染（media/panel.js +
 *    这里的 lastPayload 缓存）；
 * 5. 轮询——间隔 3 秒、同一时刻最多一个在途刷新请求（inflight 守卫）。
 */

const vscode = require('vscode');
const ghostty = require('./lib/ghostty');

/** Output 面板通道：所有点击与 Ghostty 调用都写这里，故障时先看它 */
let output;

/** 本地时间戳 HH:MM:SS.mmm */
function stamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 写一行日志（Output 面板打开时实时可见） */
function log(line) {
  output?.appendLine(`[${stamp()}] ${line}`);
}

/** 当前工作区根目录（无工作区时返回 undefined） */
function workspaceDir() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// —— 真实副作用（osascript / open）：注入给 lib/ghostty.js 的决策流程 ——

function runJxa(script) {
  return ghostty.jxa(script);
}

function runOpen(argv) {
  return ghostty.execFileAsync(ghostty.OPEN, argv);
}

/** 失败不再静默：弹错误提示 + Show Log 按钮（lib 已把原因写进日志） */
function reportFailure(error) {
  vscode.window.showErrorMessage(`Ghostty Launcher: ${error}`, 'Show Log').then((pick) => {
    if (pick === 'Show Log') output?.show(true);
  });
}

/**
 * 面板：顶部 New Window 按钮 + 打开的窗口实时列表（点击行激活对应窗口）。
 * 主侧边栏与副侧边栏各一个实例，各自独立轮询、各自缓存上次列表。
 */
class WindowsPanel {
  constructor(extensionUri, tag) {
    this.extensionUri = extensionUri;
    this.tag = tag; // 'primary' / 'secondary'：日志里区分是哪个面板
    this.view = undefined;
    this.timer = undefined;
    this.inflight = false; // 在途刷新守卫：同一时刻最多一个
    this.lastPayload = undefined; // 上次列表数据，面板重开时先拿它立即渲染
  }

  log(line) {
    log(`[${this.tag}] ${line}`);
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage((msg) => {
      this.handleMessage(msg, view).catch((e) => this.log(`消息处理异常：${e.message}`));
    });
    view.onDidChangeVisibility(() => (view.visible ? this.start() : this.stop()));
    view.onDidDispose(() => {
      this.stop();
      if (this.view === view) this.view = undefined;
    });

    this.log('面板已加载，开始轮询窗口列表');
    this.start();
  }

  async handleMessage(msg, view) {
    if (msg.type === 'ready') {
      // webview 就绪：先用缓存列表立即渲染（不给空白窗），再拉一次最新数据
      this.log(this.lastPayload ? 'webview 就绪，先用缓存列表渲染' : 'webview 就绪（暂无缓存列表）');
      if (this.lastPayload) this.post({ type: 'list', ...this.lastPayload });
      this.refresh();
      return;
    }

    if (msg.type === 'newWindow') {
      const dir = workspaceDir();
      this.log(`点击 New Window（工作区目录：${dir || '无'}）`);
      const running = await ghostty.isGhosttyRunning();
      const res = await ghostty.runNewWindow({
        running,
        dir,
        command: ghostty.loginShell(),
        jxa: runJxa,
        open: runOpen,
        log: (line) => this.log(line),
      });
      this.post(
        res.ok
          ? { type: 'notice', kind: 'info', text: 'New window opened.' }
          : { type: 'notice', kind: 'error', text: res.error }
      );
      // 窗口刚建好时列表接口不一定马上能看到，稍等再刷
      setTimeout(() => this.refresh(), 600);
      return;
    }

    if (msg.type === 'activate') {
      this.log(`点击窗口行：激活 id=${msg.id}`);
      const res = await ghostty.runActivate({
        id: msg.id,
        jxa: runJxa,
        log: (line) => this.log(line),
      });
      if (!res.ok) this.post({ type: 'notice', kind: 'error', text: res.error });
      setTimeout(() => this.refresh(), 400);
    }
  }

  /** 面板可见时每 LIST_INTERVAL 毫秒刷新一次窗口列表 */
  start() {
    this.stop();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), ghostty.LIST_INTERVAL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  post(message) {
    try {
      this.view?.webview.postMessage(message);
    } catch (e) {
      /* 面板已销毁，忽略 */
    }
  }

  async refresh() {
    const view = this.view;
    if (!view || !view.visible) return;
    if (this.inflight) {
      this.log('上一次列表刷新还在进行中，跳过本次');
      return;
    }

    this.inflight = true;
    const started = Date.now();
    try {
      const data = await ghostty.listWindows();
      const ms = Date.now() - started;
      // 逐次记录（含耗时）：轮询日志既是「每次 Ghostty 调用可观测」的要求，也是故障排查时
      // 判断扩展有没有卡住的心跳证据；正常一次约 0.4~0.5s
      if (data.error) this.log(`列表刷新失败：${data.error}（running=${data.running}，${ms}ms）`);
      else this.log(`列表刷新 ok：running=${data.running} windows=${data.windows.length}（${ms}ms）`);
      this.lastPayload = data;
      if (this.view === view) this.post({ type: 'list', ...data });
    } catch (e) {
      this.log(`列表刷新异常：${e.message}`);
    } finally {
      this.inflight = false;
    }
  }

  html(webview) {
    const nonce = Math.random().toString(36).slice(2);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'panel.js'));
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${webview.cspSource};">
<style nonce="${nonce}">
  body { padding: 10px; font-family: var(--vscode-font-family); margin: 0; }
  .btn { display: block; width: 100%; box-sizing: border-box; padding: 6px 10px; margin-bottom: 8px;
         background: var(--vscode-button-background); color: var(--vscode-button-foreground);
         border: none; border-radius: 3px; font-size: 13px; cursor: pointer; text-align: center; }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .notice { font-size: 12px; line-height: 1.35; padding: 6px 8px; border-radius: 4px; margin-bottom: 8px;
            word-break: break-word; }
  .notice.error { color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
                  background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.12));
                  border: 1px solid var(--vscode-inputValidation-errorBorder, transparent); }
  .notice.info { color: var(--vscode-descriptionForeground); }
  .row { padding: 6px 6px; border-radius: 4px; cursor: pointer; display: flex; gap: 8px; align-items: flex-start; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row svg { flex: none; width: 15px; height: 15px; margin-top: 2px; opacity: 0.85; }
  .txt { min-width: 0; }
  .name { color: var(--vscode-foreground); font-size: 13px; line-height: 1.3;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dir { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.3; margin-top: 1px;
         white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 2px 4px; }
</style>
</head>
<body>
<button id="new" class="btn">New Window</button>
<div id="notice" class="notice error" hidden></div>
<div id="list"></div>
<div id="hint" class="hint">Loading open Ghostty windows…</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/** 状态栏按钮 / 命令面板命令：newWindow=false 激活已有窗口，true 始终新窗口 */
function summon(newWindow) {
  const dir = workspaceDir();
  log(newWindow ? '命令面板：New Terminal Window（始终新窗口）' : '状态栏按钮：唤起 Ghostty');
  ghostty
    .isGhosttyRunning()
    .then((running) => {
      const run = newWindow ? ghostty.runNewWindow : ghostty.runSummon;
      return run({
        running,
        dir,
        command: ghostty.loginShell(),
        jxa: runJxa,
        open: runOpen,
        log,
      });
    })
    .then((res) => {
      if (!res.ok) reportFailure(res.error);
    })
    .catch((e) => {
      log(`✗ 意外异常：${e.message}`);
      reportFailure(e.message);
    });
}

function activate(context) {
  output = vscode.window.createOutputChannel('Ghostty Launcher');
  context.subscriptions.push(output);
  log(
    `Ghostty Launcher v${context.extension?.packageJSON?.version || '?'} 已激活（VSCode ${vscode.version}，` +
      `面板轮询间隔 ${ghostty.LIST_INTERVAL}ms）`
  );

  const show = vscode.commands.registerCommand('ghosttyLauncher.show', () => summon(false));
  const newWin = vscode.commands.registerCommand('ghosttyLauncher.newWindow', () => summon(true));

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = '👻';
  item.tooltip = 'Ghostty 终端：点击唤起已有窗口（未运行时在当前项目目录启动）';
  item.command = 'ghosttyLauncher.show';
  item.show();

  // 主侧边栏（活动栏容器）与副侧边栏容器各注册一个面板实例：同一套 UI，两处同时可用，
  // 各自独立轮询（只在面板可见时拉列表，见 WindowsPanel.start/stop）
  const panels = [
    ['ghosttyLauncher.windows', 'primary'],
    ['ghosttyLauncher.windowsSecondary', 'secondary'],
  ].map(([id, tag]) => vscode.window.registerWebviewViewProvider(id, new WindowsPanel(context.extensionUri, tag)));

  context.subscriptions.push(show, newWin, item, ...panels);
}

function deactivate() {}

module.exports = { activate, deactivate };
