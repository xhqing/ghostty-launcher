'use strict';

/**
 * Ghostty 调用层（Issue #1：面板 New Window 偶发无反应）。
 *
 * 本文件分两层：
 * - 纯逻辑 / 决策层：JXA 脚本生成、New Window 与激活窗口的决策流程、shell 参数
 *   引号包装——外部副作用（osascript / open / 日志）全部由调用方注入，单测注入
 *   假实现即可断言行为，不需要真的拉起 Ghostty（见 test/ghostty.test.js）。
 * - 真实副作用实现（isGhosttyRunning / listWindows / jxa 等）：extension.js 接线用。
 *
 * 关键约束（Issue #1 期望行为 3）：Ghostty 已在运行时 New Window 失败只重试一次，
 * 仍失败就报错，绝不回退 `open -na`——运行中回退会拉起第二个 Ghostty 实例
 * （两个实例的窗口互不相通，0.2.0 已修掉的坑）。
 */

const { execFile } = require('node:child_process');
const os = require('node:os');

const APP = 'Ghostty.app';
const OPEN = '/usr/bin/open';
const PGREP = '/usr/bin/pgrep';
const OSA = '/usr/bin/osascript';

/** 面板可见时轮询窗口列表的间隔（毫秒）。2s → 3s：每次轮询要 spawn 一次 osascript，偏重 */
const LIST_INTERVAL = 3000;
const OSA_TIMEOUT = 5000;

/** 无 log 注入时的空实现 */
function noop() {}

/** 把任意抛出物整理成一行错误文案 */
function errorMessage(e) {
  if (e && e.message) return String(e.message);
  return String(e);
}

/** 取文本首行并截断，避免把整段 stderr / 脚本回显带进日志与面板 */
function firstLine(text) {
  return String(text || '').trim().split('\n')[0].slice(0, 200);
}

/** 给含特殊字符的参数加双引号（仅用于日志里展示命令，真实调用一律走 execFile 传 argv） */
function shellQuote(s) {
  const str = String(s);
  return /^[\w\-.,:=/@]+$/.test(str) ? str : `"${str.replace(/"/g, '\\"')}"`;
}

// —— JXA（AppleScript 的 JavaScript 方言）脚本生成，需要 Ghostty 1.2+ 的脚本字典 ——

/** 枚举所有打开的 Ghostty 窗口：id / 标题 / 当前选中终端的工作目录 */
function buildListScript() {
  return `
    (function () {
      const app = Application("Ghostty");
      return JSON.stringify(app.windows().map(w => {
        let dir = "";
        try { dir = w.selectedTab().focusedTerminal().workingDirectory() || ""; } catch (e) {}
        return { id: w.id(), name: w.name(), dir: dir };
      }));
    })()`;
}

/** 把指定 id 的窗口拉到前台（同时激活 Ghostty 应用）；找不到返回 "notfound" */
function buildActivateScript(id) {
  return `
    (function () {
      const app = Application("Ghostty");
      const w = app.windows().find(x => x.id() === ${JSON.stringify(id)});
      if (!w) return "notfound";
      app.activateWindow(w);
      return "ok";
    })()`;
}

/**
 * 新建窗口并落在指定目录，随后把新窗口置前激活（Issue #5）。
 * 注意 1：surface configuration 未显式设置的字段会覆盖为空值，command 必须给登录
 * shell，否则新窗口的 shell 立即退出、窗口秒关（实测）。
 * 注意 2：Ghostty 的 AppleScript `new window` 只创建窗口、**不做 `NSApp.activate`**，
 * 所以 Ghostty 在后台时新窗口会停在后面（需手动切）；`activate window` 才是
 * `makeKeyAndOrderFront` + `NSApp.activate(ignoringOtherApps: true)` 的置前路径。
 * 激活失败**不抛出**——窗口已经建出来了，抛出去会被上层当成创建失败去重试（多建
 * 一个窗口）；改为返回可区分状态 "activate-failed"，由上层按「已创建但未置前」处理。
 */
