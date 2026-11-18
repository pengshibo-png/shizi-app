/**
 * flow-test.mjs — 走一遍真实学习流程，验证关键路径可用
 *
 * 检查：首页 → 点"接着学" → 单字页出现楷体大字 → 点选项 → 回到首页
 * 同时抓控制台错误和音频请求失败。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const [, , url, outPath] = process.argv;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9400 + Math.floor(Math.random() * 200);
const profile = join(process.env.TEMP ?? '.', `shi-flow-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=800,1280', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
const errors = [];
const audioRequests = [];

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
  return r.result.value;
}

(async () => {
  const steps = [];
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

    ws.addEventListener('message', (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.method === 'Runtime.exceptionThrown') {
        errors.push(d.params.exceptionDetails?.exception?.description ?? 'exception');
      }
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
        errors.push(d.params.args.map((a) => a.value ?? '').join(' '));
      }
      if (d.method === 'Network.responseReceived') {
        const u = d.params.response.url;
        if (u.includes('/audio/')) {
          audioRequests.push({ url: decodeURIComponent(u.split('/').pop()), status: d.params.response.status });
        }
      }
    });

    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Network.enable');
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 800, height: 1280, deviceScaleFactor: 1, mobile: false,
    });
    // 固定用"纸"主题，方便对比；顺便清空旧进度
    await rpc(ws, 'Page.navigate', { url });
    await sleep(3000);

    await evalJs(ws, `localStorage.clear(); localStorage.setItem('shi.themeMode','paper'); true`);
    await rpc(ws, 'Page.reload');
    await sleep(3000);

    steps.push({
      step: 'home',
      h1: await evalJs(ws, `document.querySelector('h1')?.innerText ?? null`),
      buttons: await evalJs(ws, `[...document.querySelectorAll('button')].map(b=>b.innerText.trim().slice(0,14))`),
    });

    // 点"接着学"
    await evalJs(ws, `
      (() => {
        const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('接着学'));
        if (!b) throw new Error('找不到接着学按钮');
        b.click();
        return true;
      })()
    `);
    await sleep(2500);

    steps.push({
      step: 'study',
      hanzi: await evalJs(ws, `document.querySelector('.shi-tianzi-char')?.innerText ?? null`),
      hanziFont: await evalJs(ws, `(()=>{const e=document.querySelector('.shi-tianzi-char');return e?getComputedStyle(e).fontFamily:null})()`),
      hanziSize: await evalJs(ws, `(()=>{const e=document.querySelector('.shi-tianzi-char');return e?getComputedStyle(e).fontSize:null})()`),
      // 先等字体就绪再检查：document.fonts.check() 在字体仍在加载时会返回 false，
      // 会造成假失败（实测踩到过）。真正判断"楷体是否生效"用像素法，见 verify-app-font.mjs。
      fontLoaded: await evalJs(
        ws,
        `(async () => { await document.fonts.ready; return document.fonts.check('200px "ShiziWenKai"', '重'); })()`,
      ),
      pinyin: await evalJs(ws, `document.querySelector('.shi-py')?.innerText ?? null`),
      choices: await evalJs(ws, `[...document.querySelectorAll('.shi-choice')].map(e=>e.innerText.trim())`),
      progress: await evalJs(ws, `document.querySelector('.shi-progress-label')?.innerText ?? null`),
    });

    // 点第一个选项
    await evalJs(ws, `document.querySelector('.shi-choice')?.click(); true`);
    await sleep(600);
    steps.push({
      step: 'after-pick',
      feedback: await evalJs(ws, `document.querySelector('.shi-fb-text')?.innerText?.slice(0,60) ?? null`),
      rightMarked: await evalJs(ws, `document.querySelectorAll('.shi-choice.is-right').length`),
    });

    // 等它翻到下一字
    await sleep(2200);
    steps.push({
      step: 'next-char',
      hanzi: await evalJs(ws, `document.querySelector('.shi-tianzi-char')?.innerText ?? null`),
      progress: await evalJs(ws, `document.querySelector('.shi-progress-label')?.innerText ?? null`),
      learned: await evalJs(ws, `JSON.parse(localStorage.getItem('shi.state.v1')||'{}').learnedCount ?? 0`),
    });

    const info = {
      url,
      steps,
      audioRequests: audioRequests.slice(0, 10),
      audioOk: audioRequests.filter((a) => a.status === 200 || a.status === 206).length,
      audioFail: audioRequests.filter((a) => a.status >= 400).length,
      errors,
    };
    if (outPath) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(info, null, 1), 'utf8');
    }

    const pass =
      steps[1]?.hanzi &&
      steps[1]?.fontLoaded === true &&
      steps[1]?.hanziSize === '340px' &&
      steps[3]?.progress?.startsWith('2') &&
      steps[3]?.learned >= 2 &&
      errors.length === 0;

    console.log(JSON.stringify({ ...info, verdict: pass ? 'PASS 学习流程可用' : 'FAIL' }, null, 1));
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