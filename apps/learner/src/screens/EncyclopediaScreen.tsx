import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@shi/ui';
import type { EncyclopediaBundle } from '@shi/content';

/**
 * 百科屏：12 大类目录 → 分类列表 → 卡片阅读。
 *
 * 评审补充三的关键结构：从「被安排的每日一条」变成「她自己的工具书」。
 * 老人哪天想查「过期药能不能吃」，自己翻得到。
 *
 * 层级刻意只有两级（目录 / 列表），卡片内嵌在列表里展开——
 * 老人界面的导航深度超过两级就会迷路。
 */

type View =
  | { v: 'cats' }
  | { v: 'list'; cat: string }
  | { v: 'card'; cat: string; order: number };

export function EncyclopediaScreen({
  bundle,
  viewed,
  onMarkViewed,
  onBack,
}: {
  bundle: EncyclopediaBundle;
  /** 已看过的卡片 id 集合（历史记录数据源） */
  viewed: Set<string>;
  onMarkViewed: (id: string) => void;
  onBack: () => void;
}) {
  const [view, setView] = useState<View>({ v: 'cats' });

  useEffect(() => {
    // 返回顶层时滚回顶部
    if (view.v === 'cats') window.scrollTo(0, 0);
  }, [view]);

  const byCat = useMemo(() => {
    const m = new Map<string, typeof bundle.cards>();
    for (const c of bundle.cards) {
      const k = c.cat ?? '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return m;
  }, [bundle]);

  // ================================================================ 目录

  if (view.v === 'cats') {
    return (
      <div className="shi-app">
        <div className="shi-topbar">
          <span className="shi-topbar-title">生活百科</span>
          <span className="shi-caption shi-tnum">{bundle.meta.total} 条</span>
        </div>

        <div className="shi-place-note">想查什么，点开看。每天也推一条新知识。</div>

        {/* 目录 = 安静的两列清单：名字 + 条数，没有色边没有简介没有底色 */}
        <div className="shi-cat-grid">
          {bundle.cats.map((c) => {
            const total = byCat.get(c.key)?.length ?? c.count;
            const seen = (byCat.get(c.key) ?? []).filter((x) => viewed.has(x.id)).length;
            const allSeen = total > 0 && seen >= total;
            return (
              <button
                key={c.key}
                type="button"
                className={`shi-cat${allSeen ? ' is-all-seen' : ''}`}
                onClick={() => setView({ v: 'list', cat: c.key })}
                aria-label={`${c.name}，共 ${total} 条${seen > 0 ? `，已看 ${seen} 条` : ''}`}
              >
                <span className="shi-cat-name">{c.name}</span>
                <span className="shi-cat-count shi-tnum">{total}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ================================================================ 分类列表 + 内嵌卡片

  const list = byCat.get(view.cat) ?? [];
  const catInfo = bundle.cats.find((c) => c.key === view.cat);

  return (
    <div className="shi-app">
      <div className="shi-topbar">
        <button type="button" className="shi-back" onClick={() => setView({ v: 'cats' })} aria-label="回目录">
          ‹
        </button>
        <span className="shi-topbar-title">{catInfo?.name ?? view.cat}</span>
        <span className="shi-caption shi-tnum">{list.length} 条</span>
      </div>

      <div className="shi-enc-scroll">
        {list.map((c) => {
          const isOpen = view.v === 'card' && view.order === c.order;
          const isSeen = viewed.has(c.id);
          return (
            <div key={c.id} className={`shi-enc-item${isOpen ? ' is-open' : ''}${isSeen ? ' is-seen' : ''}`}>
              <button
                type="button"
                className="shi-enc-row"
                onClick={() => {
                  if (isOpen) setView({ v: 'list', cat: view.cat });
                  else {
                    setView({ v: 'card', cat: view.cat, order: c.order });
                    onMarkViewed(c.id);
                  }
                }}
                aria-expanded={isOpen}
              >
                <span className="shi-enc-title">{c.title}</span>
                <span className="shi-enc-state">{isSeen ? '看过' : '›'}</span>
              </button>

              {isOpen && (
                <div className="shi-enc-body">
                  <p className="shi-enc-text">{c.body}</p>
                  <div className="shi-enc-q">{c.question}</div>
                  <div className="shi-enc-opts">
                    {[c.optionA, c.optionB].map((opt, i) => (
                      <EncChoice
                        key={opt}
                        opt={opt}
                        right={i === (c.correct === 'A' ? 0 : 1)}
                      />
                    ))}
                  </div>
                  <div className="shi-enc-explain">{c.explain}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 展开卡片里的选项按钮（点击只高亮正确项，不判分——百科是阅读不是考试） */
function EncChoice({ opt, right }: { opt: string; right: boolean }) {
  const [picked, setPicked] = useState(false);
  return (
    <button
      type="button"
      className={`shi-enc-opt${picked ? (right ? ' is-right' : ' is-wrong') : ''}`}
      onClick={() => setPicked(true)}
    >
      {opt}
    </button>
  );
}