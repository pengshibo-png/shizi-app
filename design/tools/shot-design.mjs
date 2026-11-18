/**
 * shot-design.mjs — 设计验收截图
 * 播种一个真实使用中的状态（已摸底、学了几天、看过百科），
 * 然后逐屏截图。纸/墨两主题都出，便于核对对比度与割裂。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'design/shots/redesign';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
mkdirSync(outDir, { recursive: true });

const port = 9600 + Math.floor(Math.random() * 90);
const profile = join(process.env.TEMP ?? '.', `shi-shot-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=393,851', '--force-device-scale-factor=2', 'about:blank',
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
async function ev(ws, expression) {
  const r = await rpc(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
  return r.result.value;
}
async function waitFor(ws, sel, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    if (await ev(ws, `!!document.querySelector(${JSON.stringify(sel)})`)) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(300);
  }
}
async function shot(ws, name) {
  const r = await rpc(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
  return name;
}

/** 播种：已摸底、学到第 6 天（非巩固日）、今天认了 8 个、40 字待温习 */
const SEED = `(() => {
  const today = new Date();
  const dk = (d) => { const p=(n)=>String(n).padStart(2,'0');
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); };
  const days = [];
  for (let i=6;i>=0;i--){ const d=new Date(today); d.setDate(d.getDate()-i); days.push(dk(d)); }
  const chars = '一二三四五十百万人口手目头足心儿女日月水火山石田土大小上下中左右前后天地风雨云电门窗床桌椅米面油菜茶盐糖'.split('');
  const state = {
    deviceId: 'seed-device',
    learnedCount: 100,
    newPerDay: 20,
    reviews: {},
    tasks: {},
    sessions: [],
    accuracyHistory: [{date: days[4], correct: 17, total: 20}, {date: days[5], correct: 18, total: 20}],
    mathDone: [1,2,3,4,5,6,7,8,9,10,11,12,13,14],
    scienceDone: [],
    familyMessage: null,
  };
  chars.forEach((c,i)=>{
    state.reviews[c] = { char:c, stage: i<24?4:2,
      dueAt: i<24 ? Date.now()+365*86400000 : Date.now()-3600000,
      lastResult:'correct', streak:2, sessions:['s1','s2'], updatedAt: Date.now() };
  });
  days.forEach((d,i)=>{
    state.tasks[d] = { deviceId:'seed-device', date:d, dayIndex:i+1, newTarget:20,
      newDone: i===6?8:20, reviewTarget:16, reviewDone: i===6?0:16,
      mathDone:i<5, scienceDone:i<4, durationSec:1080, completedAt: i===6?null:Date.now() };
    state.sessions.push({ id:'s'+i, date:d, startedAt:Date.now()-86400000*(6-i)-3600000,
      endedAt:Date.now()-86400000*(6-i), newLearned: i===6?8:20, reviewed: i===6?0:16,
      correct: i===6?7:18, total: i===6?8:20 });
  });
  localStorage.setItem('shi.state.v1', JSON.stringify(state));
  localStorage.setItem('shi.deviceId','seed-device');
  localStorage.setItem('shi.themeMode','paper');
  localStorage.setItem('shi.placement.v1', JSON.stringify({phase:'done', mathStart:15,
    result:{knownChars:[], answers:[], estimatedKnown:260, takenAt:Date.now()-6*86400000}}));
  localStorage.setItem('shi.encViewed.v1', JSON.stringify(Array.from({length:12},(_,i)=>'e'+(i+1))));
  return true;
})()`;

