/**
 * build-characters.mjs — 生成 3500 字教学字表（《通用规范汉字表》一级字表全量）
 *
 * 取字策略（三层来源，全部可复核）
 *   1. 功能核心 1500：教育部《扫盲教育课程设置及教学材料编写指导纲要》附件
 *      592 最高频 + 358 次高频 + 550 非高频，保留原文分档与档内顺序。
 *   2. 补足 2000：一级字表(3500) 里其余全部字，按语料字频(Jun Da)
 *      从高到低补入，只在「不在 1500 核心内」的字里挑。
 *   3. 校验：1500 必须全部属于 3500；3500 必须全部有笔顺数据。
 *
 * 排课：3500 / 175 天 = 每天 20 字。顺序 = 档1 → 档2 → 档3 → 补充字，
 * 因此「592 最高频」全部落在前 30 天（592 / 20 = 29.6 天），符合设计约束。
 *
 * 输出：packages/content/data/characters.json
 *       packages/content/review/polyphone.csv  （多音字待人工确认清单）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinyin } from 'pinyin-pro';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const DATA = join(PKG, 'data');
const CACHE = join(DATA, 'cache');

const DAYS = 175;
const PER_DAY = 20;
const TOTAL = DAYS * PER_DAY; // 3500 = 一级字表全量
const EXTRA_COUNT = 2000; // 3500 - 1500 功能核心
// 592 最高频必须全部落在这 30 天（600 个格位）之内
const HEAD_DAYS = 30;
const DAYS_HEAD_SLOTS = HEAD_DAYS * PER_DAY;

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function readText(p) {
  return readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------- 载入来源

const level1Path = join(CACHE, 'level-1.txt');
if (!existsSync(level1Path)) die(`缺少一级字表缓存: ${level1Path}\n先运行 scripts/fetch-level1.ps1 或手动下载。`);
const level1 = readText(level1Path).replace(/[\r\n\s]/g, '');
if (level1.length !== 3500) die(`一级字表应为 3500 字，实际 ${level1.length}`);

const tiersRaw = JSON.parse(readText(join(DATA, 'moe-tiers.json')));
const TIER_KEYS = ['592', '358', '550'];
const TIER_EXPECT = { 592: 592, 358: 358, 550: 550 };
for (const k of TIER_KEYS) {
  const got = tiersRaw.tiers[k].length;
  if (got !== TIER_EXPECT[k]) die(`扫盲字表档 ${k} 应为 ${TIER_EXPECT[k]} 字，实际 ${got}`);
}

const freqRaw = JSON.parse(readText(join(DATA, 'char-frequency.json')));
const freqRank = new Map();
for (const e of freqRaw.entries) {
  if (!freqRank.has(e.char)) freqRank.set(e.char, e.rank);
}

const level1Set = new Set(level1);

// 白名单例外：教育部扫盲字表收录、但不属于《通用规范汉字表》一级字表的字。
// 实测三层来源只有 1 处冲突；这些字在功能上确实高频（地名/地址/票据），故保留，
// 但必须逐字说明理由，防止以后来源变化时静默混入生僻字。
const NON_LEVEL1_WHITELIST = new Map([
  ['圳', '地名用字（深圳），教育部扫盲 592 最高频字表收录；本身属二级字表'],
]);

// ---------------------------------------------------------------- 组成 3500

// 1) 功能核心 1500，保持档序
const core = [];
const seen = new Set();
const tierOf = new Map();
for (const key of TIER_KEYS) {
  for (const ch of tiersRaw.tiers[key]) {
    if (seen.has(ch)) continue;
    if (!level1Set.has(ch) && !NON_LEVEL1_WHITELIST.has(ch)) {
      die(`扫盲字「${ch}」不在《通用规范汉字表》一级字表中，且未列入白名单`);
    }
    seen.add(ch);
    core.push(ch);
    tierOf.set(ch, key);
  }
}
if (core.length !== 1500) die(`功能核心应为 1500 字，实际 ${core.length}`);

// 白名单里的字必须真的出现，避免白名单过期后失去意义
for (const ch of NON_LEVEL1_WHITELIST.keys()) {
  if (!seen.has(ch)) die(`白名单字「${ch}」未出现在扫盲字表中，请清理白名单`);
}

// 2) 补足 2000：一级字表内、非核心的全部字，按字频排名排序
const extras = level1
  .split('')
  .filter((ch) => !seen.has(ch))
  .sort((a, b) => (freqRank.get(a) ?? Infinity) - (freqRank.get(b) ?? Infinity))
  .slice(0, EXTRA_COUNT);
if (extras.length !== EXTRA_COUNT) die(`补充字应为 ${EXTRA_COUNT}，实际 ${extras.length}`);

const ordered = [...core, ...extras];
if (ordered.length !== TOTAL) die(`总字数应为 ${TOTAL}，实际 ${ordered.length}`);

// ---------------------------------------------------------------- 教学顺序

/**
 * 单纯按「档位 + 字频」排，第 1 天会冒出「的 地 内 位 专 物 使 非 推 确」这类
 * 抽象虚词和结构复杂的字 —— 对零基础老人是劝退。真实识字教材都是先教
 * 能看见、能指认、能画的字（人 口 手 大 小 上 下 日 月）。
 *
 * 约束：592 最高频必须全部落在前 30 天（600 个格位）。所以**只能在头 600 个
 * 格位内部重排**，不能把最高频字挤到 30 天之后。
 *
 * 排法：前 12 天每天 20 字里 14 个取「具象字」、6 个取「按字频补齐」；
 * 第 13–30 天反过来，逐步过渡到纯字频顺序。档位成员不变，只变先后。
 */

