/**
 * density.mjs — 「简洁度 / 呼吸感」量化
 *
 * 用户的反馈是主观词（简洁、留白、呼吸感），必须换成能对比的数字，
 * 否则「改简洁」只会变成越改越花。四个指标：
 *
 *   air      视口内没有任何内容的横向比例（留白比例，越大越透气）
 *   boxes    有可见边框或非透明底色的容器数（盒子数量，越少越干净）
 *   accents  强调色像素占比（红越少越克制）
 *   texts    屏上文字块数（信息量，越少越聚焦）
 *   gaps     相邻内容块之间的中位间距（越大越有呼吸）
 *
 * 用法：node design/tools/density.mjs [url] [--out file.json]
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
const port = 9450 + Math.floor(Math.random() * 90);
const profile = join(process.env.TEMP ?? '.', `shi-den-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=393,851', '--force-device-scale-factor=2', 'about:blank',
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

/** 强调色：朱砂（纸 #9a2820 / 墨 #ef8a76 一带）*/
const MEASURE = `(() => {
  const vh = innerHeight, vw = innerWidth;
  // 强调色直接读令牌，不写死色相 —— 换配色后指标才不会失真
  // （原先按红橙系判，换成靛青后恒为 0，等于指标失效）
  const css = getComputedStyle(document.documentElement);
  // 令牌值是 hex（#1a4373），计算样式是 rgb() —— 两种都要能解析。
  // 用 \\d+ 抓 hex 会抓成 ["1","4373"]，指标就恒为 0（踩过）。
  const parse = (v) => {
    const s = String(v).trim();
    if (s.startsWith('#')) {
      const h = s.slice(1);
      const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      if (f.length < 6) return null;
      return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
    }
    const m = s.match(/[\\d.]+/g);
    return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null;
  };
  const accents = ['--shi-color-action','--shi-color-grid-active','--shi-color-gold']
    .map((k) => parse(css.getPropertyValue(k))).filter(Boolean);
  const near = (a, b) => a && b && Math.abs(a[0]-b[0])<14 && Math.abs(a[1]-b[1])<14 && Math.abs(a[2]-b[2])<14;
  const isAccent = (v) => { const c = parse(v); return c ? accents.some((a) => near(a, c)) : false; };

  // 1) 留白：按 4px 采样，标记有内容的行
  const occupied = new Uint8Array(Math.ceil(vh / 4));
  const boxes = [];
  const texts = [];
  document.querySelectorAll('*').forEach((e) => {
    const b = e.getBoundingClientRect();
    if (b.width < 4 || b.height < 2 || b.bottom < 0 || b.top > vh) return;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.opacity === '0') return;
    const text = (e.childElementCount === 0 ? (e.textContent || '') : '').trim();
    const paintedBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && !/rgba\\(0, 0, 0, 0\\)/.test(cs.backgroundColor);
    const bgIsCanvas = paintedBg && cs.backgroundColor === getComputedStyle(document.body).backgroundColor;
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) > 0
      && cs['border' + s + 'Style'] !== 'none' && cs['border' + s + 'Color'] !== 'rgba(0, 0, 0, 0)');
    const svg = !!e.closest('svg');
    if (text) texts.push({ top: b.top, bottom: b.bottom });
    // 盒子：有底色（且不等于画布色）或有可见边框的容器
    if ((paintedBg && !bgIsCanvas) || hasBorder) boxes.push({ sel: (e.className || e.tagName).toString().slice(0, 34), text: text.slice(0, 12) });
    // 有东西就占用这些行
    const counts = !!text || svg || (paintedBg && !bgIsCanvas) || hasBorder;
    if (counts) {
      for (let i = Math.floor(Math.max(0, b.top) / 4); i <= Math.floor(Math.min(vh, b.bottom) / 4); i++) occupied[i] = 1;
    }
  });
  const rows = occupied.length;
  let filled = 0;
  for (let i = 0; i < rows; i++) if (occupied[i]) filled++;

  // 2) 块间距：按内容顶边排序，取相邻块的中位间隔
  const tops = [...texts.map((t) => t.top), ...boxes.map(() => 0)].filter((v) => v > 0).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < tops.length; i++) { const g = tops[i] - tops[i - 1]; if (g > 3) gaps.push(g); }
  gaps.sort((a, b) => a - b);

  // 3) 强调色像素占比：从画布取样（用 canvas 读不了网页，改用元素颜色统计 + 截图侧另算）
  const accentEls = [];
  document.querySelectorAll('*').forEach((e) => {
    const cs = getComputedStyle(e);
    if (isAccent(cs.color) || isAccent(cs.backgroundColor) || isAccent(cs.borderTopColor)) accentEls.push((e.className || e.tagName).toString().slice(0, 24));
  });

  return JSON.stringify({
    air: +(((rows - filled) / rows) * 100).toFixed(1),
    boxes: boxes.length,
    boxNames: [...new Set(boxes.map((b) => b.sel))].slice(0, 14),
    texts: texts.length,
    gapMedian: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : 0,
    gapP90: gaps.length ? Math.round(gaps[Math.floor(gaps.length * 0.9)]) : 0,
    accentEls: accentEls.length,
    accentUnique: [...new Set(accentEls)].slice(0, 12),
  });
})()`;

