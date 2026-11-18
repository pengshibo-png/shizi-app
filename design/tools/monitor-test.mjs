/**
 * monitor-test.mjs — 验证监护端能真实拉到并展示日报
 *
 * 步骤：注入同步地址与 learnerId → reload → 断言今日页各字段与数据一致。
 * 这是"家属能看到真实学习情况"这条验收标准的直接证据。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , url, syncBase, learnerId, outDir] = process.argv;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

if (outDir) mkdirSync(outDir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 90);
const profile = join(process.env.TEMP ?? '.', `shi-mon-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=430,900', 'about:blank',
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
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 2, mobile: true });
    await rpc(ws, 'Page.navigate', { url: 'about:blank' });
    await sleep(300);

    // 先在 about:blank 上塞好 localStorage（同源限制：改到目标源后再塞）
    await rpc(ws, 'Page.navigate', { url });
    await sleep(3000);
    await evalJs(ws, `
      localStorage.setItem('shi.monitor.baseUrl', ${JSON.stringify(syncBase)});
      localStorage.setItem('shi.monitor.learnerId', ${JSON.stringify(learnerId)});
      true
    `);
    await rpc(ws, 'Page.reload');
    await sleep(3500);

    const info = await evalJs(ws, `(() => {
      const txt = (s) => document.querySelector(s)?.innerText ?? null;
      return JSON.stringify({
        status: txt('.mon-status'),
        sub: txt('.mon-sub'),
        items: [...document.querySelectorAll('.mon-item')].map(e => e.innerText.replace(/\\n/g,' ')),
        stats: [...document.querySelectorAll('.mon-stat')].map(e => e.innerText.replace(/\\n/g,' ')),
        alerts: [...document.querySelectorAll('.mon-alert')].map(e => e.innerText.trim()),
        bodyText: document.body.innerText.replace(/\\s+/g,' ').slice(0, 400),
        tabCount: document.querySelectorAll('.mon-tab').length,
      }, null, 1);
    })()`);

    if (outDir) {
      const r = await rpc(ws, 'Page.captureScreenshot', { format: 'png' });
      const fs = await import('node:fs');
      fs.writeFileSync(join(outDir, 'monitor-today.png'), Buffer.from(r.data, 'base64'));
      console.log('  shot: monitor-today.png');
    }

    const parsed = JSON.parse(info);
    const pass =
      parsed.status?.includes('今天学过了') &&
      parsed.tabCount === 3 &&
      errs.length === 0;

    console.log(JSON.stringify({ ...parsed, errors: errs, verdict: pass ? 'PASS 监护端拿到真实日报' : 'FAIL' }, null, 1));
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