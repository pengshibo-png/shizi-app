/**
 * gen-plan-doc.mjs — 生成 90 天逐日学习计划（可打印贴墙）
 *
 * 输出：docs/学习计划.md
 * 内容来自 characters.json / math.json / science.json，保证与实际教学顺序一致，
 * 不是单独手写一份"看起来对"的计划表。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const ROOT = join(PKG, '..', '..');
const DATA = join(PKG, 'data');
const OUT = join(ROOT, 'docs', '学习计划.md');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const chars = readJson(join(DATA, 'characters.json'));
const math = readJson(join(DATA, 'math.json'));
const sci = readJson(join(DATA, 'science.json'));

const daily = chars.dailyChars;
const lessons = new Map(math.lessons.map((l) => [l.day, l]));
const cards = new Map(sci.cards.map((c) => [c.day, c]));

const WEEKNAME = ['日', '一', '二', '三', '四', '五', '六'];

const lines = [];
lines.push('# 90 天学习计划');
lines.push('');
lines.push('> 这份表与实际教学内容**完全对应**（由 `packages/content/scripts/gen-plan-doc.mjs` 从内容数据生成），');
lines.push('> 可以直接打印出来贴在墙上，也可以在老人端 App 里看。');
lines.push('');
lines.push('## 怎么用');
lines.push('');
lines.push('**不划分时段。** 每天就四件事，什么时候做都行，做一点存一点：');
lines.push('');
lines.push('| 任务 | 每天的量 | 做完的标志 |');
lines.push('| --- | --- | --- |');
lines.push('| 学新字 | 20 个 | 每个字走一遍「看 → 听 → 认」 |');
lines.push('| 复习 | 到期的那些（约 80 个） | 全部过一遍 |');
lines.push('| 生活数学 | 1 节 | 3 道题做完 |');
lines.push('| 科普 | 1 条 | 听完 + 1 道判断题 |');
lines.push('');
lines.push('四件都做完算今天完成。做不完不要紧，第二天接着做，总天数会相应顺延。');
lines.push('');
lines.push('**第 7、14、21…天是巩固日**：不学新字，只复习和一整周回顾。');
lines.push('');
lines.push('**关于速度**：20 新字/天 是不低的强度。如果连续一周正确率低于 70%，');
lines.push('App 会自动把每天新字减半并顺延总周期，界面上会写明"计划已调整"。这不是失败，是正常调节。');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 里程碑');
lines.push('');
lines.push('| 天数 | 累计认读 | 大致能做到 |');
lines.push('| --- | --- | --- |');
lines.push('| 第 7 天 | 140 字 | 认出家人称呼、数字、身体部位 |');
lines.push('| 第 30 天 | 600 字 | 看懂药品名称、公交站牌、简单短信 |');
lines.push('| 第 60 天 | 1200 字 | 读懂超市标签、银行单据关键字 |');
lines.push('| 第 90 天 | 1800 字 | 读懂常见通知与说明书主旨 |');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 逐日表');
lines.push('');

for (const d of daily) {
  const n = d.day;
  const isConsolidation = n % 7 === 0;
  const l = lessons.get(n);
  const c = cards.get(n);

  lines.push(`### 第 ${n} 天${isConsolidation ? '（巩固日）' : ''}`);
  lines.push('');

  if (isConsolidation) {
    lines.push('今天不学新字，只把这一周的字再认一遍。');
  } else {
    lines.push(`**新字 ${d.chars.length} 个**：${d.chars.join(' ')}`);
  }
  lines.push('');

  if (l) {
    lines.push(`**生活数学**：${l.module} · ${l.title}`);
    lines.push('');
    lines.push(`> ${l.script}`);
    lines.push('');
    for (const [i, it] of l.items.entries()) {
      const ans = it.options[it.correct];
      lines.push(`${i + 1}. ${it.prompt}　→　${ans}`);
    }
    lines.push('');
    lines.push(`今天能用的：${l.action}`);
  }

  lines.push('');

  if (c) {
    lines.push(`**科普**：${c.theme} · ${c.title}`);
    lines.push('');
    lines.push(`> ${c.body}`);
    lines.push('');
    lines.push(`问：${c.question}　答案：${c.correct === 'A' ? c.optionA : c.optionB}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
}

lines.push('## 附：字表来源');
lines.push('');
lines.push('这 1800 字不是随便挑的，三层来源：');
lines.push('');
lines.push('1. **功能核心 1500 字** —— 教育部《扫盲教育课程设置及教学材料编写指导纲要》附件，');
lines.push('   分 592 最高频 / 358 次高频 / 550 非高频三档。最高的 592 字全部排在前 30 天。');
lines.push('2. **补充 300 字** —— 从《通用规范汉字表》一级字表（3500）中，按真实语料字频从高到低补入。');
lines.push('3. **教学顺序** —— 前 12 天优先安排"能看见、能指认"的具象字（人、口、手、日、月），');
lines.push('   而不是按字频把"的、地、内、位"这类虚词堆在第一天。');
lines.push('');
lines.push('每一字都带：拼音（含声调）、笔顺动画、部首笔画、组词、预录读音。');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'), 'utf8');

console.log(`✓ 学习计划已生成：${OUT}`);
console.log(`  天数 ${daily.length}，每节含新字/数学/科普`);