// 具象字优先表：能画出来、能指认、日常能见到的字，按教学难易大致排序
const CONCRETE_ORDER = [
  '一二三四五六七八九十百千万',
  '人口手目耳鼻牙头足心',
  '父母儿女兄弟姐妹夫妻孙爷娘',
  '日月水火土山石田天人风雨云雪冰',
  '牛羊马猪狗鸡鱼鸟虫花草树叶果',
  '上下左右中前后内外东西南北',
  '大小多少长短高低',
  '走看听说吃喝坐站睡笑哭买卖拿放开关',
  '米面饭菜肉蛋奶茶酒盐油糖',
  '衣鞋帽袜裤门窗桌椅床灯碗筷杯',
  '年月日时分今明昨早晚春夏秋冬',
  '好坏新旧冷热干净',
].join('');
// 去重并保留首次出现顺序
const concreteIdx = new Map();
for (const ch of CONCRETE_ORDER) {
  if (!concreteIdx.has(ch)) concreteIdx.set(ch, concreteIdx.size);
}

const tier1List = tiersRaw.tiers['592'];
const headBlock = [...tier1List]; // 592 字，必须全部进前 30 天
const headSet = new Set(headBlock);

if (headBlock.length > DAYS_HEAD_SLOTS) {
  die(`592 档有 ${headBlock.length} 字，超过前 30 天的 ${DAYS_HEAD_SLOTS} 个格位`);
}

// 具象字队列（限定在头块内），按字频从高到低
const qConcrete = headBlock
  .filter((ch) => concreteIdx.has(ch))
  .sort((a, b) => concreteIdx.get(a) - concreteIdx.get(b));

// 其余头块字，按字频从高到低
const qRest = headBlock
  .filter((ch) => !concreteIdx.has(ch))
  .sort((a, b) => (freqRank.get(a) ?? Infinity) - (freqRank.get(b) ?? Infinity));

const headOrdered = [];
for (let day = 1; day <= DAYS; day++) {
  if (headOrdered.length >= headBlock.length) break;
  // 前 12 天：14 具象 + 6 字频；之后：6 具象 + 14 字频
  const wantConcrete = day <= 12 ? 14 : 6;
  let taken = 0;
  const dayChars = [];
  for (let i = 0; i < PER_DAY; i++) {
    const preferConcrete = i % 20 < wantConcrete * 2; // 交替穿插，避免整段同类
    let ch;
    if (preferConcrete && qConcrete.length) ch = qConcrete.shift();
    else if (qRest.length) ch = qRest.shift();
    else if (qConcrete.length) ch = qConcrete.shift();
    else break;
    if (concreteIdx.has(ch)) taken++;
    dayChars.push(ch);
  }
  headOrdered.push(...dayChars);
}
// 头块可能不足整天，补齐
headOrdered.push(...qConcrete, ...qRest);
headOrdered.length = headBlock.length;

if (new Set(headOrdered).size !== headBlock.length) {
  die('头块重排后出现重复或缺失');
}
for (const ch of headBlock) {
  if (!headOrdered.includes(ch)) die(`头块重排丢失了「${ch}」`);
}

// 尾块：其余 2908 字，按 档位优先 → 字频
const TIER_RANK = { 592: 0, 358: 1, 550: 2, extra: 3 };
const tailBlock = ordered
  .filter((ch) => !headSet.has(ch))
  .sort((a, b) => {
    const ta = TIER_RANK[tierOf.get(a) ?? 'extra'];
    const tb = TIER_RANK[tierOf.get(b) ?? 'extra'];
    if (ta !== tb) return ta - tb;
    return (freqRank.get(a) ?? Infinity) - (freqRank.get(b) ?? Infinity);
  });

const teachingOrder = [...headOrdered, ...tailBlock];
if (teachingOrder.length !== TOTAL) die(`教学顺序长度 ${teachingOrder.length} ≠ ${TOTAL}`);
if (new Set(teachingOrder).size !== TOTAL) die('教学顺序存在重复字');

// ---------------------------------------------------------------- 元数据

const HWD = join(PKG, 'node_modules', 'hanzi-writer-data');
const hasStroke = (ch) => existsSync(join(HWD, `${ch}.json`));

