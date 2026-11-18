/**
 * flow-full.mjs — 全链路测试：摸底 → 跳级 → 三 Tab → 百科 → 历史
 *
 * 这是本轮改动的验收：功能区重构 + 摸底定级 + 百科 + 历史记录。
 * 全部走真实浏览器（CDP），断言行为而非样式。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const port = 9150 + Math.floor(Math.random() * 80);
const profile = join(process.env.TEMP ?? '.', `shi-full-${Date.now()}`);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + port,
  '--window-size=393,851', '--autoplay-policy=no-user-gesture-required', 'about:blank',
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

/** 等选择器出现（最多 timeoutMs），替代固定 sleep——摸底流程对服务器速度敏感 */
async function waitFor(ws, selector, timeoutMs = 15000, poll = 400) {
  const t0 = Date.now();
  for (;;) {
    const ok = await ev(ws, `!!document.querySelector(${JSON.stringify(selector)})`);
    if (ok) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(poll);
  }
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
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    ws.addEventListener('message', (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails?.exception?.description?.split('\n')[0]);
    });

    await rpc(ws, 'Page.enable');
    await rpc(ws, 'Runtime.enable');
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 393, height: 851, deviceScaleFactor: 1, mobile: true });
    await rpc(ws, 'Page.navigate', { url });
    await waitFor(ws, '.shi-place-note, .shi-head h1, .shi-tab', 60000);

    // 清空 → 首启应进摸底
    await ev(ws, `localStorage.clear(); true`);
    await rpc(ws, 'Page.reload');
    // 必须等到第一道题真的出现：只等 .shi-place-note 会在 Vite 冷启动时抢跑，
    // 后续点击全部落空，得到「假失败」（实测踩过两次）
    const ready = await waitFor(ws, '.shi-choice', 90000);
    steps.push({ s: '第一道题出现', ready });
    // 摸底第一题的两个选项：这里原先是「拼音 / 不是这个」，等于送答案。
    // 轮询到真的拿到两条非空文案为止（React 重渲染会让单次取值落空）。
    let placementChoices = [];
    for (let i = 0; i < 40; i++) {
      placementChoices = JSON.parse(await ev(ws, `JSON.stringify(
        [...document.querySelectorAll('.shi-choice')].map(b => b.innerText.trim()).filter(Boolean)
      )`));
      if (placementChoices.length === 2) break;
      await sleep(300);
    }
    steps.push({ s: '摸底选项', texts: placementChoices });

    steps.push({ s: '首启', got: await ev(ws, `document.querySelector('.shi-topbar-title')?.innerText ?? document.body.innerText.slice(0,60)`) });

    // ---- 摸底：前 60 题选「正确拼音」侧；之后选「不是这个」（=不会）
    for (let i = 0; i < 125; i++) {
      const inChar = await ev(ws, `!!document.querySelector('.shi-choice')`);
      if (!inChar) break;
      await ev(ws, `(() => {
        const btns = [...document.querySelectorAll('.shi-choice')];
        const py = btns.find(b => b.innerText !== '不是这个');
        (py ?? btns[0])?.click();
        return true;
      })()`);
      await sleep(1150);
    }
    for (let i = 0; i < 125; i++) {
      const inChar = await ev(ws, `!!document.querySelector('.shi-choice')`);
      if (!inChar) break;
      await ev(ws, `(() => {
        const btns = [...document.querySelectorAll('.shi-choice')];
        btns[1]?.click(); return true;
      })()`);
      await sleep(1050);
    }

    steps.push({ s: '识字摸底后', got: await ev(ws, `document.querySelector('.shi-topbar-title')?.innerText ?? '进入数学?'`) });

    // ---- 数学摸底：选第一个选项
    await waitFor(ws, '.shi-math-opt', 20000);
    for (let i = 0; i < 6; i++) {
      const inMath = await ev(ws, `!!document.querySelector('.shi-math-opt')`);
      if (!inMath) break;
      await ev(ws, `document.querySelector('.shi-math-opt')?.click(); true`);
      await sleep(1400);
    }
    // 等 TabBar 出现 = 摸底完成进主框架
    await waitFor(ws, '.shi-tab', 30000);

    // ---- 摸底完成后应在首页（今天 Tab）
    // 兜底：万一还有题没答完（服务器慢），继续答到 TabBar 出现为止
    for (let i = 0; i < 260; i++) {
      if (await ev(ws, `!!document.querySelector('.shi-tab')`)) break;
      if (await ev(ws, `!!document.querySelector('.shi-choice')`)) {
        await ev(ws, `(() => { const b=[...document.querySelectorAll('.shi-choice')]; (b.find(x=>x.innerText!=='不是这个')??b[0])?.click(); return true; })()`);
        await sleep(1050);
      } else if (await ev(ws, `!!document.querySelector('.shi-math-opt')`)) {
        await ev(ws, `document.querySelector('.shi-math-opt')?.click(); true`);
        await sleep(1300);
      } else {
        await sleep(500);
      }
    }
    steps.push({ s: '摸底完成→首页', got: await ev(ws, `document.querySelector('.shi-lesson-title')?.innerText ?? document.body.innerText.slice(0,40)`) });
    const dbg1 = JSON.parse(await ev(ws, `JSON.stringify(window.__shi ?? {})`));
    steps.push({ s: '摸底数据', knownCount: dbg1.knownCount, effectiveDays: dbg1.effectiveDays, newCharsTodaySample: dbg1.newCharsTodaySample });

    // ---- 百科 Tab
    await ev(ws, `[...document.querySelectorAll('.shi-tab')][1]?.click(); true`);
    await waitFor(ws, '.shi-cat', 20000);
    steps.push({ s: '百科Tab', title: await ev(ws, `document.querySelector('.shi-topbar-title')?.innerText`), cats: await ev(ws, `document.querySelectorAll('.shi-cat').length`) });
    // 点开第一个分类
    await ev(ws, `document.querySelector('.shi-cat')?.click(); true`);
    await sleep(1000);
    steps.push({ s: '分类列表', title: await ev(ws, `document.querySelector('.shi-topbar-title')?.innerText`), rows: await ev(ws, `document.querySelectorAll('.shi-enc-row').length`) });
    // 展开第一条
    await ev(ws, `document.querySelector('.shi-enc-row')?.click(); true`);
    await sleep(800);
    steps.push({ s: '卡片展开', body: await ev(ws, `document.querySelector('.shi-enc-text')?.innerText?.slice(0,30) ?? null`) });

    // ---- 我的 Tab（历史记录）
    await ev(ws, `[...document.querySelectorAll('.shi-tab')][2]?.click(); true`);
    await sleep(1000);
    steps.push({ s: '我的Tab', title: await ev(ws, `document.querySelector('.shi-topbar-title')?.innerText`), stats: await ev(ws, `[...document.querySelectorAll('.shi-stat-v')].map(e=>e.innerText)`) });

    // ---- 回今天 Tab，学一个字验证字序从摸底后继续
    await ev(ws, `[...document.querySelectorAll('.shi-tab')][0]?.click(); true`);
    await sleep(800);
    steps.push({ s: '回今天', h1: await ev(ws, `document.querySelector('.shi-head h1')?.innerText`) });
    await ev(ws, `[...document.querySelectorAll('button')].find(b=>b.innerText.includes('接着学'))?.click(); true`);
    await sleep(1500);
    steps.push({ s: '学字页', hanzi: await ev(ws, `document.querySelector('.shi-tianzi-char')?.innerText ?? null`) });

    const dbg2 = JSON.parse(await ev(ws, `JSON.stringify(window.__shi ?? {})`));

    // ---- 断言
    // 选项文案体检：错误项绝不能是「不是这个」「？」这类把答案送出去的提示。
    // 必须在习字页刚加载时取，否则可能已经跳走。
    await waitFor(ws, '.shi-choice', 20000);
    const choiceTexts = JSON.parse(await ev(ws, `JSON.stringify(
      [...document.querySelectorAll('.shi-choice')].map(b => b.innerText.trim())
    )`));
    const giveaway = [...choiceTexts, ...placementChoices].filter(
      (t) => t === '不是这个' || t === '？' || t === '',
    );

    const checks = {
      placementShown: steps.some((x) => x.s === '第一道题出现' && x.ready),
      mathPhaseReached: steps.some((x) => x.s === '摸底完成→首页'),
      // 摸底不再能靠「挑那个像答案的选项」拿满分：
      // 修掉「不是这个」之后，脚本随机点只能猜对约一半（实测 54/120）。
      // 原先断言 >=100 其实是在断言那个送答案的缺陷。
      knownApplied: dbg2.knownCount >= 20 && dbg2.knownCount <= 100,
      // 字序必须真的被摸底缩短。上限从数据取，不写死 ——
      // 字表从 1800/90 天扩到 3500/175 天后，写死 90 的断言会误报。
      effectiveReduced: dbg2.effectiveDays !== null && dbg2.effectiveDays < (dbg2.totalDays ?? 175),
      encTabWorks: steps.find((x) => x.s === '百科Tab')?.cats >= 9,
      encListWorks: (steps.find((x) => x.s === '分类列表')?.rows ?? 0) >= 5,
      encCardOpens: Boolean(steps.find((x) => x.s === '卡片展开')?.body),
      historyWorks: steps.find((x) => x.s === '我的Tab')?.title === '学习记录',
      studyFlowOk: Boolean(steps.find((x) => x.s === '学字页')?.hanzi),
      noGiveawayChoices: giveaway.length === 0 && placementChoices.length === 2,
      noRuntimeErrors: errs.length === 0,
    };

    const pass = Object.values(checks).every(Boolean);
    console.log(JSON.stringify({ steps, checks, choiceTexts, giveaway, errors: errs.slice(0, 5), final: dbg2, verdict: pass ? 'PASS 全链路' : 'FAIL' }, null, 1));
    if (!pass) process.exitCode = 1;
    ws.close();
  } catch (e) {
    console.error('✗', e.message);
    console.log(JSON.stringify({ steps, errors: errs }, null, 1));
    process.exitCode = 1;
  } finally {
    proc.kill();
    await sleep(150);
    try { (await import('node:fs')).rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
})();