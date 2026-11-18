import { useEffect, useMemo, useState } from 'react';
import { MATH_CHECKS, SAMPLE_TOTAL, buildSample, mathStartDay } from '@shi/core';
import { TianziGrid } from '@shi/ui';
import type { CharacterRecord } from '@shi/content';

export interface PlacementOutcome {
  charAnswers: { char: string; correct: boolean; ms: number }[];
  mathAnswers: boolean[];
  mathStart: number;
}

/**
 * 摸底屏：识字 120 字抽样 → 数学 6 题。
 *
 * 「考试」的壳一秒都不能有：文案是「看看您已经会哪些」，
 * 答错只说「以后会教」，全程可跳。
 * 摸底结果直接改写字序（认识 500 字 → 只学剩下 1300）。
 *
 * 所有 hooks 在任何条件 return 之前（React 规则，之前踩过）。
 */
export function PlacementScreen({
  chars,
  onFinish,
  onSkip,
}: {
  chars: CharacterRecord[];
  onFinish: (o: PlacementOutcome) => void;
  onSkip: () => void;
}) {
  const [phase, setPhase] = useState<'char' | 'math'>('char');
  const [ci, setCi] = useState(0);
  const [charAnswers, setCharAnswers] = useState<
    { char: string; correct: boolean; ms: number }[]
  >([]);
  const [picked, setPicked] = useState<'left' | 'right' | null>(null);
  const [leftIsRight, setLeftIsRight] = useState(true);

  const [mi, setMi] = useState(0);
  const [mathAnswers, setMathAnswers] = useState<boolean[]>([]);
  const [mPicked, setMPicked] = useState<number | null>(null);
  /** 识字测完进入数学时携带的答案快照（避免闭包旧值） */
  const [pendingChar, setPendingChar] = useState<
    { char: string; correct: boolean; ms: number }[]
  >([]);

  const sample = useMemo(() => buildSample(chars, 42), [chars]);
  const qStart = useMemo(() => Date.now(), [ci, phase, mi]);

  useEffect(() => {
    setLeftIsRight(Math.random() < 0.5);
    setPicked(null);
    setMPicked(null);
  }, [ci, mi, phase]);

  function finish(a: { char: string; correct: boolean; ms: number }[], m: boolean[]) {
    onFinish({ charAnswers: a, mathAnswers: m, mathStart: mathStartDay(m) });
  }

  // ================================================================ 识字阶段

  if (phase === 'char') {
    const q = sample[ci];

    if (!q) {
      queueMicrotask(() => setPhase('math'));
      return (
        <div className="shi-app">
          <div className="shi-center">
            <div className="shi-big">识字看完了</div>
            <div className="shi-dim">接下来看看算术</div>
          </div>
        </div>
      );
    }

    const pick = (side: 'left' | 'right') => {
      if (picked) return;
      const isRight = (side === 'left') === leftIsRight;
      setPicked(side);
      const rec = { char: q.char.char, correct: isRight, ms: Date.now() - qStart };
      window.setTimeout(() => {
        const next = [...charAnswers, rec];
        setCharAnswers(next);
        setPicked(null);
        if (ci + 1 >= SAMPLE_TOTAL) {
          setPendingChar(next);
          setPhase('math');
        } else {
          setCi(ci + 1);
        }
      }, isRight ? 550 : 1000);
    };

    return (
      <div className="shi-charpage">
        <div className="shi-topbar">
          <span className="shi-topbar-title">看看您已经会哪些</span>
          <span className="shi-caption shi-tnum">
            {ci + 1} / {SAMPLE_TOTAL}
          </span>
        </div>

        <div className="shi-place-note">
          这个字念什么？认得就选对的读音。不认得随便选，以后会教。
        </div>

        <div className="shi-tianzi-wrap">
          <TianziGrid char={q.char.char} variant="mi" />
        </div>

        <div className="shi-choices">
          <button
            type="button"
            className={`shi-choice${picked === 'left' ? (leftIsRight ? ' is-right' : '') : ''}`}
            onClick={() => pick('left')}
            aria-label={`选 ${leftIsRight ? q.char.pinyin : q.distractor}`}
          >
            {leftIsRight ? q.char.pinyin : q.distractor}
          </button>
          <button
            type="button"
            className={`shi-choice${picked === 'right' ? (!leftIsRight ? ' is-right' : '') : ''}`}
            onClick={() => pick('right')}
            aria-label={`选 ${!leftIsRight ? q.char.pinyin : q.distractor}`}
          >
            {!leftIsRight ? q.char.pinyin : q.distractor}
          </button>
        </div>

        <button type="button" className="shi-place-skip" onClick={onSkip}>
          先跳过，直接开始学
        </button>
      </div>
    );
  }

  // ================================================================ 数学阶段

  const effCharAnswers = pendingChar.length > 0 ? pendingChar : charAnswers;
  const m = MATH_CHECKS[mi];

  if (!m) {
    queueMicrotask(() => finish(effCharAnswers, mathAnswers));
    return (
      <div className="shi-app">
        <div className="shi-center">
          <div className="shi-big">都看完了</div>
        </div>
      </div>
    );
  }

  const mpick = (i: number) => {
    if (mPicked !== null) return;
    setMPicked(i);
    const ok = i === m.correct;
    window.setTimeout(() => {
      const next = [...mathAnswers, ok];
      setMathAnswers(next);
      setMPicked(null);
      // 答错即停：基础没过，从那儿补
      if (!ok || mi + 1 >= MATH_CHECKS.length) {
        finish(effCharAnswers, next);
      } else {
        setMi(mi + 1);
      }
    }, ok ? 550 : 1200);
  };

  return (
    <div className="shi-app">
      <div className="shi-topbar">
        <span className="shi-topbar-title">再看看算术</span>
        <span className="shi-caption shi-tnum">
          {mi + 1} / {MATH_CHECKS.length}
        </span>
      </div>

      <div className="shi-place-note">答到哪算哪，答不上的直接从那儿教。</div>

      <div className="shi-math-prompt">{m.prompt}</div>

      <div className="shi-math-opts">
        {m.options.map((opt, i) => (
          <button
            key={opt}
            type="button"
            className={`shi-math-opt${
              mPicked !== null
                ? i === m.correct
                  ? ' is-right'
                  : i === mPicked
                    ? ' is-wrong'
                    : ''
                : ''
            }`}
            onClick={() => mpick(i)}
          >
            {opt}
          </button>
        ))}
      </div>

      {mPicked !== null && mPicked !== m.correct && (
        <div className="shi-feedback">
          <div className="shi-fb-text">没关系，这个以后教。</div>
        </div>
      )}

      <button type="button" className="shi-place-skip" onClick={onSkip}>
        先跳过，直接开始学
      </button>
    </div>
  );
}