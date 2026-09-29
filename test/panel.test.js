'use strict';

/**
 * media/panel.js 单元测试（ghostty-launcher Issue #1：New Window 偶发无反应）。
 *
 * 覆盖 webview 端可抽离的纯函数：列表 payload 稳定签名（签名不变则不重建
 * DOM——消除「点击被吞」的核心防护）与列表状态提示文案。DOM 绑定与交互
 * 不做单测，由预发布人工验收覆盖。本文件在 node 下 require media/panel.js，
 * 同时验证该文件的 module.exports 守卫（纯函数段可独立加载）。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const panel = require('../media/panel');

const ONE = { running: true, windows: [{ id: 1, name: 'one', dir: '/a' }] };

// —— 列表 payload 稳定签名（Issue #1 期望行为 4：数据未变化不重建 DOM）——

test('signatureOf：相同列表数据（不同对象）→ 签名相同', () => {
  assert.equal(
    panel.signatureOf({ running: true, windows: [{ id: 1, name: 'one', dir: '/a' }] }),
    panel.signatureOf({ running: true, windows: [{ id: 1, name: 'one', dir: '/a' }] })
  );
});

test('signatureOf：未运行与运行中无窗口 → 签名不同（提示文案需切换）', () => {
  assert.notEqual(
    panel.signatureOf({ running: false, windows: [] }),
    panel.signatureOf({ running: true, windows: [] })
  );
});

test('signatureOf：窗口数量 / id / 名称 / 目录任一变化 → 签名不同', () => {
  const base = panel.signatureOf(ONE);
  const variants = [
    { running: true, windows: [] },
    { running: true, windows: [{ id: 2, name: 'one', dir: '/a' }] },
    { running: true, windows: [{ id: 1, name: 'two', dir: '/a' }] },
    { running: true, windows: [{ id: 1, name: 'one', dir: '/b' }] },
    {
      running: true,
      windows: [
        { id: 1, name: 'one', dir: '/a' },
        { id: 2, name: 'two', dir: '/b' },
      ],
    },
  ];
  for (const v of variants) {
    assert.notEqual(panel.signatureOf(v), base, `payload 变化应引起签名变化：${JSON.stringify(v)}`);
  }
});

test('signatureOf：列表错误状态变化 → 签名不同', () => {
  assert.notEqual(
    panel.signatureOf({ running: true, windows: [], error: 'boom' }),
    panel.signatureOf({ running: true, windows: [] })
  );
});

// —— 列表状态提示文案 ——

test('hintFor：Ghostty 未运行与运行中无窗口给出不同的提示', () => {
  const notRunning = panel.hintFor({ running: false, windows: [] });
  const noneOpen = panel.hintFor({ running: true, windows: [] });
  assert.equal(typeof notRunning, 'string');
  assert.ok(notRunning.length > 0, '未运行应有提示');
  assert.equal(typeof noneOpen, 'string');
  assert.ok(noneOpen.length > 0, '无窗口应有提示');
  assert.notEqual(notRunning, noneOpen, '两种状态应给出不同的指引');
});

test('hintFor：列表不可用（error）→ 提示包含错误原因', () => {
  const hint = panel.hintFor({
    running: true,
    windows: [],
    error: 'script dictionary unavailable',
  });
  assert.equal(typeof hint, 'string');
  assert.ok(hint.includes('script dictionary unavailable'), '错误原因应透传到提示里');
});

test('hintFor：有窗口（正常）→ 不需要提示', () => {
  assert.ok(!panel.hintFor(ONE), '正常状态不应显示提示');
});
