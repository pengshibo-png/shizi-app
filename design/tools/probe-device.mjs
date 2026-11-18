/**
 * probe-device.mjs — 在真机/模拟器的 Capacitor WebView 里取界面事实
 *
 * 用途：release 包默认关掉了 WebView 调试，本脚本配合临时开启的
 * webContentsDebuggingEnabled 读取「设备里到底发生了什么」——
 * 主题、画布色、安全区、根元素几何。避免靠截图猜颜色来源。
 *
 * 用法：先 adb forward，再 node design/tools/probe-device.mjs
 */
import { execFileSync } from 'node:child_process';

const ADB = 'D:\\Android\\Sdk\\platform-tools\\adb.exe';
const PKG = 'cn.shizi.learner';

function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8' }).trim();
}

const pid = adb('shell', 'pidof', PKG).split(/\s+/)[0];
if (!pid) throw new Error('App 没在运行');
const socket = `webview_devtools_remote_${pid}`;
adb('forward', 'tcp:9333', `localabstract:${socket}`);

const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error(`没有可调试页面：${JSON.stringify(targets).slice(0, 300)}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});

let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const mid = ++id;
    const on = (ev) => {
      const d = JSON.parse(ev.data);
      if (d.id !== mid) return;
      ws.removeEventListener('message', on);
      d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

const probe = await rpc('Runtime.evaluate', {
  returnByValue: true,
  awaitPromise: true,
  expression: `(() => {
    const cs = getComputedStyle(document.body);
    const probeEl = document.createElement('div');
    probeEl.style.cssText = 'position:fixed;top:0;left:0;height:env(safe-area-inset-top,0px);width:1px;';
    document.body.appendChild(probeEl);
    const insetTop = Math.round(probeEl.getBoundingClientRect().height);
    probeEl.style.cssText = 'position:fixed;bottom:0;left:0;height:env(safe-area-inset-bottom,0px);width:1px;';
    document.body.appendChild(probeEl);
    const insetBottom = Math.round(probeEl.getBoundingClientRect().height);
    probeEl.remove();
    const root = document.getElementById('root');
    const app = document.querySelector('.shi-app, .shi-charpage');
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    return JSON.stringify({
      url: location.href,
      theme: document.documentElement.dataset.theme ?? null,
      bodyBg: cs.backgroundColor,
      dvh: Math.round(window.innerHeight),
      insetTop, insetBottom,
      root: r(root), app: r(app),
      firstText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 40),
    });
  })()`,
});

console.log(JSON.stringify(JSON.parse(probe.result.value), null, 1));
ws.close();
adb('forward', '--remove', 'tcp:9333');
