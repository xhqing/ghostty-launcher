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
