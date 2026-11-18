/**
 * verify-font-pixels.mjs — 用像素哈希证明楷体真的改变了字形渲染
 *
 * CJK 是全角等宽字，测宽度无法区分字体（楷体和黑体都是 1em）。
 * 所以改用 canvas 渲染同一个字，比较两种字体下的像素差异：
 * 像素不同 = 字形不同 = 字体真的生效了。
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

const port = 9900 + Math.floor(Math.random() * 90);
const profile = join(process.env.TEMP ?? '.', `shi-fp-${Date.now()}`);
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
    await sleep(1400);

    const r = await rpc(ws, 'Runtime.evaluate', {
      expression: `(async () => {
        await document.fonts.ready;
        const S = 160, TEXT = '重';
        const draw = (family) => {
          const c = document.createElement('canvas');
          c.width = S; c.height = S;
          const x = c.getContext('2d');
          x.fillStyle = '#ffffff'; x.fillRect(0, 0, S, S);
          x.fillStyle = '#000000';
          x.font = S * 0.9 + 'px ' + family;
          x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(TEXT, S / 2, S / 2);
          return x.getImageData(0, 0, S, S).data;
        };
        const kai = draw('"ShiziWenKai"');
        const sans = draw('"Noto Sans SC", "Microsoft YaHei", sans-serif');
        const serif = draw('serif');

        // 统计墨迹像素数 + 与楷体的差异像素数
        const inkCount = (d) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200) n++; return n; };
        const diffCount = (a, b) => {
          let n = 0;
          for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 16) n++;
          return n;
        };
        const inkKai = inkCount(kai), inkSans = inkCount(sans), inkSerif = inkCount(serif);
        return JSON.stringify({
          glyphCheck: document.fonts.check('160px "ShiziWenKai"', '重'),
          loadedFaces: [...document.fonts].map(f => ({ family: f.family, status: f.status })),
          inkPixels: { kai: inkKai, sans: inkSans, serif: inkSerif },
          diffPixels: { kaiVsSans: diffCount(kai, sans), kaiVsSerif: diffCount(kai, serif) },
          totalPixels: S * S,
        }, null, 1);
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    const d = JSON.parse(r.result.value);

    const kaiChanged = d.diffPixels.kaiVsSans > d.totalPixels * 0.02;
    const verdict = d.glyphCheck && kaiChanged && d.inkPixels.kai > 0;

    const info = {
      html: htmlPath,
      ...d,
      kaiDiffersFromSansPct: Number(((d.diffPixels.kaiVsSans / d.totalPixels) * 100).toFixed(1)),
      verdict: verdict ? 'PASS 楷体字形已生效（像素确有差异）' : 'FAIL 仍在使用回退字体',
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