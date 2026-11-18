import { z } from 'zod';

/** 学习阶段（SRS 档位）。0 = 刚学会，越大间隔越长 */
export const SrsStageSchema = z.number().int().min(0).max(4);
export type SrsStage = z.infer<typeof SrsStageSchema>;

/** 复习间隔（天）。老人遗忘快，用比年轻人更密的 4 档间隔。 */
export const INTERVALS_DAYS: readonly number[] = [1, 3, 8, 21] as const;

/** 掌握判定：跨两个不同时段连续答对 2 次 */
export const MASTERY_CONSECUTIVE = 2;

export const SlotSchema = z.enum(['any']);
export type Slot = z.infer<typeof SlotSchema>;

export const AnswerResultSchema = z.enum(['correct', 'wrong']);
export type AnswerResult = z.infer<typeof AnswerResultSchema>;

/** 单个字的复习状态 */
export const ReviewStateSchema = z.object({
  char: z.string().length(1),
  deviceId: z.string().min(1),
  /** 档位 0..4，4 = 已掌握 */
  stage: SrsStageSchema,
  /** 下次到期时间（epoch ms） */
  dueAt: z.number().int().nonnegative(),
  /** 累计答错次数 */
  lapses: z.number().int().nonnegative(),
  /** 连续答对次数 */
  consecutiveCorrect: z.number().int().nonnegative(),
  /** 上次答对所在的学习时段会话 id，用于"跨时段"判定 */
  lastCorrectSessionId: z.string().nullable(),
  /** 累计答题次数 */
  reviews: z.number().int().nonnegative(),
  /** 最后一次作答时间 */
  lastSeenAt: z.number().int().nonnegative(),
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const CharacterSchema = z.object({
  id: z.string().min(1),
  char: z.string().length(1),
  pinyin: z.string().min(1),
  readings: z.array(z.string()),
  tier: z.enum(['592', '358', '550', 'extra']),
  day: z.number().int().min(1).max(90),
  strokes: z.number().int().positive().nullable(),
  audioKey: z.string().min(1),
  wordIds: z.array(z.string()).default([]),
});
export type Character = z.infer<typeof CharacterSchema>;

export const WordSchema = z.object({
  id: z.string().min(1),
  word: z.string().min(2),
  chars: z.array(z.string()),
  freq: z.number().nonnegative().optional(),
  gloss: z.string().default(''),
  audioKey: z.string().min(1),
});
export type Word = z.infer<typeof WordSchema>;

export const ScienceCardSchema = z.object({
  id: z.string().min(1),
  day: z.number().int().min(1).max(90),
  week: z.number().int().min(1).max(13),
  theme: z.string().min(1),
  title: z.string().min(1).max(14),
  body: z.string().min(1),
  question: z.string().min(1).max(20),
  optionA: z.string().min(1).max(8),
  optionB: z.string().min(1).max(8),
  correct: z.enum(['A', 'B']),
  explain: z.string().min(1).max(40),
  audioKey: z.string().default(''),
});
export type ScienceCard = z.infer<typeof ScienceCardSchema>;

export const MathItemSchema = z.object({
  prompt: z.string().min(1),
  kind: z.enum(['choice', 'count']),
  options: z.array(z.string().min(1)).min(2).max(4),
  correct: z.number().int().nonnegative(),
  hint: z.string().default(''),
}).refine((it) => it.correct < it.options.length, {
  message: 'correct 下标超出 options 范围',
});
export type MathItem = z.infer<typeof MathItemSchema>;

export const MathLessonSchema = z.object({
  day: z.number().int().min(1).max(90),
  module: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  script: z.string().min(1),
  items: z.array(MathItemSchema).length(3),
  action: z.string().min(1),
  audioKey: z.string().default(''),
});
export type MathLesson = z.infer<typeof MathLessonSchema>;

/**
 * 每日任务。注意：**不划分时段**，只记当天完成量。
 * 老人想什么时候学就什么时候学，做一点存一点。
 */
export const DailyTaskSchema = z.object({
  deviceId: z.string().min(1),
  /** 本地日期 YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 教学日序号 1..90（可以是顺延后的） */
  dayIndex: z.number().int().min(1),
  newTarget: z.number().int().nonnegative(),
  newDone: z.number().int().nonnegative(),
  reviewTarget: z.number().int().nonnegative(),
  reviewDone: z.number().int().nonnegative(),
  mathDone: z.boolean(),
  scienceDone: z.boolean(),
  durationSec: z.number().int().nonnegative(),
  completedAt: z.number().int().nullable(),
});
export type DailyTask = z.infer<typeof DailyTaskSchema>;

export const DailyReportSchema = z.object({
  deviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newLearned: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  durationSec: z.number().int().nonnegative(),
  mathDone: z.boolean(),
  scienceDone: z.boolean(),
  /** 已完成任务项数 0..4 */
  itemsDone: z.number().int().min(0).max(4),
  streak: z.number().int().nonnegative(),
});
export type DailyReport = z.infer<typeof DailyReportSchema>;

/** 上传到同步服务的事件（append-only） */
export const SyncEventSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  kind: z.enum(['answer', 'session', 'task', 'config']),
  at: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});
export type SyncEvent = z.infer<typeof SyncEventSchema>;
