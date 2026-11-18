import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyPlacementToOrder,
  buildDailyPlan,
  estimateKnown,
  isDayComplete,
  itemsDone,
  makeResult,
  nextNewChars,
  toDateKey,
  type DailyPlan,
  type PlacementState,
} from '@shi/core';
import {
  loadCharacters,
  loadEncyclopedia,
  loadMath,
  loadStrokes,
  loadWords,
  indexByChar,
  indexWords,
  wordsOf,
  type CharacterRecord,
  type EncyclopediaBundle,
  type MathBundle,
  type WordRecord,
} from '@shi/content';
import { startThemeWatcher, loadThemeMode, type ThemeName, type ThemeMode } from '@shi/ui';
import {
  createInitialState,
  endSession,
  loadState,
  markMathDone,
  markScienceDone,
  recordAnswer,
  recordNewChar,
  saveState,
  type AppState,
  type SessionRecord,
} from './store.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { StudyScreen } from './screens/StudyScreen.js';
import { ReviewScreen } from './screens/ReviewScreen.js';
import { MyCharsScreen } from './screens/MyCharsScreen.js';
import { MathScreen } from './screens/MathScreen.js';
import { ScienceScreen } from './screens/ScienceScreen.js';
import { EncyclopediaScreen } from './screens/EncyclopediaScreen.js';
import { HistoryScreen } from './screens/HistoryScreen.js';
import { TabBar, type TabId } from './screens/TabBar.js';
import { PlacementScreen, type PlacementOutcome } from './screens/PlacementScreen.js';
import { syncStatusBar } from './statusbar.js';
import './app.css';

/** 二级路由：在 Tab 之内再进的屏（学字/复习/数学/科普/我的字） */
type Sub =
  | { name: 'none' }
  | { name: 'study' }
  | { name: 'review' }
  | { name: 'mychars' }
  | { name: 'math' }
  | { name: 'science' };

export interface AppData {
  chars: CharacterRecord[];
  byChar: Map<string, CharacterRecord>;
  wordsById: Map<string, WordRecord>;
  dailyChars: { day: number; chars: string[] }[];
  math: MathBundle;
  enc: EncyclopediaBundle;
}

const ENC_VIEWED_KEY = 'shi.encViewed.v1';

