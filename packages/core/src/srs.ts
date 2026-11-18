import {
  INTERVALS_DAYS,
  MASTERY_CONSECUTIVE,
  type ReviewState,
  type SrsStage,
} from './schema.js';

export const DAY_MS = 86_400_000;

/** 新建一个字的初始复习状态：学完立刻进入 D+1 复习队列 */
export function initReviewState(
  char: string,
  deviceId: string,
  now: number,
): ReviewState {
  return {
    char,
    deviceId,
    stage: 0,
    dueAt: now + INTERVALS_DAYS[0]! * DAY_MS,
    lapses: 0,
    consecutiveCorrect: 0,
    lastCorrectSessionId: null,
    reviews: 0,
    lastSeenAt: now,
  };
}

export interface AnswerContext {
  /** 本次学习会话 id。同一会话内的连续答对不算"跨时段" */
  sessionId: string;
  now: number;
}

/**
 * 处理一次作答，返回更新后的状态。
 *
 * 规则（针对 60–80 岁学习者设计）：
 *  - 答对：连续答对 +1；若跨了不同会话且连续答对达到 2 次，升档。
 *  - 答错：降一档（不低于 0），连续答对清零，错次 +1，**当天再考一次**
 *    （dueAt 设为 now + 10 分钟，而不是明天），避免错误被带到下一次。
 *  - 到顶档 stage >= 4 视为已掌握，不再排期（dueAt 设为极大值）。
 */
export function applyAnswer(
  state: ReviewState,
  result: 'correct' | 'wrong',
  ctx: AnswerContext,
): ReviewState {
  const next: ReviewState = {
    ...state,
    reviews: state.reviews + 1,
    lastSeenAt: ctx.now,
  };

  if (result === 'correct') {
    const crossedSession =
      state.lastCorrectSessionId !== null &&
      state.lastCorrectSessionId !== ctx.sessionId;
    next.consecutiveCorrect = state.consecutiveCorrect + 1;
    next.lastCorrectSessionId = ctx.sessionId;

    const mastered = next.consecutiveCorrect >= MASTERY_CONSECUTIVE && crossedSession;
    if (mastered) {
      const stage = Math.min(state.stage + 1, 4) as SrsStage;
      next.stage = stage;
      next.consecutiveCorrect = 0;
      next.dueAt =
        stage >= 4
          ? Number.MAX_SAFE_INTEGER
          : ctx.now + INTERVALS_DAYS[Math.min(stage, INTERVALS_DAYS.length - 1)]! * DAY_MS;
    } else {
      // 还没跨会话，先按当前档位留在队列里（隔几小时再来一次）
      next.stage = state.stage;
      next.dueAt = ctx.now + 6 * 3_600_000;
    }
    return next;
  }

  // 答错：降档 + 当天补考
  next.stage = Math.max(state.stage - 1, 0) as SrsStage;
  next.consecutiveCorrect = 0;
  next.lapses = state.lapses + 1;
  next.lastCorrectSessionId = null;
  next.dueAt = ctx.now + 10 * 60_000;
  return next;
}

/** 取某个时刻所有到期的字，按到期时间升序（最该复习的排前面） */
export function dueQueue(states: Iterable<ReviewState>, now: number): ReviewState[] {
  const out: ReviewState[] = [];
  for (const s of states) {
    if (s.stage < 4 && s.dueAt <= now) out.push(s);
  }
  out.sort((a, b) => a.dueAt - b.dueAt || a.lapses - b.lapses);
  return out;
}

/** 已掌握 = 到达最高档 */
export function isMastered(state: ReviewState): boolean {
  return state.stage >= 4;
}

/**
 * 自适应降速判定。
 *
 * 20 新字/天 对零基础老人是很高的强度。若最近 7 个学习日的滚动正确率
 * 掉到 70% 以下，就说明当前节奏吃不消，应当减半新字并顺延总周期，
 * 而不是硬推导致挫败感。
 */
export const ADAPT_THRESHOLD = 0.7;
export const ADAPT_WINDOW_DAYS = 7;

export interface DayAccuracy {
  date: string;
  correct: number;
  total: number;
}

export interface PaceDecision {
  /** 建议的当日新字量 */
  newPerDay: number;
  /** 是否触发降速 */
  slowed: boolean;
  /** 触发原因（给家属端显示） */
  reason: string | null;
  /** 滚动正确率，无数据时为 null */
  rollingAccuracy: number | null;
}

export function decidePace(baseNewPerDay: number, history: DayAccuracy[]): PaceDecision {
  const recent = history
    .filter((d) => d.total > 0)
    .slice(-ADAPT_WINDOW_DAYS);

  if (recent.length < 3) {
    return { newPerDay: baseNewPerDay, slowed: false, reason: null, rollingAccuracy: null };
  }

  const correct = recent.reduce((s, d) => s + d.correct, 0);
  const total = recent.reduce((s, d) => s + d.total, 0);
  const acc = total > 0 ? correct / total : 1;

  if (acc < ADAPT_THRESHOLD) {
    return {
      newPerDay: Math.max(1, Math.ceil(baseNewPerDay / 2)),
      slowed: true,
      reason: `最近 ${recent.length} 天正确率 ${Math.round(acc * 100)}%，已把每天新字减半`,
      rollingAccuracy: acc,
    };
  }
  return { newPerDay: baseNewPerDay, slowed: false, reason: null, rollingAccuracy: acc };
}
