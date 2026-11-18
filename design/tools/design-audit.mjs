/**
 * design-audit.mjs — 界面几何体检（不需要人眼也能抓出「看起来难受」的问题）
 *
 * 检四件事，都是用户明确抱怨过的类型：
 *  1 空洞：连续 >110 CSS px 没有任何内容的横向带（「大片空白」）
 *  2 溢出/裁切：文字 scrollWidth 超出容器、元素越出视口
 *  3 点不大：可点元素短边 < 52 CSS px（适老化底线，次级控件也不许更小）
 *  4 撞车：可点元素互相重叠（误触来源）
 *
 * 用法：node design/tools/design-audit.mjs [url]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
const port = 9400 + Math.floor(Math.random() * 90);
const profile = join(process.env.TEMP ?? '.', `shi-audit-${Date.now()}`);
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
async function waitFor(ws, sel, timeout = 40000) {
  const t0 = Date.now();
  for (;;) {
    if (await ev(ws, `!!document.querySelector(${JSON.stringify(sel)})`)) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(300);
  }
}

/** 页面内执行的体检脚本：返回问题清单 */
const AUDIT = `(() => {
  const vh = innerHeight, vw = innerWidth;
  const out = { holes: [], overflow: [], small: [], overlap: [], scroll: null };

  /** 元素是否在可滚动祖先里（那种类里超出视口是正常的，不算溢出） */
  const inScroller = (e) => {
    for (let p = e.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll') return true;
    }
    return false;
  };

  // 1) 空洞：按 4px 一行采样，找连续无内容的横向带
  const marks = [];
  document.querySelectorAll('h1,h2,p,button,span,div,i,svg,img').forEach((e) => {
    const b = e.getBoundingClientRect();
    if (b.width < 6 || b.height < 2) return;
    if (getComputedStyle(e).visibility === 'hidden') return;
    // 只有真的画了东西的才算：有文字，或有背景色/边框
    const cs = getComputedStyle(e);
    const hasText = (e.innerText || '').trim().length > 0 && e.children.length === 0;
    const hasPaint = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none'
      || parseFloat(cs.borderTopWidth) > 0 || cs.borderBottomWidth !== '0px'
      || !!e.closest('svg');
    if (!hasText && !hasPaint) return;
    marks.push([Math.max(0, b.top), Math.min(vh, b.bottom)]);
  });
  marks.sort((a, b) => a[0] - b[0]);
  let y = 0, runStart = 0;
  const occupied = new Uint8Array(Math.ceil(vh / 4));
  marks.forEach(([t, b]) => {
    for (let i = Math.floor(t / 4); i <= Math.floor(Math.min(b, vh) / 4); i++) occupied[i] = 1;
  });
  let run = 0;
  for (let i = 0; i < occupied.length; i++) {
    if (!occupied[i]) { run++; if (run === 1) runStart = i * 4; }
    else { if (run * 4 >= 110) out.holes.push({ from: runStart, to: i * 4, px: run * 4 }); run = 0; }
  }
  if (run * 4 >= 110) out.holes.push({ from: runStart, to: vh, px: run * 4 });

  // 2) 溢出 / 越界
  document.querySelectorAll('*').forEach((e) => {
    const b = e.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return;
    // 滚动容器里的内容本来就允许超出视口
    if (!inScroller(e) && (b.right > vw + 1.5 || b.left < -1.5 || b.bottom > vh + 1.5)) {
      out.overflow.push({ sel: e.className || e.tagName, right: Math.round(b.right), bottom: Math.round(b.bottom) });
    } else if (e.scrollHeight > e.clientHeight + 3 && getComputedStyle(e).overflowY === 'hidden'
               && (e.innerText || '').trim()
               /* 田字格是刻意 overflow:hidden：米字格的对角线按 -22% 外扩画再裁成方形，
                  这几像素是设计不是缺陷，别报出来 */
               && !/shi-tianzi/.test(e.className || '')) {
      out.overflow.push({ sel: e.className || e.tagName, clipped: e.scrollHeight - e.clientHeight });
    }
  });

  // 3) 触控热区
  document.querySelectorAll('button, a, [role=button]').forEach((e) => {
    const b = e.getBoundingClientRect();
    if (b.width < 2) return;
    if (Math.min(b.width, b.height) < 52) {
      out.small.push({ text: (e.innerText || e.getAttribute('aria-label') || '').slice(0, 16), w: Math.round(b.width), h: Math.round(b.height) });
    }
  });

  // 4) 可点元素重叠
  // 底部 TabBar / 抽屉遮罩本来就该浮在滚动内容之上，这种「重叠」是设计，不算问题
  const isBar = (e) => !!e.closest('.shi-tabbar, .shi-sheet-mask');
  const hits = [...document.querySelectorAll('button, a')].map((e) => {
    const b = e.getBoundingClientRect();
    return { e, b, t: (e.innerText || '').slice(0, 12), bar: isBar(e) };
  }).filter((x) => x.b.width > 10);
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      if (hits[i].bar !== hits[j].bar) continue;
      const a = hits[i].b, c = hits[j].b;
      const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
      const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (ox > 6 && oy > 6) out.overlap.push({ a: hits[i].t, b: hits[j].t, ox: Math.round(ox), oy: Math.round(oy) });
    }
  }
  out.scroll = { bodyH: document.body.scrollHeight, vh };
  return JSON.stringify(out);
})()`;

