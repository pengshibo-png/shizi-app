/**
 * probe-strokes.mjs — 诊断笔顺懒加载为什么失败
 * 在项目根目录运行；路径全部从 cwd 推导，不写死本机位置。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) {
  console.error('✗ 找不到 Chrome / Edge，请改 CHROME 候选路径');
  process.exit(1);
}
// Vite 的 /@fs/ 前缀 = 项目绝对路径（Windows 盘符后不带斜杠）
const FSROOT = '/@fs' + process.cwd().replace(/\\/g, '/').replace(/^([A-Za-z]:)/, '$1');
const port = 9700 + Math.floor(Math.random() * 90);
const profile = join(process.env.TEMP ?? '.', `shi-probe-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=393,851', 'about:blank',
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
async function ev(ws, expression) {
  const r = await rpc(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails
    ? { ERR: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
    : r.result.value;
}

(async () => {
  try {
    let wsUrl;
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const p = list.find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
      } catch { /* */ }
      await sleep(250);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Page.navigate', { url });
    await sleep(9000);

    console.log('1) 直接 import @fs 路径:');
    console.log(await ev(ws, `(async () => {
      try {
        const m = await import(`${FSROOT}/packages/content/data/strokes.json');
        const d = m.default ?? m;
        return JSON.stringify({ keys: Object.keys(d).slice(0,4), count: d.chars ? Object.keys(d.chars).length : null });
      } catch (e) { return 'ERR ' + e.message; }
    })()`));

    console.log('2) 走 content 包的 loadStrokes:');
    console.log(await ev(ws, `(async () => {
      try {
        const m = await import(`${FSROOT}/packages/content/index.js');
        const s = await m.loadStrokes();
        return JSON.stringify({ ok: true, n: Object.keys(s).length, has着: !!s['着'] });
      } catch (e) { return 'ERR ' + e.message; }
    })()`));

    console.log('3) HTTP 直取 JSON:');
    console.log(await ev(ws, `(async () => {
      try {
        const r = await fetch(`${FSROOT}/packages/content/data/strokes.json');
        const t = await r.text();
        return JSON.stringify({ status: r.status, len: t.length, head: t.slice(0,60) });
      } catch (e) { return 'ERR ' + e.message; }
    })()`));

    ws.close();
  } catch (e) {
    console.error('✗', e.message);
    process.exitCode = 1;
  } finally {
    proc.kill();
    await sleep(200);
    try { (await import('node:fs')).rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
})();