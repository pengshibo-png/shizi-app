/**
 * verify-font.mjs — 验证楷体字体是否真的加载并在页面上生效
 *
 * 为什么单独验：截图文件偏小通常是回退到了系统字体，而这一步
 * 直接决定"识字 App 是否用楷体教学"这个正确性要求。必须在
 * 实际渲染环境里查，不能看 CSS 写了什么就认为生效。
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [, , htmlPath, outPath] = process.argv;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9500 + Math.floor(Math.random() * 200);
const profile = join(process.env.TEMP ?? '.', `shi-font-${Date.now()}`);

const proc = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--window-size=800,1280', 'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let id = 0;
function rpc(ws, method, params = {}) {
  const msgId = ++id;
  return new Promise((res, rej) => {
    const on = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch { return; }
      if (d.id !== msgId) return;
      ws.removeEventListener('message', on);
      if (d.error) rej(new Error(JSON.stringify(d.error)));
      else res(d.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: msgId, method, params }));
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
      } catch { /* 等启动 */ }
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
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 800, height: 1280, deviceScaleFactor: 1, mobile: false,
    });
    await rpc(ws, 'Page.navigate', { url: pathToFileURL(resolve(htmlPath)).href });
    await sleep(1200);

    const r = await rpc(ws, 'Runtime.evaluate', {
      expression: `(async () => {
        await document.fonts.ready;
        const loaded = [...document.fonts].map(f => ({
          family: f.family, status: f.status, weight: f.weight,
        }));
        // 用两个不同字体的 canvas 量同一个字，宽度不同才说明字体真的换上了
        const measure = (family, text, size) => {
          const c = document.createElement('canvas').getContext('2d');
          c.font = size + 'px ' + family;
          return c.measureText(text).width;
        };
        const widths = {
          kai: measure("'ShiziWenKai'", '重', 200),
          serif: measure('serif', '重', 200),
          sans: measure('sans-serif', '重', 200),
        };
        const el = document.querySelector('.greet h1, .hanzi, h1');
        const computed = el ? getComputedStyle(el).fontFamily : null;
        return JSON.stringify({ loaded, widths, computed, check: document.fonts.check("200px 'ShiziWenKai'", '重') }, null, 1);
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });

    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    const data = JSON.parse(r.result.value);

    const info = {
      html: htmlPath,
      fontFaceLoaded: data.loaded,
      glyphCheck: data.check,
      computedFamily: data.computed,
      measuredWidths: data.widths,
      // 楷体与衬线/无衬线的宽度都相同 → 说明根本没换上，在吃回退
      kaiDiffersFromSans: Math.abs(data.widths.kai - data.widths.sans) > 0.5,
      kaiDiffersFromSerif: Math.abs(data.widths.kai - data.widths.serif) > 0.5,
    };

    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(outPath, JSON.stringify(info, null, 1), 'utf8');
    console.log(JSON.stringify(info, null, 1));

    ws.close();
  } catch (e) {
    console.error('✗', e.message);
    process.exitCode = 1;
  } finally {
    proc.kill();
    await sleep(150);
    try {
      const { rmSync } = await import('node:fs');
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    } catch { /* ignore */ }
  }
})();