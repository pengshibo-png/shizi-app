import { useEffect, useState } from 'react';
import { BackButton, SpeakButton, playAudio, stopAudio } from '@shi/ui';
import type { EncyclopediaCard } from '@shi/content';

export interface ScienceProps {
  card: EncyclopediaCard;
  onDone: () => void;
  onBack: () => void;
}

/**
 * 科普：一张卡 = 大字标题 + 60–90 字正文（可全文朗读）+ 1 道判断题。
 * 老人不认字，所以"听"是主路径，文字是辅助。
 */
export function ScienceScreen(p: ScienceProps) {
  const [picked, setPicked] = useState<'A' | 'B' | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => stopAudio(), []);

  function speak() {
    // 百科新条目音频未生成时 audioKey 为 null：静默降级（界面文字可读，不白屏）
    if (!p.card.audioKey) return;
    setPlaying(true);
    playAudio(p.card.audioKey, {
      rate: 0.9,
      onEnd: () => setPlaying(false),
      onError: () => setPlaying(false),
    });
  }

  function handlePick(side: 'A' | 'B') {
    if (picked) return;
    setPicked(side);
    window.setTimeout(() => {
      if (side === p.card.correct) p.onDone();
      else p.onDone(); // 答错也算学过一遍，不卡住老人
    }, 1200);
  }

  const isRight = picked === p.card.correct;

  return (
    <div className="shi-app">
      <div className="shi-topbar">
        <BackButton onClick={p.onBack} />
        <span className="shi-topbar-title">科普</span>
      </div>

      <div className="shi-scicard">
        <div className="shi-sci-theme">
          {p.card.theme} · 第 {p.card.day} 天
        </div>
        <div className="shi-sci-title">{p.card.title}</div>

        <div className="shi-sci-body">
          {p.card.body}{' '}
          <SpeakButton onSpeak={speak} playing={playing} label="播放这条科普" size={56} />
        </div>

        <div className="shi-sci-q">{p.card.question}</div>

        <div className="shi-math-opts">
          <button
            type="button"
            className={`shi-math-opt${
              picked !== null ? (p.card.correct === 'A' ? ' is-right' : picked === 'A' ? ' is-wrong' : '') : ''
            }`}
            onClick={() => handlePick('A')}
          >
            {p.card.optionA}
          </button>
          <button
            type="button"
            className={`shi-math-opt${
              picked !== null ? (p.card.correct === 'B' ? ' is-right' : picked === 'B' ? ' is-wrong' : '') : ''
            }`}
            onClick={() => handlePick('B')}
          >
            {p.card.optionB}
          </button>
        </div>

        {picked && (
          <div className="shi-feedback">
            <div className="shi-fb-text">
              {isRight ? '说对了。' : ''}
              {p.card.explain}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}