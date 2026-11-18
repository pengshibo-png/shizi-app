/**
 * enrich-characters.mjs — 给 3500 字补上「部首」与「简短释义」
 *
 * 来源：新华字典 word.json（MIT），字段 radicals / explanation。
 *
 * 注意：新华字典的 explanation 是给识字人看的，又长又书面
 * （「嗄〈叹〉 同啊”。表示省悟或惊奇 嗄!难道这里是没有地方官的么?--宋·佚名...」）。
 * 直接塞给老人等于没写。这里做三步精简：
 *   1. 只取首段，砍掉"--书名"之后的引文
 *   2. 去掉拼音重复与〈〉标记
 *   3. 截到 40 字以内
 * 精简后的释义只作为"辅助理解"，界面主路径仍是「字 + 词组 + 例句 + 读音」。
 *
 * 输出：覆写 characters.json 的 radical / gloss 字段
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const DATA = join(PKG, 'data');
const CACHE = join(DATA, 'cache');

const charsPath = join(DATA, 'characters.json');
const dictPath = join(CACHE, 'xinhua-word.json');

if (!existsSync(dictPath)) {
  console.error(`✗ 缺少新华字典缓存: ${dictPath}`);
  process.exit(1);
}

const charsData = JSON.parse(readFileSync(charsPath, 'utf8'));
const dict = JSON.parse(readFileSync(dictPath, 'utf8'));

/** 建索引：一个字可能有多条，保留释义最长（最完整）的那条 */
const byWord = new Map();
for (const e of dict) {
  if (!e?.word || e.word.length !== 1) continue;
  const prev = byWord.get(e.word);
  if (!prev || (e.explanation?.length ?? 0) > (prev.explanation?.length ?? 0)) {
    byWord.set(e.word, e);
  }
}

/**
 * 把新华字典的长释义压成一句人话。
 *
 * 实测字典结构是：
 *   字 \n\n (造字法。本义……)     ← 这一整段是字形学说明，老人看不懂
 *   然后是十几条古籍引文
 *   最后才是 字拼音\n ⒈现代义项一\n ⒉现代义项二   ← 真正的释义在这里
 *
 * 所以不能取第一段（会得到「人 (象形」这种），必须优先找 ⒈ 开头的义项区。
 */
function shorten(explanation, char) {
  if (!explanation) return '';
  let s = String(explanation);

  // 优先：取 ⒈ 开头的现代义项
  const i1 = s.indexOf('⒈');
  if (i1 >= 0) {
    const rest = s.slice(i1 + 1);
    const i2 = rest.indexOf('⒉');
    let seg = i2 > 0 ? rest.slice(0, i2) : rest;
    seg = seg.split(/[\n]/)[0] ?? seg;
    s = seg;
  } else {
    // 没有编号区：去掉开头的括号造字法说明，只留正文
    s = s.replace(/^[\s\S]*?\)\s*/, '');
  }

  // 字典里「～」代指本字，几乎总出现在举例中（「货币～币。铜～。金～。」）。
  // 做法：取第一个「～」之前的义项主体，后面全是举例，直接丢弃。
  // 没有「～」的说明本身就是正常释义，原样保留。
  const tilde = s.search(/[～〜]/);
  if (tilde >= 2) {
    s = s.slice(0, tilde);
  } else if (tilde >= 0) {
    s = s.replace(/[～〜]/g, char);
  }
  // 括号说明（「(象形。…)」）与「又如…」举例串
  s = s.replace(/（[^）]*）|\([^)]*\)/g, ' ');
  s = s.split('又如')[0] ?? s;
  // 去掉引文与出处
  s = s.replace(/[-—]{2}[\s\S]*$/, '');
  s = s.replace(/[〈《][^〉》]*[〉》]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  // 取第一句
  const stop = s.search(/[。；！？]/);
  if (stop > 4) s = s.slice(0, stop);
  s = s.replace(/^[，。、；：\s]+/, '').replace(/[，。、；：\s]+$/, '');
  if (s.length > 34) s = `${s.slice(0, 32)}…`;
  return s;
}

let gotRadical = 0;
let gotGloss = 0;
const missing = [];

for (const rec of charsData.characters) {
  const e = byWord.get(rec.char);

  if (e?.radicals && String(e.radicals).trim()) {
    rec.radical = String(e.radicals).trim().slice(0, 2);
    gotRadical++;
  } else {
    rec.radical = null;
    missing.push(rec.char);
  }

  const g = shorten(e?.explanation, rec.char);
  rec.gloss = g;
  if (g) gotGloss++;
}

// 校验
const errors = [];
if (gotRadical < 3300) errors.push(`部首覆盖只有 ${gotRadical}/3500`);
if (gotGloss < 1700) errors.push(`释义覆盖只有 ${gotGloss}/1800`);

if (errors.length) {
  console.error(`✗ 补全不足：`);
  errors.forEach((e) => console.error('  -', e));
  console.error(`  缺部首: ${missing.slice(0, 20).join('')}`);
  process.exit(1);
}

charsData.meta.radicalCoverage = gotRadical;
charsData.meta.glossCoverage = gotGloss;
charsData.meta.glossSource = '新华字典 (MIT)，已精简至 34 字以内';

writeFileSync(charsPath, JSON.stringify(charsData, null, 1), 'utf8');

/**
 * 输出人工复核清单。
 *
 * 新华字典的义项顺序是历时的（先古义后今义），个别字会自动取到不合适的义项，
 * 例如「车」取到了象棋的"车"。这类无法靠正则修正，只能列出来人工过一遍。
 * 释义在界面上是辅助信息，主路径是「字 + 词组 + 例句 + 读音」，所以不阻塞使用。
 */
const reviewDir = join(PKG, 'review');
mkdirSync(reviewDir, { recursive: true });
const suspicious = [];
for (const rec of charsData.characters) {
  const g = rec.gloss ?? '';
  const reasons = [];
  if (!g) reasons.push('空');
  else if (g.length < 3) reasons.push('过短');
  else if (/同本义|象形|会意|形声|假借|指事/.test(g)) reasons.push('含字形学术语');
  else if (/也$|前$|明$|这$|我$|中$|烈$|十$/.test(g)) reasons.push('尾部有残留');
  else if (g.length > 30) reasons.push('过长');
  if (reasons.length) suspicious.push({ char: rec.char, pinyin: rec.pinyin, gloss: g, reason: reasons.join('/') });
}

const csv = [
  'char,pinyin,gloss,reason',
  ...suspicious.map((s) => `${s.char},${s.pinyin},"${s.gloss.replace(/"/g, '""')}",${s.reason}`),
].join('\n');
writeFileSync(join(reviewDir, 'gloss-check.csv'), '\ufeff' + csv, 'utf8');

console.log('✓ 补全完成');
console.log(`  部首  ${gotRadical}/1800`);
console.log(`  释义  ${gotGloss}/1800`);
console.log(`  待复核 ${suspicious.length} 条 → review/gloss-check.csv`);
console.log('  抽样：');
for (const ch of ['人', '水', '医', '药', '钱', '家']) {
  const r = charsData.characters.find((c) => c.char === ch);
  if (r) console.log(`    ${ch}  ${r.pinyin}  部首${r.radical ?? '?'}  ${r.gloss || '（无）'}`);
}
if (missing.length) console.log(`  缺部首的字: ${missing.slice(0, 30).join('')}`);