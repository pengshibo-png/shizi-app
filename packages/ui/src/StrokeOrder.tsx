import { useEffect, useRef, useState } from 'react';
import HanziWriter from 'hanzi-writer';
import type { StrokeData } from '@shi/content';

/**
 * 笔顺演示 —— 描红本的核心动作。
 *
 * 老人学字不能只看静态字形：起笔、行笔、收笔的顺序才是「怎么写」。
 * 这里在米字格里逐笔演示，点一下重播。
 *
 * 颜色取自本册子：轮廓淡朱（描红引导）、笔画松烟墨、当前笔朱砂。
 * 数据来自 hanzi-writer-data（Arphic PL），只打包我们教的 1800 字。
 */
export function StrokeOrder({
  char,
  data,
  size = 150,
  autoPlay = true,
  onDone,
}: {
  char: string;
  data: StrokeData | undefined;
  size?: number;
  autoPlay?: boolean;
  onDone?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const writerRef = useRef<HanziWriter | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !data) return;

    host.innerHTML = '';
    setReady(false);

    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--shi-color-text').trim() || '#17130f';
    const guide = css.getPropertyValue('--shi-color-faint').trim() || '#857c6e';
    const accent = css.getPropertyValue('--shi-color-action').trim() || '#9a2820';

    let writer: HanziWriter;
    try {
      writer = HanziWriter.create(host, char, {
        width: size,
        height: size,
        padding: 6,
        showOutline: true,
        showCharacter: false,
        strokeColor: ink,
        outlineColor: guide,
        radicalColor: accent,
        highlightColor: accent,
        strokeAnimationSpeed: 0.85,
        delayBetweenStrokes: 220,
        charDataLoader: (_c, onComplete) => {
          onComplete({ strokes: data.s, medians: data.m } as never);
        },
      });
    } catch {
      return;
    }

    writerRef.current = writer;
    setReady(true);

    if (autoPlay) {
      setPlaying(true);
      writer.animateCharacter({
        onComplete: () => {
          setPlaying(false);
          onDone?.();
        },
      });
    }

    return () => {
      try {
        // hanzi-writer 没有 cancelAnimation；用 pauseAnimation 停住再清空宿主
        writer.pauseAnimation();
      } catch {
        /* 卸载时动画可能已结束 */
      }
      writerRef.current = null;
      host.innerHTML = '';
    };
    // onDone 每次渲染都是新函数，不进依赖，避免重复重播
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char, data, size, autoPlay]);

  function replay() {
    const w = writerRef.current;
    if (!w || playing) return;
    setPlaying(true);
    w.hideCharacter();
    w.animateCharacter({ onComplete: () => setPlaying(false) });
  }

  if (!data) {
    return (
      <div className="shi-stroke shi-stroke--empty">
        <span>笔顺准备中</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`shi-stroke${playing ? ' is-playing' : ''}`}
      onClick={replay}
      aria-label={`重播 ${char} 的笔顺`}
    >
      <div ref={hostRef} className="shi-stroke-canvas" aria-hidden="true" />
      <span className="shi-stroke-hint">
        {playing ? '正在写' : ready ? '点一下再看' : '准备中'}
      </span>
    </button>
  );
}