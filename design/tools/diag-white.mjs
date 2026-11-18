/**
 * diag-white.mjs — 白屏诊断：抓模块加载失败 / 未捕获异常 / 网络错误
 * check-page 只看 console.error，抓不到 import 失败与 unhandled rejection。
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9820 + Math.floor(Math.random() * 60);
const profile = join(process.env.TEMP ?? '.', `shi-white-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=393,851', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
const rpc = (ws, m, p = {}) => new Promise((res, rej) => {
  const mid = ++id;
  const on = (ev) => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    if (d.id !== mid) return;
    ws.removeEventListener('message', on);
    d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
  };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
});

(async () => {
  const events = [];
  try {
    let u;
    for (let i = 0; i < 80; i++) {
      try {
        const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const p = l.find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) { u = p.webSocketDebuggerUrl; break; }
      } catch { /* */ }
      await sleep(250);
    }
    const ws = new WebSocket(u);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    ws.addEventListener('message', (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.method === 'Runtime.exceptionThrown') {
        events.push({ kind: 'exception', text: d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text });
      }
      if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') {
        events.push({ kind: 'log', text: d.params.entry.text, url: d.params.entry.url });
      }
      if (d.method === 'Network.loadingFailed') {
        events.push({ kind: 'netfail', id: d.params.requestId, err: d.params.errorText });
      }
      if (d.method === 'Network.responseReceived' && d.params.response.status >= 400) {
        events.push({ kind: 'http', status: d.params.response.status, url: d.params.response.url });
      }
    });
    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Log.enable');
    await rpc(ws, 'Network.enable');
    await rpc(ws, 'Page.navigate', { url });
    await sleep(20000);

    const state = await rpc(ws, 'Runtime.evaluate', {
      returnByValue: true,
      expression: `JSON.stringify({
        rootKids: document.getElementById('root')?.childElementCount ?? -1,
        bodyText: (document.body.innerText||'').slice(0,120),
        shi: window.__shi ?? null,
      })`,
    });
    console.log('STATE:', state.result.value);
    console.log('EVENTS:');
    events.slice(0, 14).forEach((e) => console.log(' ', JSON.stringify(e).slice(0, 300)));
    ws.close();
  } catch (e) {
    console.error('✗', e.message);
  } finally {
    proc.kill();
    await sleep(200);
    try { (await import('node:fs')).rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* */ }
  }
})();