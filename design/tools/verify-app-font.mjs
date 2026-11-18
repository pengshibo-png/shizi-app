/**
 * verify-app-font.mjs — 在运行中的 App 里验证楷体真的用于汉字渲染
 *
 * 不用 document.fonts.check()：它对"字体已加载"和"实际用于该元素"是两件事，
 * 且受加载时序影响。这里在页面里用 canvas 分别用楷体和黑体画同一个字，
 * 比像素差异 —— 差异显著才说明楷体真的生效。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const [, , url, outPath] = process.argv;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9800 + Math.floor(Math.random() * 90);
const profile = join(process.env.TEMP ?? '.', `shi-af-${Date.now()}`);
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
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
    await sleep(3200);

    // 清空进度并锁定纸主题
    await evalJs(ws, `localStorage.clear(); localStorage.setItem('shi.themeMode','paper'); true`);
    await rpc(ws, 'Page.reload');
    await sleep(3200);

    // 进入单字页
    await evalJs(ws, `[...document.querySelectorAll('button')].find(b=>b.innerText.includes('接着学')).click(); true`);
    await sleep(2500);

    const info = await evalJs(ws, `(async () => {
      await document.fonts.ready;
      const el = document.querySelector('.shi-tianzi-char');
      const probe = (family) => {
        const c = document.createElement('canvas');
        c.width = 160; c.height = 160;
        const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0,0,160,160);
        x.fillStyle = '#000';
        x.font = '144px ' + family;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('重', 80, 80);
        return x.getImageData(0,0,160,160).data;
      };
      const kai = probe('"ShiziWenKai"');
      const sans = probe('"Noto Sans SC", "Microsoft YaHei", sans-serif');
      let diff = 0;
      for (let i = 0; i < kai.length; i += 4) if (Math.abs(kai[i]-sans[i]) > 16) diff++;
      const total = 160*160;
      return JSON.stringify({
        hanziChar: el ? el.innerText : null,
        hanziFontFamily: el ? getComputedStyle(el).fontFamily : null,
        hanziFontSize: el ? getComputedStyle(el).fontSize : null,
        loadedFaces: [...document.fonts].map(f => ({ family: f.family, status: f.status })),
        pixelDiffPct: Number(((diff/total)*100).toFixed(1)),
      }, null, 1);
    })()`);

    const d = JSON.parse(info);
    const pass = d.pixelDiffPct > 2 && d.hanziFontFamily?.includes('ShiziWenKai') && d.hanziFontSize === '340px';
    const out = { url, ...d, verdict: pass ? 'PASS 楷体在真实 App 中生效' : 'FAIL' };
    if (outPath) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');
    }
    console.log(JSON.stringify(out, null, 1));
    if (!pass) process.exitCode = 1;
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