const NAME = {
  today: '.shi-lesson-title',
  encyclopedia: '.shi-cat',
  mine: '.shi-hist-stats',
};

(async () => {
  const report = {};
  try {
    let wsUrl;
    for (let i = 0; i < 90; i++) {
      try {
        const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const p = l.find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
      } catch { /* */ }
      await sleep(250);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 393, height: 851, deviceScaleFactor: 2, mobile: true });
    await rpc(ws, 'Page.navigate', { url });
    await waitFor(ws, '.shi-place-note, .shi-tab', 60000);

    // 播种：已摸底 + 学过几天，界面才有内容可审
    await ev(ws, `(() => {
      const chars='一二三四五十百万人口手目头足心儿女日月水火山石田土大小上下中左右前后天地风雨云电门窗床桌椅米面油菜茶盐糖'.split('');
      const st={deviceId:'a',learnedCount:100,newPerDay:20,reviews:{},tasks:{},sessions:[],accuracyHistory:[],mathDone:[1,2,3,4,5,6,7,8,9,10],scienceDone:[],familyMessage:null};
      chars.forEach((c,i)=>st.reviews[c]={char:c,stage:i<24?4:2,dueAt:i<24?Date.now()+3e10:Date.now()-1e6,lastResult:'correct',streak:2,sessions:['s'],updatedAt:Date.now()});
      localStorage.setItem('shi.state.v1',JSON.stringify(st));
      localStorage.setItem('shi.placement.v1',JSON.stringify({phase:'done',mathStart:11,result:{knownChars:[],answers:[],estimatedKnown:260,takenAt:Date.now()}}));
      localStorage.setItem('shi.themeMode','paper');
      localStorage.setItem('shi.encViewed.v1',JSON.stringify(['e1','e2','e3']));
      return true;
    })()`);
    await rpc(ws, 'Page.reload');
    await waitFor(ws, '.shi-tab', 40000);
    await sleep(1200);

    report['习字首页'] = JSON.parse(await ev(ws, AUDIT));

    await ev(ws, `[...document.querySelectorAll('.shi-tab')][1]?.click(); true`);
    await waitFor(ws, '.shi-cat', 20000);
    await sleep(500);
    report['百科目录'] = JSON.parse(await ev(ws, AUDIT));

    await ev(ws, `document.querySelector('.shi-cat')?.click(); true`);
    await waitFor(ws, '.shi-enc-row', 20000);
    await ev(ws, `document.querySelector('.shi-enc-row')?.click(); true`);
    await sleep(600);
    report['百科条目'] = JSON.parse(await ev(ws, AUDIT));

    await ev(ws, `[...document.querySelectorAll('.shi-tab')][2]?.click(); true`);
    await waitFor(ws, '.shi-hist-stats', 20000);
    await sleep(500);
    report['学习记录'] = JSON.parse(await ev(ws, AUDIT));

    await ev(ws, `document.querySelector('.shi-cell')?.click(); true`);
    await waitFor(ws, '.shi-grid', 20000);
    await sleep(400);
    await ev(ws, `document.querySelector('.shi-cell')?.click(); true`);
    await waitFor(ws, '.shi-sheet', 20000);
    await sleep(1500);
    report['我的字+抽屉'] = JSON.parse(await ev(ws, AUDIT));

    await ev(ws, `[...document.querySelectorAll('.shi-tab')][0]?.click(); true`);
    await waitFor(ws, '.shi-dijiao', 20000);
    await ev(ws, `document.querySelector('.shi-btn--primary')?.click(); true`);
    await waitFor(ws, '.shi-stroke-row', 25000);
    await sleep(2000);
    report['习字页'] = JSON.parse(await ev(ws, AUDIT));

    // 汇总
    const bad = [];
    for (const [k, v] of Object.entries(report)) {
      if (v.holes.length) bad.push(`${k}: 空洞 ${v.holes.map((h) => `${h.from}-${h.to}(${h.px}px)`).join(' ')}`);
      if (v.overflow.length) bad.push(`${k}: 溢出 ${v.overflow.slice(0, 3).map((o) => `${o.sel}${o.clipped ? `裁${o.clipped}px` : ''}`).join(' | ')}`);
      if (v.small.length) bad.push(`${k}: 小热区 ${v.small.slice(0, 4).map((s) => `${s.text || '?'} ${s.w}x${s.h}`).join(' | ')}`);
      if (v.overlap.length) bad.push(`${k}: 重叠 ${v.overlap.slice(0, 3).map((o) => `${o.a}×${o.b}`).join(' | ')}`);
      if (v.scroll && v.scroll.bodyH > v.scroll.vh + 2) bad.push(`${k}: 内容超视口 ${v.scroll.bodyH}>${v.scroll.vh}`);
    }
    console.log(JSON.stringify({ verdict: bad.length ? '需修' : 'PASS 几何体检', problems: bad, report }, null, 1));
    if (bad.length) process.exitCode = 1;
    ws.close();
  } catch (e) {
    console.error('✗', e.message);
    console.log(JSON.stringify(report, null, 1));
    process.exitCode = 1;
  } finally {
    proc.kill();
    await sleep(200);
    try { (await import('node:fs')).rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* */ }
  }
})();