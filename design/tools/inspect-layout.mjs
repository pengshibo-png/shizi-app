/**
 * inspect-layout.mjs — 打印首页各主要元素的实际位置与高度
 *
 * 用来定位"中间一片空白"这类问题：逐个元素看 rect，
 * 就知道是谁被压成 0、谁占了多余空间。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const [, , url, vw = '393', vh = '851'] = process.argv;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9700 + Math.floor(Math.random() * 200);
const profile = join(process.env.TEMP ?? '.', `shi-ins-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  `--window-size=${vw},${vh}`, 'about:blank',
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
async function evalJs(ws, expression) {
  const r = await rpc(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
  return r.result.value;
}

const SELECTORS = [
  'html', 'body', '#root', '.shi-app',
  '.shi-topbar', '.shi-head', '.shi-today', '.shi-rows', '.shi-bottom',
  '.shi-row', '.shi-head h1', '.shi-today .shi-today-num',
];

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
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', j, { once: true });
    });
    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', {
      width: Number(vw), height: Number(vh), deviceScaleFactor: 1, mobile: true,
    });
    await rpc(ws, 'Page.navigate', { url });
    await sleep(3500);

    const out = await evalJs(
      ws,
      `JSON.stringify(${JSON.stringify(SELECTORS)}.map(s => {
        const e = document.querySelector(s);
        if (!e) return { sel: s, missing: true };
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return { sel: s, top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
                 flex: cs.flex, minH: cs.minHeight, display: cs.display, overflow: cs.overflow };
      }), null, 1)`,
    );

    console.log(`viewport ${vw}x${vh}`);
    const rows = JSON.parse(out);
    console.log('sel'.padEnd(30), 'top'.padStart(6), 'h'.padStart(6), 'w'.padStart(6), 'flex');
    for (const r of rows) {
      if (r.missing) { console.log(r.sel.padEnd(30), '  MISSING'); continue; }
      console.log(
        r.sel.padEnd(30),
        String(r.top).padStart(6),
        String(r.h).padStart(6),
        String(r.w).padStart(6),
        r.flex,
      );
    }
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