const SEED = `(() => {
  const chars='一二三四五十百万人口手目头足心儿女日月水火山石田土大小上下中左右前后天地风雨云电门窗床桌椅米面油菜茶盐糖'.split('');
  const st={deviceId:'a',learnedCount:100,newPerDay:20,reviews:{},tasks:{},sessions:[],accuracyHistory:[],mathDone:[1,2,3,4,5,6,7,8,9,10],scienceDone:[],familyMessage:null};
  chars.forEach((c,i)=>st.reviews[c]={char:c,stage:i<24?4:2,dueAt:i<24?Date.now()+3e10:Date.now()-1e6,lastResult:'correct',streak:2,sessions:['s'],updatedAt:Date.now()});
  localStorage.setItem('shi.state.v1',JSON.stringify(st));
  localStorage.setItem('shi.placement.v1',JSON.stringify({phase:'done',mathStart:11,result:{knownChars:[],answers:[],estimatedKnown:260,takenAt:Date.now()}}));
  localStorage.setItem('shi.themeMode','paper');
  localStorage.setItem('shi.encViewed.v1',JSON.stringify(['e1','e2','e3']));
  return true;
})()`;

(async () => {
  const res = {};
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
    await ev(ws, SEED);
    await rpc(ws, 'Page.reload');
    await waitFor(ws, '.shi-tab', 40000);
    await sleep(1200);

    res['习字首页'] = JSON.parse(await ev(ws, MEASURE));

    await ev(ws, `[...document.querySelectorAll('.shi-tab')][1]?.click(); true`);
    await waitFor(ws, '.shi-cat, .shi-cat-row', 20000);
    await sleep(400);
    res['百科目录'] = JSON.parse(await ev(ws, MEASURE));

    await ev(ws, `[...document.querySelectorAll('.shi-tab')][2]?.click(); true`);
    await waitFor(ws, '.shi-app', 20000);
    await sleep(400);
    res['我的'] = JSON.parse(await ev(ws, MEASURE));

    await ev(ws, `[...document.querySelectorAll('.shi-tab')][0]?.click(); true`);
    await waitFor(ws, '.shi-dijiao', 20000);
    await ev(ws, `document.querySelector('.shi-btn--primary')?.click(); true`);
    await waitFor(ws, '.shi-tianzi-wrap', 25000);
    await sleep(1500);
    res['习字页'] = JSON.parse(await ev(ws, MEASURE));

    const sum = Object.entries(res).map(([k, v]) => ({
      屏: k, 留白: v.air + '%', 盒子: v.boxes, 文字块: v.texts,
      中位间距: v.gapMedian + 'px', 强调色元素: v.accentEls,
    }));
    const agg = {
      screens: res,
      avg: {
        air: +(sum.length ? (Object.values(res).reduce((a, v) => a + v.air, 0) / Object.values(res).length).toFixed(1) : 0),
        boxes: Math.round(Object.values(res).reduce((a, v) => a + v.boxes, 0) / Object.values(res).length),
        texts: Math.round(Object.values(res).reduce((a, v) => a + v.texts, 0) / Object.values(res).length),
        gapMedian: Math.round(Object.values(res).reduce((a, v) => a + v.gapMedian, 0) / Object.values(res).length),
        accentEls: Math.round(Object.values(res).reduce((a, v) => a + v.accentEls, 0) / Object.values(res).length),
      },
      table: sum,
    };
    console.log(JSON.stringify(agg, null, 1));
    ws.close();
  } catch (e) {
    console.error('✗', e.message, JSON.stringify(res, null, 1));
    process.exitCode = 1;
  } finally {
    proc.kill();
    await sleep(200);
    try { (await import('node:fs')).rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* */ }
  }
})();