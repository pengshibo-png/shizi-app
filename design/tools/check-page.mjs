/**
 * check-page.mjs — 检查页面是否真的渲染出内容（不是白屏）
 *
 * 用途：截图只能看大小，看不出是白屏还是正常。这里读实际 DOM：
 * 节点数、可见文字、根元素尺寸、控制台错误。
 *
 * 用法：node check-page.mjs <url> [宽] [高]
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const [, , url, vw = '800', vh = '1280'] = process.argv;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9200 + Math.floor(Math.random() * 300);
const profile = join(process.env.TEMP ?? '.', `shi-page-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  `--window-size=${vw},${vh}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
const consoleErrors = [];

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

    ws.addEventListener('message', (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
        consoleErrors.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (d.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(d.params.exceptionDetails?.exception?.description ?? 'exception');
      }
    });

    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', {
      width: Number(vw), height: Number(vh), deviceScaleFactor: 1, mobile: false,
    });
    await rpc(ws, 'Page.navigate', { url });
    await sleep(3500);

    const r = await rpc(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const root = document.getElementById('root');
        const q = (s) => document.querySelectorAll(s).length;
        const txt = (root ? root.innerText : '').replace(/\\s+/g, ' ').trim();
        const btns = [...document.querySelectorAll('button')].map(b => ({
          text: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 24),
          w: Math.round(b.getBoundingClientRect().width),
          h: Math.round(b.getBoundingClientRect().height),
        }));
        const h1 = document.querySelector('h1');
        const cs = h1 ? getComputedStyle(h1) : null;
        return JSON.stringify({
          bodyHeight: document.body.scrollHeight,
          rootNodes: root ? root.querySelectorAll('*').length : 0,
          textLength: txt.length,
          textSample: txt.slice(0, 200),
          h1: h1 ? h1.innerText : null,
          h1Size: cs ? cs.fontSize : null,
          buttonCount: q('button'),
          buttons: btns.slice(0, 12),
          fontLoaded: document.fonts.check('40px "ShiziWenKai"', '重'),
          theme: document.documentElement.dataset.theme,
          debug: window.__shi ?? null,
        }, null, 1);
      })()`,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    const info = JSON.parse(r.result.value);

    const tooSmall = info.buttons.filter((b) => b.w > 0 && (b.w < 64 || b.h < 64));
    const verdict = info.textLength > 10 && info.rootNodes > 10 && consoleErrors.length === 0;

    console.log(JSON.stringify({
      url,
      ...info,
      buttonsUnder64: tooSmall,
      consoleErrors,
      verdict: verdict ? 'PASS 页面渲染正常' : 'FAIL 白屏或报错',
    }, null, 1));

    if (!verdict) process.exitCode = 1;
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