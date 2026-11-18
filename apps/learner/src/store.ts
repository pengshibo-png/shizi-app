/**
 * store.ts — 老人端本地存储
 *
 * 设计约束：
 *  - 完全离线可用，不依赖任何网络。
 *  - 进程被杀 / 断电 / 存储压力下不能丢进度 —— 每次作答立刻落盘。
 *  - 采用"单键快照 + 递增事件日志"：快照是权威状态，事件日志用于同步推给
 *    家属端，并能在快照损坏时回放重建。
 *  - 不使用 IndexedDB 的复杂事务，localStorage 足够（数据量 < 2MB），
 *    且同步 API 更不容易在低端安卓上出问题。
 */

import {
  applyAnswer,
  initReviewState,
  toDateKey,
  type DailyTask,
  type ReviewState,
} from '@shi/core';

const KEY_STATE = 'shi.state.v1';
const KEY_EVENTS = 'shi.events.v1';
const KEY_DEVICE = 'shi.deviceId';

export interface AnswerEvent {
  id: string;
  at: number;
  char: string;
  result: 'correct' | 'wrong';
  sessionId: string;
}

export interface SessionRecord {
  id: string;
  date: string;
  startedAt: number;
  endedAt: number;
  newLearned: number;
  reviewed: number;
  correct: number;
  total: number;
}

export interface AppState {
  deviceId: string;
  /** 首次使用时间 */
  createdAt: number;
  /** 已学新字总数（决定下一步教哪 20 个，支持顺延） */
  learnedCount: number;
  /** 每字的复习状态 */
  reviews: Record<string, ReviewState>;
  /** 每日任务板 */
  tasks: Record<string, DailyTask>;
  /** 已完成数学课的日次 */
  mathDone: number[];
  /** 已完成科普的日次 */
  scienceDone: number[];
  /** 学习会话记录（家属端用量/用时） */
  sessions: SessionRecord[];
  /** 最近 8 天的正确率，用于自适应降速 */
  accuracyHistory: { date: string; correct: number; total: number }[];
  /** 今日内的作答明细（用于计算当天正确率） */
  todayAnswers: { date: string; correct: number; total: number };
  /** 家属端留言 */
  familyMessage: string | null;
  /** 每日新字目标（家属可远程调） */
  newPerDay: number;
}

function newDeviceId(): string {
  // 不依赖 crypto.randomUUID（老 WebView 可能没有）
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `d${Date.now().toString(36)}${rnd()}`;
}

export function createInitialState(): AppState {
  const now = Date.now();
  let deviceId = '';
  try {
    deviceId = localStorage.getItem(KEY_DEVICE) ?? '';
  } catch {
    /* 隐私模式 */
  }
  if (!deviceId) {
    deviceId = newDeviceId();
    try {
      localStorage.setItem(KEY_DEVICE, deviceId);
    } catch {
      /* ignore */
    }
  }
  return {
    deviceId,
    createdAt: now,
    learnedCount: 0,
    reviews: {},
    tasks: {},
    mathDone: [],
    scienceDone: [],
    sessions: [],
    accuracyHistory: [],
    todayAnswers: { date: toDateKey(new Date(now)), correct: 0, total: 0 },
    familyMessage: null,
    newPerDay: 20,
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY_STATE);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as AppState;
    // 老版本或缺字段时用初始值补齐，避免升级后白屏
    const base = createInitialState();
    return {
      ...base,
      ...parsed,
      reviews: parsed.reviews ?? {},
      tasks: parsed.tasks ?? {},
      mathDone: parsed.mathDone ?? [],
      scienceDone: parsed.scienceDone ?? [],
      sessions: parsed.sessions ?? [],
      accuracyHistory: parsed.accuracyHistory ?? [],
      todayAnswers: parsed.todayAnswers ?? base.todayAnswers,
      deviceId: parsed.deviceId || base.deviceId,
      newPerDay: parsed.newPerDay || 20,
    };
  } catch {
    // 快照损坏：从事件日志回放重建，仍失败则从头开始
    const rebuilt = rebuildFromEvents();
    return rebuilt ?? createInitialState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY_STATE, JSON.stringify(state));
  } catch {
    // 存储满时先清事件日志再试一次，保证快照优先落盘
    try {
      localStorage.removeItem(KEY_EVENTS);
      localStorage.setItem(KEY_STATE, JSON.stringify(state));
    } catch {
      /* 实在存不下就只能放弃本次写入，但界面继续可用 */
    }
  }
}

