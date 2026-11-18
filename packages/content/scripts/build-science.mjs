/**
 * build-science.mjs — 把科普 CSV 转成应用可用的 JSON
 *
 * 输入：packages/content/content/science.csv（可由用户替换后重跑）
 * 输出：packages/content/data/science.json
 *
 * 校验是硬门槛：列缺失、日次跳号/重复、正文超字数、答案非 A/B、
 * 主题非法，任何一条都直接失败，不允许把坏内容灌进 App。
 * 用户之后自己写好科普文件，只需覆盖 CSV 再跑一次。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const SRC = join(PKG, 'content', 'science.csv');
const OUT = join(PKG, 'data', 'science.json');

const REQUIRED = [
  'day', 'week', 'theme', 'title', 'body',
  'question', 'optionA', 'optionB', 'correct', 'explain',
];

const THEMES = new Set([
  '用药安全', '饮食营养', '就医挂号', '居家安全',
  '防诈骗', '身体运动', '自然与环境', '生活电器',
]);

const LIMITS = { title: 14, question: 20, option: 8, explain: 40, bodyMin: 60, bodyMax: 90 };

if (!existsSync(SRC)) {
  console.error(`✗ 缺少科普内容文件: ${SRC}`);
  process.exit(1);
}

/** 极简 CSV 解析：支持双引号包裹、字段内逗号、"" 转义 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const cjkCount = (s) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;

let raw = readFileSync(SRC, 'utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

const rows = parseCsv(raw);
if (rows.length < 2) {
  console.error('✗ CSV 没有数据行');
  process.exit(1);
}

const header = rows[0].map((h) => h.trim());
const errors = [];

for (const col of REQUIRED) {
  if (!header.includes(col)) errors.push(`表头缺少列 "${col}"`);
}
if (errors.length) {
  console.error('✗ 表头校验失败：');
  errors.forEach((e) => console.error('  -', e));
  process.exit(1);
}

const idx = Object.fromEntries(REQUIRED.map((c) => [c, header.indexOf(c)]));
const cards = [];
const seenDays = new Set();

for (const [n, r] of rows.slice(1).entries()) {
  const line = n + 2; // CSV 行号（1 = 表头）
  const get = (k) => (r[idx[k]] ?? '').trim();

  const day = Number(get('day'));
  const week = Number(get('week'));
  const theme = get('theme');
  const title = get('title');
  const body = get('body');
  const question = get('question');
  const optionA = get('optionA');
  const optionB = get('optionB');
  const correct = get('correct');
  const explain = get('explain');

  if (!Number.isInteger(day) || day < 1 || day > 90) errors.push(`第 ${line} 行: day="${get('day')}" 非法`);
  if (seenDays.has(day)) errors.push(`第 ${line} 行: day ${day} 重复`);
  seenDays.add(day);
  if (!Number.isInteger(week) || week < 1 || week > 13) errors.push(`第 ${line} 行: week 非法`);
  if (!THEMES.has(theme)) errors.push(`第 ${line} 行: theme "${theme}" 不在允许列表`);
  if (cjkCount(title) > LIMITS.title) errors.push(`第 ${line} 行: title 超过 ${LIMITS.title} 字`);
  const bc = cjkCount(body);
  if (bc < LIMITS.bodyMin || bc > LIMITS.bodyMax) {
    errors.push(`第 ${line} 行: body ${bc} 字，应为 ${LIMITS.bodyMin}–${LIMITS.bodyMax}`);
  }
  if (cjkCount(question) > LIMITS.question) errors.push(`第 ${line} 行: question 超过 ${LIMITS.question} 字`);
  if (cjkCount(optionA) > LIMITS.option || cjkCount(optionB) > LIMITS.option) {
    errors.push(`第 ${line} 行: 选项超过 ${LIMITS.option} 字`);
  }
  if (correct !== 'A' && correct !== 'B') errors.push(`第 ${line} 行: correct="${correct}" 应为 A 或 B`);
  if (cjkCount(explain) > LIMITS.explain) errors.push(`第 ${line} 行: explain 超过 ${LIMITS.explain} 字`);

  cards.push({
    id: `s${day}`,
    day,
    week,
    theme,
    title,
    body,
    question,
    optionA,
    optionB,
    correct,
    explain,
    audioKey: `s/${day}`,
  });
}

for (let d = 1; d <= 90; d++) {
  if (!seenDays.has(d)) errors.push(`缺少 day ${d}`);
}
cards.sort((a, b) => a.day - b.day);

/**
 * 平衡正确答案位置。
 *
 * 判断题如果"对"永远在 A，全选 A 就能蒙对大多数，家属端看到的正确率
 * 就不再反映真实掌握程度 —— 这正是我们要避免的数据失真。
 * 这里在保语义不变的前提下交换选项内容，让 A/B 尽量各占一半。
 */
function rebalance(cards) {
  let aCount = 0;
  let bCount = 0;
  for (const c of cards) {
    // 已经偏向某侧时，若当前卡的答案恰好在领先侧，就换到另一侧
    const leadingA = aCount >= bCount;
    const wantA = !leadingA;
    if ((c.correct === 'A') !== wantA) {
      const tmp = c.optionA;
      c.optionA = c.optionB;
      c.optionB = tmp;
      c.correct = c.correct === 'A' ? 'B' : 'A';
    }
    if (c.correct === 'A') aCount++;
    else bCount++;
  }
  return { aCount, bCount };
}

const balanced = rebalance(cards);

if (errors.length) {
  console.error(`✗ 科普内容校验失败，共 ${errors.length} 处：`);
  errors.slice(0, 40).forEach((e) => console.error('  -', e));
  process.exit(1);
}

const themeCount = {};
for (const c of cards) themeCount[c.theme] = (themeCount[c.theme] ?? 0) + 1;

writeFileSync(
  OUT,
  JSON.stringify(
    {
      meta: {
        total: cards.length,
        themes: themeCount,
        source: 'packages/content/content/science.csv',
        limits: LIMITS,
      },
      cards,
    },
    null,
    1,
  ),
  'utf8',
);

console.log(`✓ 科普内容构建完成：${cards.length} 条`);
console.log(`  主题分布：${Object.entries(themeCount).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
console.log(`  正确答案：A ${cards.filter((c) => c.correct === 'A').length} / B ${cards.filter((c) => c.correct === 'B').length}`);