import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  decidePace,
  dueQueue,
  initReviewState,
  isMastered,
  type DayAccuracy,
} from '../srs.js';
import { DAY_MS } from '../srs.js';
import type { ReviewState } from '../schema.js';

const D0 = Date.UTC(2026, 0, 1);
const dev = 'dev-1';

function fresh(): ReviewState {
  return initReviewState('人', dev, D0);
}

/** 走到"已升一档"的状态：跨两个会话各答对一次 */
function afterOnePromotion(now: number): ReviewState {
  let s = fresh();
  s = applyAnswer(s, 'correct', { sessionId: 's1', now });
  s = applyAnswer(s, 'correct', { sessionId: 's2', now: now + 1000 });
  return s;
}

describe('initReviewState', () => {
  it('新字进入 D+1 复习队列', () => {
    const s = fresh();
    expect(s.stage).toBe(0);
    expect(s.dueAt).toBe(D0 + DAY_MS);
    expect(s.lapses).toBe(0);
    expect(s.consecutiveCorrect).toBe(0);
  });
});

describe('applyAnswer — 答对', () => {
  it('同一会话内连续答对两次不升档（必须跨时段）', () => {
    let s = fresh();
    const now = D0 + DAY_MS;
    s = applyAnswer(s, 'correct', { sessionId: 'same', now });
    s = applyAnswer(s, 'correct', { sessionId: 'same', now: now + 5000 });
    expect(s.stage).toBe(0);
    expect(s.consecutiveCorrect).toBe(2);
  });

  it('跨两个会话各答对一次 → 升到第 1 档，下个间隔 3 天', () => {
    const now = D0 + DAY_MS;
    const s = afterOnePromotion(now);
    expect(s.stage).toBe(1);
    // 升档发生在第二次作答时刻（now + 1000），间隔从那一刻算起
    expect(s.dueAt).toBe(now + 1000 + 3 * DAY_MS);
  });

  it('连续升档到 4 即掌握，不再排期', () => {
    let s = fresh();
    let now = D0;
    for (let i = 0; i < 8; i++) {
      s = applyAnswer(s, 'correct', { sessionId: `s${i}`, now: (now += DAY_MS) });
    }
    expect(s.stage).toBe(4);
    expect(isMastered(s)).toBe(true);
    expect(s.dueAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('未达掌握时保持在复习队列里（6 小时后）', () => {
    const now = D0 + DAY_MS;
    let s = fresh();
    s = applyAnswer(s, 'correct', { sessionId: 's1', now });
    expect(s.dueAt).toBe(now + 6 * 3_600_000);
  });
});

describe('applyAnswer — 答错', () => {
  it('答错降一档、清零连对、当天 10 分钟后补考', () => {
    const now = D0 + 5 * DAY_MS;
    const s = afterOnePromotion(now); // stage 1
    const wrong = applyAnswer(s, 'wrong', { sessionId: 's3', now: now + 1000 });
    expect(wrong.stage).toBe(0);
    expect(wrong.consecutiveCorrect).toBe(0);
    expect(wrong.lapses).toBe(1);
    expect(wrong.dueAt).toBe(now + 1000 + 10 * 60_000);
  });

  it('第 0 档答错不会降成负数', () => {
    const now = D0 + DAY_MS;
    const s = applyAnswer(fresh(), 'wrong', { sessionId: 's1', now });
    expect(s.stage).toBe(0);
    expect(s.lapses).toBe(1);
  });

  it('掌握后答错会退回队列', () => {
    let s = fresh();
    let now = D0;
    for (let i = 0; i < 8; i++) s = applyAnswer(s, 'correct', { sessionId: `s${i}`, now: (now += DAY_MS) });
    expect(isMastered(s)).toBe(true);
    const back = applyAnswer(s, 'wrong', { sessionId: 'late', now: now + DAY_MS });
    expect(back.stage).toBe(3);
    expect(isMastered(back)).toBe(false);
    expect(back.dueAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('dueQueue', () => {
  it('只返回到期且未掌握的字，按到期时间升序', () => {
    const a = { ...fresh(), char: 'A', dueAt: D0 - 2 * DAY_MS };
    const b = { ...fresh(), char: 'B', dueAt: D0 - DAY_MS };
    const c = { ...fresh(), char: 'C', dueAt: D0 + 5 * DAY_MS };
    const d = { ...fresh(), char: 'D', dueAt: D0 - DAY_MS, stage: 4 as const };
    const q = dueQueue([a, b, c, d], D0);
    expect(q.map((s) => s.char)).toEqual(['A', 'B']);
  });
});

describe('decidePace — 自适应降速', () => {
  const mk = (correct: number, total: number, i: number): DayAccuracy => ({
    date: `2026-01-0${i + 1}`,
    correct,
    total,
  });

  it('数据不足 3 天时不做判断', () => {
    const d = decidePace(20, [mk(5, 10, 0), mk(9, 10, 1)]);
    expect(d.slowed).toBe(false);
    expect(d.newPerDay).toBe(20);
    expect(d.rollingAccuracy).toBeNull();
  });

  it('正确率低于 70% → 新字减半并给出说明', () => {
    const hist = [mk(5, 10, 0), mk(6, 10, 1), mk(6, 10, 2)];
    const d = decidePace(20, hist);
    expect(d.slowed).toBe(true);
    expect(d.newPerDay).toBe(10);
    expect(d.reason).toContain('减半');
    expect(d.rollingAccuracy).toBeCloseTo(17 / 30, 5);
  });

  it('正确率达标则保持原节奏', () => {
    const hist = [mk(9, 10, 0), mk(8, 10, 1), mk(9, 10, 2)];
    const d = decidePace(20, hist);
    expect(d.slowed).toBe(false);
    expect(d.newPerDay).toBe(20);
  });

  it('只统计最近 7 天', () => {
    const bad = Array.from({ length: 10 }, (_, i) => mk(1, 10, i));
    const good = Array.from({ length: 7 }, (_, i) => mk(10, 10, i + 10));
    const d = decidePace(20, [...bad, ...good]);
    expect(d.slowed).toBe(false);
  });

  it('跳过没有作答的日期，只用有作答的天数算准确率', () => {
    const d = decidePace(20, [
      mk(8, 10, 0),
      { date: 'gap', correct: 0, total: 0 },
      mk(8, 10, 1),
      mk(8, 10, 2),
    ]);
    expect(d.rollingAccuracy).toBeCloseTo(0.8, 5);
  });

  it('有作答的天数不足 3 天时不下判断（避免误降速）', () => {
    const d = decidePace(20, [mk(8, 10, 0), { date: 'gap', correct: 0, total: 0 }, mk(8, 10, 1)]);
    expect(d.rollingAccuracy).toBeNull();
    expect(d.slowed).toBe(false);
  });
});
