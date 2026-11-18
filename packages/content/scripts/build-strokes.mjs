/**
 * build-strokes.mjs — 为 3500 个教学字打包笔顺数据
 *
 * 源：hanzi-writer-data（Arphic PL 授权，9575 字 / 30.8 MB）
 * 只取我们教的 3500 字，且只留 strokes + medians（动画与描红判定所需），
 * 丢掉 radStrokes 等用不到的字段，把体积压到最小。
 *
 * 输出：packages/content/data/strokes.json
 *   { meta:{count,bytes}, chars: { "一": {s:[path...], m:[[[x,y]...]]} } }
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const ROOT = join(PKG, '..', '..');
const require = createRequire(import.meta.url);

// 定位 hanzi-writer-data（pnpm 虚拟存储）
function findDataDir() {
  const direct = join(ROOT, 'node_modules', 'hanzi-writer-data');
  if (existsSync(direct)) return direct;
  const pnpm = join(ROOT, 'node_modules', '.pnpm');
  if (!existsSync(pnpm)) return null;
  const hit = readdirSync(pnpm).find((n) => n.startsWith('hanzi-writer-data@'));
  return hit ? join(pnpm, hit, 'node_modules', 'hanzi-writer-data') : null;
}

const dataDir = findDataDir();
if (!dataDir) {
  console.error('✗ 找不到 hanzi-writer-data，先 pnpm add -w hanzi-writer-data');
  process.exit(1);
}

const chars = JSON.parse(readFileSync(join(PKG, 'data', 'characters.json'), 'utf8')).characters;
const out = {};
const missing = [];

for (const c of chars) {
  const f = join(dataDir, `${c.char}.json`);
  if (!existsSync(f)) {
    missing.push(c.char);
    continue;
  }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  out[c.char] = { s: d.strokes, m: d.medians };
}

const json = JSON.stringify({ meta: { count: Object.keys(out).length }, chars: out });
writeFileSync(join(PKG, 'data', 'strokes.json'), json, 'utf8');

console.log(`✓ 笔顺打包：${Object.keys(out).length}/${chars.length} 字`);
console.log(`  体积 ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(2)} MB`);
if (missing.length) console.log(`  缺字 ${missing.length}：${missing.slice(0, 20).join('')}`);