(async () => {
  const shots = [];
  try {
    let wsUrl;
    for (let i = 0; i < 90; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const p = list.find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
      } catch { /* */ }
      await sleep(250);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    ws.addEventListener('message', (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails?.exception?.description?.split('\n')[0]);
    });

    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 393, height: 851, deviceScaleFactor: 2, mobile: true });
    await rpc(ws, 'Page.navigate', { url });
    await waitFor(ws, '.shi-app, .shi-place-note', 40000);
    await ev(ws, SEED);
    await rpc(ws, 'Page.reload');
    await waitFor(ws, '.shi-tiantou', 40000);
    await sleep(1200);

    shots.push(await shot(ws, '01-home-paper'));

    // 几何体检：有没有溢出/裁切
    const geo = JSON.parse(await ev(ws, `(() => {
      const r = (s) => { const e=document.querySelector(s); if(!e) return null;
        const b=e.getBoundingClientRect(); return {t:Math.round(b.top),b:Math.round(b.bottom),h:Math.round(b.height),w:Math.round(b.width)}; };
      return JSON.stringify({
        vh: innerHeight, bodyH: document.body.scrollHeight,
        app: r('.shi-app'), tiantou: r('.shi-tiantou'), lesson: r('.shi-lesson'),
        now: r('.shi-gridstrip-now'), tasks: r('.shi-tasks'),
        task1: r('.shi-task'), dijiao: r('.shi-dijiao'),
        cta: r('.shi-btn--primary'), tabbar: r('.shi-tabbar'),
      });
    })()`));

    // 墨主题
    await ev(ws, `localStorage.setItem('shi.themeMode','ink'); true`);
    await rpc(ws, 'Page.reload');
    await waitFor(ws, '.shi-tiantou', 30000);
    await sleep(1000);
    shots.push(await shot(ws, '02-home-ink'));

    // 回纸，进百科
    await ev(ws, `localStorage.setItem('shi.themeMode','paper'); true`);
    await rpc(ws, 'Page.reload');
    await waitFor(ws, '.shi-tab', 30000);
    await ev(ws, `[...document.querySelectorAll('.shi-tab')][1]?.click(); true`);
    await waitFor(ws, '.shi-cat', 20000);
    await sleep(700);
    shots.push(await shot(ws, '03-encyclopedia'));

    // 分类列表
    await ev(ws, `document.querySelector('.shi-cat')?.click(); true`);
    await waitFor(ws, '.shi-enc-row', 20000);
    await sleep(500);
    shots.push(await shot(ws, '04-enc-list'));

    // 展开卡片
    await ev(ws, `document.querySelectorAll('.shi-enc-row')[1]?.click(); true`);
    await sleep(700);
    shots.push(await shot(ws, '05-enc-card'));

    // 我的（历史）
    await ev(ws, `[...document.querySelectorAll('.shi-tab')][2]?.click(); true`);
    await waitFor(ws, '.shi-hist-stats', 20000);
    await sleep(600);
    shots.push(await shot(ws, '06-history'));

    // 习字页
    await ev(ws, `[...document.querySelectorAll('.shi-tab')][0]?.click(); true`);
    await waitFor(ws, '.shi-dijiao', 20000);
    await ev(ws, `document.querySelector('.shi-btn--primary')?.click(); true`);
    await waitFor(ws, '.shi-tianzi-wrap', 20000);
    // 等笔顺 SVG 真的画出来（4.18MB 懒加载 + hanzi-writer 渲染）
    await waitFor(ws, '.shi-stroke-canvas svg', 30000);
    await sleep(2600);
    shots.push(await shot(ws, '07-study'));
    const strokeInfo = JSON.parse(await ev(ws, `(() => {
      const svg = document.querySelector('.shi-stroke-canvas svg');
      const paths = svg ? svg.querySelectorAll('path').length : 0;
      const hint = document.querySelector('.shi-stroke-hint')?.innerText ?? null;
      const row = document.querySelector('.shi-stroke-row')?.getBoundingClientRect();
      const ch = document.querySelector('.shi-choices')?.getBoundingClientRect();
      return JSON.stringify({ svg: !!svg, paths, hint,
        rowH: row?Math.round(row.height):null,
        gap: row&&ch?Math.round(ch.top-row.bottom):null });
    })()`));

    // 我的字
    await ev(ws, `document.querySelector('.shi-back')?.click(); true`);
    await waitFor(ws, '.shi-task', 20000);
    await ev(ws, `[...document.querySelectorAll('.shi-task')].find(b=>b.innerText.includes('我认得'))?.click(); true`);
    await waitFor(ws, '.shi-grid', 20000);
    await sleep(700);
    shots.push(await shot(ws, '08-mychars'));

    // 字详情抽屉
    await ev(ws, `document.querySelector('.shi-cell')?.click(); true`);
    await waitFor(ws, '.shi-sheet', 20000);
    await waitFor(ws, '.shi-sheet .shi-stroke-canvas svg', 25000);
    await sleep(2200);
    shots.push(await shot(ws, '09-char-sheet'));
    const sheetGeo = JSON.parse(await ev(ws, `(() => {
      const s=document.querySelector('.shi-sheet')?.getBoundingClientRect();
      const svg=!!document.querySelector('.shi-sheet .shi-stroke-canvas svg');
      return JSON.stringify({ sheetH: s?Math.round(s.height):null,
        bottom: s?Math.round(s.bottom):null, vh: innerHeight, strokeSvg: svg });
    })()`));
    await ev(ws, `document.querySelector('.shi-sheet-close')?.click(); true`);
    await sleep(500);

    // 体检：所有屏有没有溢出/裁切
    const audit = JSON.parse(await ev(ws, `(() => {
      const bad = [];
      document.querySelectorAll('.shi-cell, .shi-cat, .shi-task, .shi-hist-row').forEach((e) => {
        const b = e.getBoundingClientRect();
        if (b.right > innerWidth + 1 || b.left < -1) bad.push(e.className + ' 横向溢出');
        if (e.scrollWidth > e.clientWidth + 2) bad.push(e.className + ' 内容溢出');
      });
      return JSON.stringify({ overflow: bad.slice(0,8), bodyH: document.body.scrollHeight, vh: innerHeight });
    })()`));

    console.log(JSON.stringify({ shots, geo, strokeInfo, sheetGeo, audit, errors: errs.slice(0, 6) }, null, 1));
    ws.close();
  } catch (e) {
    console.error('✗', e.message);
    console.log(JSON.stringify({ shots, errors: errs }, null, 1));
    process.exitCode = 1;
  } finally {
    proc.kill();
    await sleep(200);
    try { (await import('node:fs')).rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
})();