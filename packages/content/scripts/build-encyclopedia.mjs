/**
 * build-encyclopedia.mjs — 生活百科：合并旧 90 条科普 + 新增大类 CSV
 *
 * 来源三份：
 *   1. content/science.csv              90 条（8 主题，作者已交）
 *   2. content/encyclopedia-phone.csv   55 条（微信28/支付宝8/手机基础12/常用App7）
 *   3. content/encyclopedia-life.csv    80 条（金钱/出行/权益/人情）
 *
 * 旧 8 主题映射到新 12 大类（旧的 9 条"生活电器"并入手机使用/居家安全，
 * 旧的"自然与环境"改名"自然节气"）。最后统一按大类重排 day。
 *
 * 输出：data/encyclopedia.json
 *   cards: { cat, order, title, body, question, optionA, optionB, correct, explain, audioKey }
 *   cats:  12 大类目录（含条数、简介）
 *
 * 音频策略：旧 90 条已有音频（s/{day}.mp3）——重排 day 后 audioKey 必须跟着变，
 * 否则音频对不上。新条目一律 audioKey=null，由 build_audio.py --only enc 补齐。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const CONTENT = join(PKG, 'content');
const DATA = join(PKG, 'data');

// ---------------------------------------------------------------- 类别定义

/**
 * 12 大类：key / 展示名 / 简介 / 推送优先级（越小越先轮到）
 * 简介控制在 12 字以内：目录卡一行放得下。超过两行会被 line-clamp 截掉半句话
 * （几何体检抓到过）。
 */
const CATEGORIES = [
  { key: '手机使用', name: '手机使用', about: '微信支付宝一步步教', priority: 1 },
  { key: '防诈骗', name: '防诈骗', about: '见招拆招不上当', priority: 2 },
  { key: '用药安全', name: '用药安全', about: '吃药时间和剂量', priority: 3 },
  { key: '就医挂号', name: '看病就医', about: '挂号化验和医保', priority: 3 },
  { key: '饮食营养', name: '饮食营养', about: '吃什么怎么存放', priority: 3 },
  { key: '金钱财务', name: '金钱财务', about: '存折利息和账单', priority: 4 },
  { key: '出行', name: '出门在外', about: '公交地铁和天气', priority: 4 },
  { key: '权益法律', name: '权益法律', about: '退货遗嘱找谁说', priority: 5 },
  { key: '居家安全', name: '居家安全', about: '燃气用电防跌倒', priority: 5 },
  { key: '身体运动', name: '身体运动', about: '散步晨练有分寸', priority: 6 },
  { key: '自然节气', name: '自然节气', about: '防暑保暖知节气', priority: 6 },
  { key: '人情往来', name: '人情往来', about: '红包串门的礼数', priority: 6 },
];

/** 旧 8 主题 → 新 12 大类的映射（生活电器拆并入两个类） */
const LEGACY_MAP = {
  用药安全: '用药安全',
  饮食营养: '饮食营养',
  就医挂号: '就医挂号',
  居家安全: '居家安全',
  防诈骗: '防诈骗',
  身体运动: '身体运动',
  自然与环境: '自然节气',
  // 生活电器拆分：按 title 关键词决定并入哪个
  生活电器: 'SPLIT',
};

/** 生活电器条目的拆分规则：手机/充电/电视遥控 → 手机使用；其余 → 居家安全 */
function splitAppliance(title, body) {
  const t = `${title}${body}`;
  if (/手机|充电|电视|遥控|平板|屏幕/.test(t)) return '手机使用';
  return '居家安全';
}

// ---------------------------------------------------------------- CSV 解析（与 build-science 相同的健壮实现）

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const cjkCount = (s) => (String(s ?? '').match(/[\u4e00-\u9fff]/g) ?? []).length;

// ---------------------------------------------------------------- 载入三份内容

const errors = [];

