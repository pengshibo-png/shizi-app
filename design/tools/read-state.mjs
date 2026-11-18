/**
 * read-state.mjs — 读出 App 在 localStorage 里的真实状态（诊断用）
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9820 + Math.floor(Math.random() * 100);
const profile = join(process.env.TEMP ?? '.', `shi-state-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=800,1280', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
function rpc(ws, method, params = {}) {
  const mid = ++id;
  return new Promise((res, rej) => {
    const on = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.id !== mid) return;
      ws.removeEventListener('message', on);
      d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

const EXPR = `(() => {
  const raw = localStorage.getItem('shi.state.v1');
  const s = JSON.parse(raw || '{}');
  const tasks = s.tasks || {};
  const keys = Object.keys(tasks);
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayKey = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
  return JSON.stringify({
    todayKey,
    learnedCount: s.learnedCount ?? 0,
    newPerDay: s.newPerDay ?? null,
    taskKeys: keys,
    todayTask: tasks[todayKey] ?? null,
    allTasks: tasks,
    reviewCount: Object.keys(s.reviews || {}).length,
    lastTask: keys.length ? tasks[keys[keys.length - 1]] : null,
  }, null, 1);
})()`;

(async () => {
  try {
    let wsUrl;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const p = list.find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
      } catch { /* wait */ }
      await sleep(250);
    }
    if (!wsUrl) throw new Error('DevTools 未就绪');
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', j, { once: true });
    });
    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Page.navigate', { url });
    await sleep(3500);
    const r = await rpc(ws, 'Runtime.evaluate', { expression: EXPR, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
    console.log(r.result.value);
    ws.close();
  } catch (e) {
    console.error('✗', e.message);
    process.exitCode = 1;
  } finally {
    proc.kill();
    await sleep(150);
    try { (await import('node:fs')).rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
})();