/**
 * dump-dom.mjs — 打印页面实际 DOM 结构（诊断"选择器找不到"用）
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const [, , url, action] = process.argv;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9600 + Math.floor(Math.random() * 150);
const profile = join(process.env.TEMP ?? '.', `shi-dump-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=800,1280', '--autoplay-policy=no-user-gesture-required', 'about:blank',
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
  if (r.exceptionDetails) return 'EXCEPTION: ' + (r.exceptionDetails.exception?.description ?? '');
  return r.result.value;
}

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
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 1280, deviceScaleFactor: 1, mobile: false });
    await rpc(ws, 'Page.navigate', { url });
    await sleep(3000);

    console.log('=== 首页 ===');
    console.log(await evalJs(ws, `document.getElementById('root').innerHTML.slice(0, 1200)`));

    if (action === 'study') {
      await evalJs(ws, `localStorage.setItem('shi.themeMode','paper'); true`);
      const clicked = await evalJs(ws, `
        (() => {
          const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('接着学'));
          if (!b) return 'no button; buttons=' + [...document.querySelectorAll('button')].map(x=>x.innerText.trim()).join('|');
          b.click(); return 'clicked';
        })()
      `);
      console.log('click result:', clicked);
      await sleep(2500);
      console.log('=== 点击后 ===');
      console.log(await evalJs(ws, `document.getElementById('root').innerHTML.slice(0, 2200)`));
      console.log('=== class 列表 ===');
      console.log(await evalJs(ws, `[...new Set([...document.querySelectorAll('#root *')].map(e=>e.className).filter(c=>typeof c==='string'))].join('\\n')`));
    }
    ws.close();
  } catch (e) {
    console.error('✗', e.message);
  } finally {
    proc.kill();
    await sleep(150);
    try { (await import('node:fs')).rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
})();