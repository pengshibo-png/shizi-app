import { describe, expect, it } from 'vitest';
import { answerOnLeft, hashSeed, pickReadingDistractor } from '../distractor.js';
import type { CharacterRecord } from '../types.js';

const mk = (char: string, pinyin: string, readings?: string[]): CharacterRecord => ({
  id: char,
  char,
  pinyin,
  readings: readings ?? [pinyin],
  tier: '592',
  day: 1,
  strokes: 5,
  audioKey: `c/${char}`,
  wordIds: [],
});

const POOL = [
  mk('一', 'yī'), mk('二', 'èr'), mk('三', 'sān'), mk('四', 'sì'),
  mk('五', 'wǔ'), mk('人', 'rén'), mk('口', 'kǒu'), mk('手', 'shǒu'),
  mk('水', 'shuǐ'), mk('火', 'huǒ'), mk('山', 'shān'), mk('石', 'shí'),
];

describe('pickReadingDistractor', () => {
  it('绝不等于正确读音', () => {
    for (const c of POOL) {
      const d = pickReadingDistractor(c, POOL);
      expect(d.toLowerCase()).not.toBe(c.pinyin.toLowerCase());
    }
  });

  it('避开多音字的全部读音', () => {
    const poly = mk('重', 'zhòng', ['zhòng', 'chóng']);
    for (let s = 0; s < 40; s++) {
      const d = pickReadingDistractor(poly, [...POOL, mk('从', 'chóng')], s);
      expect(['zhòng', 'chóng']).not.toContain(d.toLowerCase());
    }
  });

  it('绝不返回提示性文案（这是原缺陷）', () => {
    for (const c of POOL) {
      const d = pickReadingDistractor(c, POOL);
      expect(d).not.toBe('不是这个');
      expect(d).not.toBe('？');
      expect(d.trim().length).toBeGreaterThan(0);
    }
  });

  it('同种子可复现（重渲染不跳变）', () => {
    const c = POOL[0]!;
    expect(pickReadingDistractor(c, POOL, 7)).toBe(pickReadingDistractor(c, POOL, 7));
  });

  it('不同种子能给出不同干扰项（不是恒为下一个）', () => {
    const c = POOL[0]!;
    const set = new Set(Array.from({ length: 30 }, (_, s) => pickReadingDistractor(c, POOL, s)));
    expect(set.size).toBeGreaterThan(3);
  });

  it('池子只有目标字时仍给出真实读音，不提示答案', () => {
    const only = mk('一', 'yī');
    const d = pickReadingDistractor(only, [only]);
    expect(d.toLowerCase()).not.toBe('yī');
    expect(d).not.toBe('不是这个');
    expect(d).not.toBe('？');
  });

  it('空池也不崩', () => {
    const d = pickReadingDistractor(mk('一', 'yī'), []);
    expect(typeof d).toBe('string');
    expect(d.length).toBeGreaterThan(0);
  });
});

describe('answerOnLeft', () => {
  it('左右都出现（不能恒左或恒右）', () => {
    const vals = Array.from({ length: 200 }, (_, i) => answerOnLeft(hashSeed(`q${i}`)));
    const left = vals.filter(Boolean).length;
    expect(left).toBeGreaterThan(60);
    expect(left).toBeLessThan(140);
  });

  it('不是 idx%2 那种可被摸出的规律', () => {
    const seq = Array.from({ length: 12 }, (_, i) => answerOnLeft(hashSeed(`item-${i}`)));
    const alternating = seq.every((v, i) => v === (i % 2 === 0));
    expect(alternating).toBe(false);
  });

  it('同种子稳定', () => {
    expect(answerOnLeft(123)).toBe(answerOnLeft(123));
  });
});