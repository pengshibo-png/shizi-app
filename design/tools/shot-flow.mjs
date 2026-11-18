/**
 * shot-flow.mjs — 走流程并逐步截图（首页 / 单字页 / 反馈态）
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , url, outDir] = process.argv;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

mkdirSync(outDir, { recursive: true });
const port = 9100 + Math.floor(Math.random() * 90);
const profile = join(process.env.TEMP ?? '.', `shi-shot-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
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
async function shot(ws, name) {
  const r = await rpc(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const fs = await import('node:fs');
  fs.writeFileSync(join(outDir, name), Buffer.from(r.data, 'base64'));
  console.log('  shot:', name);
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
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 800, height: 1280, deviceScaleFactor: 2, mobile: false,
    });
    await rpc(ws, 'Page.navigate', { url });
    await sleep(3200);

    // 清空进度 + 锁定纸主题
    await evalJs(ws, `localStorage.clear(); localStorage.setItem('shi.themeMode','paper'); true`);
    await rpc(ws, 'Page.reload');
    await sleep(3200);
    await shot(ws, 'app-01-home-paper.png');

    // 进单字页
    await evalJs(ws, `[...document.querySelectorAll('button')].find(b=>b.innerText.includes('接着学')).click(); true`);
    await sleep(2000);
    await shot(ws, 'app-02-study-paper.png');

    // 点错的那个（第二个选项）制造反馈态
    await evalJs(ws, `(() => { const cs=[...document.querySelectorAll('.shi-choice')]; (cs[1]||cs[0]).click(); return true; })()`);
    await sleep(700);
    await shot(ws, 'app-03-feedback.png');

    // 回首页切墨色
    await sleep(2200);
    await evalJs(ws, `localStorage.setItem('shi.themeMode','ink'); location.reload(); true`);
    await sleep(3200);
    await shot(ws, 'app-04-home-ink.png');

    // 我的字
    await evalJs(ws, `[...document.querySelectorAll('button')].find(b=>b.innerText.includes('我的字'))?.click(); true`);
    await sleep(1600);
    await shot(ws, 'app-05-mychars-ink.png');

    // 科普
    await evalJs(ws, `[...document.querySelectorAll('button')].find(b=>b.innerText.includes('科普'))?.click(); true`);
    await sleep(1600);
    await shot(ws, 'app-06-science-ink.png');

    // 数学
    await evalJs(ws, `[...document.querySelectorAll('button')].find(b=>b.innerText.includes('生活数学'))?.click(); true`);
    await sleep(1600);
    await shot(ws, 'app-07-math-ink.png');

    console.log('done');
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