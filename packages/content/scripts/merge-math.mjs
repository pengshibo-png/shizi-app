/**
 * merge-math.mjs — 合并 math.json (day 1–75) 与 math-76-90.json (day 76–90)
 *
 * 内容由两个作者分批产出，合并时必须重新做一遍全量校验，而不是相信
 * 各自的"我已自检"：日次连续性、每题答案下标、选项数量、空字段。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(HERE, '..', 'content');
const MAIN = join(CONTENT, 'math.json');
const TAIL = join(CONTENT, 'math-76-90.json');
const OUT = join(CONTENT, 'math.json');

const errors = [];
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const main = read(MAIN);
const tail = existsSync(TAIL) ? read(TAIL) : { lessons: [] };

const lessons = [...main.lessons, ...tail.lessons].sort((a, b) => a.day - b.day);

// ---------------- 校验

const seen = new Set();
for (const l of lessons) {
  const where = `day ${l.day}`;
  if (seen.has(l.day)) errors.push(`${where}: 日次重复`);
  seen.add(l.day);

  for (const k of ['module', 'title', 'goal', 'script', 'action']) {
    if (!String(l[k] ?? '').trim()) errors.push(`${where}: ${k} 为空`);
  }
  if (!Array.isArray(l.items) || l.items.length !== 3) {
    errors.push(`${where}: items 应为 3 条，实际 ${l.items?.length}`);
    continue;
  }
  for (const [i, it] of l.items.entries()) {
    if (!String(it.prompt ?? '').trim()) errors.push(`${where} 第${i + 1}题: prompt 为空`);
    if (!['choice', 'count'].includes(it.kind)) errors.push(`${where} 第${i + 1}题: kind 非法 ${it.kind}`);
    const opts = it.options ?? [];
    if (opts.length < 2 || opts.length > 4) errors.push(`${where} 第${i + 1}题: options ${opts.length} 个`);
    if (!Number.isInteger(it.correct) || it.correct < 0 || it.correct >= opts.length) {
      errors.push(`${where} 第${i + 1}题: correct=${it.correct} 越界（options ${opts.length} 个）`);
    }
    if (opts.some((o) => !String(o).trim())) errors.push(`${where} 第${i + 1}题: 存在空选项`);
    // 选项内部去重：同一个选项出现两次等于没有区分度
    if (new Set(opts).size !== opts.length) errors.push(`${where} 第${i + 1}题: 选项重复`);
  }
}

const days = lessons.map((l) => l.day);
for (let d = 1; d <= 90; d++) {
  if (!seen.has(d)) errors.push(`缺少 day ${d}`);
}

if (days.length !== 90) errors.push(`总课数应为 90，实际 ${days.length}`);

// 正确答案位置分布：全在一个位置等于可以蒙
const posCount = [0, 0, 0, 0];
for (const l of lessons) for (const it of l.items) posCount[it.correct]++;

const moduleCount = {};
for (const l of lessons) moduleCount[l.module] = (moduleCount[l.module] ?? 0) + 1;

if (errors.length) {
  console.error(`✗ 合并校验失败，共 ${errors.length} 处问题：`);
  for (const e of errors.slice(0, 40)) console.error('  -', e);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({ version: 1, lessons }, null, 1), 'utf8');
if (existsSync(TAIL)) {
  const { unlinkSync } = await import('node:fs');
  unlinkSync(TAIL);
}

console.log(`✓ 数学课程合并完成：${lessons.length} 节`);
console.log(`  模块分布：${Object.entries(moduleCount).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
console.log(`  正确答案位置分布：A=${posCount[0]} B=${posCount[1]} C=${posCount[2]} D=${posCount[3]}`);
console.log(`  题目总数：${lessons.length * 3}`);
