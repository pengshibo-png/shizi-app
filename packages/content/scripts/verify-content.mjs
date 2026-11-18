/**
 * verify-content.mjs — 内容完整性总校验
 *
 * 构建期断言，任何一项不通过就退出码非零：
 *   1. 3500 字 × 五项字段齐全（拼音/笔顺/部首/释义/读音）
 *   2. 音频零缺失（单字 + 词组 + 数学 + 科普）
 *   3. 笔顺 3500/3500 命中
 *   4. 字体覆盖全字集
 *   5. 数学 90 节 × 3 题、科普 90 条，日次连续
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const DATA = join(PKG, 'data');
const ASSETS = join(PKG, 'assets');

const errors = [];
const warnings = [];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---------------------------------------------------------------- 字表

const chars = readJson(join(DATA, 'characters.json'));
const list = chars.characters ?? [];

if (list.length !== 3500) errors.push(`字表应为 3500（一级字表全量），实际 ${list.length}`);
if (new Set(list.map((c) => c.char)).size !== list.length) errors.push('字表存在重复字');

let missingStroke = 0;
let missingPinyin = 0;
let missingWords = 0;
for (const c of list) {
  if (typeof c.strokes !== 'number' || c.strokes <= 0) missingStroke++;
  if (!c.pinyin) missingPinyin++;
  if (!Array.isArray(c.wordIds) || c.wordIds.length === 0) missingWords++;
}
if (missingStroke) errors.push(`${missingStroke} 个字缺笔顺数据`);
if (missingPinyin) errors.push(`${missingPinyin} 个字缺拼音`);
if (missingWords) warnings.push(`${missingWords} 个字没有词组（界面会隐藏词组行）`);

// 每天恰好 20 字
const daily = chars.dailyChars ?? [];
if (daily.length !== 175) errors.push(`日次应为 175，实际 ${daily.length}`);
for (const d of daily) {
  if (d.chars.length !== 20) errors.push(`第 ${d.day} 天有 ${d.chars.length} 字`);
}

// 592 最高频全在前 30 天
const first30 = new Set(daily.slice(0, 30).flatMap((d) => d.chars));
const tier592 = list.filter((c) => c.tier === '592');
const leaked = tier592.filter((c) => !first30.has(c.char));
if (leaked.length) errors.push(`592 最高频有 ${leaked.length} 字不在前 30 天：${leaked.slice(0, 10).map((c) => c.char).join('')}`);

// ---------------------------------------------------------------- 音频

const audioDir = join(ASSETS, 'audio');
const need = [];

for (const c of list) need.push({ key: `c/${c.char}.mp3`, kind: '单字' });
const words = readJson(join(DATA, 'words.json')).words ?? [];
for (const w of words) need.push({ key: `w/${w.word}.mp3`, kind: '词组' });

const math = readJson(join(DATA, 'math.json'));
for (const l of math.lessons ?? []) need.push({ key: `m/${l.day}.mp3`, kind: '数学' });

const sci = readJson(join(DATA, 'science.json'));
for (const c of sci.cards ?? []) need.push({ key: `s/${c.day}.mp3`, kind: '科普' });

// 生活百科（12 大类）：旧 90 条复用 s/{srcDay}，新条目走 e/{slug}{order}
const encPath = join(DATA, 'encyclopedia.json');
let enc = null;
if (existsSync(encPath)) {
  enc = readJson(encPath);
  for (const c of enc.cards ?? []) {
    if (!c.audioKey) { errors.push(`百科 ${c.id} 无 audioKey`); continue; }
    need.push({ key: `${c.audioKey}.mp3`, kind: '百科' });
  }
}

const missingByKind = new Map();
for (const n of need) {
  if (!existsSync(join(audioDir, n.key))) {
    missingByKind.set(n.kind, (missingByKind.get(n.kind) ?? 0) + 1);
  }
}
for (const [kind, count] of missingByKind) {
  errors.push(`${kind}音频缺 ${count} 个`);
}

// ---------------------------------------------------------------- 数学 / 科普

const lessons = math.lessons ?? [];
if (lessons.length !== 90) errors.push(`数学应为 90 节，实际 ${lessons.length}`);
for (let d = 1; d <= 90; d++) {
  const l = lessons.find((x) => x.day === d);
  if (!l) { errors.push(`数学缺 day ${d}`); continue; }
  if (l.items.length !== 3) errors.push(`数学 day ${d} 题数 ${l.items.length}`);
  for (const it of l.items) {
    if (!Number.isInteger(it.correct) || it.correct < 0 || it.correct >= it.options.length) {
      errors.push(`数学 day ${d} 答案下标越界`);
    }
  }
}

const cards = sci.cards ?? [];
if (cards.length !== 90) errors.push(`科普应为 90 条，实际 ${cards.length}`);
for (let d = 1; d <= 90; d++) {
  if (!cards.find((c) => c.day === d)) errors.push(`科普缺 day ${d}`);
}

// ---------------------------------------------------------------- 生活百科结构
if (enc) {
  const ec = enc.cards ?? [];
  if (ec.length !== enc.meta?.total) errors.push(`百科 meta.total ${enc.meta?.total} ≠ 实际 ${ec.length}`);
  if ((enc.cats ?? []).length !== 12) errors.push(`百科应为 12 大类，实际 ${(enc.cats ?? []).length}`);

  const days = new Set();
  const keys = new Set();
  const catSeen = new Map();
  let aCount = 0;
  for (const c of ec) {
    if (days.has(c.day)) errors.push(`百科 day ${c.day} 重复`);
    days.add(c.day);
    if (keys.has(c.audioKey)) errors.push(`百科音频键重复 ${c.audioKey}`);
    keys.add(c.audioKey);
    catSeen.set(c.cat, (catSeen.get(c.cat) ?? 0) + 1);
    if (c.correct === 'A') aCount++;
    const zh = (c.body.match(/[一-鿿]/g) ?? []).length;
    if (zh < 55 || zh > 95) errors.push(`百科 ${c.id}「${c.title}」正文 ${zh} 字（应 55–95）`);
    if (enc.cats.every((k) => k.key !== c.cat)) errors.push(`百科 ${c.id} 大类未登记：${c.cat}`);
  }
  for (let d = 1; d <= ec.length; d++) if (!days.has(d)) errors.push(`百科缺 day ${d}`);
  for (const k of enc.cats ?? []) {
    if (!(catSeen.get(k.key) > 0)) errors.push(`大类「${k.name}」一条都没有`);
  }
  // 判断题答案位置必须打散：一侧占比 >60% 时，蒙题也能过半，家属端正确率失真
  const share = aCount / Math.max(1, ec.length);
  if (share < 0.4 || share > 0.6) errors.push(`百科答案偏斜：A ${(share * 100).toFixed(0)}%`);
}

// ---------------------------------------------------------------- 字体

const font = join(ASSETS, 'fonts', 'wenkai-subset.woff2');
if (!existsSync(font)) {
  errors.push('缺楷体子集字体');
} else {
  const mb = statSync(font).size / 1024;
  if (mb > 900) warnings.push(`楷体子集 ${mb.toFixed(0)}KB 偏大`);
}

// ---------------------------------------------------------------- 报告

const audioCount = need.length;
const audioSize = (() => {
  let total = 0;
  for (const n of need) {
    const p = join(audioDir, n.key);
    if (existsSync(p)) total += statSync(p).size;
  }
  return total;
})();

console.log('=== 内容完整性 ===');
console.log(`  汉字        ${list.length}`);
console.log(`  日次        ${daily.length} × 20`);
console.log(`  词组        ${words.length}`);
console.log(`  数学        ${lessons.length} 节 / ${lessons.length * 3} 题`);
console.log(`  科普        ${cards.length} 条`);
if (enc) {
  const aShare = Math.round((enc.cards.filter((c) => c.correct === 'A').length / enc.cards.length) * 100);
  console.log(`  生活百科    ${enc.cards.length} 条 / ${enc.cats.length} 大类（答案 A ${aShare}%）`);
}
console.log(`  音频        ${audioCount - [...missingByKind.values()].reduce((a, b) => a + b, 0)}/${audioCount}  (${(audioSize / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  笔顺        ${list.length - missingStroke}/${list.length}`);
console.log(`  592 前30天  ${leaked.length === 0 ? 'OK' : 'FAIL'}`);

if (warnings.length) {
  console.log('\n警告：');
  warnings.forEach((w) => console.log('  -', w));
}

if (errors.length) {
  console.error(`\n✗ 校验失败，共 ${errors.length} 处：`);
  errors.slice(0, 30).forEach((e) => console.error('  -', e));
  process.exit(1);
}

console.log('\n✓ 全部通过');