import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackButton,
  Progress,
  SpeakButton,
  StrokeOrder,
  TianziGrid,
  playAudio,
  preloadAudio,
  stopAudio,
  type AudioKey,
} from '@shi/ui';
import { loadStrokes, type CharacterRecord, type StrokeData, type WordRecord } from '@shi/content';
import { hashSeed, pickReadingDistractor } from '@shi/core';

export interface StudyProps {
  chars: string[];
  byChar: Map<string, CharacterRecord>;
  wordsById: Map<string, WordRecord>;
  wordsOfChar: (c: CharacterRecord) => WordRecord[];
  /** 全字表：干扰读音从这里取，本批次可能只剩 1 个字 */
  allChars: CharacterRecord[];
  onLearn: (char: string) => void;
  onAnswer: (char: string, result: 'correct' | 'wrong') => void;
  onDone: () => void;
  onBack: () => void;
}

/**
 * 单字学习：5 拍
 *  1 大字占屏 → 2 自动朗读 → 3 笔顺提示 → 4 词组 + 例句 → 5 二选一识别
 *
 * 关键取舍：不做书写练习。目标是"看见能读、知道意思"，
 * 这样 20 字/天才有可能在老人身上成立。
 *
 * 注意：所有 hooks 必须在任何条件 return 之前调用，
 * 否则切换字时会触发 "Rendered fewer hooks than expected"。
 */