function readEvents(): AnswerEvent[] {
  try {
    const raw = localStorage.getItem(KEY_EVENTS);
    return raw ? (JSON.parse(raw) as AnswerEvent[]) : [];
  } catch {
    return [];
  }
}

export function appendEvent(ev: AnswerEvent): void {
  const events = readEvents();
  events.push(ev);
  // 只留最近 5000 条，防止无限增长
  const trimmed = events.length > 5000 ? events.slice(-5000) : events;
  try {
    localStorage.setItem(KEY_EVENTS, JSON.stringify(trimmed));
  } catch {
    /* 写不进去不影响主流程 */
  }
}

export function getEvents(): AnswerEvent[] {
  return readEvents();
}

/** 从事件日志回放重建复习状态（快照损坏时的兜底） */
function rebuildFromEvents(): AppState | null {
  const events = readEvents();
  if (!events.length) return null;
  const state = createInitialState();
  for (const ev of events) {
    const prev =
      state.reviews[ev.char] ??
      initReviewState(ev.char, state.deviceId, ev.at);
    state.reviews[ev.char] = applyAnswer(prev, ev.result, {
      sessionId: ev.sessionId,
      now: ev.at,
    });
  }
  return state;
}

// ---------------------------------------------------------------- 领域操作

/** 记录一次作答，立刻返回更新后的状态并落盘 */
export function recordAnswer(
  state: AppState,
  char: string,
  result: 'correct' | 'wrong',
  sessionId: string,
): AppState {
  const now = Date.now();
  const prev = state.reviews[char] ?? initReviewState(char, state.deviceId, now);
  const next = applyAnswer(prev, result, { sessionId, now });

  appendEvent({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    at: now,
    char,
    result,
    sessionId,
  });

  const today = toDateKey(new Date(now));
  const ta =
    state.todayAnswers.date === today
      ? state.todayAnswers
      : { date: today, correct: 0, total: 0 };
  const todayAnswers = {
    date: today,
    correct: ta.correct + (result === 'correct' ? 1 : 0),
    total: ta.total + 1,
  };

  const updated: AppState = {
    ...state,
    reviews: { ...state.reviews, [char]: next },
    todayAnswers,
  };
  saveState(updated);
  return updated;
}

/** 学会一个新字：计数 +1，并立刻建立复习状态（D+1 到期） */
export function recordNewChar(state: AppState, char: string): AppState {
  if (state.reviews[char]) return state;
  const now = Date.now();
  const updated: AppState = {
    ...state,
    learnedCount: state.learnedCount + 1,
    reviews: {
      ...state.reviews,
      [char]: initReviewState(char, state.deviceId, now),
    },
  };
  saveState(updated);
  return updated;
}

export function markMathDone(state: AppState, day: number): AppState {
  if (state.mathDone.includes(day)) return state;
  const updated = { ...state, mathDone: [...state.mathDone, day] };
  saveState(updated);
  return updated;
}

export function markScienceDone(state: AppState, day: number): AppState {
  if (state.scienceDone.includes(day)) return state;
  const updated = { ...state, scienceDone: [...state.scienceDone, day] };
  saveState(updated);
  return updated;
}

export function endSession(state: AppState, session: SessionRecord): AppState {
  const today = session.date;
  const prev = state.accuracyHistory.find((h) => h.date === today);
  const accuracyHistory = [
    ...state.accuracyHistory.filter((h) => h.date !== today),
    {
      date: today,
      correct: (prev?.correct ?? 0) + session.correct,
      total: (prev?.total ?? 0) + session.total,
    },
  ].slice(-30);

  const updated = {
    ...state,
    sessions: [...state.sessions, session].slice(-200),
    accuracyHistory,
  };
  saveState(updated);
  return updated;
}

/** 连续学习天数（今天或昨天有活动才算延续） */
export function computeStreak(state: AppState, today: Date): number {
  const active = new Set(state.sessions.map((s) => s.date));
  let streak = 0;
  const d = new Date(today.getTime());
  // 今天没学不算断，从昨天往前数
  if (!active.has(toDateKey(d))) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 400; i++) {
    const key = toDateKey(d);
    if (!active.has(key)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}