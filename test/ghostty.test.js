'use strict';

/**
 * lib/ghostty.js 单元测试（ghostty-launcher Issue #1：New Window 偶发无反应）。
 *
 * 覆盖可抽离的纯逻辑：New Window 决策（失败重试一次、绝不回退 open -na 拉起
 * 第二实例）、激活窗口决策、JXA 脚本生成、shellQuote、轮询间隔，以及失败
 * 可观测（log 上报）。用例按 Issue #1「期望行为」出题，实现尚不存在时先行
 * 编写、自跑确认红后才交付开发（dev-workflow 测试先行）；DOM 绑定与面板
 * 交互不做单测，由预发布人工验收覆盖。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');

const ghostty = require('../lib/ghostty');

const DIR = '/Users/x/My Projects/app';
const SHELL = '/bin/zsh';

/** 把 shellQuote 的结果交给 /bin/sh 实际解析一次，返回它看到的参数值 */
function viaShell(value) {
  return execFileSync('/bin/sh', ['-c', `printf '%s' ${ghostty.shellQuote(value)}`], {
    encoding: 'utf8',
  });
}

/**
 * 在 Node 沙箱里真实执行 buildNewWindowScript 生成的 JXA 脚本，用桩对象承接
 * Application("Ghostty")——脚本是纯 JS 表达式，可真实跑控制流；纯字符串断言
 * 覆盖不到「激活失败是否被吞成创建失败」这类分支（Issue #5 的关键防护）。
 */
function runAppleScript(script, app) {
  return vm.runInNewContext(script, { Application: () => app });
}

/**
 * Application("Ghostty") 桩：记录 newWindow / activateWindow 调用，并按需注入
 * 失败——newWindow 抛错代表创建失败，activateWindow 抛错代表「已创建但激活失败」。
 */
function createAppStub({ newWindowThrows = false, activateThrows = false } = {}) {
  const calls = { newWindow: 0, activateWindow: [] };
  const win = { id: 7 };
  const cfg = { initialWorkingDirectory: null, command: null };
  const app = {
    newSurfaceConfiguration: () => cfg,
    newWindow: () => {
      calls.newWindow += 1;
      if (newWindowThrows) throw new Error('newWindow boom');
      return win;
    },
    activateWindow: (w) => {
      calls.activateWindow.push(w);
      if (activateThrows) throw new Error('activateWindow boom');
      return 'ok';
    },
  };
  return { app, calls, cfg, win };
}

// —— 轮询间隔（Issue #1 期望行为 5：间隔 2s → 3s）——

test('LIST_INTERVAL：轮询间隔为 3000ms', () => {
  assert.equal(ghostty.LIST_INTERVAL, 3000);
});

// —— shellQuote（含空格参数的引号包装）——

test('shellQuote：含空格的路径被包装为单个 shell 参数', () => {
  assert.equal(viaShell(DIR), DIR);
});

test('shellQuote：无需包装的普通参数原样返回', () => {
  assert.equal(ghostty.shellQuote('ghostty'), 'ghostty');
});

// —— JXA 脚本生成 ——

test('buildListScript：生成枚举 Ghostty 窗口的 JXA 脚本', () => {
  const script = ghostty.buildListScript();
  assert.equal(typeof script, 'string');
  assert.ok(script.includes('Ghostty'), '脚本应引用 Ghostty 应用');
  assert.ok(script.includes('windows'), '脚本应枚举 windows');
});

test('buildActivateScript：脚本携带窗口 id 且调用 activateWindow', () => {
  const script = ghostty.buildActivateScript(42);
  assert.equal(typeof script, 'string');
  assert.ok(script.includes('42'), '脚本应包含目标窗口 id');
  assert.ok(script.includes('activateWindow'), '脚本应调用 activateWindow');
});

test('buildNewWindowScript：脚本携带初始目录与登录 shell（JSON 转义嵌入）', () => {
  const script = ghostty.buildNewWindowScript({ dir: DIR, command: SHELL });
  assert.equal(typeof script, 'string');
  assert.ok(script.includes(JSON.stringify(DIR)), '目录应作为 JSON 字符串嵌入');
  assert.ok(script.includes(JSON.stringify(SHELL)), '登录 shell 应作为 JSON 字符串嵌入');
  assert.ok(script.includes('newWindow'), '脚本应调用 newWindow');
});

