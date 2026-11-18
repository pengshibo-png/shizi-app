import { useEffect, useMemo, useState } from 'react';
import {
  BackButton,
  Progress,
  SpeakButton,
  TianziGrid,
  playAudio,
  stopAudio,
} from '@shi/ui';
import { answerOnLeft, hashSeed, pickReadingDistractor } from '@shi/core';
import type { CharacterRecord, WordRecord } from '@shi/content';

export interface ReviewProps {
  chars: string[];
  byChar: Map<string, CharacterRecord>;
  wordsById: Map<string, WordRecord>;
  /** 全字表：干扰读音从这里取，不能从本批次取（批次可能只有 1 个字） */
  allChars: CharacterRecord[];
  onAnswer: (char: string, result: 'correct' | 'wrong') => void;
  onDone: () => void;
  onBack: () => void;
}

/**
 * 复习：只做"认读"识别，每项 ≤8 秒。
 * 不出示拼音，先看能不能认出来；答错才给读音和词组。
 */
export function ReviewScreen(p: ReviewProps) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<'left' | 'right' | null>(null);
  const [played, setPlayed] = useState(false);

  /**
   * 批次快照：进入复习时固定，避免作答后父组件重算到期列表
   * 导致当前字被换掉、进度错位。
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

  useEffect(() => () => stopAudio(), []);

  if (list.length === 0) {
    return (
      <div className="shi-app">
        <div className="shi-topbar">
          <BackButton onClick={p.onBack} />
        </div>
        <div className="shi-center">
          <div className="shi-big">今天没有要复习的</div>
          <div className="shi-dim">新学的字明天会来复习</div>
          <button type="button" className="shi-btn shi-btn--primary" onClick={p.onDone}>
            回首页
          </button>
        </div>
      </div>
    );
  }

  if (!cur) {
    return (
      <div className="shi-app">
        <div className="shi-center">
          <div className="shi-big">复习完了</div>
          <button type="button" className="shi-btn shi-btn--primary" onClick={p.onDone}>
            回首页
          </button>
        </div>
      </div>
    );
  }

  // 干扰读音从全字表取（本批次可能只有 1 个字，取不到别的）。
  // 原先这里错误项写「不是这个」，等于把答案告诉她 —— 家属端的正确率会全是假的。
  const distractor = pickReadingDistractor(cur, p.allChars, hashSeed(`rev:${cur.char}:${idx}`));
  const showChar = cur.char;
  // 每题独立随机，不能用 idx % 2（老人会摸出「隔一个在左」的规律）
  const leftIsRight = answerOnLeft(hashSeed(`side:${cur.char}:${idx}`));

  function speak() {
    playAudio(cur!.audioKey, { rate: 0.92 });
    setPlayed(true);
  }

  function handlePick(side: 'left' | 'right') {
    if (picked) return;
    const isRight = (side === 'left') === leftIsRight;
    setPicked(side);
    p.onAnswer(cur!.char, isRight ? 'correct' : 'wrong');
    playAudio(cur!.audioKey, { rate: 0.9 });
    window.setTimeout(() => {
      setPicked(null);
      setPlayed(false);
      if (idx + 1 >= list.length) p.onDone();
      else setIdx(idx + 1);
    }, isRight ? 800 : 1500);
  }

  return (
    <div className="shi-charpage">
      <div className="shi-topbar">
        <BackButton onClick={p.onBack} />
        <Progress value={idx + 1} max={list.length} label="复习进度" />
      </div>

      <div className="shi-tianzi-wrap">
        <TianziGrid char={showChar} showGuide={played} />
      </div>

      <div className="shi-readout">
        <div className="shi-pinyinrow">
          <SpeakButton onSpeak={speak} label={`播放「${showChar}」的读音`} />
        </div>
        <div className="shi-sent">这个字念什么？</div>
      </div>

      <div className="shi-choices">
        <button
          type="button"
          className={`shi-choice${picked === 'left' ? (leftIsRight ? ' is-right' : ' is-wrong') : ''}`}
          onClick={() => handlePick('left')}
          aria-label={`选 ${leftIsRight ? cur.pinyin : distractor}`}
        >
          {leftIsRight ? cur.pinyin : distractor}
        </button>
        <button
          type="button"
          className={`shi-choice${picked === 'right' ? (!leftIsRight ? ' is-right' : ' is-wrong') : ''}`}
          onClick={() => handlePick('right')}
          aria-label={`选 ${!leftIsRight ? cur.pinyin : distractor}`}
        >
          {!leftIsRight ? cur.pinyin : distractor}
        </button>
      </div>

      {picked && (
        <div className="shi-feedback">
          <div className="shi-fb-text">
            「{cur.char}」念 {cur.pinyin}
            {cur.readings.length > 1 ? `，也念 ${cur.readings.filter((r) => r !== cur.pinyin).join('、')}` : ''}
            。
          </div>
        </div>
      )}
    </div>
  );
}