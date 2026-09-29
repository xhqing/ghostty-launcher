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

const ghostty = require('../lib/ghostty');

const DIR = '/Users/x/My Projects/app';
const SHELL = '/bin/zsh';

/** 把 shellQuote 的结果交给 /bin/sh 实际解析一次，返回它看到的参数值 */
function viaShell(value) {
  return execFileSync('/bin/sh', ['-c', `printf '%s' ${ghostty.shellQuote(value)}`], {
    encoding: 'utf8',
  });
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