// —— New Window 决策流程（Issue #1 期望行为 3：重试一次，绝不带回退 open -na）——

test('runNewWindow：运行中首次成功 → ok，且不调用 open', async () => {
  const calls = { jxa: 0, open: 0 };
  const res = await ghostty.runNewWindow({
    running: true,
    dir: DIR,
    command: SHELL,
    jxa: async () => {
      calls.jxa += 1;
      return 'ok';
    },
    open: async () => {
      calls.open += 1;
    },
  });
  assert.equal(res.ok, true);
  assert.equal(calls.jxa, 1);
  assert.equal(calls.open, 0);
});

test('runNewWindow：运行中调用失败 → 重试一次，重试成功即成功', async () => {
  let tries = 0;
  const res = await ghostty.runNewWindow({
    running: true,
    dir: DIR,
    command: SHELL,
    jxa: async () => {
      tries += 1;
      if (tries === 1) throw new Error('first attempt failed');
      return 'ok';
    },
    open: async () => {
      throw new Error('运行中不应回退 open');
    },
  });
  assert.equal(res.ok, true);
  assert.equal(tries, 2, '失败后应恰好重试一次');
});

test('runNewWindow：运行中两次都失败 → 返回错误，绝不回退 open（防第二实例）', async () => {
  let jxaCalls = 0;
  let openCalls = 0;
  const res = await ghostty.runNewWindow({
    running: true,
    dir: DIR,
    command: SHELL,
    jxa: async () => {
      jxaCalls += 1;
      throw new Error('script dictionary unavailable');
    },
    open: async () => {
      openCalls += 1;
    },
  });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /script dictionary unavailable/, '错误原因应透传给调用方');
  assert.equal(jxaCalls, 2, '失败后应恰好重试一次，共两次调用');
  assert.equal(openCalls, 0, '运行中失败绝不回退 open -na（会拉起第二实例）');
});

test('runNewWindow：运行中成功路径的 JXA 脚本携带目录与登录 shell', async () => {
  const scripts = [];
  await ghostty.runNewWindow({
    running: true,
    dir: DIR,
    command: SHELL,
    jxa: async (script) => {
      scripts.push(script);
      return 'ok';
    },
    open: async () => {},
  });
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0].includes(JSON.stringify(DIR)));
  assert.ok(scripts[0].includes(JSON.stringify(SHELL)));
});

test('runNewWindow：未运行 → open -na 冷启动并带工作目录，不调 JXA', async () => {
  let jxaCalls = 0;
  const openArgvs = [];
  const res = await ghostty.runNewWindow({
    running: false,
    dir: DIR,
    command: SHELL,
    jxa: async () => {
      jxaCalls += 1;
      return 'ok';
    },
    open: async (argv) => {
      openArgvs.push(argv);
    },
  });
  assert.equal(res.ok, true);
  assert.equal(jxaCalls, 0);
  assert.equal(openArgvs.length, 1);
  const argv = openArgvs[0];
  assert.ok(argv.includes('-na'), '冷启动应使用 open -na');
  assert.ok(argv.includes('Ghostty.app'), '应启动 Ghostty.app');
  assert.ok(argv.includes('--args'), '应透传 --args');
  assert.ok(argv.includes(`--working-directory=${DIR}`), '应带工作目录');
});

test('runNewWindow：未运行时 open 失败 → 返回错误', async () => {
  const res = await ghostty.runNewWindow({
    running: false,
    dir: DIR,
    command: SHELL,
    jxa: async () => 'ok',
    open: async () => {
      throw new Error('open failed');
    },
  });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /open failed/);
});

// —— 可观测性（Issue #1 期望行为 1：失败不再静默吞掉）——

test('runNewWindow：失败路径写入 log 且包含失败原因', async () => {
  const lines = [];
  const res = await ghostty.runNewWindow({
    running: true,
    dir: DIR,
    command: SHELL,
    jxa: async () => {
      throw new Error('boom');
    },
    open: async () => {},
    log: (line) => {
      lines.push(String(line));
    },
  });
  assert.equal(res.ok, false);
  assert.ok(lines.length >= 1, '失败必须至少写一条日志');
  assert.ok(lines.some((l) => l.includes('boom')), '日志应包含失败原因');
});

