const vscode = require('vscode');
const { exec } = require('child_process');

const APP = 'Ghostty.app';
const PGREP = '/usr/bin/pgrep';
const OPEN = '/usr/bin/open';

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

/** 拉起 Ghostty。
 *  - newWindow=true：始终新窗口，落在当前工作区目录
 *  - newWindow=false：在跑则激活已有窗口；没跑则带工作区目录启动
 */
function summon(newWindow) {
  const dir = workspaceDir();
  const args = [];

  if (newWindow) {
    args.push('-na', APP, '--args');
    if (dir) args.push(`--working-directory=${dir}`);
  } else {
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

  exec(`${OPEN} ${args.map(shellQuote).join(' ')}`);
}

/** 给含空格的参数加引号 */
function shellQuote(s) {
  return /[^\w\-.,:=/@]/.test(s) ? `"${s}"` : s;
}

function activate(context) {
  const show = vscode.commands.registerCommand('ghosttyLauncher.show', () => summon(false));
  const newWin = vscode.commands.registerCommand('ghosttyLauncher.newWindow', () => summon(true));

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = '👻';
  item.tooltip = 'Ghostty 终端：点击唤起已有窗口（未运行时在当前项目目录启动）';
  item.command = 'ghosttyLauncher.show';
  item.show();

  context.subscriptions.push(show, newWin, item);
}

function deactivate() {}

module.exports = { activate, deactivate };
