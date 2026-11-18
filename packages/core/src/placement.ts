/**
 * placement.ts — 摸底定级（一次性，首启时）
 *
 * 背景：奶奶不是零基础（会接微信视频、认识部分字）。原实现 learnedCount 从 0
 * 线性推进 = 从「一」开始重教一个会用微信的人 = 把她当小孩，弃用风险最高。
 *
 * 方案：
 *   识字：分层抽样 120 字（592/358/550/extra 按比例），二选一认读。
 *         已认识 → 标记 known 并从字序剔除；不认识 → 保留待学。
 *         全程答错不责备（本来就不该当作考试）。
 *   数学：6 题定起点，按答对情况跳过基础课。
 *
 * 摸底结果同时是家属端第一条有用数据（「奶奶原来认识约 N 字」）。
 */

import type { CharacterRecord } from './types.js';
import { hashSeed, pickReadingDistractor } from './distractor.js';

export interface PlacementOutcome {
  charAnswers: { char: string; correct: boolean; ms: number }[];
  mathAnswers: boolean[];
  mathStart: number;
}

// ---------------------------------------------------------------- 识字抽样

/**
 * 各档抽样数：按 3500 字表的真实占比分配，合计 120。
 * 字表从 1800 扩到 3500 后 extra 档从 300 涨到 2000（占 57%），
 * 若仍只抽 25 个，回推出来的识字量会非常噪 —— 必须按占比重配。
 *   592/3500=16.9% → 20   358/3500=10.2% → 12
 *   550/3500=15.7% → 19   extra 2000/3500=57.1% → 69
 */
export const SAMPLE_PLAN = [
  { tier: '592', take: 20 },
  { tier: '358', take: 12 },
  { tier: '550', take: 19 },
  { tier: 'extra', take: 69 },
] as const;

export const SAMPLE_TOTAL = SAMPLE_PLAN.reduce((s, p) => s + p.take, 0); // 120

/** 可复现抽样（固定种子，同一设备同一批题） */
function seededPick(arr: CharacterRecord[], n: number, seed: number): CharacterRecord[] {
  const a = [...arr];
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a.slice(0, n);
}

export interface PlacementSample {
  char: CharacterRecord;
  /** 干扰**读音**（不是干扰字，也不是「不是这个」这类提示文案） */
  distractor: string;
}

/**
 * 生成摸底题单：每题「这个字念什么」二选一。
 * 干扰项必须是另一个真实读音 —— 原先错误项写「不是这个」，
 * 老人挑那个像答案的就能全对，摸底会高估识字量并跳过她其实不认识的字。
 */
export function buildSample(chars: CharacterRecord[], seed = 42): PlacementSample[] {
  const byTier = new Map<string, CharacterRecord[]>();
  for (const c of chars) {
    const k = c.tier;
    if (!byTier.has(k)) byTier.set(k, []);
    byTier.get(k)!.push(c);
  }
  const pool: CharacterRecord[] = [];
  for (const p of SAMPLE_PLAN) {
    const arr = byTier.get(p.tier) ?? [];
    if (arr.length === 0) continue;
    pool.push(...seededPick(arr, Math.min(p.take, arr.length), seed + p.tier.length));
  }
  return pool.map((c) => ({
    char: c,
    distractor: pickReadingDistractor(c, chars, hashSeed(`${c.char}:${seed}`)),
  }));
}

// ---------------------------------------------------------------- 摸底结果

export interface PlacementResult {
  /** 摸底认出的字（char 集合）——从字序剔除 */
  knownChars: Set<string>;
  /** 抽样明细：每题 字/对错/耗时（给家属端看） */
  answers: { char: string; correct: boolean; ms: number }[];
  /** 推断的总识字量估计（分层回推） */
  estimatedKnown: number;
  /** 摸底时间 */
  takenAt: number;
}

/**
 * 分层回推：每档的答对率 × 该档总量，加总得估计识字量。
 * 这是家属端「奶奶原来认识约 N 字」的数据来源。
 */
export function estimateKnown(chars: CharacterRecord[], answers: { char: string; correct: boolean }[]): number {
  const byTier = new Map<string, { hit: number; n: number }>();
  for (const a of answers) {
    const c = chars.find((x) => x.char === a.char);
    const t = c?.tier ?? 'extra';
    const rec = byTier.get(t) ?? { hit: 0, n: 0 };
    rec.n++;
    if (a.correct) rec.hit++;
    byTier.set(t, rec);
  }
  const tierSize = new Map<string, number>();
  for (const c of chars) {
    const k = c.tier;
    tierSize.set(k, (tierSize.get(k) ?? 0) + 1);
  }
  let est = 0;
  for (const [t, rec] of byTier) {
    const size = tierSize.get(t) ?? 0;
    est += (rec.hit / Math.max(1, rec.n)) * size;
  }
  return Math.round(est);
}