test('runNewWindow：成功路径写入 log', async () => {
  const lines = [];
  await ghostty.runNewWindow({
    running: true,
    dir: DIR,
    command: SHELL,
    jxa: async () => 'ok',
    open: async () => {},
    log: (line) => {
      lines.push(String(line));
    },
  });
  assert.ok(lines.length >= 1, '每次调用都应可观测');
});

// —— 激活窗口决策（Issue #1 期望行为 2：失败可见）——

test('runActivate：成功 → ok', async () => {
  const res = await ghostty.runActivate({ id: 42, jxa: async () => 'ok' });
  assert.equal(res.ok, true);
});

test('runActivate：JXA 脚本携带目标窗口 id', async () => {
  const scripts = [];
  await ghostty.runActivate({
    id: 42,
    jxa: async (script) => {
      scripts.push(script);
      return 'ok';
    },
  });
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0].includes('42'));
});

test('runActivate：窗口已不存在 → ok=false 且附带用户可见错误', async () => {
  const lines = [];
  const res = await ghostty.runActivate({
    id: 42,
    jxa: async () => 'notfound',
    log: (line) => {
      lines.push(String(line));
    },
  });
  assert.equal(res.ok, false);
  assert.ok(
    typeof res.error === 'string' && res.error.length > 0,
    '窗口不存在时应返回用户可见的失败原因'
  );
  assert.ok(lines.length >= 1, '失败必须写入日志');
});

test('runActivate：调用失败 → ok=false 且错误原因透传', async () => {
  const res = await ghostty.runActivate({
    id: 42,
    jxa: async () => {
      throw new Error('osascript died');
    },
  });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /osascript died/);
});

// —— New Window 焦点（Issue #5：新窗口建出后未置前）——
//
// 协议约定（由本测试定义，开发按此实现）：
//   - buildNewWindowScript 生成的脚本：new Window 建出后调用 app.activateWindow(win)
//     把窗口置前；激活失败**不抛出**、返回 "activate-failed"（与创建失败区分开）；
//     只有 newWindow 本身失败才抛出（上层据此重试并报错）。
//   - runNewWindow 收到 "activate-failed"：按成功处理（ok:true）、不重试（重试会
//     建出第二个窗口）、不回退 open -na，并写一条警告日志（可观测、不静默）。

