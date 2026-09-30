'use strict';

/**
 * 面板 webview 端脚本（Issue #1：New Window 偶发无反应）。
 *
 * 从 extension.js 的内联 HTML 字符串里抽出，分两段：
 * - 纯函数区（signatureOf / hintFor）：带 module.exports 守卫，node 可直接
 *   require 做单测（test/panel.test.js）；不在文件顶层碰 document。
 * - DOM 绑定区：只在 webview 环境执行（document 与 acquireVsCodeApi 都在时）。
 *
 * 关键约束（Issue #1 期望行为 4）：列表数据未变化时**不重建 DOM**——面板每 3 秒
 * 刷新一次，全量重建会让「按下鼠标到松开」之间赶上的那次重建把点击吞掉。
 */

/** 面板窗口行左侧的幽灵图标（与活动栏图标同一造型） */
const GHOST_PATH =
  'M5 11 A7 7 0 0 1 19 11 V19 a2.3334 2.3334 0 0 1 -4.6667 0 a2.3334 2.3334 0 0 1 -4.6667 0 a2.3334 2.3334 0 0 1 -4.6666 0 Z ' +
  'M7.7 10.2 a1.7 1.7 0 1 0 3.4 0 a1.7 1.7 0 1 0 -3.4 0 Z ' +
  'M12.9 10.2 a1.7 1.7 0 1 0 3.4 0 a1.7 1.7 0 1 0 -3.4 0 Z';

/**
 * 列表 payload 的稳定签名：覆盖全部会影响渲染的字段（运行状态 / 错误 / 每个窗口
 * 的 id、标题、目录）。签名相同即数据未变，调用方跳过 DOM 重建。
 */
function signatureOf(payload) {
  if (!payload) return '';
  const windows = Array.isArray(payload.windows) ? payload.windows : [];
  return JSON.stringify([
    payload.running ? 1 : 0,
    payload.error || '',
    windows.map((w) => [String(w.id), String(w.name || ''), String(w.dir || '')]),
  ]);
}

/** 列表状态提示文案；正常（运行中且有窗口）返回空串表示不显示提示 */
function hintFor(payload) {
  if (!payload) return 'Loading open Ghostty windows…';
  if (!payload.running) return 'Ghostty is not running — click New Window to launch it.';
  if (payload.error) return 'Window list unavailable: ' + payload.error;
  if (!Array.isArray(payload.windows) || !payload.windows.length) return 'No open windows.';
  return '';
}

/* —— 以下为 webview DOM 绑定区 —— */

/** 面板加载后立即渲染缓存列表，这样重新打开面板时不会先空一下（Issue #1 期望行为 4） */
function initPanel() {
  const vscode = acquireVsCodeApi();
  const listEl = document.getElementById('list');
  const hintEl = document.getElementById('hint');
  const noticeEl = document.getElementById('notice');

  let lastSignature = null;
  let noticeTimer;

  /** 操作结果提示：info 自动消失，error 常驻到下一条提示（失败要让用户看得见） */
  function setNotice(kind, text) {
    if (noticeTimer) clearTimeout(noticeTimer);
    if (!text) {
      noticeEl.hidden = true;
      noticeEl.textContent = '';
      return;
    }
    noticeEl.hidden = false;
    noticeEl.className = 'notice ' + kind;
    noticeEl.textContent = text;
    if (kind === 'info') noticeTimer = setTimeout(() => setNotice('', ''), 4000);
  }

  function buildRow(w) {
    const div = document.createElement('div');
    div.className = 'row';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', GHOST_PATH);
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

  function renderList(payload) {
    const signature = signatureOf(payload);
    if (signature === lastSignature) return; // 数据未变 → 不重建 DOM（点击不被吞）
    lastSignature = signature;

    listEl.textContent = '';
    (payload.windows || []).forEach((w) => listEl.appendChild(buildRow(w)));

    const hint = hintFor(payload);
    hintEl.hidden = !hint;
    hintEl.textContent = hint;
  }

  document.getElementById('new').onclick = () => {
    setNotice('info', 'Opening a new window…');
    vscode.postMessage({ type: 'newWindow' });
  };

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'list') renderList(m);
    else if (m.type === 'notice') setNotice(m.kind, m.text);
  });

  vscode.postMessage({ type: 'ready' });
}

if (typeof document !== 'undefined' && typeof acquireVsCodeApi === 'function') initPanel();

if (typeof module !== 'undefined' && module.exports) module.exports = { signatureOf, hintFor };