/** 从摸底答案生成结果（correct = 认识） */
export function makeResult(
  chars: CharacterRecord[],
  answers: { char: string; correct: boolean; ms: number }[],
): PlacementResult {
  return {
    knownChars: new Set(answers.filter((a) => a.correct).map((a) => a.char)),
    answers,
    estimatedKnown: estimateKnown(chars, answers),
    takenAt: Date.now(),
  };
}

// ---------------------------------------------------------------- 数学摸底

/** 6 题定起点。skipTo 返回应直接进入的天序。 */
export const MATH_CHECKS = [
  {
    id: 'm1',
    prompt: '这个数是多少？',
    options: ['86', '68'],
    correct: 0,
    hint: '十位是8，个位是6',
    /** 100 以内数字认识 → 跳过数与量前 6 课 */
    passSkip: 7,
    failSkip: 1,
  },
  {
    id: 'm2',
    prompt: '13 加 5 等于多少？',
    options: ['18', '17'],
    correct: 0,
    hint: '13 再数 5 个',
    /** 20 以内加减 → 跳过加减法前 8 课 */
    passSkip: 15,
    failSkip: 7,
  },
  {
    id: 'm3',
    prompt: '这张钱是多少元？',
    options: ['50', '100'],
    correct: 1,
    hint: '红色的最大张是100',
    /** 认识人民币面额 → 跳到购物找零（第 27 天模块） */
    passSkip: 27,
    failSkip: 15,
  },
  {
    id: 'm4',
    prompt: '现在是几点？（看钟面）',
    options: ['3 点', '6 点'],
    correct: 0,
    hint: '短针指 3 就是 3 点',
    /** 会看整点 → 跳过钟表前 2 课 */
    passSkip: 39,
    failSkip: 37,
  },
  {
    id: 'm5',
    prompt: '鸡蛋 6 元一斤，买两斤多少钱？',
    options: ['12 元', '8 元'],
    correct: 0,
    hint: '6 加 6',
    /** 会算总价 → 直接进生活中的数 */
    passSkip: 71,
    failSkip: 39,
  },
  {
    id: 'm6',
    prompt: '血压计上显示 140/90，高压是多少？',
    options: ['140', '90'],
    correct: 0,
    hint: '斜杠前面是高压',
    passSkip: 76,
    failSkip: 71,
  },
] as const;

/** 顺序答 6 题（答错即停：基础没过就不必往后测），返回起点 day */
export function mathStartDay(answers: boolean[]): number {
  let start = 1;
  for (let i = 0; i < answers.length && i < MATH_CHECKS.length; i++) {
    const check = MATH_CHECKS[i]!;
    if (answers[i]) start = check.passSkip;
    else break; // 基础没过，从基础补
  }
  return start;
}

// ---------------------------------------------------------------- 首启流程

export type PlacementState =
  | { phase: 'not-taken' }
  | { phase: 'char' } // 识字摸底进行中（外部驱动题目流）
  | { phase: 'math' } // 数学摸底进行中
  | { phase: 'done'; result: PlacementResult; mathStart: number };

const KEY = 'shi.placement.v1';

export function loadPlacement(): PlacementState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { phase: 'not-taken' };
    const p = JSON.parse(raw);
    if (p.phase === 'done') {
      // Set 序列化后是数组，还原
      p.result.knownChars = new Set(p.result.knownChars ?? []);
      return p;
    }
    return p;
  } catch {
    return { phase: 'not-taken' };
  }
}

export function savePlacement(s: PlacementState): void {
  try {
    const serial =
      s.phase === 'done'
        ? { ...s, result: { ...s.result, knownChars: [...s.result.knownChars] } }
        : s;
    localStorage.setItem(KEY, JSON.stringify(serial));
  } catch {
    /* 存不下不阻塞首启 */
  }
}

/**
 * 摸底完成后改造字序：已认识的字从学习队列剔除。
 * 返回新的「待学字序列」（保持原教学顺序的相对次序）。
 */
export function applyPlacementToOrder(
  dailyChars: { day: number; chars: string[] }[],
  known: Set<string>,
): { day: number; chars: string[] }[] {
  // 拍平后剔除已知字，再按每 20 字重新成天
  const flat: string[] = [];
  for (const d of dailyChars) for (const c of d.chars) if (!known.has(c)) flat.push(c);
  const out: { day: number; chars: string[] }[] = [];
  for (let i = 0; i < flat.length; i += 20) {
    out.push({ day: out.length + 1, chars: flat.slice(i, i + 20) });
  }
  return out;
}