test('buildNewWindowScript：脚本在 newWindow 之后调用 activateWindow 激活新窗口（Issue #5）', () => {
  const script = ghostty.buildNewWindowScript({ dir: DIR, command: SHELL });
  const newWindowAt = script.search(/\.newWindow\s*\(/);
  const activateAt = script.search(/\.activateWindow\s*\(/);
  assert.ok(newWindowAt >= 0, '脚本应调用 newWindow');
  assert.ok(activateAt >= 0, '脚本应调用 activateWindow（新窗口必须被置前激活）');
  assert.ok(newWindowAt < activateAt, 'activateWindow 必须在 newWindow 之后调用（拿到窗口对象再激活）');
  assert.ok(script.includes('activate-failed'), '脚本应能返回「已创建但激活失败」的可区分状态');
});

test('buildNewWindowScript：执行生成脚本 → 先建窗口、再用 newWindow 返回的窗口对象激活', () => {
  const { app, calls, cfg, win } = createAppStub();
  const out = runAppleScript(ghostty.buildNewWindowScript({ dir: DIR, command: SHELL }), app);
  assert.equal(out, 'ok');
  assert.equal(calls.newWindow, 1, '应恰好新建一个窗口');
  assert.equal(calls.activateWindow.length, 1, '应对新窗口调用一次 activateWindow');
  assert.equal(calls.activateWindow[0], win, 'activateWindow 的参数必须是 newWindow 返回的窗口对象');
  assert.equal(cfg.initialWorkingDirectory, DIR, '既有契约：初始目录应嵌入配置');
  assert.equal(cfg.command, SHELL, '既有契约：登录 shell 应嵌入配置');
});

test('buildNewWindowScript：激活抛错 → 返回 "activate-failed"、不抛出（不得被当成创建失败）', () => {
  const { app, calls } = createAppStub({ activateThrows: true });
  const out = runAppleScript(ghostty.buildNewWindowScript({ dir: DIR, command: SHELL }), app);
  assert.equal(out, 'activate-failed', '激活失败必须有可区分状态（否则上层会重试建出第二个窗口）');
  assert.equal(calls.newWindow, 1);
});

test('buildNewWindowScript：newWindow 抛错 → 创建失败保持可见（不得伪装成成功状态）', () => {
  const { app } = createAppStub({ newWindowThrows: true });
  let outcome;
  let threw = false;
  try {
    outcome = runAppleScript(ghostty.buildNewWindowScript({ dir: DIR, command: SHELL }), app);
  } catch {
    threw = true;
  }
  assert.ok(
    threw || !['ok', 'activate-failed'].includes(outcome),
    '创建失败必须让上层看到失败（抛出或返回非成功状态），不得吞成 ok / activate-failed'
  );
});

test('runNewWindow：窗口已创建但激活失败 → ok:true、不重试、不回退 open，且日志有警告（Issue #5）', async () => {
  let jxaCalls = 0;
  let openCalls = 0;
  const lines = [];
  const res = await ghostty.runNewWindow({
    running: true,
    dir: DIR,
    command: SHELL,
    jxa: async () => {
      jxaCalls += 1;
      return 'activate-failed';
    },
    open: async () => {
      openCalls += 1;
    },
    log: (line) => lines.push(String(line)),
  });
  assert.equal(res.ok, true, '窗口已建出：激活失败不算创建失败，必须报告成功');
  assert.equal(jxaCalls, 1, '不得重试——重试会建出第二个窗口');
  assert.equal(openCalls, 0, '不得回退 open -na');
  assert.ok(
    lines.some((l) => /(⚠|警告|warn)/i.test(l) && /(激活|置前)/.test(l)),
    '「已创建但激活失败」必须写进日志且标为警告（可观测、不静默）'
  );
});

test('runNewWindow：脚本返回非约定状态 → 仍按创建失败重试并报错（不放宽失败判定）', async () => {
  let jxaCalls = 0;
  let openCalls = 0;
  const res = await ghostty.runNewWindow({
    running: true,
    dir: DIR,
    command: SHELL,
    jxa: async () => {
      jxaCalls += 1;
      return 'AppleScript error: newWindow failed';
    },
    open: async () => {
      openCalls += 1;
    },
  });
  assert.equal(res.ok, false, '非约定状态不是成功');
  assert.equal(jxaCalls, 2, '除 "activate-failed" 外的非 ok 状态仍应重试一次');
  assert.equal(openCalls, 0, '绝不回退 open -na');
  assert.match(String(res.error), /newWindow failed/, '错误原因应透传');
});

// —— 置前结果实测与 LaunchServices 兜底（Issue #8：系统静默否决 → 日志说成功、屏幕没变化）——
//
// 协议约定（由本测试定义，开发按此实现）：
//   - ensureForeground：置前不再只信 AppleScript 的返回值（`activate window` 底层
//     NSApp.activate(ignoringOtherApps:) 异步无返回值，拿不到 macOS 的拒收结果），
//     而是实测「Ghostty 是否已在前台」；不在前台时走 activateApp（真机即
//     `open -a Ghostty.app`）兜底一次并复查，以复查结果为准。
//   - foregroundNoticeText：把置前失败渲染成可直接展示给用户的面板提示文案。

/**
 * ensureForeground 的桩：isFrontmost 按脚本序列依次返回 / 抛出（序列用尽即抛错，
 * 防实现的意外多查），activateApp 记录调用、按需抛错，wait 只记录调用（不真延时）。
 */
function createForegroundStubs({ isFrontmost = [], activateThrows = false } = {}) {
  const calls = { isFrontmost: 0, activateApp: 0, wait: 0 };
  const events = [];
  const queue = [...isFrontmost];
  return {
    calls,
    events,
    isFrontmost: async () => {
      calls.isFrontmost += 1;
      events.push('isFrontmost');
      if (queue.length === 0) throw new Error('isFrontmost 桩已用尽：查询次数超出用例预期');
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next === true;
    },
    activateApp: async () => {
      calls.activateApp += 1;
      events.push('activateApp');
      if (activateThrows) throw new Error('open -a Ghostty.app 失败：boom');
    },
    wait: async () => {
      calls.wait += 1;
      events.push('wait');
    },
  };
}

test('ensureForeground：已在前台 → ok:true、method:none，且绝不调用 activateApp（Issue #8）', async () => {
  const stubs = createForegroundStubs({ isFrontmost: [true] });
  const lines = [];
  const res = await ghostty.ensureForeground({
    isFrontmost: stubs.isFrontmost,
    activateApp: stubs.activateApp,
    wait: stubs.wait,
    log: (line) => lines.push(String(line)),
  });
  assert.equal(res.ok, true);
  assert.equal(res.method, 'none');
  assert.equal(stubs.calls.isFrontmost, 1, '已在前台只需查询一次');
  assert.equal(stubs.calls.activateApp, 0, '已在前台不得有多余的兜底动作');
  assert.ok(stubs.calls.wait >= 1, '每次查询前应先调用 wait 注入延时');
  assert.ok(lines.length >= 1, '成功路径也应有可辨识日志（不静默）');
  assert.ok(
    lines.some((l) => /(前台|最前)/.test(l)),
    '成功路径日志应说明已在前台（可辨识）'
  );
});

test('ensureForeground：不在前台 → activateApp 兜底恰一次，复查在前台 → ok:true、method:launchservices（Issue #8）', async () => {
  const stubs = createForegroundStubs({ isFrontmost: [false, true] });
  const lines = [];
  const res = await ghostty.ensureForeground({
    isFrontmost: stubs.isFrontmost,
    activateApp: stubs.activateApp,
    wait: stubs.wait,
    log: (line) => lines.push(String(line)),
  });
  assert.equal(res.ok, true, '兜底后复查已在前台 → 成功');
  assert.equal(res.method, 'launchservices');
  assert.equal(stubs.calls.activateApp, 1, '兜底动作应恰好调用一次');
  assert.equal(stubs.calls.isFrontmost, 2, '首次查询 + 兜底后复查');
  assert.ok(stubs.calls.wait >= 2, '后台路径的每次查询前都要 wait');
  assert.ok(
    lines.some((l) => /open -a|LaunchServices|兜底/i.test(l)),
    '日志应可辨识出走了 LaunchServices 兜底'
  );
});

test('ensureForeground：兜底后仍不在前台 → ok:false、method:launchservices，error 为可展示的中文原因（Issue #8）', async () => {
  const stubs = createForegroundStubs({ isFrontmost: [false, false] });
  const lines = [];
  const res = await ghostty.ensureForeground({
    isFrontmost: stubs.isFrontmost,
    activateApp: stubs.activateApp,
    wait: stubs.wait,
    log: (line) => lines.push(String(line)),
  });
  assert.equal(res.ok, false, '实测仍未置前必须报失败（不得静默成功）');
  assert.equal(res.method, 'launchservices');
  assert.ok(typeof res.error === 'string' && res.error.length > 0, '失败必须带用户可读的原因');
  assert.ok(/[\u4e00-\u9fa5]/.test(res.error), '原因应为中文文案（可直接展示）');
  assert.ok(
    lines.some((l) => /(⚠|✗|失败)/.test(l)),
    '失败必须写警告日志（不静默）'
  );
});

test('ensureForeground：isFrontmost 抛错 → 不 reject、记日志后按「未能确认」走兜底、以复查为准（Issue #8）', async () => {
  const stubs = createForegroundStubs({ isFrontmost: [new Error('osascript timed out'), true] });
  const lines = [];
  let res;
  try {
    res = await ghostty.ensureForeground({
      isFrontmost: stubs.isFrontmost,
      activateApp: stubs.activateApp,
      wait: stubs.wait,
      log: (line) => lines.push(String(line)),
    });
  } catch (e) {
    assert.fail(`不得向上抛（不 reject），实际抛出：${e && e.message ? e.message : e}`);
  }
  assert.equal(res.ok, true);
  assert.equal(res.method, 'launchservices');
  assert.equal(stubs.calls.activateApp, 1, '查询失败不算「已在前台」，仍要兜底');
  assert.equal(stubs.calls.isFrontmost, 2, '抛错的首次查询 + 兜底后复查');
  assert.ok(
    lines.some((l) => l.includes('osascript timed out')),
    '查询失败本身要留日志（不静默吞掉）'
  );
});

test('ensureForeground：复查抛错 → 不 reject，返回失败而非谎报成功（Issue #8 边界）', async () => {
  const stubs = createForegroundStubs({ isFrontmost: [false, new Error('recheck boom')] });
  let res;
  try {
    res = await ghostty.ensureForeground({
      isFrontmost: stubs.isFrontmost,
      activateApp: stubs.activateApp,
      wait: stubs.wait,
    });
  } catch (e) {
    assert.fail(`复查出错同样不得向上抛（不 reject），实际抛出：${e && e.message ? e.message : e}`);
  }
  assert.equal(res.ok, false, '无法确认已置前时只能报失败，不得谎报成功');
  assert.ok(typeof res.error === 'string' && res.error.length > 0, '失败必须带原因');
});

test('ensureForeground：activateApp 抛错 → 不 reject，返回 ok:false + 原因，并留失败日志（Issue #8）', async () => {
  const stubs = createForegroundStubs({ isFrontmost: [false], activateThrows: true });
  const lines = [];
  let res;
  try {
    res = await ghostty.ensureForeground({
      isFrontmost: stubs.isFrontmost,
      activateApp: stubs.activateApp,
      wait: stubs.wait,
      log: (line) => lines.push(String(line)),
    });
  } catch (e) {
    assert.fail(`兜底动作抛错不得向上抛（不 reject），实际抛出：${e && e.message ? e.message : e}`);
  }
  assert.equal(res.ok, false);
  assert.equal(stubs.calls.activateApp, 1, '兜底动作应被调用（哪怕它失败了）');
  assert.ok(typeof res.error === 'string' && res.error.length > 0, '兜底失败也要给出可展示原因');
  assert.ok(
    lines.some((l) => /(⚠|✗|失败)/.test(l)),
    '兜底失败必须写日志（不静默）'
  );
});

test('ensureForeground：wait 在每次查询前调用（注入延时，不真等待）', async () => {
  const stubs = createForegroundStubs({ isFrontmost: [false, true] });
  await ghostty.ensureForeground({
    isFrontmost: stubs.isFrontmost,
    activateApp: stubs.activateApp,
    wait: stubs.wait,
  });
  let pendingWaits = 0;
  for (const ev of stubs.events) {
    if (ev === 'wait') pendingWaits += 1;
    else if (ev === 'isFrontmost') {
      assert.ok(pendingWaits >= 1, '每一次 isFrontmost 查询之前都必须先调用 wait');
      pendingWaits -= 1;
    }
  }
  assert.ok(stubs.calls.wait >= 2, '后台路径（首次 + 复查）至少调用 wait 两次');
});

// —— 置前失败的用户提示文案（Issue #8 期望行为 3：失败可见、给手动切换指引）——

test('foregroundNoticeText：窗口已建出 → 含「新窗口已创建」「未能切到前台」「⌘-Tab」与失败原因（Issue #8）', () => {
  const text = ghostty.foregroundNoticeText({ created: true, error: 'macOS 拒绝了本次置前请求' });
  assert.equal(typeof text, 'string');
  assert.ok(text.includes('新窗口已创建'), '必须说清窗口确实建出来了（不是什么都没发生）');
  assert.ok(text.includes('未能切到前台'), '必须明确告知置前失败');
  assert.ok(text.includes('⌘-Tab'), '应给出手动切换操作指引');
  assert.ok(text.includes('macOS 拒绝了本次置前请求'), '应包含传入的失败原因');
});

test('foregroundNoticeText：窗口未建出 → 不得声称「新窗口已创建」，仍给指引与原因（Issue #8）', () => {
  const text = ghostty.foregroundNoticeText({ created: false, error: 'open -a Ghostty.app 失败' });
  assert.equal(typeof text, 'string');
  assert.ok(text.includes('未能切到前台'));
  assert.ok(text.includes('⌘-Tab'));
  assert.ok(text.includes('open -a Ghostty.app 失败'));
  assert.ok(!text.includes('新窗口已创建'), '窗口未建出时文案必须与事实一致（不得谎称已创建）');
});

test('foregroundNoticeText：error 缺省 → 不抛错，仍返回含手动切换指引的文案（Issue #8 边界）', () => {
  const text = ghostty.foregroundNoticeText({ created: false });
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0);
  assert.ok(text.includes('⌘-Tab'));
});
