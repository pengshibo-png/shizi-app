/**
 * derive-palette.mjs — 按 huashu-design「色彩推导协议」推导并论证配色
 *
 * 三步法：采样 → 收敛（oklch）→ 论证
 *
 * 采样（文化语境，不是凭空发明）：
 *   靛青 / 琉璃绀 —— 蓝染与青花瓷的颜色。深、偏紫灰，skill 的文化语境表明确把它
 *     与「科技蓝 #0066FF（SaaS/效率）」区分开：前者手工/沉静，后者是模型默认抽签。
 *     识字 App 写的是墨、染的是布，靛与墨同属传统书写/织染材料，天然带「为什么」。
 *   松烟墨 —— 比油烟墨更冷（带蓝底），所以正文用冷近黑而不是暖褐黑。
 *   宣纸 —— 中性象牙白，不是奶油黄。上一版 #faf7f0 属「暖奶油底 + 陶土点缀」，
 *     正是 skill 点名的 AI 默认家族，这是「不够高级」的根因。
 *   石绿 / 赭金 —— 矿物颜料，只做语义色与极小面积点睛。
 *
 * 收敛：3 个有彩色（靛 / 石绿 / 赭金）+ 1 组中性明度序列；
 *   有彩色之间 oklch 色相角差 ≥60°；chroma 按「印刷色质感」表压到油墨区间。
 */

// ---------- sRGB ↔ oklch ----------
const srgbToLin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const linToSrgb = (c) => {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};
function hexToOklch(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLin((n >> 16) & 255), g = srgbToLin((n >> 8) & 255), b = srgbToLin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L: +L.toFixed(3), C: +C.toFixed(3), H: +H.toFixed(1) };
}
function oklchToHex(L, C, H) {
  const h = (H * Math.PI) / 180;
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const to = (v) => linToSrgb(v).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgbToLin((n >> 16) & 255) + 0.7152 * srgbToLin((n >> 8) & 255) + 0.0722 * srgbToLin(n & 255);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// ---------- 推导 ----------
// 中性明度序列（冷调，chroma 0.004–0.010，落在「大面积底色 0.01–0.04」的下沿：纸感）
const NEUTRAL_H = 250;           // 冷灰偏蓝，与靛同族，不是暖褐
const neutral = (L, C = 0.006) => oklchToHex(L, C, NEUTRAL_H);

// 有彩色：靛（主）/ 石绿（成功）/ 赭金（点睛）
// chroma 按印刷质感表：主色 0.08–0.15（油墨感），点睛 0.15–0.22 仅限小面积
const INDIGO_H = 255;            // 琉璃绀：偏紫灰的深蓝
const GREEN_H = 155;             // 石绿：偏青的矿物绿
const GOLD_H = 75;               // 赭金：带棕灰，不是警示黄

const PAPER = {
  canvas: neutral(0.965, 0.005),
  surface: neutral(0.99, 0.003),
  sunken: neutral(0.925, 0.008),
  text: oklchToHex(0.22, 0.012, INDIGO_H),      // 松烟墨：冷近黑
  muted: oklchToHex(0.47, 0.014, INDIGO_H),
  faint: oklchToHex(0.62, 0.014, INDIGO_H),
  rule: neutral(0.90, 0.008),
  grid: oklchToHex(0.625, 0.018, INDIGO_H),     // 田字格：中性冷灰，功能结构（≥3:1）
  gridSoft: oklchToHex(0.80, 0.014, INDIGO_H),
  action: oklchToHex(0.38, 0.095, INDIGO_H),    // 靛青主色：油墨区间
  onAction: neutral(0.985, 0.004),
  success: oklchToHex(0.47, 0.085, GREEN_H),
  warn: oklchToHex(0.52, 0.105, GOLD_H),
  danger: oklchToHex(0.45, 0.135, 25),
  info: oklchToHex(0.38, 0.095, INDIGO_H),
  gold: oklchToHex(0.58, 0.115, GOLD_H),        // 连续天数：极小面积
};
const INK = {
  canvas: oklchToHex(0.19, 0.022, INDIGO_H),    // 夜：靛黑，不是纯黑也不是暖褐
  surface: oklchToHex(0.245, 0.024, INDIGO_H),
  sunken: oklchToHex(0.155, 0.018, INDIGO_H),
  text: oklchToHex(0.95, 0.012, 90),
  muted: oklchToHex(0.74, 0.016, INDIGO_H),
  faint: oklchToHex(0.58, 0.018, INDIGO_H),
  rule: oklchToHex(0.30, 0.020, INDIGO_H),
  grid: oklchToHex(0.52, 0.024, INDIGO_H),
  gridSoft: oklchToHex(0.40, 0.022, INDIGO_H),
  action: oklchToHex(0.76, 0.105, INDIGO_H),    // 夜里的靛要提亮才够对比
  onAction: oklchToHex(0.19, 0.022, INDIGO_H),
  success: oklchToHex(0.75, 0.105, GREEN_H),
  warn: oklchToHex(0.78, 0.115, GOLD_H),
  danger: oklchToHex(0.72, 0.135, 25),
  info: oklchToHex(0.76, 0.105, INDIGO_H),
  gold: oklchToHex(0.80, 0.125, GOLD_H),
};

// ---------- 输出 + 校验 ----------
const show = (name, T) => {
  console.log(`\n=== ${name} ===`);
  for (const [k, v] of Object.entries(T)) {
    const o = hexToOklch(v);
    console.log(`  ${k.padEnd(10)} ${v}  oklch(${o.L} ${o.C} ${o.H})`);
  }
};
show('纸（昼）', PAPER);
show('墨（夜）', INK);

console.log('\n=== 色相分离（协议要求有彩色 H 差 ≥60°）===');
const hs = { 靛: INDIGO_H, 石绿: GREEN_H, 赭金: GOLD_H };
const keys = Object.keys(hs);
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    let d = Math.abs(hs[keys[i]] - hs[keys[j]]);
    if (d > 180) d = 360 - d;
    console.log(`  ${keys[i]} ↔ ${keys[j]}: ${d.toFixed(0)}° ${d >= 60 ? '✓' : '✗'}`);
  }
}

