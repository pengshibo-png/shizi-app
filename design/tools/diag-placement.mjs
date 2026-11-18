/**
 * diag-placement.mjs — 摸底流程聚焦诊断
 * 只做一件事：清空 → 首启 → 走完 120 题识字 → 看进度与最终 state。
 * 每 10 题打印一次进度，定位卡点。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9500 + Math.floor(Math.random() * 80);
const profile = join(process.env.TEMP ?? '.', `shi-diag-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
  return r.result.value;
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
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 393, height: 851, deviceScaleFactor: 1, mobile: true });

    await rpc(ws, 'Page.navigate', { url });
    await sleep(8000);
    console.log('初始页面:', await ev(ws, `document.body.innerText.slice(0,80)`));

    await ev(ws, `localStorage.clear(); true`);
    await rpc(ws, 'Page.reload');
    // 等摸底屏
    let appeared = false;
    for (let i = 0; i < 100; i++) {
      if (await ev(ws, `!!document.querySelector('.shi-place-note')`)) { appeared = true; break; }
      await sleep(500);
    }
    console.log('摸底屏出现:', appeared, '| 等待轮数:', appeared ? 'ok' : 'timeout');
    console.log('当前文本:', await ev(ws, `document.body.innerText.slice(0,80)`));

    // 走题：每题点「拼音侧」，打印进度
    let clicked = 0;
    for (let i = 0; i < 140; i++) {
      const st = await ev(ws, `(() => {
        const bar = document.querySelector('.shi-topbar-title')?.innerText ?? '';
        const prog = document.querySelector('.shi-caption')?.innerText ?? '';
        const hasChoice = !!document.querySelector('.shi-choice');
        const hasMath = !!document.querySelector('.shi-math-opt');
        const hasTab = !!document.querySelector('.shi-tab');
        return JSON.stringify({bar, prog, hasChoice, hasMath, hasTab});
      })()`);
      const s = JSON.parse(st);
      if (clicked % 10 === 0) console.log(`[${clicked}]`, st);

      if (s.hasChoice) {
        await ev(ws, `(() => {
          const btns=[...document.querySelectorAll('.shi-choice')];
          const py=btns.find(b=>b.innerText!=='不是这个');
          (py??btns[0])?.click(); return true;
        })()`);
        clicked++;
        await sleep(1200);
      } else if (s.hasMath) {
        break;
      } else if (s.hasTab) {
        console.log('意外进入主框架');
        break;
      } else {
        await sleep(600);
      }
    }

    console.log('--- 识字阶段结束，已点', clicked, '题 ---');
    console.log('数学阶段:', await ev(ws, `!!document.querySelector('.shi-math-opt')`));
    console.log('localStorage placement:', await ev(ws, `localStorage.getItem('shi.placement.v1')?.slice(0,200) ?? null`));

    // 走数学
    for (let i = 0; i < 8; i++) {
      if (!(await ev(ws, `!!document.querySelector('.shi-math-opt')`))) break;
      await ev(ws, `document.querySelector('.shi-math-opt')?.click(); true`);
      await sleep(1500);
    }
    await sleep(2000);

    console.log('--- 最终 ---');
    console.log('TabBar:', await ev(ws, `!!document.querySelector('.shi-tab')`));
    console.log('placement:', await ev(ws, `localStorage.getItem('shi.placement.v1')?.slice(0,160) ?? null`));
    console.log('__shi:', await ev(ws, `JSON.stringify(window.__shi ?? {})`));

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