/**
 * build-math.mjs — 把 math.json 整理成应用可直接消费的 JSON
 *
 * 输入：packages/content/content/math.json（90 节，三题/节）
 * 输出：packages/content/data/math.json
 *
 * 这里再校验一遍，因为内容可能被替换：日次、题数、答案下标、空字段。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const SRC = join(PKG, 'content', 'math.json');
const OUT = join(PKG, 'data', 'math.json');

if (!existsSync(SRC)) {
  console.error(`✗ 缺少数学内容: ${SRC}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(SRC, 'utf8'));
const lessons = (data.lessons ?? []).slice().sort((a, b) => a.day - b.day);
const errors = [];

if (lessons.length !== 90) errors.push(`课数应为 90，实际 ${lessons.length}`);

const seen = new Set();
for (const l of lessons) {
  const at = `day ${l.day}`;
  if (!Number.isInteger(l.day) || l.day < 1 || l.day > 90) errors.push(`非法日次 ${l.day}`);
  if (seen.has(l.day)) errors.push(`${at}: 重复`);
  seen.add(l.day);
  for (const k of ['module', 'title', 'goal', 'script', 'action']) {
    if (!String(l[k] ?? '').trim()) errors.push(`${at}: ${k} 为空`);
  }
  if (!Array.isArray(l.items) || l.items.length !== 3) {
    errors.push(`${at}: 题数应为 3，实际 ${l.items?.length}`);
    continue;
  }
  for (const [i, it] of l.items.entries()) {
    const q = `${at} 第${i + 1}题`;
    if (!String(it.prompt ?? '').trim()) errors.push(`${q}: prompt 为空`);
    if (!['choice', 'count'].includes(it.kind)) errors.push(`${q}: kind 非法`);
    const opts = it.options ?? [];
    if (opts.length < 2 || opts.length > 4) errors.push(`${q}: 选项 ${opts.length} 个`);
    if (!Number.isInteger(it.correct) || it.correct < 0 || it.correct >= opts.length) {
      errors.push(`${q}: correct 越界`);
    }
    if (new Set(opts).size !== opts.length) errors.push(`${q}: 选项重复`);
  }
}
for (let d = 1; d <= 90; d++) if (!seen.has(d)) errors.push(`缺少 day ${d}`);

if (errors.length) {
  console.error(`✗ 数学内容校验失败，共 ${errors.length} 处：`);
  errors.slice(0, 40).forEach((e) => console.error('  -', e));
  process.exit(1);
}

const out = {
  meta: {
    total: lessons.length,
    modules: lessons.reduce((m, l) => ((m[l.module] = (m[l.module] ?? 0) + 1), m), {}),
    questionCount: lessons.length * 3,
    source: 'packages/content/content/math.json',
  },
  lessons: lessons.map((l) => ({
    day: l.day,
    module: l.module,
    title: l.title,
    goal: l.goal,
    script: l.script,
    items: l.items.map((it, i) => ({
      id: `m${l.day}-${i + 1}`,
      prompt: it.prompt,
      kind: it.kind,
      options: it.options,
      correct: it.correct,
      hint: it.hint ?? '',
    })),
    action: l.action,
    audioKey: `m/${l.day}`,
  })),
};

writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');

const pos = [0, 0, 0, 0];
for (const l of out.lessons) for (const it of l.items) pos[it.correct]++;
console.log(`✓ 数学内容构建完成：${out.lessons.length} 节 / ${out.meta.questionCount} 题`);
console.log(`  模块：${Object.entries(out.meta.modules).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
console.log(`  答案位置：A=${pos[0]} B=${pos[1]} C=${pos[2]} D=${pos[3]}`);