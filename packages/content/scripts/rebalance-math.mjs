/**
 * rebalance-math.mjs — 打散数学题的正确答案位置
 *
 * 合并后的实测分布是 A=82 / B=163 / C=25 / D=0：全蒙 B 就能对 61%，
 * 这对"判断老人是否真的在算"是致命的，会让家属端的正确率数据失去意义。
 *
 * 做法：对每道题按确定性种子重排选项，并把"正确答案应当落在哪个位置"
 * 强制按 0,1,2,3 循环分配，使分布尽量均匀。题面与答案语义不变，
 * 只改变选项顺序。
 *
 * 同一天内也要求位置不重复，避免"今天三题都选第一个"就能连对。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'content', 'math.json');

const data = JSON.parse(readFileSync(FILE, 'utf8'));

/** 可复现的伪随机（mulberry32），保证每次构建结果一致 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates，使用外部 rng */
function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let moved = 0;
let cursor = 0;

for (const lesson of data.lessons) {
  const usedInDay = new Set();

  // 先给"选项少"的题分配位置：2 选项题只有 0/1 两个坑，若先被 3 选项题
  // 占掉，它必然撞位。按选项数升序处理可以把撞位降到最少。
  const order = lesson.items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => a.it.options.length - b.it.options.length || a.i - b.i);

  for (const { it: item, i: idx } of order) {
    const n = item.options.length;
    const correctText = item.options[item.correct];

    // 选一个期望的正确位置：优先当天没用过的
    let target = -1;
    for (let k = 0; k < n; k++) {
      const cand = (cursor + k) % n;
      if (!usedInDay.has(cand)) {
        target = cand;
        break;
      }
    }
    if (target < 0) target = cursor % n;
    usedInDay.add(target);
    cursor++;

    if (item.correct === target) {
      const rand = rng(lesson.day * 100 + idx);
      const others = item.options.filter((_, i) => i !== item.correct);
      const shuffledOthers = shuffle(others, rand);
      const rebuilt = [];
      let oi = 0;
      for (let i = 0; i < n; i++) {
        rebuilt.push(i === target ? correctText : shuffledOthers[oi++]);
      }
      item.options = rebuilt;
      item.correct = target;
      continue;
    }

    // 把正确答案挪到 target，其余选项随机铺满
    const rand = rng(lesson.day * 1000 + idx * 7 + 13);
    const others = shuffle(
      item.options.filter((_, i) => i !== item.correct),
      rand,
    );
    const rebuilt = [];
    let oi = 0;
    for (let i = 0; i < n; i++) {
      rebuilt.push(i === target ? correctText : others[oi++]);
    }
    item.options = rebuilt;
    item.correct = target;
    moved++;
  }
}

// ---------------- 校验

const posCount = [0, 0, 0, 0];
const perDayDup = [];
for (const lesson of data.lessons) {
  const seen = new Set();
  for (const it of lesson.items) {
    posCount[it.correct]++;
    if (seen.has(it.correct)) perDayDup.push(lesson.day);
    seen.add(it.correct);
    // 答案文本必须仍在选项里
    if (it.correct < 0 || it.correct >= it.options.length) {
      throw new Error(`day ${lesson.day}: correct 越界`);
    }
  }
}

const total = posCount.reduce((a, b) => a + b, 0);
const maxShare = Math.max(...posCount) / total;

writeFileSync(FILE, JSON.stringify(data, null, 1), 'utf8');

console.log(`✓ 选项重排完成：挪动 ${moved} 题`);
console.log(`  正确答案位置：A=${posCount[0]} B=${posCount[1]} C=${posCount[2]} D=${posCount[3]}`);
console.log(`  最大占比：${(maxShare * 100).toFixed(1)}%（应 < 40%）`);
if (perDayDup.length) {
  console.log(`  ⚠ 同一天内正确答案位置重复的课：${perDayDup.slice(0, 10).join(',')}`);
}
if (maxShare >= 0.4) {
  console.error('✗ 分布仍然偏斜');
  process.exit(1);
}