function buildNewWindowScript({ dir, command }) {
  const target = dir || os.homedir();
  return `
    (function () {
      const app = Application("Ghostty");
      const cfg = app.newSurfaceConfiguration();
      cfg.initialWorkingDirectory = ${JSON.stringify(target)};
      cfg.command = ${JSON.stringify(command)};
      const win = app.newWindow({ withConfiguration: cfg });
      try {
        app.activateWindow(win);
      } catch (e) {
        return "activate-failed";
      }
      return "ok";
    })()`;
}

// —— 冷启动（Ghostty 未运行）：`open -na` 带工作目录拉起新实例 ——

/** 组装冷启动 argv；-na 强制新实例，未运行时用户配置全生效 */
function coldStartArgv(dir) {
  const argv = ['-na', APP, '--args'];
  if (dir) argv.push(`--working-directory=${dir}`);
  return argv;
}

/** 冷启动并 log 结果；成功 / 失败都返回 { ok, error? }，不抛异常 */
async function coldStart({ dir, open, log }) {
  const argv = coldStartArgv(dir);
  const started = Date.now();
  log(`Ghostty 未运行 → 冷启动：open ${argv.map(shellQuote).join(' ')}`);
  try {
    await open(argv);
    log(`✓ 冷启动成功（${Date.now() - started}ms）`);
    return { ok: true };
  } catch (e) {
    const error = `启动 Ghostty 失败：${errorMessage(e)}`;
    log(`✗ ${error}`);
    return { ok: false, error };
  }
}

// —— 决策流程（外部依赖注入，单测主战场）——

/**
 * New Window 决策（Issue #1 期望行为 3）：
 * - Ghostty 未运行 → `open -na --args --working-directory=<dir>` 冷启动；
 * - Ghostty 运行中 → AppleScript 新建窗口；失败重试一次，仍失败返回
 *   { ok:false, error }，**绝不**回退 open -na（防第二实例）。
 *
 * @param {{ running:boolean, dir?:string, command?:string,
 *           jxa:(script:string)=>Promise<string>, open:(argv:string[])=>Promise<void>,
 *           log?:(line:string)=>void }} opts
 * @returns {Promise<{ ok:boolean, error?:string }>}
 */
async function runNewWindow({ running, dir, command, jxa, open, log = noop }) {
  if (!running) return coldStart({ dir, open, log });

  const script = buildNewWindowScript({ dir, command });
  const target = dir || os.homedir();
  let lastError = '';

  // 第一次 + 重试一次，总共最多两次 AppleScript 调用
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = Date.now();
    try {
      const out = String(await jxa(script)).trim();
      if (out === 'activate-failed') {
        // 窗口已建出、只是没置前：算成功（重试会建出第二个窗口），但必须留痕
        log(`⚠ 新窗口已创建，但置前激活失败（第 ${attempt} 次，${Date.now() - started}ms，dir=${target}）——窗口可能停在后台，可从面板列表点它切过去`);
        return { ok: true };
      }
      if (out !== 'ok') throw new Error(`AppleScript 返回异常：${firstLine(out)}`);
      log(`✓ 新窗口创建成功（第 ${attempt} 次，${Date.now() - started}ms，dir=${target}）`);
      return { ok: true };
    } catch (e) {
      lastError = errorMessage(e);
      log(`✗ 新窗口创建失败（第 ${attempt} 次，${Date.now() - started}ms）：${lastError}`);
      if (attempt === 1) log('↻ 重试一次…');
    }
  }

  const error = `新窗口创建失败：${lastError}`;
  log(`✗ ${error}（已重试一次；不回退 open -na，运行中回退会拉起第二实例）`);
  return { ok: false, error };
}

/**
 * 激活已有窗口的决策：把窗口 id 交给 AppleScript，找不到 / 调用失败都返回
 * { ok:false, error }（Issue #1 期望行为 2：失败可见）。
 *
 * @param {{ id:*, jxa:(script:string)=>Promise<string>, log?:(line:string)=>void }} opts
 * @returns {Promise<{ ok:boolean, error?:string }>}
 */
