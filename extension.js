const vscode = require('vscode');
const { exec, execFile } = require('child_process');

const APP = 'Ghostty.app';
const PGREP = '/usr/bin/pgrep';
const OPEN = '/usr/bin/open';
const OSA = '/usr/bin/osascript';
const LIST_INTERVAL = 2000; // 面板可见时轮询窗口列表的间隔（毫秒）
const OSA_TIMEOUT = 5000;

/** Ghostty 是否正在运行（进程名为小写 ghostty） */
function isRunning() {
  return new Promise((resolve) => {
    exec(`${PGREP} -x ghostty`, (err, stdout) => resolve(!!stdout.trim()));
  });
}

/** 当前工作区根目录（无工作区时返回 undefined） */
function workspaceDir() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** 用户登录 shell（新建窗口时需显式指定，否则 Ghostty 的 surface configuration 会把空 command 当立即退出） */
function loginShell() {
  return process.env.SHELL || '/bin/zsh';
}

/** 执行一段 JXA（AppleScript 的 JavaScript 方言）脚本，resolve stdout 字符串 */
function jxa(script) {
  return new Promise((resolve, reject) => {
    execFile(OSA, ['-l', 'JavaScript', '-e', script], { timeout: OSA_TIMEOUT }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').split('\n')[0].slice(0, 200)));
      else resolve(stdout.toString());
    });
  });
}

/** 枚举所有打开的 Ghostty 窗口（走 Ghostty 自带 AppleScript 脚本字典，需要 Ghostty 1.2+）。
 *  返回 { running, windows: [{ id, name, dir }], error }，dir 为窗口当前选中终端的工作目录。
 */
async function listWindows() {
  if (!(await isRunning())) return { running: false, windows: [] };
  try {
    const out = await jxa(`
      (function () {
        const app = Application("Ghostty");
        return JSON.stringify(app.windows().map(w => {
          let dir = "";
          try { dir = w.selectedTab().focusedTerminal().workingDirectory() || ""; } catch (e) {}
          return { id: w.id(), name: w.name(), dir: dir };
        }));
      })()`);
    return { running: true, windows: JSON.parse(out) };
  } catch (e) {
    return { running: true, windows: [], error: e.message };
  }
}

/** 把指定 id 的 Ghostty 窗口拉到前台（同时激活 Ghostty 应用） */
async function activateWindow(id) {
  const out = await jxa(`
    (function () {
      const app = Application("Ghostty");
      const w = app.windows().find(x => x.id() === ${JSON.stringify(id)});
      if (!w) return "notfound";
      app.activateWindow(w);
      return "ok";
    })()`);
  return out.trim() === 'ok';
}

/** Ghostty 已在运行时用 AppleScript 新建窗口并落在指定目录。
 *  注意：surface configuration 未显式设置的字段会覆盖为空值，command 必须给登录 shell，
 *  否则新窗口的 shell 立即退出、窗口秒关（实测）。需要 Ghostty 1.2+。
 */
function newWindowViaAppleScript(dir) {
  return jxa(`
    (function () {
      const app = Application("Ghostty");
      const cfg = app.newSurfaceConfiguration();
      cfg.initialWorkingDirectory = ${JSON.stringify(dir || require('os').homedir())};
      cfg.command = ${JSON.stringify(loginShell())};
      app.newWindow({ withConfiguration: cfg });
      return "ok";
    })()`);
}

/** 给含空格的参数加引号 */
function shellQuote(s) {
  return /[^\w\-.,:=/@]/.test(s) ? `"${s}"` : s;
}

/** 拉起 Ghostty。
 *  - newWindow=true：始终新窗口，落在当前工作区目录。
 *    运行中走 AppleScript `new window`（`open -na --args` 对运行中实例会拉起第二个进程，
 *    两个实例的窗口互不相通，实测已踩坑）；未运行走 `open -na --args --working-directory`。
 *  - newWindow=false：在跑则激活已有窗口；没跑则带工作区目录启动。
 */
function summon(newWindow) {
  const dir = workspaceDir();

  if (!newWindow) {
    isRunning().then((running) => {
      if (running) {
        // 激活已有窗口（-a 对运行中实例会忽略 --args，所以纯激活）
        exec(`${OPEN} -a ${APP}`);
        return;
      }
      const start = ['-na', APP, '--args'];
      if (dir) start.push(`--working-directory=${dir}`);
      exec(`${OPEN} ${start.map(shellQuote).join(' ')}`);
    });
    return;
  }

  isRunning().then((running) => {
    if (running) {
      newWindowViaAppleScript(dir).catch(() => {
        // 旧版 Ghostty（<1.2）没有脚本字典时回退到 open 路径
        const args = ['-na', APP, '--args'];
        if (dir) args.push(`--working-directory=${dir}`);
        exec(`${OPEN} ${args.map(shellQuote).join(' ')}`);
      });
      return;
    }
    const start = ['-na', APP, '--args'];
    if (dir) start.push(`--working-directory=${dir}`);
    exec(`${OPEN} ${start.map(shellQuote).join(' ')}`);
  });
}

