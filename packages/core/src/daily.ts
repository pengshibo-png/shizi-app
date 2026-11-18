import { dueQueue, decidePace, type DayAccuracy } from './srs.js';
import type { DailyTask, ReviewState } from './schema.js';

/** 每日固定任务量 —— 不划分时段，老人一天里随便什么时候做。 */
export const NEW_PER_DAY = 20;
export const TOTAL_DAYS = 90;

/** 本地日期 → YYYY-MM-DD */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 今天的任务板。
 *
 * 设计要点（对应「不要分时段」这条需求）：
 *  - 只有"今天要做多少"，没有"什么时候做"。
 *  - 四项任务：学新字 / 复习 / 数学 / 科普。
 *  - 任意一项有进展就算今天有学习，不判为中断，保心态。
 */
export interface DailyPlan {
  date: string;
  dayIndex: number;
  newTarget: number;
  /** 今天该复习的字（按到期时间排序） */
  reviewChars: string[];
  reviewTarget: number;
  mathDone: boolean;
  scienceDone: boolean;
  /** 剩余项数，用于首页"今天还剩 X 项" */
  remainingItems: number;
  /** 是否为巩固日（每 7 天一次，0 新字） */
  isConsolidation: boolean;
  /** 触发降速时的说明，给家属端展示 */
  paceNote: string | null;
}

export function isConsolidationDay(dayIndex: number): boolean {
  return dayIndex > 0 && dayIndex % 7 === 0;
}

export function buildDailyPlan(opts: {
  date: string;
  dayIndex: number;
  states: Iterable<ReviewState>;
  now: number;
  mathDone: boolean;
  scienceDone: boolean;
  history?: DayAccuracy[];
  baseNewPerDay?: number;
}): DailyPlan {
  const {
    date,
    dayIndex,
    states,
    now,
    mathDone,
    scienceDone,
    history = [],
    baseNewPerDay = NEW_PER_DAY,
  } = opts;

  const consolidation = isConsolidationDay(dayIndex);
  const pace = decidePace(baseNewPerDay, history);
  const newTarget = consolidation ? 0 : pace.newPerDay;

  const due = dueQueue(states, now);
  const reviewChars = due.map((s) => s.char);

  const remainingItems =
    (newTarget > 0 ? 1 : 0) +
    (reviewChars.length > 0 ? 1 : 0) +
    (mathDone ? 0 : 1) +
    (scienceDone ? 0 : 1);

  return {
    date,
    dayIndex,
    newTarget,
    reviewChars,
    reviewTarget: reviewChars.length,
    mathDone,
    scienceDone,
    remainingItems,
    isConsolidation: consolidation,
    paceNote: pace.reason,
  };
}

/** 今日完成度 0..4，家属端显示 "今日 3/4 项" */
export function itemsDone(
  plan: DailyPlan,
  progress: { newDone: number; reviewDone: number },
): number {
  let n = 0;
  if (plan.newTarget === 0 || progress.newDone >= plan.newTarget) n += 1;
  if (plan.reviewTarget === 0 || progress.reviewDone >= plan.reviewTarget) n += 1;
  if (plan.mathDone) n += 1;
  if (plan.scienceDone) n += 1;
  return n;
}

export function isDayComplete(plan: DailyPlan, progress: { newDone: number; reviewDone: number }): boolean {
  const newOk = plan.newTarget === 0 || progress.newDone >= plan.newTarget;
  const revOk = plan.reviewTarget === 0 || progress.reviewDone >= plan.reviewTarget;
  return newOk && revOk && plan.mathDone && plan.scienceDone;
}

/**
 * 该学哪 20 个字。
 *
 * 采用"顺延"语义：不按日历日硬绑教材日次，而是按**实际已学字数**推进。
 * 某天没做完 20 个，第二天接着做剩下的，总周期相应变长 —— 界面如实显示
 * "预计还需 N 天"，而不是假装还差 90 天。
 */
export function nextNewChars(
  dailyChars: ReadonlyArray<{ day: number; chars: readonly string[] }>,
  learnedCount: number,
  count: number,
): string[] {
  const flat = dailyChars.flatMap((d) => d.chars);
  return flat.slice(learnedCount, learnedCount + count);
}

/** 预计还需多少天（按每天 newPerDay 计） */
export function estimateDaysRemaining(total: number, learned: number, newPerDay: number): number {
  const left = Math.max(0, total - learned);
  if (newPerDay <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(left / newPerDay);
}

/** 把任务记录汇总成家属端要看的日报 */
export function summarizeReport(task: DailyTask, accuracy: number, streak: number) {
  const itemsDoneCount =
    (task.newTarget === 0 || task.newDone >= task.newTarget ? 1 : 0) +
    (task.reviewTarget === 0 || task.reviewDone >= task.reviewTarget ? 1 : 0) +
    (task.mathDone ? 1 : 0) +
    (task.scienceDone ? 1 : 0);

  return {
    deviceId: task.deviceId,
    date: task.date,
    newLearned: task.newDone,
    reviewed: task.reviewDone,
    accuracy,
    durationSec: task.durationSec,
    mathDone: task.mathDone,
    scienceDone: task.scienceDone,
    itemsDone: itemsDoneCount,
    streak,
  };
}