async function runActivate({ id, jxa, log = noop }) {
  const started = Date.now();
  try {
    const out = String(await jxa(buildActivateScript(id))).trim();
    if (out === 'notfound') {
      const error = `窗口已不存在（可能刚被关闭）：id=${id}`;
      log(`✗ 激活窗口失败：${error}`);
      return { ok: false, error };
    }
    if (out !== 'ok') throw new Error(`AppleScript 返回异常：${firstLine(out)}`);
    log(`✓ 已激活窗口 id=${id}（${Date.now() - started}ms）`);
    return { ok: true };
  } catch (e) {
    const error = `激活窗口失败：${errorMessage(e)}`;
    log(`✗ ${error}`);
    return { ok: false, error };
  }
}

/**
 * 状态栏按钮 / 命令「唤起 Ghostty」的决策：运行中激活已有窗口（`open -a`），
 * 未运行冷启动并带工作目录。
 */
async function runSummon({ running, dir, open, log = noop }) {
  if (!running) return coldStart({ dir, open, log });

  const started = Date.now();
  log(`Ghostty 运行中 → 激活已有窗口：open -a ${APP}`);
  try {
    await open(['-a', APP]);
    log(`✓ 已激活 Ghostty（${Date.now() - started}ms）`);
    return { ok: true };
  } catch (e) {
    const error = `激活 Ghostty 失败：${errorMessage(e)}`;
    log(`✗ ${error}`);
    return { ok: false, error };
  }
}

// —— 置前结果实测与 LaunchServices 兜底（Issue #8）——

/**
 * 确保 Ghostty 真的到了前台（Issue #8 期望行为 1、2、3）。
 *
 * 背景：`activate window`（AppleScript）底层是 `NSApp.activate(ignoringOtherApps: true)`
 * ——**异步、无返回值**：脚本只能返回「请求已发出」，拿不到系统收不收。macOS 的防抢焦点
 * 策略会在 AppKit 之下**静默否决**这次激活（系统日志记为 `CPS: Rejecting expired request`），
 * 于是出现「日志写着 ✓ 成功、屏幕上却没置前」的偶发症状。所以这里不再只信脚本返回值，而是
 * **实测**「Ghostty 是不是真的在前台」：不在就换 LaunchServices 路径（真机 `open -a Ghostty.app`）
 * 兜底一次、再实测确认；两次都没上去就如实报失败，把「没能自动切到前台」交给上层提示用户。
 *
 * 外部副作用（查询前台 / 兜底激活 / 等待 / 日志）全部由调用方注入，单测注入假实现即可，
 * 不需要真的碰系统；查询与兜底分别出错都不向上抛（不 reject），只如实反映到返回值与日志。
 *
 * @param {{ isFrontmost:()=>Promise<boolean>, activateApp:()=>Promise<void>,
 *           log?:(line:string)=>void, wait?:()=>Promise<void> }} opts
 * @returns {Promise<{ ok:boolean, method:'none'|'launchservices', error?:string }>}
 *   ok=true 表示已实测确认在前台；method 区分「本来就在前台」（none）与「兜底激活后成功」
 *   （launchservices）；ok=false 时 error 是一句可直接给用户看的中文原因。
 */
async function ensureForeground({ isFrontmost, activateApp, log = noop, wait = noop }) {
  /**
   * 查询一次「是否已在前台」。查询本身出错**不算已在前台**、也不向上抛：
   * 记日志后按「未能确认」处理，由后续复查结果定论（防把一次查询故障谎报成成功）。
   */
  async function probe(stage) {
    try {
      await wait(); // 让系统把上一次激活请求处理完，避免刚发出去就查（假阴性）
      return (await isFrontmost()) === true;
    } catch (e) {
      log(`⚠ ${stage}查询置前结果失败：${errorMessage(e)}`);
      return false;
    }
  }

  if (await probe('')) {
    log('✓ 已在前台，无需兜底');
    return { ok: true, method: 'none' };
  }

  // 不在前台（或没查清）→ 换 LaunchServices 路径兜底一次：它走 lsd 的 open 请求，
  // 与 AppleScript 自激活是两条不同的系统路径，实测中常有其中一条被放行
  log(`↻ 未确认已在最前 → LaunchServices 兜底一次：open -a ${APP}`);
  try {
    await activateApp();
  } catch (e) {
    const error = `兜底激活失败：${errorMessage(e)}`;
    log(`⚠ 未能切到前台：${error}`);
    return { ok: false, method: 'launchservices', error };
  }

  if (await probe('兜底后复查')) {
    log('✓ 经 LaunchServices 兜底置前成功');
    return { ok: true, method: 'launchservices' };
  }

  const error = '系统未允许自动切到前台（macOS 防抢焦点）';
  log(`⚠ 未能切到前台：${error}（AppleScript 与 LaunchServices 两条路径都试过）`);
  return { ok: false, method: 'launchservices', error };
}