let fails = 0;
const check = (label, fg, bg, min) => {
  const r = ratio(fg, bg);
  if (r < min) fails++;
  console.log(`  ${r >= min ? '✓' : '✗'} ${label.padEnd(24)} ${r.toFixed(2)} (≥${min})`);
};
for (const [name, T] of [['纸', PAPER], ['墨', INK]]) {
  console.log(`\n=== ${name} 对比度 ===`);
  check('正文 text/canvas', T.text, T.canvas, 7);
  check('正文 text/surface', T.text, T.surface, 7);
  check('小字 muted/canvas', T.muted, T.canvas, 4.5);
  check('大字 faint/canvas', T.faint, T.canvas, 3);
  check('按钮 onAction/action', T.onAction, T.action, 7);
  check('强调 action/canvas', T.action, T.canvas, 4.5);
  check('成功 success/canvas', T.success, T.canvas, 4.5);
  check('格框 grid/canvas', T.grid, T.canvas, 3);
  check('格内虚线 gridSoft', T.gridSoft, T.canvas, 1.5);
  check('赭金 gold/canvas', T.gold, T.canvas, 3);
}
console.log(`\n${fails === 0 ? '✓ 推导结果全部达标' : `✗ ${fails} 项未达标，需调整 L/C`}`);
console.log('\n论证：主色取蓝染/青花瓷的琉璃绀（oklch H255、chroma 0.095 落在油墨区间），');
console.log('      正文用带蓝底的松烟墨，底色是中性象牙白而非奶油黄 ——');
console.log('      三者同属传统书写与织染材料，且刻意避开「暖奶油底＋陶土点缀」这个 AI 默认家族。');
process.exit(fails === 0 ? 0 : 1);