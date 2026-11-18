import { describe, expect, it } from 'vitest';
import {
  buildDailyPlan,
  estimateDaysRemaining,
  isConsolidationDay,
  isDayComplete,
  itemsDone,
  nextNewChars,
  summarizeReport,
  toDateKey,
} from '../daily.js';
import { initReviewState } from '../srs.js';
import type { DailyTask, ReviewState } from '../schema.js';

const NOW = Date.UTC(2026, 0, 10, 9, 0, 0);
const DEV = 'dev-1';
const DATE = '2026-01-10';

function due(chars: string[]): ReviewState[] {
  return chars.map((c) => ({ ...initReviewState(c, DEV, NOW), dueAt: NOW - 1000 }));
}

const base = {
  date: DATE,
  now: NOW,
  mathDone: false,
  scienceDone: false,
};

describe('toDateKey', () => {
  it('补零到 YYYY-MM-DD', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('isConsolidationDay', () => {
  it('每 7 天是巩固日，第 0 天不是', () => {
    expect(isConsolidationDay(7)).toBe(true);
    expect(isConsolidationDay(14)).toBe(true);
    expect(isConsolidationDay(90)).toBe(false);
    expect(isConsolidationDay(1)).toBe(false);
    expect(isConsolidationDay(0)).toBe(false);
  });
});

describe('buildDailyPlan', () => {
  it('普通日：20 新字 + 到期复习 + 数学 + 科普 = 4 项', () => {
    const plan = buildDailyPlan({ ...base, dayIndex: 1, states: due(['人', '口']) });
    expect(plan.newTarget).toBe(20);
    expect(plan.reviewChars).toEqual(['人', '口']);
    expect(plan.remainingItems).toBe(4);
    expect(plan.isConsolidation).toBe(false);
  });

  it('巩固日不给新字', () => {
    const plan = buildDailyPlan({ ...base, dayIndex: 7, states: due(['人']) });
    expect(plan.newTarget).toBe(0);
    expect(plan.isConsolidation).toBe(true);
    // 没有新字任务，剩复习+数学+科普 3 项
    expect(plan.remainingItems).toBe(3);
  });

  it('没有到期复习时不计入剩余项', () => {
    const plan = buildDailyPlan({ ...base, dayIndex: 2, states: [] });
    expect(plan.reviewTarget).toBe(0);
    expect(plan.remainingItems).toBe(3); // 新字 + 数学 + 科普
  });

  it('正确率过低时新字减半并带说明', () => {
    const hist = [
      { date: '2026-01-07', correct: 5, total: 10 },
      { date: '2026-01-08', correct: 6, total: 10 },
      { date: '2026-01-09', correct: 6, total: 10 },
    ];
    const plan = buildDailyPlan({ ...base, dayIndex: 5, states: [], history: hist });
    expect(plan.newTarget).toBe(10);
    expect(plan.paceNote).toContain('减半');
  });
});

describe('itemsDone / isDayComplete', () => {
  const plan = buildDailyPlan({ ...base, dayIndex: 1, states: due(['人']) });

  it('一项没做时完成度为 0', () => {
    expect(itemsDone(plan, { newDone: 0, reviewDone: 0 })).toBe(0);
    expect(isDayComplete(plan, { newDone: 0, reviewDone: 0 })).toBe(false);
  });

  it('新字做完计 1 项（复习/数学/科普都还没做）', () => {
    expect(itemsDone(plan, { newDone: 20, reviewDone: 0 })).toBe(1);
  });

  it('四项全绿才算当天完成', () => {
    const full = buildDailyPlan({ ...base, dayIndex: 1, states: due(['人']), mathDone: true, scienceDone: true });
    expect(itemsDone(full, { newDone: 20, reviewDone: 1 })).toBe(4);
    expect(isDayComplete(full, { newDone: 20, reviewDone: 1 })).toBe(true);
  });

  it('任务做完但复习没做完不算完成', () => {
    const p = buildDailyPlan({ ...base, dayIndex: 1, states: due(['人', '口']), mathDone: true, scienceDone: true });
    expect(isDayComplete(p, { newDone: 20, reviewDone: 1 })).toBe(false);
  });
});

describe('nextNewChars — 顺延语义', () => {
  const daily = [
    { day: 1, chars: ['一', '二'] },
    { day: 2, chars: ['三', '四'] },
    { day: 3, chars: ['五', '六'] },
  ];

  it('按已学字数推进，不按日历日', () => {
    expect(nextNewChars(daily, 0, 2)).toEqual(['一', '二']);
    expect(nextNewChars(daily, 2, 2)).toEqual(['三', '四']);
  });

  it('中途没做完时接着做剩下的', () => {
    expect(nextNewChars(daily, 1, 3)).toEqual(['二', '三', '四']);
  });

  it('学完时不越界', () => {
    expect(nextNewChars(daily, 6, 2)).toEqual([]);
    expect(nextNewChars(daily, 5, 10)).toEqual(['六']);
  });
});

describe('estimateDaysRemaining', () => {
  it('按剩余字数与每日量估算', () => {
    expect(estimateDaysRemaining(1800, 0, 20)).toBe(90);
    expect(estimateDaysRemaining(1800, 600, 20)).toBe(60);
    expect(estimateDaysRemaining(1800, 1790, 20)).toBe(1);
    expect(estimateDaysRemaining(1800, 1800, 20)).toBe(0);
  });

  it('每日量为 0 时返回无穷', () => {
    expect(estimateDaysRemaining(100, 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('summarizeReport', () => {
  it('四项都完成 → itemsDone 4', () => {
    const task: DailyTask = {
      deviceId: DEV,
      date: DATE,
      dayIndex: 3,
      newTarget: 20,
      newDone: 20,
      reviewTarget: 80,
      reviewDone: 80,
      mathDone: true,
      scienceDone: true,
      durationSec: 1500,
      completedAt: NOW,
    };
    const r = summarizeReport(task, 0.85, 3);
    expect(r.itemsDone).toBe(4);
    expect(r.newLearned).toBe(20);
    expect(r.reviewed).toBe(80);
    expect(r.streak).toBe(3);
  });

  it('部分完成只计已完成的项', () => {
    const task: DailyTask = {
      deviceId: DEV,
      date: DATE,
      dayIndex: 3,
      newTarget: 20,
      newDone: 12,
      reviewTarget: 80,
      reviewDone: 80,
      mathDone: true,
      scienceDone: false,
      durationSec: 900,
      completedAt: null,
    };
    const r = summarizeReport(task, 0.6, 0);
    expect(r.itemsDone).toBe(2); // 复习 + 数学
  });
});