/** 置前失败时默认给用户看的原因（真机上最可能的一种） */
const FOREGROUND_BLOCKED = '系统未允许自动切到前台（macOS 防抢焦点）';

/**
 * 置前失败的提示文案（Issue #8 期望行为 3：失败可见，并给出手动切换指引）。
 *
 * created 必须如实反映事实：New Window 是「窗口已建出、只是没上来」，
 * 状态栏唤起 / 列表行激活则没有新建窗口——文案不能把两件事混为一谈（不得谎称已创建）。
 *
 * @param {{ created?:boolean, error?:string }} [opts]
 * @returns {string}
 */
function foregroundNoticeText({ created = false, error = '' } = {}) {
  const reason = String(error || '').trim() || FOREGROUND_BLOCKED;
  const head = created ? '新窗口已创建，但未能切到前台' : '未能切到前台';
  return `${head}：${reason}。请从窗口列表点击目标窗口，或用 ⌘-Tab 手动切换。`;
}

// —— 真实副作用实现（extension.js 用；单测不触碰这一段）——

/** 执行外部命令，resolve stdout；非零退出时 reject 并带 stderr 首行 */
function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) reject(new Error(firstLine(stderr) || err.message));
      else resolve(String(stdout));
    });
  });
}

/** 执行一段 JXA 脚本，resolve stdout 字符串 */
function jxa(script) {
  return execFileAsync(OSA, ['-l', 'JavaScript', '-e', script], { timeout: OSA_TIMEOUT });
}

/** Ghostty 是否正在运行（进程名为小写 ghostty；未运行时 pgrep 以退出码 1 结束） */
function isGhosttyRunning() {
  return new Promise((resolve) => {
    execFile(PGREP, ['-x', 'ghostty'], (err, stdout) => resolve(Boolean(String(stdout || '').trim())));
  });
}

/** 用户登录 shell（新建窗口时需显式指定） */
function loginShell() {
  return process.env.SHELL || '/bin/zsh';
}

/** 把 AppleScript 返回的窗口数组规整为 { id, name, dir } */
function normalizeWindows(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed.map((w) => ({
    id: w.id,
    name: String(w.name || ''),
    dir: String(w.dir || ''),
  }));
}

/**
 * 枚举所有打开的 Ghostty 窗口。
 * 返回 { running, windows, error? }——列表不可用时带 error 而不抛异常，
 * 由调用方（面板）决定怎么提示，轮询不会因单次失败而中断。
 */
async function listWindows() {
  if (!(await isGhosttyRunning())) return { running: false, windows: [] };
  try {
    const raw = await jxa(buildListScript());
    return { running: true, windows: normalizeWindows(JSON.parse(raw)) };
  } catch (e) {
    return { running: true, windows: [], error: errorMessage(e) };
  }
}

module.exports = {
  APP,
  OPEN,
  PGREP,
  OSA,
  LIST_INTERVAL,
  OSA_TIMEOUT,
  shellQuote,
  buildListScript,
  buildActivateScript,
  buildNewWindowScript,
  runNewWindow,
  runActivate,
  runSummon,
  ensureForeground,
  foregroundNoticeText,
  execFileAsync,
  jxa,
  isGhosttyRunning,
  loginShell,
  listWindows,
};