// 多音字检测：pinyin-pro 的 multiple 模式返回所有读音
function readingsOf(ch) {
  try {
    const all = pinyin(ch, { multiple: true, type: 'array', toneType: 'symbol' });
    return [...new Set(all.filter(Boolean))];
  } catch {
    return [];
  }
}

const characters = [];
const polyphones = [];
const missingStrokes = [];
const dayBuckets = Array.from({ length: DAYS }, () => []);

for (let i = 0; i < teachingOrder.length; i++) {
  const ch = teachingOrder[i];
  const day = Math.floor(i / PER_DAY) + 1;

  if (!hasStroke(ch)) missingStrokes.push(ch);

  let strokeCount = null;
  if (hasStroke(ch)) {
    const g = JSON.parse(readText(join(HWD, `${ch}.json`)));
    strokeCount = Array.isArray(g.strokes) ? g.strokes.length : null;
  }

  const readings = readingsOf(ch);
  const primary = readings[0] ?? pinyin(ch, { toneType: 'symbol' });
  if (readings.length > 1) {
    polyphones.push({ char: ch, day, readings: readings.join(' / '), primary });
  }

  const rec = {
    id: ch,
    char: ch,
    pinyin: primary,
    readings,
    tier: tierOf.get(ch) ?? 'extra',
    day,
    strokes: strokeCount,
    audioKey: `c/${ch}`,
  };
  characters.push(rec);
  dayBuckets[day - 1].push(ch);
}

if (missingStrokes.length) {
  die(`${missingStrokes.length} 个字缺少笔顺数据: ${missingStrokes.join('')}`);
}

// ---------------------------------------------------------------- 校验

// 592 最高频必须全在前 30 天
const first30 = new Set(dayBuckets.slice(0, 30).flat());
const tier1 = tiersRaw.tiers['592'];
const leaked = tier1.filter((ch) => !first30.has(ch));
if (leaked.length) die(`592 最高频有 ${leaked.length} 字未落在前 30 天: ${leaked.join('')}`);

// 每天恰好 20 字
for (let d = 1; d <= DAYS; d++) {
  if (dayBuckets[d - 1].length !== PER_DAY) {
    die(`第 ${d} 天有 ${dayBuckets[d - 1].length} 字，应为 ${PER_DAY}`);
  }
}

// 无重复
if (new Set(ordered).size !== ordered.length) die('字表存在重复字');

// ---------------------------------------------------------------- 输出

const dailyChars = dayBuckets.map((chars, i) => ({ day: i + 1, chars }));

const out = {
  meta: {
    generatedBy: 'packages/content/scripts/build-characters.mjs',
    total: characters.length,
    days: DAYS,
    perDay: PER_DAY,
    tierCounts: {
      592: tiersRaw.tiers['592'].length,
      358: tiersRaw.tiers['358'].length,
      550: tiersRaw.tiers['550'].length,
      extra: extras.length,
    },
    sources: [
      { role: '成员集', name: '《通用规范汉字表》一级字表 3500', count: 3500 },
      { role: '功能频率分层', name: '教育部《扫盲教育课程设置及教学材料编写指导纲要》附件', count: 1500 },
      { role: '补充字排序', name: '现代汉语语料库字频表 (Jun Da, MTSU)', count: freqRaw.count },
      { role: '笔顺数据', name: 'hanzi-writer-data (Arphic Public License)', count: 9574 },
    ],
  },
  characters,
  dailyChars,
};

mkdirSync(DATA, { recursive: true });
writeFileSync(join(DATA, 'characters.json'), JSON.stringify(out, null, 1), 'utf8');

const reviewDir = join(PKG, 'review');
mkdirSync(reviewDir, { recursive: true });
const csv = [
  'char,day,tier,readings,primary,要教的读音,备注',
  ...polyphones.map((p) => `${p.char},${p.day},${tierOf.get(p.char) ?? 'extra'},"${p.readings}",${p.primary},,`),
].join('\n');
writeFileSync(join(reviewDir, 'polyphone.csv'), '\ufeff' + csv, 'utf8');

console.log('✓ 字表构建完成');
console.log(`  总字数      ${characters.length}`);
console.log(`  天数        ${DAYS} 天 × ${PER_DAY} 字`);
console.log(`  分档        592:${tiersRaw.tiers['592'].length}  358:${tiersRaw.tiers['358'].length}  550:${tiersRaw.tiers['550'].length}  补充:${extras.length}`);
console.log(`  笔顺覆盖    ${characters.length}/${characters.length}`);
console.log(`  多音字      ${polyphones.length} 个 → review/polyphone.csv`);
console.log(`  前 30 天含 592 档全部字  ✓`);
console.log(`  第 1 天     ${dayBuckets[0].join('')}`);
console.log(`  第 90 天    ${dayBuckets[89].join('')}`);
