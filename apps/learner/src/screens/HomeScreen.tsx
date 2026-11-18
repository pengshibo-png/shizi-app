import { PrimaryButton, TianziGrid } from '@shi/ui';
import type { EncyclopediaCard } from '@shi/content';
import type { DailyPlan } from '../derive.js';

/**
 * 首页只需要这几样东西，别的都在「我的」或子页里。
 * props 少一个，屏上就少一块 —— 简洁首先是删东西。
 */
export interface HomeProps {
  plan: DailyPlan;
  streak: number;
  completed: boolean;
  previewChars: string[];
  /** 当前字的拼音（没有就空字符串，界面上安静地不显示） */
  heroPinyin?: string;
  newDoneToday: number;
  todayPush: EncyclopediaCard | null;
  mathTodo: boolean;
  onStartStudy: () => void;
  onReview: () => void;
  onMath: () => void;
  onScience: () => void;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 首页 = 一张纸，上面只有一个字。
 *
 * 上一版这里有印章、进度环、2×2 小格、四个带图标方框和勾选框的任务行 ——
 * 量化下来 28 个盒子、34 处强调色，谁都不是主角。
 * 现在只剩：日期 → 今天要认几个字 → 一个大米字格 → 拼音 → 接下来几个字
 * → 三行安静的任务 → 一个按钮。分组交给间距，不交给边框。
 * 「我认得的字」挪到「我的」，亮度也挪到「我的」。
 */
export function HomeScreen(p: HomeProps) {
  const newTarget = p.plan.newTarget;
  const newDone = Math.min(p.newDoneToday, newTarget);
  const isReviewDay = newTarget === 0 || p.previewChars.length === 0;
  const heroChars = isReviewDay ? p.plan.reviewChars.slice(0, 5) : p.previewChars.slice(0, 5);
  const rest = heroChars.slice(1);

  const now = new Date();
  const dateLine = `${now.getMonth() + 1}月${now.getDate()}日 周${WEEK[now.getDay()]}`;

  const title = p.completed
    ? '今天都学完了'
    : isReviewDay
      ? `今天温习 ${p.plan.reviewTarget} 个字`
      : `今天认 ${newTarget} 个字`;

  return (
    <div className="shi-app shi-home">
      <header className="shi-home-top">
        <span className="shi-date shi-tnum">{dateLine}</span>
        {p.streak > 1 && <span className="shi-streak shi-tnum">连续 {p.streak} 天</span>}
      </header>

      <section className="shi-hero">
        <h1 className="shi-hero-title">{title}</h1>

        <div className="shi-hero-grid">
          {heroChars.length > 0 ? (
            <TianziGrid char={heroChars[0]!} variant="mi" state={isReviewDay ? 'plain' : 'current'} />
          ) : (
            <div className="shi-hero-blank">今天没有新字</div>
          )}
        </div>

        <div className="shi-hero-meta">
          {heroChars.length > 0 ? (
            <>
              <span className="shi-hero-py">{p.heroPinyin}</span>
              {!isReviewDay && (
                <span className="shi-hero-count shi-tnum">
                  {newDone} / {newTarget}
                </span>
              )}
            </>
          ) : null}
        </div>

        {rest.length > 0 && (
          <div className="shi-rest" aria-label="接下来的字">
            {rest.map((c, i) => (
              <span key={`${c}-${i}`} className="shi-rest-char">
                {c}
              </span>
            ))}
          </div>
        )}
      </section>

      <nav className="shi-tasks" aria-label="今天的功课">
        <button type="button" className="shi-task" onClick={p.onReview}>
          <span className="shi-task-name">温习旧字</span>
          <span className="shi-task-meta shi-tnum">
            {p.plan.reviewTarget === 0 ? '暂无' : `${p.plan.reviewTarget} 字`}
          </span>
        </button>

        <button type="button" className="shi-task" onClick={p.onMath}>
          <span className="shi-task-name">生活数学</span>
          <span className="shi-task-meta">
            {p.mathTodo ? (p.plan.mathDone ? '做了' : '1 节') : '学完了'}
          </span>
        </button>

        <button type="button" className="shi-task" onClick={p.onScience}>
          <span className="shi-task-name">生活百科</span>
          <span className="shi-task-meta">{p.todayPush ? p.todayPush.title : '看完了'}</span>
        </button>
      </nav>

      {p.plan.paceNote && <p className="shi-pace-note">{p.plan.paceNote}</p>}

      <div className="shi-dijiao">
        <PrimaryButton
          onClick={p.onStartStudy}
          ariaLabel={p.completed ? '今天已学完，再听一遍' : '接着习字'}
        >
          {p.completed ? '再听一遍' : '接着习字'}
        </PrimaryButton>
      </div>
    </div>
  );
}