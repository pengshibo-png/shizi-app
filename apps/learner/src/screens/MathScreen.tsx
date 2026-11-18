import { useEffect, useState } from 'react';
import { BackButton, SpeakButton, playAudio, stopAudio } from '@shi/ui';
import type { MathLesson } from '@shi/content';

export interface MathProps {
  lesson: MathLesson;
  onDone: () => void;
  onBack: () => void;
}

/**
 * 生活数学：一节课 = 讲解 + 3 题 + 一个"今天就能用"的动作。
 * 题面全部挂生活场景，不出抽象算式。
 */
export function MathScreen(p: MathProps) {
  const [qi, setQi] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [rightCount, setRightCount] = useState(0);
  const [finished, setFinished] = useState(false);

  const item = p.lesson.items[qi];

  useEffect(() => () => stopAudio(), []);

  function speakScript() {
    // 讲解稿的音频按 lesson 预生成；缺文件时静默退化，界面仍可读
    playAudio(p.lesson.audioKey, { rate: 0.9 });
  }

  function handlePick(i: number) {
    if (picked !== null || !item) return;
    setPicked(i);
    const correct = i === item.correct;
    if (correct) setRightCount((v) => v + 1);
    window.setTimeout(() => {
      setPicked(null);
      if (qi + 1 >= p.lesson.items.length) setFinished(true);
      else setQi(qi + 1);
    }, correct ? 900 : 1600);
  }

  if (!item && !finished) {
    return (
      <div className="shi-app">
        <div className="shi-topbar">
          <BackButton onClick={p.onBack} />
        </div>
        <div className="shi-center">
          <div className="shi-big">这节课没有题</div>
          <button type="button" className="shi-btn shi-btn--primary" onClick={p.onDone}>
            好了
          </button>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="shi-app">
        <div className="shi-topbar">
          <BackButton onClick={p.onBack} />
        </div>
        <div className="shi-center">
          <div className="shi-big">
            这节做完了 · {rightCount} / {p.lesson.items.length}
          </div>
          <div className="shi-dim">{p.lesson.action}</div>
          <button type="button" className="shi-btn shi-btn--primary" onClick={p.onDone}>
            好了
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shi-app">
      <div className="shi-topbar">
        <BackButton onClick={p.onBack} />
        <span className="shi-topbar-title shi-tnum">
          {qi + 1} / {p.lesson.items.length}
        </span>
      </div>

      <div className="shi-math-head">
        <div className="shi-mod">{p.lesson.module}</div>
        <h1>{p.lesson.title}</h1>
      </div>

      <div className="shi-math-script">
        {p.lesson.script}{' '}
        <SpeakButton onSpeak={speakScript} label="播放讲解" size={56} />
      </div>

      <div className="shi-math-prompt">{item!.prompt}</div>

      <div className="shi-math-opts">
        {item!.options.map((opt, i) => (
          <button
            key={opt}
            type="button"
            className={`shi-math-opt${
              picked !== null
                ? i === item!.correct
                  ? ' is-right'
                  : i === picked
                    ? ' is-wrong'
                    : ''
                : ''
            }`}
            onClick={() => handlePick(i)}
          >
            {opt}
          </button>
        ))}
      </div>

      {picked !== null && picked !== item!.correct && item!.hint && (
        <div className="shi-feedback">
          <div className="shi-fb-text">{item!.hint}</div>
        </div>
      )}
    </div>
  );
}