function loadEncViewed(): Set<string> {
  try {
    const raw = localStorage.getItem(ENC_VIEWED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveEncViewed(s: Set<string>): void {
  try {
    localStorage.setItem(ENC_VIEWED_KEY, JSON.stringify([...s].slice(-2000)));
  } catch {
    /* ignore */
  }
}

function loadPlacementState(): PlacementState {
  try {
    const raw = localStorage.getItem('shi.placement.v1');
    if (!raw) return { phase: 'not-taken' };
    const p = JSON.parse(raw) as PlacementState & {
      result?: { knownChars?: string[] };
    };
    if (p.phase === 'done' && p.result) {
      return {
        phase: 'done',
        result: {
          ...p.result,
          knownChars: new Set(p.result.knownChars ?? []),
        },
      } as PlacementState;
    }
    return p;
  } catch {
    return { phase: 'not-taken' };
  }
}

let sessionCounter = 0;
function newSessionId(): string {
  sessionCounter += 1;
  return `s${Date.now().toString(36)}-${sessionCounter}`;
}

export function App() {
  const [tab, setTab] = useState<TabId>('today');
  const [sub, setSub] = useState<Sub>({ name: 'none' });
  const [state, setState] = useState<AppState>(() => loadState());
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [, setTheme] = useState<ThemeName | null>(null);
  const [placement, setPlacement] = useState<PlacementState>(() => loadPlacementState());
  const [encViewed, setEncViewed] = useState<Set<string>>(() => loadEncViewed());

  const sessionIdRef = useRef<string>(newSessionId());
  const sessionStartRef = useRef<number>(Date.now());
  const sessionStatsRef = useRef({ correct: 0, total: 0, newLearned: 0, reviewed: 0 });

  useEffect(
    () =>
      startThemeWatcher(
        () => themeMode,
        (t) => {
          setTheme(t);
          void syncStatusBar(t);
        },
      ),
    [themeMode],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [charsBundle, wordsBundle, math, enc] = await Promise.all([
          loadCharacters(),
          loadWords(),
          loadMath(),
          loadEncyclopedia(),
        ]);
        if (!alive) return;
        setData({
          chars: charsBundle.characters,
          byChar: indexByChar(charsBundle.characters),
          wordsById: indexWords(wordsBundle.words),
          dailyChars: charsBundle.dailyChars,
          math,
          enc,
        });
        // 笔顺 4.18 MB：主内容就绪后空闲预载，她点进习字页时已经在了。
        // 失败不阻塞——认读主流程不依赖笔顺。
        const idle =
          (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
            .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 600));
        idle(() => {
          void loadStrokes().catch(() => undefined);
        });
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---------------------------------------------------------------- 摸底完成后改写字序

  /** 摸底已知字 → 从字序剔除后的日程（一次性，摸底完成时算） */
  const effectiveDaily = useMemo(() => {
    if (!data) return null;
    if (placement.phase !== 'done') return data.dailyChars;
    return applyPlacementToOrder(data.dailyChars, placement.result.knownChars);
  }, [data, placement]);

  // ---------------------------------------------------------------- 计划与新字

  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  // 字表天数由数据决定，不写死 —— 字表从 1800 扩到 3500 后天序跟着变
  const totalDays = effectiveDaily?.length ?? 1;

  const plan: DailyPlan | null = useMemo(() => {
    if (!data || !effectiveDaily) return null;
    const mathDay = data.math.lessons.find((l) => !state.mathDone.includes(l.day))?.day ?? 0;
    // 每日一条从百科推送（按全局天序取下一条未看的）
    const pushCard = data.enc.cards.find((c) => !encViewed.has(c.id));
    return buildDailyPlan({
      date: todayKey,
      dayIndex: Math.min(totalDays, Math.floor(state.learnedCount / 20) + 1),
      states: Object.values(state.reviews),
      now: Date.now(),
      mathDone: mathDay === 0,
      scienceDone: !pushCard,
      history: state.accuracyHistory,
      baseNewPerDay: state.newPerDay,
    });
  }, [data, state, todayKey, encViewed, effectiveDaily, totalDays]);

  /** 今天应学的新字：在剔除已知字后的字序里取 */
  const newCharsToday = useMemo(() => {
    if (!data || !plan || !effectiveDaily) return [];
    const doneToday = state.tasks[todayKey]?.newDone ?? 0;
    const need = Math.max(0, plan.newTarget - doneToday);
    return nextNewChars(effectiveDaily, state.learnedCount, need);
  }, [data, plan, state, todayKey, effectiveDaily]);

  // 开发期诊断（自动化测试断言用）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__shi = {
      learnedCount: state.learnedCount,
      placementPhase: placement.phase,
      knownCount: placement.phase === 'done' ? placement.result.knownChars.size : 0,
      effectiveDays: effectiveDaily?.length ?? null,
      totalDays: data?.dailyChars?.length ?? null,
      planNewTarget: plan?.newTarget ?? null,
      newCharsTodayLen: newCharsToday.length,
      newCharsTodaySample: newCharsToday.slice(0, 5),
      encTotal: data?.enc.meta.total ?? null,
      tab,
    };
  }, [data, plan, state, placement, effectiveDaily, newCharsToday, tab]);

  // ---------------------------------------------------------------- 会话与答题

  const commitSession = useCallback(() => {
    const s = sessionStatsRef.current;
    if (s.total === 0 && s.newLearned === 0) return;
    const rec: SessionRecord = {
      id: sessionIdRef.current,
      date: toDateKey(new Date()),
      startedAt: sessionStartRef.current,
      endedAt: Date.now(),
      newLearned: s.newLearned,
      reviewed: s.reviewed,
      correct: s.correct,
      total: s.total,
    };
    setState((prev) => endSession(prev, rec));
    sessionIdRef.current = newSessionId();
    sessionStartRef.current = Date.now();
    sessionStatsRef.current = { correct: 0, total: 0, newLearned: 0, reviewed: 0 };
  }, []);

  const handleAnswer = useCallback((char: string, result: 'correct' | 'wrong') => {
    sessionStatsRef.current.total += 1;
    if (result === 'correct') sessionStatsRef.current.correct += 1;
    setState((prev) => recordAnswer(prev, char, result, sessionIdRef.current));
  }, []);

  const handleLearnNew = useCallback((char: string) => {
    setState((prev) => {
      const next = recordNewChar(prev, char);
      if (next === prev) return prev;
      sessionStatsRef.current.newLearned += 1;
      const key = toDateKey(new Date());
      const task = next.tasks[key];
      if (task) {
        next.tasks[key] = { ...task, newDone: task.newDone + 1 };
      } else {
        next.tasks[key] = {
          deviceId: next.deviceId,
          date: key,
          dayIndex: Math.min(175, Math.floor(next.learnedCount / 20) + 1),
          newTarget: next.newPerDay,
          newDone: 1,
          reviewTarget: 0,
          reviewDone: 0,
          mathDone: false,
          scienceDone: false,
          durationSec: 0,
          completedAt: null,
        };
      }
      saveState(next);
      return next;
    });
  }, []);

  const handleMathDone = useCallback((day: number) => {
    setState((prev) => markMathDone(prev, day));
  }, []);

  const markEncViewed = useCallback((id: string) => {
    setEncViewed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveEncViewed(next);
      return next;
    });
  }, []);

  const goToday = useCallback(() => {
    commitSession();
    setSub({ name: 'none' });
    setTab('today');
  }, [commitSession]);

  const cycleTheme = useCallback(() => {
    setThemeMode((m) => {
      const next: ThemeMode = m === 'auto' ? 'paper' : m === 'paper' ? 'ink' : 'auto';
      try {
        localStorage.setItem('shi.themeMode', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ---------------------------------------------------------------- 摸底完成

  const finishPlacement = useCallback(
    (o: PlacementOutcome) => {
      const result = makeResult(data?.chars ?? [], o.charAnswers);
      const knownCount = o.charAnswers.filter((a) => a.correct).length;
      const done: PlacementState = { phase: 'done', result, mathStart: o.mathStart };
      try {
        localStorage.setItem(
          'shi.placement.v1',
          JSON.stringify({ ...done, result: { ...result, knownChars: [...result.knownChars] } }),
        );
      } catch {
        /* ignore */
      }
      setPlacement(done);

      // 数学跳级：把 skip 之前的课全部标记完成
      if (o.mathStart > 1) {
        setState((prev) => {
          const next = { ...prev, mathDone: [...prev.mathDone] };
          for (let d = 1; d < o.mathStart; d++) {
            if (!next.mathDone.includes(d)) next.mathDone.push(d);
          }
          saveState(next);
          return next;
        });
      }

      // 会认识 N 字也写进当日记录（家属端可见第一条摸底数据）
      console.info(`[摸底] 认识 ${knownCount}/${120} 抽样，估计 ${result.estimatedKnown} 字，数学从第 ${o.mathStart} 天起`);
      setTab('today');
    },
    [data],
  );

  // ---------------------------------------------------------------- 渲染

  if (error) {
    return (
      <div className="shi-app">
        <div className="shi-center">
          <div className="shi-big">内容没读出来</div>
          <div className="shi-dim">{error}</div>
          <button type="button" className="shi-btn shi-btn--primary" onClick={() => location.reload()}>
            重新打开
          </button>
        </div>
      </div>
    );
  }

  if (!data || !plan || !effectiveDaily) {
    return (
      <div className="shi-app">
        <div className="shi-head">
          <h1>正在准备</h1>
        </div>
        <div className="shi-skel" style={{ height: 220, marginTop: 32 }} />
        <div className="shi-skel" style={{ height: 100, marginTop: 32 }} />
      </div>
    );
  }

  // ---- 摸底（首启且未做过且未跳过）----
  if (placement.phase === 'not-taken' && state.learnedCount === 0 && sub.name === 'none' && tab === 'today') {
    return (
      <PlacementScreen
        chars={data.chars}
        onFinish={finishPlacement}
        onSkip={() => {
          // 跳过 = 按零基础学（保持原字序）
          const skipped: PlacementState = { phase: 'not-taken' };
          try {
            localStorage.setItem('shi.placement.v1', JSON.stringify({ phase: 'skipped' }));
          } catch {
            /* ignore */
          }
          setPlacement({ phase: 'done', result: makeResult(data.chars, []), mathStart: 1 } as PlacementState);
          setTab('today');
        }}
      />
    );
  }

  // ---- 二级屏（Tab 之内进入，无 TabBar——沉浸学习态）----
  switch (sub.name) {
    case 'study':
      return (
        <StudyScreen
          chars={newCharsToday}
          byChar={data.byChar}
          wordsById={data.wordsById}
          wordsOfChar={(c) => wordsOf(c, data.wordsById)}
          allChars={data.chars}
          onLearn={handleLearnNew}
          onAnswer={handleAnswer}
          onDone={goToday}
          onBack={goToday}
        />
      );

    case 'review':
      return (
        <ReviewScreen
          chars={plan.reviewChars}
          byChar={data.byChar}
          wordsById={data.wordsById}
          allChars={data.chars}
          onAnswer={handleAnswer}
          onDone={goToday}
          onBack={goToday}
        />
      );

    case 'mychars':
      return (
        <MyCharsScreen
          chars={data.chars}
          states={state.reviews}
          wordsById={data.wordsById}
          onBack={() => setSub({ name: 'none' })}
        />
      );

    case 'math': {
      const mathDay = data.math.lessons.find((l) => !state.mathDone.includes(l.day))?.day ?? 90;
      const lesson = data.math.lessons.find((l) => l.day === mathDay);
      return lesson ? (
        <MathScreen
          lesson={lesson}
          onDone={() => {
            handleMathDone(lesson.day);
            goToday();
          }}
          onBack={goToday}
        />
      ) : (
        <div className="shi-app">
          <div className="shi-center">
            <div className="shi-big">数学都学完了</div>
            <button type="button" className="shi-btn shi-btn--primary" onClick={goToday}>
              回去
            </button>
          </div>
        </div>
      );
    }

    case 'science': {
      const card = data.enc.cards.find((c) => !encViewed.has(c.id));
      return card ? (
        <ScienceScreen
          card={card}
          onDone={() => {
            markEncViewed(card.id);
            goToday();
          }}
          onBack={goToday}
        />
      ) : (
        <div className="shi-app">
          <div className="shi-center">
            <div className="shi-big">今天的都看完了</div>
            <button type="button" className="shi-btn shi-btn--primary" onClick={goToday}>
              回去
            </button>
          </div>
        </div>
      );
    }

    default:
      break;
  }

  // ---- 三 Tab 主框架 ----
  const mathDay = data.math.lessons.find((l) => !state.mathDone.includes(l.day))?.day ?? 90;
  const pushCard = data.enc.cards.find((c) => !encViewed.has(c.id));
  const todayTask = state.tasks[todayKey];
  const streak = computeStreak(state, new Date());
  // 首页主角是「当前这一个字」，拼音跟着它走（巩固日取复习队列的第一个）
  const heroChar = newCharsToday[0] ?? plan.reviewChars[0];
  const heroPinyin = heroChar ? data.byChar.get(heroChar)?.pinyin ?? '' : '';

  const doneToday = {
    newDone: todayTask?.newDone ?? 0,
    reviewDone: todayTask?.reviewDone ?? 0,
  };

  const tabContent =
    tab === 'today' ? (
      <HomeScreen
        plan={plan}
        streak={streak}
        completed={isDayComplete(plan, doneToday)}
        previewChars={newCharsToday.slice(0, 5)}
        heroPinyin={heroPinyin}
        newDoneToday={todayTask?.newDone ?? 0}
        onStartStudy={() => setSub({ name: 'study' })}
        onReview={() => setSub({ name: 'review' })}
        onMath={() => setSub({ name: 'math' })}
        onScience={() => setSub({ name: 'science' })}
        todayPush={pushCard ?? null}
        mathTodo={mathDay <= 90}
      />
    ) : tab === 'encyclopedia' ? (
      <EncyclopediaScreen
        bundle={data.enc}
        viewed={encViewed}
        onMarkViewed={markEncViewed}
        onBack={() => setTab('today')}
      />
    ) : (
      <HistoryScreen
        state={state}
        encViewed={encViewed}
        total={effectiveDaily.reduce((s, d) => s + d.chars.length, 0)}
        themeMode={themeMode}
        onToggleTheme={cycleTheme}
        onMyChars={() => setSub({ name: 'mychars' })}
        onBack={() => setTab('today')}
      />
    );

  return (
    <div className="shi-tabbed">
      <div className="shi-tab-body">{tabContent}</div>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}

/** 连续学习天数（今天没学不算断，从昨天往前数） */
function computeStreak(state: AppState, today: Date): number {
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

export function createAppState(): AppState {
  return createInitialState();
}