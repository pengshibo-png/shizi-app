/**
 * build-words.mjs — 为每个字挑选 3 个「日常真会用」的词组
 *
 * 词表来源：jieba 主词典 dict.txt（word / 语料词频 / 词性，349,046 条）。
 * 先用新华词典 (ci.json) 的「按字频之和」打分试过一版，结果选出「人我」
 * 「水国」「医国」这种古籍词——因为常用字组成的词不等于常用词。改用真实
 * 语料词频后，选出来的是「我们/今天/电话/医院/回家」这类词。
 *
 * 约束：词长 2–3、每个字都在 3500 字表内（不引入生字）。
 *
 * 输出：packages/content/data/words.json，并回填 characters.json 的 wordIds
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const DATA = join(PKG, 'data');
const CACHE = join(DATA, 'cache');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const charsData = readJson(join(DATA, 'characters.json'));
const taught = new Set(charsData.characters.map((c) => c.char));

// ---------------------------------------------------------------- 词频表

const jiebaPath = join(CACHE, 'jieba-dict.txt');
if (!existsSync(jiebaPath)) {
  console.error(
    `✗ 缺少 jieba 词典: ${jiebaPath}\n` +
      '  下载（约 4.9 MB，MIT）：\n' +
      '    curl -L -o packages/content/data/cache/jieba-dict.txt \\\n' +
      '      https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt\n' +
      '  注：组词结果 data/words.json 已随仓库分发，只有要改词表时才需要它。',
  );
  process.exit(1);
}

const entries = [];
// jieba 词性：nr=人名，ns=地名，nz=专名。人名词必须剔除（否则「钱」会组出
// 「钱运录」这种人名）；地名里「中国/日本/北京」是正常词汇，保留。
const EXCLUDED_POS = new Set(['nr']);
const POS_RE = /^[a-z]{1,4}$/;
for (const line of readFileSync(jiebaPath, 'utf8').split('\n')) {
  const parts = line.trim().split(' ');
  if (parts.length < 2) continue;
  const [word, freqStr] = parts;
  if (!word) continue;
  const pos = parts.length >= 3 && POS_RE.test(parts[2]) ? parts[2] : '';
  if (EXCLUDED_POS.has(pos)) continue;
  if (word.length < 2 || word.length > 3) continue;
  const freq = Number(freqStr);
  if (!Number.isFinite(freq) || freq <= 0) continue;
  // 只收纯汉字词
  if (!/^[\u4e00-\u9fff]+$/.test(word)) continue;
  let ok = true;
  const used = new Set();
  for (const ch of word) {
    if (!taught.has(ch) || used.has(ch)) {
      ok = false;
      break;
    }
    used.add(ch);
  }
  if (!ok) continue;
  entries.push({ word, freq });
}

// 同词可能重复，保留最高频
const bestFreq = new Map();
for (const e of entries) {
  const cur = bestFreq.get(e.word);
  if (cur === undefined || e.freq > cur) bestFreq.set(e.word, e.freq);
}
const candidates = [...bestFreq.entries()]
  .map(([word, freq]) => ({ word, freq }))
  .sort((a, b) => b.freq - a.freq);

console.log(`可用候选词（字全在 3500 表内）: ${candidates.length}`);
console.log('  最高频 10 个:', candidates.slice(0, 10).map((c) => `${c.word}(${c.freq})`).join(' '));

// ---------------------------------------------------------------- 释义（可选）

let glossMap = new Map();
const ciPath = join(CACHE, 'xinhua-ci.json');
if (existsSync(ciPath)) {
  try {
    for (const e of readJson(ciPath)) {
      if (e.ci && !glossMap.has(e.ci)) {
        glossMap.set(e.ci, String(e.explanation ?? '').replace(/^\d+\.\s*/, '').slice(0, 50));
      }
    }
  } catch {
    // 释义只是锦上添花，失败了不影响组词
  }
}

// ---------------------------------------------------------------- 分配

const PER_CHAR = 3;
const buckets = new Map();
for (const ch of taught) buckets.set(ch, []);

for (const cand of candidates) {
  for (const ch of cand.word) {
    const arr = buckets.get(ch);
    if (arr.length < PER_CHAR * 6) arr.push(cand);
  }
}

const words = [];
const wordId = new Map();
const pickFor = new Map();

for (const ch of taught) {
  const arr = buckets.get(ch);
  // 以该字开头优先（组词更直观），其次按词频
  arr.sort((a, b) => {
    const sa = a.word.startsWith(ch) ? 0 : 1;
    const sb = b.word.startsWith(ch) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return b.freq - a.freq;
  });
  const chosen = [];
  for (const c of arr) {
    if (chosen.length >= PER_CHAR) break;
    if (chosen.some((x) => x.word === c.word)) continue;
    chosen.push(c);
  }
  pickFor.set(ch, chosen);
  for (const c of chosen) {
    if (!wordId.has(c.word)) {
      const id = `w${words.length + 1}`;
      wordId.set(c.word, id);
      words.push({
        id,
        word: c.word,
        chars: [...c.word],
        freq: c.freq,
        gloss: glossMap.get(c.word) ?? '',
        audioKey: `w/${c.word}`,
      });
    }
  }
}

for (const rec of charsData.characters) {
  const chosen = pickFor.get(rec.char) ?? [];
  rec.wordIds = chosen.map((c) => wordId.get(c.word));
}

writeFileSync(
  join(DATA, 'words.json'),
  JSON.stringify({ meta: { total: words.length, perChar: PER_CHAR }, words }, null, 1),
  'utf8',
);
charsData.meta.wordCount = words.length;
charsData.meta.wordSource = 'jieba dict.txt 语料词频';
writeFileSync(join(DATA, 'characters.json'), JSON.stringify(charsData, null, 1), 'utf8');

console.log(`✓ 词组构建完成：${words.length} 个词，每字最多 ${PER_CHAR} 个`);
console.log('  抽样：');
for (const ch of ['人', '日', '水', '钱', '车', '医', '药', '家']) {
  const ws = (pickFor.get(ch) ?? []).map((c) => c.word).join('、');
  console.log(`    ${ch} → ${ws}`);
}
