import { useEffect, useMemo, useState } from 'react';
import { BackButton, Icon, SpeakButton, StrokeOrder, TianziGrid, playAudio, stopAudio } from '@shi/ui';
import { loadStrokes, type CharacterRecord, type StrokeData, type WordRecord } from '@shi/content';
import type { ReviewState } from '@shi/core';

export interface MyCharsProps {
  chars: CharacterRecord[];
  states: Record<string, ReviewState>;
  wordsById: Map<string, WordRecord>;
  onBack: () => void;
}

type Filter = 'all' | 'learning' | 'mastered';

/**
 * 我认得的字：一整页田字格。
 *
 * 三重编码（颜料色 + 边框样式 + 文字标签），色盲与灰度下同样可读。
 * 点任一格开详情抽屉：米字格 + 读音 + 词 + 部首释义 + 笔顺，
 * 于是这页不只是「看进度」，而是她随时能翻的字典。
 */
export function MyCharsScreen(p: MyCharsProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [openChar, setOpenChar] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Record<string, StrokeData> | null>(null);
  const PAGE = 240;

  useEffect(() => {
    let alive = true;
    loadStrokes()
      .then((s) => alive && setStrokes(s))
      .catch(() => alive && setStrokes({}));
    return () => {
      alive = false;
    };
  }, []);

  // 抽屉打开时锁底层滚动，防滚动穿透
  useEffect(() => {
    if (!openChar) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      stopAudio();
    };
  }, [openChar]);

  const learned = useMemo(
    () => p.chars.filter((c) => p.states[c.char]),
    [p.chars, p.states],
  );

  const stats = useMemo(() => {
    let mastered = 0;
    for (const c of learned) if ((p.states[c.char]?.stage ?? 0) >= 4) mastered++;
    return { mastered, learning: learned.length - mastered, total: learned.length };
  }, [learned, p.states]);

  const filtered = useMemo(() => {
    if (filter === 'learning') return learned.filter((c) => (p.states[c.char]?.stage ?? 0) < 4);
    if (filter === 'mastered') return learned.filter((c) => (p.states[c.char]?.stage ?? 0) >= 4);
    return learned;
  }, [learned, p.states, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE, safePage * PAGE + PAGE);

  const detail = openChar ? p.chars.find((c) => c.char === openChar) : null;
  const detailWord = detail
    ? detail.wordIds.map((id) => p.wordsById.get(id)).find((w): w is WordRecord => Boolean(w))
    : undefined;

  return (
    <div className="shi-app shi-mychars">
      <div className="shi-topbar">
        <BackButton onClick={p.onBack} />
        <span className="shi-topbar-title">我认得的字</span>
        <span className="shi-caption shi-tnum">{stats.total}</span>
      </div>

      {/* 筛选：册子的书签条，不用大按钮占掉半屏 */}
      <div className="shi-chips" role="tablist" aria-label="按掌握程度筛选">
        {(
          [
            ['all', '全部', stats.total],
            ['learning', '在学', stats.learning],
            ['mastered', '学会', stats.mastered],
          ] as [Filter, string, number][]
        ).map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={filter === k}
            className={`shi-chip${filter === k ? ' is-on' : ''}`}
            data-k={k}
            onClick={() => {
              setFilter(k);
              setPage(0);
            }}
          >
            {label}
            <b className="shi-tnum">{n}</b>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="shi-center">
          <div className="shi-big">这里还没有字</div>
          <div className="shi-dim">学过的字会一个个落进格子</div>
        </div>
      ) : (
        <>
          <div className="shi-grid">
            {pageItems.map((c) => {
              const mastered = (p.states[c.char]?.stage ?? 0) >= 4;
              return (
                <button
                  key={c.char}
                  type="button"
                  className={`shi-cell ${mastered ? 'is-mastered' : 'is-learning'}`}
                  onClick={() => setOpenChar(c.char)}
                  aria-label={`${c.char}，${c.pinyin}，${mastered ? '已学会' : '在学'}`}
                >
                  <span className="shi-cell-char">{c.char}</span>
                  <span className="shi-cell-flag">{mastered ? '学会' : '在学'}</span>
                </button>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="shi-pager">
              <button
                type="button"
                className="shi-pager-btn"
                disabled={safePage === 0}
                onClick={() => setPage((v) => Math.max(0, v - 1))}
              >
                上一页
              </button>
              <span className="shi-tnum">
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="shi-pager-btn"
                disabled={safePage + 1 >= pageCount}
                onClick={() => setPage((v) => Math.min(pageCount - 1, v + 1))}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}

      {/* 详情抽屉 */}
      {detail && (
        <div className="shi-sheet-mask" onClick={() => setOpenChar(null)}>
          <div
            className="shi-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${detail.char} 的详情`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shi-sheet-grip" aria-hidden="true" />
            <div className="shi-sheet-head">
              <span className="shi-sheet-title">这个字</span>
              <button
                type="button"
                className="shi-sheet-close"
                onClick={() => setOpenChar(null)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className="shi-sheet-body">
              <div className="shi-sheet-grid">
                <TianziGrid char={detail.char} variant="mi" state="current" />
              </div>

              <div className="shi-sheet-info">
                <div className="shi-pinyinrow">
                  <span className="shi-py">{detail.pinyin}</span>
                  <SpeakButton
                    onSpeak={() => playAudio(detail.audioKey, { rate: 0.9 })}
                    label={`播放「${detail.char}」的读音`}
                  />
                </div>
                {detailWord && (
                  <div className="shi-sheet-word">
                    {detailWord.word}
                    <SpeakButton
                      onSpeak={() => playAudio(detailWord.audioKey, { rate: 0.9 })}
                      label={`播放词语「${detailWord.word}」`}
                      size={56}
                    />
                  </div>
                )}
                {(detail.radical || detail.gloss) && (
                  <div className="shi-gloss">
                    {detail.radical && <span className="shi-radical">部首 {detail.radical}</span>}
                    {detail.gloss && <span>{detail.gloss}</span>}
                  </div>
                )}
              </div>

              <div className="shi-sheet-stroke">
                <div className="shi-stroke-side">
                  <span className="shi-stroke-count shi-tnum">
                    笔顺 · {strokes?.[detail.char]?.s.length ?? detail.strokes ?? '—'} 画
                  </span>
                </div>
                <StrokeOrder char={detail.char} data={strokes?.[detail.char]} size={116} autoPlay />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}