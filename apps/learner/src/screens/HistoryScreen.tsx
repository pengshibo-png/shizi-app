/**
 * 「我的」= 学习记录 + 亮度。
 *
 * 上一版这屏有四个带底色的数字卡、一条三段彩色进度条、三枚图例、
 * 七个田字格和一张表 —— 量化下来 26 个盒子、30 处强调色。
 * 这一版只剩三块：一行数字、七个点、一张表。分组交给间距。
 *
 * 亮度切换也从首页挪到这里：它是设置，不是每天要看的东西，
 * 放在「我的」符合习惯，也让首页少一个控件。
 */

import { useMemo } from 'react';
import { toDateKey } from '@shi/core';
import type { AppState } from '../store.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function HistoryScreen({
  state,
  encViewed,
  total,
  themeMode,
  onToggleTheme,
  onMyChars,
  onBack,
}: {
  state: AppState;
  encViewed: Set<string>;
  total: number;
  themeMode: 'auto' | 'paper' | 'ink';
  onToggleTheme: () => void;
  onMyChars: () => void;
  onBack: () => void;
}) {
  const byDate = useMemo(() => {
    const m = new Map<
      string,
      { new: number; review: number; correct: number; total: number; ms: number }
    >();
    const bump = (k: string) => {
      if (!m.has(k)) m.set(k, { new: 0, review: 0, correct: 0, total: 0, ms: 0 });
      return m.get(k)!;
    };
    for (const s of state.sessions) {
      const r = bump(s.date);
      r.new += s.newLearned;
      r.review += s.reviewed;
      r.correct += s.correct;
      r.total += s.total;
      r.ms += s.endedAt - s.startedAt;
    }
    for (const [date, t] of Object.entries(state.tasks)) {
      const r = bump(date);
      r.new = Math.max(r.new, t.newDone);
      r.review = Math.max(r.review, t.reviewDone);
      if (t.mathDone || t.scienceDone) r.total = Math.max(r.total, 1);
    }
    return m;
  }, [state]);

  const days = useMemo(
    () => [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30),
    [byDate],
  );

  const week = useMemo(() => {
    const out: { key: string; label: string; did: boolean; isToday: boolean }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = toDateKey(d);
      const rec = byDate.get(key);
      const task = state.tasks[key];
      out.push({
        key,
        label: WEEK[d.getDay()]!,
        did: Boolean((rec?.new ?? 0) > 0 || (rec?.review ?? 0) > 0 || task?.mathDone || task?.scienceDone),
        isToday: i === 0,
      });
    }
    return out;
  }, [byDate, state]);

  const mastered = useMemo(
    () => Object.values(state.reviews).filter((r) => r.stage >= 4).length,
    [state.reviews],
  );
  const remaining = Math.max(0, total - state.learnedCount);
  const themeWord = themeMode === 'auto' ? '跟随时间' : themeMode === 'paper' ? '纸色' : '墨色';

  return (
    <div className="shi-app shi-history">
      <div className="shi-topbar">
        <span className="shi-topbar-title">学习记录</span>
        <button
          type="button"
          className="shi-theme-btn"
          onClick={onToggleTheme}
          aria-label={`切换亮度，现在是${themeWord}`}
        >
          {themeWord}
        </button>
      </div>

      {/* 一行数字说清全部进度，不用色条不用图例 */}
      <p className="shi-sum">
        已认 <b className="shi-tnum">{state.learnedCount}</b> 字
      </p>
      <p className="shi-sum-sub shi-tnum">
        巩固 {mastered} · 还剩 {remaining} · 看过 {encViewed.size} 条知识
      </p>

      {/* 「我认得的字」从首页挪来：它是回看的东西，不是每天要完成的任务 */}
      <nav className="shi-entry" aria-label="回看">
        <button type="button" className="shi-task" onClick={onMyChars}>
          <span className="shi-task-name">我认得的字</span>
          <span className="shi-task-meta shi-tnum">{state.learnedCount} 字 ›</span>
        </button>
      </nav>

      {/* 最近七天：七个点，学过的实心 */}
      <section className="shi-week" aria-label="最近七天">
        <div className="shi-week-head">最近七天</div>
        <div className="shi-week-row">
          {week.map((d) => (
            <div key={d.key} className={`shi-week-cell${d.isToday ? ' is-today' : ''}`}>
              <span
                className={`shi-dot${d.did ? ' is-did' : ''}`}
                aria-label={`${d.key}${d.did ? '，学了' : '，没学'}`}
              />
              <span className="shi-week-label">{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 逐日账 */}
      <div className="shi-hist-list">
        {days.length === 0 && <div className="shi-empty">还没有记录。学一天就有了。</div>}
        {days.map(([date, r]) => {
          const acc = r.total > 0 ? Math.round((r.correct / r.total) * 100) : null;
          return (
            <div key={date} className="shi-hist-row">
              <span className="shi-hist-date shi-tnum">{date.slice(5)}</span>
              <span className="shi-hist-new shi-tnum">学 {r.new}</span>
              <span className="shi-hist-rev shi-tnum">{r.review > 0 ? `习 ${r.review}` : '—'}</span>
              <span className="shi-hist-acc shi-tnum">{acc !== null ? `${acc}%` : '—'}</span>
              <span className="shi-hist-time shi-tnum">{Math.round(r.ms / 60000)} 分</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}