import { buildDailyPlan, itemsDone, isDayComplete, nextNewChars, toDateKey } from '@shi/core';
import type { DailyPlan } from '@shi/core';
import type { AppState } from './store.js';

/**
 * derive.ts — 老人端的派生计算
 *
 * core 提供纯函数，这里负责把它们接到 AppState 上。
 */

export { buildDailyPlan, itemsDone, isDayComplete, nextNewChars, toDateKey };
export type { DailyPlan };

/** 连续学习天数：今天没学不算断，从昨天往前数 */
export function computeStreakSafe(state: AppState, today: Date): number {
  const active = new Set(state.sessions.map((s) => s.date));
  for (const [date, t] of Object.entries(state.tasks)) {
    if (t.newDone > 0 || t.reviewDone > 0 || t.mathDone || t.scienceDone) active.add(date);
  }
  let streak = 0;
  const d = new Date(today.getTime());
  if (!active.has(toDateKey(d))) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 400; i++) {
    const key = toDateKey(d);
    if (!active.has(key)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}