export function StudyScreen(p: StudyProps) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<'left' | 'right' | null>(null);
  const [wrongOnce, setWrongOnce] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [leftIsRight, setLeftIsRight] = useState(true);
  const learnedRef = useRef<Set<string>>(new Set());
  const [strokes, setStrokes] = useState<Record<string, StrokeData> | null>(null);

  // 笔顺数据懒加载（4.18 MB，不进主包）；失败也不影响认读主流程
  useEffect(() => {
    let alive = true;
    loadStrokes()
      .then((s) => {
        if (alive) setStrokes(s);
      })
      .catch(() => {
        if (alive) setStrokes({});
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 批次快照：只在进入学习流程时取一次。
   *
   * 不能直接依赖 props.chars —— 父组件的 newCharsToday 会随 learnedCount
   * 变化而重算（need = target - doneToday）。若这里实时跟随，
   * 学会一个字 → 列表整体前移 → 当前字变化 → 再次上报学会 → 无限循环，
   * 最终把 learnedCount 推到 target 使列表变空。这是实测踩到的真实缺陷。
   */
  const [batch] = useState<string[]>(() => p.chars);

  const list = useMemo(
    () =>
      batch
        .map((c) => p.byChar.get(c))
        .filter((c): c is CharacterRecord => Boolean(c)),
    [batch, p.byChar],
  );

  const cur = list[idx];

  // 进入新字：随机决定正确项在左还是右，重置状态，自动朗读
  useEffect(() => {
    const c = list[idx];
    if (!c) return;
    setPicked(null);
    setWrongOnce(false);
    setLeftIsRight(Math.random() < 0.5);

    // 同一个字只上报一次"学会"，避免重渲染时重复计数
    if (!learnedRef.current.has(c.char)) {
      learnedRef.current.add(c.char);
      p.onLearn(c.char);
    }

    const t = window.setTimeout(() => {
      setPlaying(true);
      playAudio(c.audioKey, {
        rate: 0.92,
        onEnd: () => setPlaying(false),
        onError: () => setPlaying(false),
      });
    }, 380);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, list]);

  // 预取后 5 个字的音频，减少首播延迟
  useEffect(() => {
    preloadAudio(list.slice(idx + 1, idx + 6).map((c) => c.audioKey));
  }, [idx, list]);

  useEffect(() => () => stopAudio(), []);

  function speak(key: AudioKey) {
    setPlaying(true);
    playAudio(key, {
      rate: 0.92,
      onEnd: () => setPlaying(false),
      onError: () => setPlaying(false),
    });
  }

  if (!cur) {
    return (
      <div className="shi-app">
        <div className="shi-topbar">
          <BackButton onClick={p.onBack} />
        </div>
        <div className="shi-center">
          <div className="shi-big">今天的字都学完了</div>
          <button type="button" className="shi-btn shi-btn--primary" onClick={p.onDone}>
            回首页
          </button>
        </div>
      </div>
    );
  }

  const words = p.wordsOfChar(cur);
  const word = words[0];
  // 考「这个字念什么」：两个真实读音二选一。
  // 原先给的是两个**字形**（其中一个就是上面格里那个字），老人只需比对形状，
  // 考不出认读；批次只剩 1 个字时还会退化成「？」。
  const distractor = pickReadingDistractor(cur, p.allChars, hashSeed(`study:${cur.char}:${idx}`));

  function handlePick(side: 'left' | 'right') {
    if (picked || !cur) return;
    const isRight = (side === 'left') === leftIsRight;
    setPicked(side);
    p.onAnswer(cur.char, isRight ? 'correct' : 'wrong');
    speak(cur.audioKey);

    if (isRight) {
      window.setTimeout(() => advance(), 950);
    } else {
      setWrongOnce(true);
      // 答错不惩罚：给出正确答案并自动加复习，留足时间看完反馈
      window.setTimeout(() => advance(), 1800);
    }
  }

  function advance() {
    setPicked(null);
    setWrongOnce(false);
    if (idx + 1 >= list.length) p.onDone();
    else setIdx(idx + 1);
  }

  const leftLabel = leftIsRight ? cur.pinyin : distractor;
  const rightLabel = leftIsRight ? distractor : cur.pinyin;

  return (
    <div className="shi-charpage">
      <div className="shi-topbar">
        <BackButton onClick={p.onBack} />
        <Progress value={idx + 1} max={list.length} label="今天的新字进度" />
      </div>

      <div className="shi-tianzi-wrap">
        <TianziGrid char={cur.char} variant="mi" state="current" />
      </div>

      <div className="shi-readout">
        <div className="shi-pinyinrow">
          <span className="shi-py">{cur.pinyin}</span>
          <SpeakButton
            onSpeak={() => speak(cur.audioKey)}
            playing={playing}
            label={`播放「${cur.char}」的读音`}
          />
        </div>
        {word && (
          <div className="shi-word">
            {word.word}{' '}
            <SpeakButton
              onSpeak={() => speak(word.audioKey)}
              label={`播放词语「${word.word}」`}
              size={56}
            />
          </div>
        )}
        {(cur.gloss || cur.radical) && (
          <div className="shi-gloss">
            {cur.radical && <span className="shi-radical">部首 {cur.radical}</span>}
            {cur.gloss && <span>{cur.gloss}</span>}
          </div>
        )}
      </div>

      {/* 笔顺：左边一行小字说明，右边一个小格演示。不占多余注意力 */}
      <div className="shi-stroke-row">
        <div className="shi-stroke-side">
          <span className="shi-stroke-count shi-tnum">
            笔顺 · {strokes?.[cur.char]?.s.length ?? cur.strokes ?? '—'} 画
          </span>
        </div>
        <StrokeOrder
          char={cur.char}
          data={strokes?.[cur.char]}
          size={128}
          autoPlay
        />
      </div>

      <div className="shi-choices">
        <button
          type="button"
          className={`shi-choice${
            picked === 'left' ? (leftIsRight ? ' is-right' : ' is-wrong') : ''
          }`}
          onClick={() => handlePick('left')}
          aria-label={`选 ${leftLabel}`}
        >
          {leftLabel}
        </button>
        <button
          type="button"
          className={`shi-choice${
            picked === 'right' ? (!leftIsRight ? ' is-right' : ' is-wrong') : ''
          }`}
          onClick={() => handlePick('right')}
          aria-label={`选 ${rightLabel}`}
        >
          {rightLabel}
        </button>
      </div>

      {wrongOnce && (
        <div className="shi-feedback">
          <div className="shi-fb-text">
            这是「{cur.char}」，念 {cur.pinyin}。没关系，明天还会再见到它。
          </div>
        </div>
      )}
    </div>
  );
}