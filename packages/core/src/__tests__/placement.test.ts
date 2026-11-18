import { describe, expect, it } from 'vitest';
import {
  MATH_CHECKS,
  SAMPLE_TOTAL,
  applyPlacementToOrder,
  buildSample,
  estimateKnown,
  makeResult,
  mathStartDay,
} from '../placement.js';
import type { CharacterRecord } from '../types.js';

// ---------------------------------------------------------------- 测试数据

const TIERS: CharacterRecord['tier'][] = ['592', '358', '550', 'extra'];
const TIER_SIZE: Record<string, number> = { 592: 592, 358: 358, 550: 550, extra: 2000 };

function makeChars(): CharacterRecord[] {
  const all: CharacterRecord[] = [];
  let code = 0x4e00; // 从「一」起连续取汉字
  for (const t of TIERS) {
    for (let i = 0; i < TIER_SIZE[t]; i++) {
      const ch = String.fromCharCode(code++);
      all.push({
        id: ch,
        char: ch,
        pinyin: 't',
        readings: ['t'],
        tier: t,
        day: 1,
        strokes: 5,
        audioKey: `c/${ch}`,
        wordIds: [],
      });
    }
  }
  return all;
}

const CHARS = makeChars();

// ---------------------------------------------------------------- 抽样

describe('buildSample 分层抽样', () => {
  const s = buildSample(CHARS, 42);
  it(`抽样总数 = ${SAMPLE_TOTAL}`, () => {
    expect(s.length).toBe(SAMPLE_TOTAL);
  });

  it('四档配比按 3500 字表占比（20/12/19/69）', () => {
    const byTier = new Map<string, number>();
    for (const q of s) byTier.set(q.char.tier, (byTier.get(q.char.tier) ?? 0) + 1);
    expect(byTier.get('592')).toBe(20);
    expect(byTier.get('358')).toBe(12);
    expect(byTier.get('550')).toBe(19);
    expect(byTier.get('extra')).toBe(69);
  });

  it('同种子可复现（同设备同一批题）', () => {
    const s2 = buildSample(CHARS, 42);
    expect(s2.map((x) => x.char.char)).toEqual(s.map((x) => x.char.char));
  });

  it('每题有干扰项且不等于答案', () => {
    for (const q of s) expect(q.distractor).not.toBe(q.char.char);
  });

  it('抽样无重复字', () => {
    const set = new Set(s.map((x) => x.char.char));
    expect(set.size).toBe(s.length);
  });
});

// ---------------------------------------------------------------- 估计回推

describe('estimateKnown 分层回推', () => {
  it('全对 → 估计接近全量 3500', () => {
    const sample = buildSample(CHARS, 42);
    const answers = sample.map((q) => ({ char: q.char.char, correct: true }));
    // 全对时每档命中率 100% → 592+358+550+2000=3500
    expect(estimateKnown(CHARS, answers)).toBe(3500);
  });

  it('全错 → 0', () => {
    const sample = buildSample(CHARS, 42);
    const answers = sample.map((q) => ({ char: q.char.char, correct: false }));
    expect(estimateKnown(CHARS, answers)).toBe(0);
  });

  it('592 档全对、其余全错 → 约 592', () => {
    const sample = buildSample(CHARS, 42);
    const answers = sample.map((q) => ({ char: q.char.char, correct: q.char.tier === '592' }));
    expect(estimateKnown(CHARS, answers)).toBe(592);
  });

  it('半对 → 半量附近', () => {
    const sample = buildSample(CHARS, 42);
    const answers = sample.map((q, i) => ({ char: q.char.char, correct: i % 2 === 0 }));
    const est = estimateKnown(CHARS, answers);
    expect(est).toBeGreaterThan(1400);
    expect(est).toBeLessThan(2100);
  });
});

// ---------------------------------------------------------------- 字序改造

describe('applyPlacementToOrder 剔除已知字', () => {
  const daily = Array.from({ length: 90 }, (_, i) => ({
    day: i + 1,
    chars: CHARS.slice(i * 20, (i + 1) * 20).map((c) => c.char),
  }));

  it('全不认识 → 顺序不变（90 天 × 20）', () => {
    const out = applyPlacementToOrder(daily, new Set());
    expect(out.length).toBe(90);
    expect(out[0].chars.length).toBe(20);
    expect(out[0].chars).toEqual(daily[0].chars);
  });

  it('认识前 100 字 → 天数减少且已知字不再出现', () => {
    const known = new Set(CHARS.slice(0, 100).map((c) => c.char));
    const out = applyPlacementToOrder(daily, known);
    const total = out.reduce((s, d) => s + d.chars.length, 0);
    expect(total).toBe(1800 - 100);
    // 已知字绝不出现
    for (const d of out) for (const c of d.chars) expect(known.has(c)).toBe(false);
    // 保持原相对次序：第一个仍是原第 101 个字
    expect(out[0].chars[0]).toBe(CHARS[100].char);
    // 1700 字 ÷ 20 = 85 天
    expect(out.length).toBe(85);
  });

  it('认识 900 字 → 45 天，且巩固日语义仍按新序生效', () => {
    const known = new Set(CHARS.slice(0, 900).map((c) => c.char));
    const out = applyPlacementToOrder(daily, known);
    expect(out.length).toBe(45);
    expect(out[44].chars.length).toBe(20);
  });
});

// ---------------------------------------------------------------- 数学起点

describe('mathStartDay 答到哪跳到哪', () => {
  it('一题不对 → 第 1 天（从最基础补）', () => {
    expect(mathStartDay([false])).toBe(1);
    expect(mathStartDay([false, true, true])).toBe(1);
  });

  it('第1题对（认识数字）→ 第 7 天（跳过数与量前6课）', () => {
    expect(mathStartDay([true])).toBe(7);
  });

  it('前两题对 → 第 15 天', () => {
    expect(mathStartDay([true, true])).toBe(15);
  });

  it('认识数字+加减+人民币 → 第 27 天（购物找零）', () => {
    expect(mathStartDay([true, true, true])).toBe(27);
  });

  it('会看钟 → 第 39 天', () => {
    expect(mathStartDay([true, true, true, true])).toBe(39);
  });

  it('全对 → 第 76 天（读血压）', () => {
    expect(mathStartDay([true, true, true, true, true, true])).toBe(76);
  });

  it('中途断档：对对错 → 停在最后一档 pass 值', () => {
    expect(mathStartDay([true, true, false])).toBe(15);
  });

  it('题量守恒：6 题', () => {
    expect(MATH_CHECKS.length).toBe(6);
  });
});

// ---------------------------------------------------------------- 结果

describe('makeResult', () => {
  it('knownChars 只含答对的', () => {
    const sample = buildSample(CHARS, 7);
    const answers = sample.slice(0, 10).map((q, i) => ({
      char: q.char.char,
      correct: i < 6, // 前 6 对后 4 错
      ms: 3000,
    }));
    const r = makeResult(CHARS, answers);
    expect(r.knownChars.size).toBe(6);
    expect(r.answers.length).toBe(10);
    expect(r.takenAt).toBeGreaterThan(0);
  });
});