/**
 * screens-test.mjs — 逐屏验证：每个屏都必须渲染出该屏特有的内容
 *
 * 只看截图大小判断不了"是不是同一屏"。这里对每屏断言其特有选择器与文案。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9000 + Math.floor(Math.random() * 90);
const profile = join(process.env.TEMP ?? '.', `shi-scr-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=800,1280', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
const errs = [];
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

const clickText = (t) =>
  `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes(${JSON.stringify(t)}));
    if (!b) return 'NOT_FOUND';
    b.click();
    return 'ok';
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
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', j, { once: true });
    });
    ws.addEventListener('message', (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.method === 'Runtime.exceptionThrown') {
        errs.push(d.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? 'exception');
      }
    });
    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 1280, deviceScaleFactor: 1, mobile: false });
    await rpc(ws, 'Page.navigate', { url });
    await sleep(3200);
    await evalJs(ws, `localStorage.clear(); localStorage.setItem('shi.themeMode','paper'); true`);
    await rpc(ws, 'Page.reload');
    await sleep(3200);

    const results = [];

    // 先学会两个字，这样"我的字"和"复习"才有内容
    await evalJs(ws, clickText('接着学'));
    await sleep(1800);
    await evalJs(ws, `document.querySelector('.shi-choice')?.click(); true`);
    await sleep(1400);
    await evalJs(ws, `document.querySelector('.shi-choice')?.click(); true`);
    await sleep(1400);
    await evalJs(ws, `document.querySelector('.shi-back')?.click(); true`);
    await sleep(1600);

    results.push({
      screen: 'home',
      h1: await evalJs(ws, `document.querySelector('h1')?.innerText ?? null`),
      rows: await evalJs(ws, `[...document.querySelectorAll('.shi-row-name')].map(e=>e.innerText)`),
    });

    // 我的字
    await evalJs(ws, clickText('我的字'));
    await sleep(1800);
    results.push({
      screen: 'mychars',
      h1: await evalJs(ws, `document.querySelector('h1')?.innerText ?? null`),
      title: await evalJs(ws, `document.querySelector('.shi-topbar-title')?.innerText ?? null`),
      cells: await evalJs(ws, `document.querySelectorAll('.shi-cell').length`),
    });
    await evalJs(ws, `document.querySelector('.shi-back')?.click(); true`);
    await sleep(1500);

    // 科普
    await evalJs(ws, clickText('科普'));
    await sleep(1800);
    results.push({
      screen: 'science',
      title: await evalJs(ws, `document.querySelector('.shi-sci-title')?.innerText ?? null`),
      bodyLen: await evalJs(ws, `document.querySelector('.shi-sci-body')?.innerText?.length ?? 0`),
      question: await evalJs(ws, `document.querySelector('.shi-sci-q')?.innerText ?? null`),
      options: await evalJs(ws, `[...document.querySelectorAll('.shi-math-opt')].map(e=>e.innerText)`),
    });
    await evalJs(ws, `document.querySelector('.shi-back')?.click(); true`);
    await sleep(1500);

    // 数学
    await evalJs(ws, clickText('生活数学'));
    await sleep(1800);
    results.push({
      screen: 'math',
      module: await evalJs(ws, `document.querySelector('.shi-mod')?.innerText ?? null`),
      title: await evalJs(ws, `document.querySelector('.shi-math-head h1')?.innerText ?? null`),
      prompt: await evalJs(ws, `document.querySelector('.shi-math-prompt')?.innerText ?? null`),
      options: await evalJs(ws, `[...document.querySelectorAll('.shi-math-opt')].map(e=>e.innerText)`),
    });

    const checks = {
      homeHasRows: (results[0].rows?.length ?? 0) >= 4,
      mycharsHasGrid: (results[1].cells ?? 0) > 0,
      mycharsTitle: results[1].title === '我的字' || (results[1].h1 ?? '').includes('个字'),
      scienceLoaded: (results[2].bodyLen ?? 0) > 40 && (results[2].options?.length ?? 0) === 2,
      mathLoaded: (results[3].prompt?.length ?? 0) > 3 && (results[3].options?.length ?? 0) >= 2,
    };

    const pass = Object.values(checks).every(Boolean) && errs.length === 0;
    console.log(JSON.stringify({ results, checks, errors: errs, verdict: pass ? 'PASS 各屏均正常' : 'FAIL' }, null, 1));
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