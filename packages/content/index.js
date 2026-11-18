/**
 * 内容数据入口（纯 JS，类型声明见 index.d.ts）。
 *
 * 数据用**静态 import** 而非动态 import：Vite 8 对
 * `import('./x.json', { with: { type: 'json' } })` 的解析不稳定，
 * 会把路径丢到 @fs 之外导致 fetch 失败。静态 import 由构建器直接
 * 转成 JS 模块，dev 与 build 行为一致，且能自动分 chunk。
 *
 * 同理，带变量或查询串的动态 import 也会静默失败掉进兜底分支
 * （实测：磁盘上 215 条百科，页面读到的是 90 条 fallback）——
 * 所以百科也用静态 import。
 */

import charactersJson from './data/characters.json';
import wordsJson from './data/words.json';
import mathJson from './data/math.json';
import scienceJson from './data/science.json';
import encyclopediaJson from './data/encyclopedia.json';

let encyclopediaCache = null;

export async function loadCharacters() {
  return charactersJson;
}

export async function loadWords() {
  return wordsJson;
}

export async function loadMath() {
  return mathJson;
}

export async function loadScience() {
  return scienceJson;
}

/**
 * 生活百科（12 大类体系，data/encyclopedia.json 由 build-encyclopedia.mjs 产出）。
 * 构建脚本未跑过时，兜底把旧科普 8 主题当 8 大类，保证页面不白屏。
 */
export async function loadEncyclopedia() {
  if (encyclopediaCache) return encyclopediaCache;
  if (encyclopediaJson?.cards?.length > 0) {
    encyclopediaCache = encyclopediaJson;
  } else {
    encyclopediaCache = {
      meta: { total: scienceJson.cards.length, cats: 8, aShare: 0.5 },
      cats: [...new Set(scienceJson.cards.map((c) => c.theme))].map((t) => ({
        key: t,
        name: t,
        about: '',
        priority: 5,
        count: scienceJson.cards.filter((c) => c.theme === t).length,
      })),
      cards: scienceJson.cards.map((c, i) => ({ ...c, cat: c.theme, order: i + 1 })),
    };
  }
  return encyclopediaCache;
}

/** 同步取用（需要立刻拿到数据时用，避免多一次 await） */
export const charactersData = charactersJson;
export const wordsData = wordsJson;
export const mathData = mathJson;
export const scienceData = scienceJson;
export const encyclopediaData = encyclopediaJson;

/**
 * 笔顺数据（1800 字 / 4.18 MB）——懒加载，不进主包。
 * 用**静态路径**的动态 import：Vite 能正确分 chunk；
 * 带变量或查询串会静默失败（本仓踩过），所以路径写死。
 */
let strokesCache = null;
export async function loadStrokes() {
  if (strokesCache) return strokesCache;
  const m = await import('./data/strokes.json');
  strokesCache = (m.default ?? m).chars;
  return strokesCache;
}

/** 按字建索引，避免 O(n) 查找 */
export function indexByChar(chars) {
  const m = new Map();
  for (const c of chars) m.set(c.char, c);
  return m;
}

export function indexWords(words) {
  const m = new Map();
  for (const w of words) m.set(w.id, w);
  return m;
}

/** 某字的词组（最多 3 个），已按常用度排好 */
export function wordsOf(char, wordsById) {
  const out = [];
  for (const id of char.wordIds) {
    const w = wordsById.get(id);
    if (w) out.push(w);
  }
  return out;
}