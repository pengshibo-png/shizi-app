/**
 * measure.mjs — 用 Chrome DevTools 协议把渲染后的布局 dump 成
 * better-design-layout-v1 JSON，交给 check_layout.py 做几何检查。
 *
 * 为什么不用肉眼看截图：布局错位 2px 在缩略图里根本看不出来，
 * better-design 的要求是"测量，不要用眼估"。
 *
 * 用法：
 *   node design/tools/measure.mjs <html文件> <输出json> [视口宽] [视口高] [根选择器]
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(process.env.USERPROFILE ?? '', '.agents', 'skills', 'better-design');

const [, , htmlPath, outPath, vw = '900', vh = '1300', rootSel = 'body'] = process.argv;

if (!htmlPath || !outPath) {
  console.error('用法: node measure.mjs <html> <out.json> [w] [h] [selector]');
  process.exit(2);
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('找不到 Chrome/Edge');
  process.exit(2);
}

const port = 9333 + Math.floor(Math.random() * 200);
const profile = join(process.env.TEMP ?? '.', `shi-measure-${Date.now()}`);

const proc = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--window-size=${vw},${vh}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools 未就绪');
}

let id = 0;
function rpc(ws, method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (data.id !== msgId) return;
      ws.removeEventListener('message', onMsg);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

async function evaluate(ws, expression) {
  const r = await rpc(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  }
  return r.result.value;
}

(async () => {
  try {
    const wsUrl = await getTarget();
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });

    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', {
      width: Number(vw),
      height: Number(vh),
      deviceScaleFactor: 1,
      mobile: false,
    });

    const url = pathToFileURL(resolve(htmlPath)).href;
    await rpc(ws, 'Page.navigate', { url });
    // 等字体加载完，否则测到的是回退字体的度量
    await sleep(1200);
    await evaluate(ws, 'document.fonts.ready.then(() => true)');

    const dumper = readFileSync(join(SKILL, 'assets', 'layout-dump', 'dump-dom.js'), 'utf8');
    const result = await evaluate(
      ws,
      `(() => { ${dumper}; return JSON.stringify(betterDesignDumpLayout(${JSON.stringify(rootSel)}), null, 1); })()`,
    );

    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(outPath, result, 'utf8');
    console.log(`✓ 布局 dump 已写入 ${outPath}`);

    ws.close();
  } catch (e) {
    console.error('✗', e.message);
    process.exitCode = 1;
  } finally {
    proc.kill();
    await sleep(200);
    try {
      const { rmSync } = await import('node:fs');
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* 清理失败不致命 */
    }
  }
})();