/** 活动栏 Ghostty 面板：顶部 New Window 按钮 + 打开窗口实时列表，点击列表项激活对应窗口 */
class WindowsPanel {
  constructor() {
    this.view = undefined;
    this.timer = undefined;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();

    view.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'newWindow') {
        summon(true);
        setTimeout(() => this.refresh(), 600);
      } else if (msg.type === 'activate') {
        try { await activateWindow(msg.id); } catch (e) { /* 窗口可能已关 */ }
        setTimeout(() => this.refresh(), 400);
      }
    });

    view.onDidChangeVisibility(() => (this.view.visible ? this.start() : this.stop()));
    view.onDidDispose(() => {
      this.stop();
      this.view = undefined;
    });
    this.start();
  }

  /** 面板可见时每 2 秒刷新一次窗口列表 */
  start() {
    this.stop();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), LIST_INTERVAL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh() {
    if (!this.view?.visible) return;
    try {
      const data = await listWindows();
      this.view.webview.postMessage({ type: 'list', ...data });
    } catch (e) { /* 忽略单次失败，下轮重试 */ }
  }

  html() {
    const nonce = Math.random().toString(36).slice(2);
    const ghost = `M5 11 A7 7 0 0 1 19 11 V19 a2.3334 2.3334 0 0 1 -4.6667 0 a2.3334 2.3334 0 0 1 -4.6667 0 a2.3334 2.3334 0 0 1 -4.6666 0 Z M7.7 10.2 a1.7 1.7 0 1 0 3.4 0 a1.7 1.7 0 1 0 -3.4 0 Z M12.9 10.2 a1.7 1.7 0 1 0 3.4 0 a1.7 1.7 0 1 0 -3.4 0 Z`;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { padding: 10px; font-family: var(--vscode-font-family); margin: 0; }
  .btn { display: block; width: 100%; box-sizing: border-box; padding: 6px 10px; margin-bottom: 10px;
         background: var(--vscode-button-background); color: var(--vscode-button-foreground);
         border: none; border-radius: 3px; font-size: 13px; cursor: pointer; text-align: center; }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
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
<div id="list"></div>
<div id="hint" class="hint" hidden></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const ghostPath = "${ghost}";
  const listEl = document.getElementById('list');
  const hintEl = document.getElementById('hint');

  document.getElementById('new').onclick = () => vscode.postMessage({ type: 'newWindow' });

  function row(w) {
    const div = document.createElement('div');
    div.className = 'row';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ghostPath);
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(p);
    const txt = document.createElement('div');
    txt.className = 'txt';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = w.name || w.dir || 'Window';
    txt.appendChild(name);
    if (w.dir && w.name) {
      const dir = document.createElement('div');
      dir.className = 'dir';
      dir.textContent = w.dir;
      txt.appendChild(dir);
    }
    div.appendChild(svg);
    div.appendChild(txt);
    div.title = w.dir || w.name || '';
    div.onclick = () => vscode.postMessage({ type: 'activate', id: w.id });
    return div;
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type !== 'list') return;
    listEl.textContent = '';
    if (!m.running) {
      hintEl.hidden = false;
      hintEl.textContent = 'Ghostty is not running — click New Window to launch it.';
    } else if (m.error) {
      hintEl.hidden = false;
      hintEl.textContent = 'Window list unavailable: ' + m.error;
    } else if (!m.windows.length) {
      hintEl.hidden = false;
      hintEl.textContent = 'No open windows.';
    } else {
      hintEl.hidden = true;
      m.windows.forEach((w) => listEl.appendChild(row(w)));
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function activate(context) {
  const show = vscode.commands.registerCommand('ghosttyLauncher.show', () => summon(false));
  const newWin = vscode.commands.registerCommand('ghosttyLauncher.newWindow', () => summon(true));

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = '👻';
  item.tooltip = 'Ghostty 终端：点击唤起已有窗口（未运行时在当前项目目录启动）';
  item.command = 'ghosttyLauncher.show';
  item.show();

  const panel = new WindowsPanel();
  const provider = vscode.window.registerWebviewViewProvider('ghosttyLauncher.windows', panel);

  context.subscriptions.push(show, newWin, item, provider);
}

function deactivate() {}

module.exports = { activate, deactivate };
