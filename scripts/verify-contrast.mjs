/**
 * verify-contrast.mjs — 「靛墨」配色的 WCAG 对比度实测
 *
 * 这一版的分层规则（写进 DESIGN.md）：
 *   text   ≥ 7:1    正文与汉字
 *   muted  ≥ 4.5:1  所有 UI 小字
 *   faint  ≥ 3:1    只允许用在 ≥24px 的汉字和「答错」淡出态
 *   grid   ≥ 3:1    田字格外框是功能结构（教间架），必须看得见
 *   grid-soft ≥1.5  格内虚线十字：次级引导，且外框已达标
 *   action 一处强调，on-action ≥ 7:1（按钮字号大但老人阅读，按正文要求）
 */

const PAPER = {
  canvas: '#f1f4f7', surface: '#fafcfe', sunken: '#e2e7eb',
  text: '#171b20', muted: '#565b63', faint: '#81878f',
  rule: '#dadee3', grid: '#818893', gridSoft: '#b8bec7', border: '#dadee3',
  action: '#1a4373', onAction: '#f8fafd', focus: '#1a4373',
  success: '#2d6945', warn: '#8c5f0e', info: '#1a4373', gold: '#a26f17',
};
const INK = {
  canvas: '#0d141e', surface: '#19212c', sunken: '#070d14',
  text: '#f1eee6', muted: '#a4acb5', faint: '#737b85',
  rule: '#272e38', grid: '#606a77', gridSoft: '#404854', border: '#272e38',
  action: '#83b4f3', onAction: '#0d141e', focus: '#83b4f3',
  success: '#75c291', warn: '#e2ac5e', info: '#83b4f3', gold: '#edb25a',
};
const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

let fails = 0;
const check = (label, fg, bg, min) => {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(24)} ${r.toFixed(2)}  (≥${min})`);
};

for (const [name, P] of [['纸（昼）', PAPER], ['墨（夜）', INK]]) {
  console.log(`\n=== ${name} ===`);
  check('正文 text/canvas', P.text, P.canvas, 7);
  check('正文 text/surface', P.text, P.surface, 7);
  check('小字 muted/canvas', P.muted, P.canvas, 4.5);
  check('小字 muted/surface', P.muted, P.surface, 4.5);
  check('大字 faint/canvas', P.faint, P.canvas, 3);
  check('按钮 on-action/action', P.onAction, P.action, 7);
  check('强调 action/canvas', P.action, P.canvas, 4.5);
  check('成功 success/canvas', P.success, P.canvas, 4.5);
  check('格框 grid/canvas', P.grid, P.canvas, 3);
  check('格内虚线 gridSoft/canvas', P.gridSoft, P.canvas, 1.5);
  check('焦点 focus/canvas', P.focus, P.canvas, 3);
  check('赭金 gold/canvas', P.gold, P.canvas, 3);
}

console.log(`\n${fails === 0 ? '✓ 全部达标' : `✗ ${fails} 项未达标`}`);

/* --------------------------------------------------------------------------
 * 令牌漂移检查：原生层（MainActivity / colors.xml）写死的画布色必须等于 CSS 令牌。
 * 这类错误肉眼看不出、界面又确实坏 —— 实测踩过：CSS 画布改成 #faf7f0 后，
 * 原生仍写 0xFFF5EFE1，深色界面上就顶一条浅色横条。
 * ----------------------------------------------------------------------- */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = readFileSync(join(ROOT, 'packages/ui/src/tokens.css'), 'utf8');
const grab = (re) => (tokens.match(re) ?? [])[1]?.toLowerCase();
const cssPaper = grab(/\[data-theme='paper'\][\s\S]*?--shi-color-canvas:\s*(#[0-9a-f]{6})/i)
  ?? grab(/:root,\s*\[data-theme='paper'\][\s\S]*?--shi-color-canvas:\s*(#[0-9a-f]{6})/i);
const cssInk = grab(/\[data-theme='ink'\][\s\S]*?--shi-color-canvas:\s*(#[0-9a-f]{6})/i);

let drift = 0;
const want = (hex) => '0xFF' + hex.slice(1).toUpperCase();
const files = [
  ['apps/learner/android/app/src/main/java/cn/shizi/learner/MainActivity.java', [
    ['CANVAS_PAPER', cssPaper], ['CANVAS_INK', cssInk],
  ]],
  ['apps/monitor/android/app/src/main/java/cn/shizi/monitor/MainActivity.java', [
    ['CANVAS_PAPER', cssPaper],
  ]],
];
for (const [rel, pairs] of files) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8');
  for (const [name, cssHex] of pairs) {
    const m = src.match(new RegExp(`${name}\\s*=\\s*(0xFF[0-9A-Fa-f]{6})`));
    if (!m || !cssHex) { console.log(`  ? ${rel} ${name} 未找到`); continue; }
    const ok = m[1].toLowerCase() === want(cssHex).toLowerCase();
    if (!ok) { drift++; console.log(`  ✗ ${name} 漂移：原生 ${m[1]} ≠ CSS 画布 ${cssHex}`); }
    else console.log(`  ✓ ${rel.split('/').pop()} ${name} = ${cssHex}`);
  }
}
// colors.xml 首帧底色
for (const rel of [
  'apps/learner/android/app/src/main/res/values/colors.xml',
  'apps/monitor/android/app/src/main/res/values/colors.xml',
]) {
  const p = join(ROOT, rel);
  if (!existsSync(p) || !cssPaper) continue;
  const m = readFileSync(p, 'utf8').match(/name="shi_window_bg">#(\w{8})</);
  if (m) {
    const ok = '#' + m[1].slice(2).toLowerCase() === cssPaper;
    if (!ok) drift++;
    console.log(`  ${ok ? '✓' : '✗'} ${rel.split('/').slice(-3).join('/')} 首帧底色 ${m[1]}${ok ? '' : ` ≠ ${cssPaper}`}`);
  }
}

if (drift) {
  console.error(`\n✗ 令牌漂移 ${drift} 处 —— 改 CSS 画布色时必须同步原生层`);
  process.exit(1);
}
process.exit(fails === 0 ? 0 : 1);
