/**
 * distractor.ts — 生成「像样」的干扰读音
 *
 * 为什么必须有这个模块：原先三个答题屏的错误选项直接写成「不是这个」，
 * 正确选项写拼音 —— 老人只要挑那个「看起来像答案」的就能全对。
 * 后果不只是练习失效：**摸底会高估识字量**，把她其实不认识的字从字序里剔除，
 * 家属端看到的正确率也全是假的。这是实测发现的真实缺陷。
 *
 * 干扰项要求：
 *  1 与正确读音不同（含多音字的全部读音都要避开）
 *  2 优先同声调数、相近长度 —— 太容易一眼排除就没有练习价值
 *  3 同一 (字, 种子) 稳定复现，避免重渲染时选项跳变
 */

import type { CharacterRecord } from './types.js';

/** 可复现的伪随机（与 placement 的抽样同一套思路） */
function makeRand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** 把字符串散列成种子，让同一个字在同一批次里拿到同一个干扰项 */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const syllableCount = (py: string) => py.trim().split(/\s+/).filter(Boolean).length;

/**
 * 从字池里挑一个与 target 读音不同的拼音。
 * 池子不够时退回一组常见读音，绝不返回「不是这个」这类提示性文案。
 */
export function pickReadingDistractor(
  target: CharacterRecord,
  pool: CharacterRecord[],
  seed = hashSeed(target.char),
): string {
  const banned = new Set(
    [target.pinyin, ...(target.readings ?? [])].map((s) => s.trim().toLowerCase()),
  );
  const rand = makeRand(seed);

  const candidates = pool.filter((c) => {
    const py = c.pinyin?.trim();
    return Boolean(py) && !banned.has(py.toLowerCase());
  });
  if (candidates.length === 0) {
    // 极端兜底：池子里没有别的读音（例如只教一个字）。用固定常见读音，仍不提示答案。
    const fallback = ['shì', 'rén', 'shuǐ', 'dà', 'xiǎo', 'zhōng'];
    const usable = fallback.filter((p) => !banned.has(p));
    return usable[Math.floor(rand() * usable.length)] ?? 'mén';
  }

  // 优先同声调数（音节数相同）且长度接近的，难度更像真实辨识
  const want = syllableCount(target.pinyin);
  const near = candidates.filter((c) => syllableCount(c.pinyin) === want);
  const from = near.length > 0 ? near : candidates;
  const picked = from[Math.floor(rand() * from.length)]!;
  return picked.pinyin.trim();
}

/** 正确项在左还是在右：每题独立随机，不能用 idx % 2（会被摸出规律） */
export function answerOnLeft(seed: number): boolean {
  return makeRand(seed)() < 0.5;
}