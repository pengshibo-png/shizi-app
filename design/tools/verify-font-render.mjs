/**
 * verify-font-render.mjs — 用 DOM 元素测字形宽度，确认楷体真的在改变渲染
 *
 * canvas 的 font 字符串对带引号的族名解析不稳，改用真实 DOM span
 * 在同样字号下比较宽度：楷体与黑体宽度不同才说明字体真的生效。
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , htmlPath, outPath] = process.argv;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9700 + Math.floor(Math.random() * 200);
const profile = join(process.env.TEMP ?? '.', `shi-fr-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--window-size=800,1280', 'about:blank',
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
    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Page.navigate', { url: pathToFileURL(resolve(htmlPath)).href });
    await sleep(1200);

    const r = await rpc(ws, 'Runtime.evaluate', {
      expression: `(async () => {
        await document.fonts.ready;
        const probe = (family) => {
          const d = document.createElement('div');
          d.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:200px;white-space:nowrap;font-family:' + family;
          d.textContent = '重重要量';
          document.body.appendChild(d);
          const w = d.getBoundingClientRect().width;
          d.remove();
          return w;
        };
        const kai = probe('"ShiziWenKai"');
        const sans = probe('"Noto Sans SC", "Microsoft YaHei", sans-serif');
        const serif = probe('serif');
        const loadedFaces = [...document.fonts].map(f => ({ family: f.family, status: f.status }));
        const el = document.querySelector('.hanzi');
        const cs = el ? getComputedStyle(el) : null;
        return JSON.stringify({
          loadedFaces,
          glyphCheck: document.fonts.check('200px "ShiziWenKai"', '重'),
          widths: { kai, sans, serif },
          hanziFontFamily: cs ? cs.fontFamily : null,
          hanziFontSize: cs ? cs.fontSize : null,
          hanziRenderedWidth: el ? el.getBoundingClientRect().width : null,
        }, null, 1);
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    const data = JSON.parse(r.result.value);

    const diffSans = Math.abs(data.widths.kai - data.widths.sans);
    const diffSerif = Math.abs(data.widths.kai - data.widths.serif);
    const verdict = data.glyphCheck && (diffSans > 1 || diffSerif > 1);

    const info = {
      html: htmlPath,
      ...data,
      kaiVsSans: Number(diffSans.toFixed(2)),
      kaiVsSerif: Number(diffSerif.toFixed(2)),
      verdict: verdict ? 'PASS 楷体已生效' : 'FAIL 仍在用回退字体',
    };
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(outPath, JSON.stringify(info, null, 1), 'utf8');
    console.log(JSON.stringify(info, null, 1));
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