function loadCsv(path, requiredCats, label) {
  if (!existsSync(path)) { errors.push(`缺文件: ${path}（${label}）`); return []; }
  let raw = readFileSync(path, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const rows = parseCsv(raw);
  if (rows.length < 2) { errors.push(`${label}: 无数据行`); return []; }
  const header = rows[0].map((h) => h.trim());
  const need = ['cat', 'order', 'title', 'body', 'question', 'optionA', 'optionB', 'correct', 'explain'];
  for (const c of need) if (!header.includes(c)) errors.push(`${label}: 缺列 ${c}`);
  const idx = Object.fromEntries(need.map((c) => [c, header.indexOf(c)]));
  const out = [];
  const seen = new Set();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const g = (k) => (r[idx[k]] ?? '').trim();
    const cat = g('cat');
    const order = Number(g('order'));
    const body = g('body');
    const correct = g('correct');
    if (!requiredCats.includes(cat)) errors.push(`${label} L${line}: cat "${cat}" 非法`);
    if (!Number.isInteger(order) || order < 1) errors.push(`${label} L${line}: order 非法`);
    if (seen.has(order)) errors.push(`${label} L${line}: order ${order} 重复`);
    seen.add(order);
    if (cjkCount(body) < 60 || cjkCount(body) > 90) errors.push(`${label} L${line}: body ${cjkCount(body)} 字`);
    if (correct !== 'A' && correct !== 'B') errors.push(`${label} L${line}: correct 非法`);
    if (!g('title') || !g('question')) errors.push(`${label} L${line}: 空字段`);
    out.push({
      cat, order, title: g('title'), body,
      question: g('question'), optionA: g('optionA'), optionB: g('optionB'),
      correct, explain: g('explain'),
    });
  });
  return out;
}

// 1) 旧 90 条（主题列叫 theme，当作 cat 读）
const sciPath = join(CONTENT, 'science.csv');
let legacy = [];
if (existsSync(sciPath)) {
  legacy = loadCsvRenameTheme(sciPath);
}
function loadCsvRenameTheme(path) {
  let raw = readFileSync(path, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const rows = parseCsv(raw);
  const header = rows[0].map((h) => h.trim());
  const need = ['theme', 'day', 'title', 'body', 'question', 'optionA', 'optionB', 'correct', 'explain'];
  const idx = Object.fromEntries(need.map((c) => [c, header.includes(c) ? header.indexOf(c) : -1]));
  const validThemes = Object.keys(LEGACY_MAP);
  const out = [];
  rows.slice(1).forEach((r, i) => {
    const g = (k) => (r[idx[k]] ?? '').trim();
    const theme = g('theme');
    if (!validThemes.includes(theme)) { errors.push(`旧科普 L${i + 2}: theme ${theme}`); return; }
    out.push({
      theme, order: Number(g('day')), title: g('title'), body: g('body'),
      question: g('question'), optionA: g('optionA'), optionB: g('optionB'),
      correct: g('correct'), explain: g('explain'),
    });
  });
  return out;
}

// 2) 新两份
const phone = loadCsv(join(CONTENT, 'encyclopedia-phone.csv'), ['微信', '支付宝', '手机基础', '常用App'], '手机使用');
const life = loadCsv(join(CONTENT, 'encyclopedia-life.csv'), ['金钱财务', '出行', '权益法律', '人情往来'], '生活大类');

// ---------------------------------------------------------------- 归并

const cards = [];

// 旧条目：theme → 12 大类（含生活电器拆分）
// srcDay 保留旧 science 的 day（1–90），它的朗读音频就存在 s/{srcDay}.mp3，
// 重排 day 后必须继续指回原音频，否则百科会变成哑的（实测踩到过）。
for (const c of legacy) {
  let cat;
  if (LEGACY_MAP[c.theme] === 'SPLIT') cat = splitAppliance(c.title, c.body);
  else cat = LEGACY_MAP[c.theme] ?? c.theme;
  const srcDay = c.order; // 旧 science day = 已生成音频的 s/{day}.mp3
  let order = srcDay;
  if (cat === '手机使用' && c.theme === '生活电器') order = 56 + (srcDay % 10);
  cards.push({ ...c, cat, order, srcDay, audioKey: `s/${srcDay}` });
}

// 新条目：子类 → 大类，音频待生成（e/{cat}-{order}）
const PHONE_SUB = { 微信: '手机使用', 支付宝: '手机使用', 手机基础: '手机使用', 常用App: '手机使用' };
for (const c of phone) {
  const cat = PHONE_SUB[c.cat] ?? '手机使用';
  cards.push({ ...c, cat, subcat: c.cat, srcDay: null, audioKey: `e/${slug(cat)}${c.order}` });
}
for (const c of life) {
  cards.push({ ...c, cat: c.cat, subcat: c.cat, srcDay: null, audioKey: `e/${slug(c.cat)}${c.order}` });
}

/** 音频文件名用 ASCII，避免中文路径在部分 Android WebView 上取不到 */
function slug(cat) {
  return (
    {
      手机使用: 'phone', 防诈骗: 'fraud', 用药安全: 'med', 看病就医: 'doctor',
      饮食营养: 'food', 金钱财务: 'money', 出门在外: 'trip', 权益法律: 'law',
      居家安全: 'home', 身体运动: 'body', 自然节气: 'term', 人情往来: 'gift',
    }[cat] ?? 'x'
  );
}

// 类内排序 + 全局重编 day（推送序：按大类优先级轮转，类内按 order）
const catOrder = new Map(CATEGORIES.map((c, i) => [c.key, i]));
const byCat = new Map();
for (const c of cards) {
  const k = c.cat;
  if (!byCat.has(k)) byCat.set(k, []);
  byCat.get(k).push(c);
}
for (const [k, arr] of byCat) {
  arr.sort((a, b) => (a.subcat ? 0 : 1) - (b.subcat ? 0 : 1) || a.order - b.order);
  arr.forEach((c, i) => (c.order = i + 1));
}

// 大类按优先级排（推送时按此目录轮转）
const sortedCats = [...CATEGORIES].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
let day = 0;
for (const cat of sortedCats) {
  const arr = byCat.get(cat.key) ?? [];
  for (const c of arr) {
    day++;
    c.day = day;
    c.id = `e${day}`;
    // audioKey 已在归并时确定（旧条目指回 s/{srcDay}，新条目用 e/xxx）
  }
}

/**
 * 卡片数组本身按「大类优先级 → 类内 order」排序。
 * 老人端每天推送取的是数组里第一个未看过的（cards.find），
 * 数组顺序 = 推送顺序；不排序的话推送顺序就退化成 CSV 的写入顺序，
 * 优先级轮转（手机 → 防骗 → 健康）会失效。
 */
cards.sort((a, b) => a.day - b.day);

/**
 * 打散判断题答案位置：correct 全压在一侧时，蒙题也能过半，
 * 家属端的正确率数据就失真。这里交换选项把 A 比例拉回 50% 附近。
 */
(function balance(ks) {
  const aIdx = ks.filter((c) => c.correct === 'A');
  const target = Math.round(ks.length / 2);
  for (const c of aIdx.slice(0, Math.max(0, aIdx.length - target))) {
    const t = c.optionA;
    c.optionA = c.optionB;
    c.optionB = t;
    c.correct = 'B';
  }
})(cards);

// ---------------------------------------------------------------- 校验

const total = cards.length;
const catCount = {};
for (const c of cards) catCount[c.cat] = (catCount[c.cat] ?? 0) + 1;
const aCount = cards.filter((c) => c.correct === 'A').length;

// 每个大类必须存在（12 类）
for (const cat of CATEGORIES) {
  if (!catCount[cat.key]) errors.push(`大类 "${cat.key}" 一条都没有`);
}
// day 连续
const days = cards.map((c) => c.day).sort((a, b) => a - b);
for (let i = 0; i < days.length; i++) {
  if (days[i] !== i + 1) { errors.push(`day 序列在 ${i + 1} 断裂`); break; }
}

if (errors.length) {
  console.error(`✗ 百科构建失败，${errors.length} 处：`);
  errors.slice(0, 40).forEach((e) => console.error('  -', e));
  process.exit(1);
}

// ---------------------------------------------------------------- 输出

const cats = sortedCats.map((c) => ({
  key: c.key,
  name: c.name,
  about: c.about,
  priority: c.priority,
  count: catCount[c.key] ?? 0,
}));

writeFileSync(
  join(DATA, 'encyclopedia.json'),
  JSON.stringify({ meta: { total, cats: cats.length, aShare: aCount / total }, cats, cards }, null, 1),
  'utf8',
);

console.log(`✓ 生活百科构建完成：${total} 条 / ${cats.length} 大类`);
console.log('  大类分布：' + cats.map((c) => `${c.name}${c.count}`).join(' '));
console.log(`  正确答案：A ${aCount} / B ${total - aCount}`);
console.log(`  天序覆盖 1-${day}`);