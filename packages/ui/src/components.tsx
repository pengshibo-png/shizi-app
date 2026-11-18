import './tokens.css';
import './components.css';
import type { CSSProperties, ReactNode } from 'react';

/** 田字格 —— 全 App 唯一"用力"的元素。汉字本来住在里面。 */
export function TianziGrid({
  char,
  size,
  showGuide = true,
  variant = 'tian',
  state = 'plain',
  children,
}: {
  char: string;
  /** 不传则填满父容器（推荐：由 CSS 用 min()/vw 控宽，保证不溢出小屏） */
  size?: number;
  showGuide?: boolean;
  /** tian = 田字格（预览用）；mi = 米字格（单字教学，对角线帮定位撇捺） */
  variant?: 'tian' | 'mi';
  /** guide = 未描的淡朱引导字；done = 已识墨字；current = 正在学 */
  state?: 'plain' | 'guide' | 'done' | 'current';
  children?: ReactNode;
}) {
  const box =
    size === undefined ? { width: '100%', height: '100%' } : { width: size, height: size };
  // 字号必须相对「格子宽度」而不是父元素字号。
  // 传了 size 就直接算；没传就交给 CSS 的 cqw（容器查询单位），
  // 否则 font-size:82% 会取父级 24px 的 82% ≈ 20px，字缩成小点（实测缺陷）。
  const charStyle = size === undefined ? undefined : { fontSize: Math.round(size * 0.654) };
  const cls = [
    'shi-tianzi',
    variant === 'mi' ? 'shi-tianzi--mi' : '',
    state === 'guide' ? 'is-guide' : '',
    state === 'done' ? 'is-done' : '',
    state === 'current' ? 'is-current' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} style={box} role="img" aria-label={`汉字 ${char}`}>
      <span className="shi-tianzi-frame" aria-hidden="true" />
      {showGuide && (
        <>
          <span className="shi-tianzi-h" aria-hidden="true" />
          <span className="shi-tianzi-v" aria-hidden="true" />
        </>
      )}
      <span className="shi-tianzi-char" style={charStyle}>
        {char}
      </span>
      {children}
    </div>
  );
}

/** 巨型按钮 —— 唯一主行动。高度 96，点击区远超适老化下限。 */
export function PrimaryButton({
  children,
  onClick,
  icon,
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className="shi-btn shi-btn--primary"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {icon && <span className="shi-btn-icon">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

/** 喇叭键 —— 全 App 最高频操作，独立成块，56×56。 */
export function SpeakButton({
  onSpeak,
  label,
  playing = false,
  size = 56,
}: {
  onSpeak: () => void;
  label: string;
  playing?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      className={`shi-speak${playing ? ' is-playing' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSpeak();
      }}
      aria-label={label}
      style={{ width: size, height: size } as CSSProperties}
    >
      <svg viewBox="0 0 32 32" width={size * 0.46} height={size * 0.46} aria-hidden="true">
        <path
          d="M8 12.5h4.2L19 7.6v16.8l-6.8-4.9H8a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M22.6 11.4a6.2 6.2 0 0 1 0 9.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M25.6 8.2a10.4 10.4 0 0 1 0 15.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/** 返回键 —— 顶部左侧，64×64。 */
export function BackButton({ onClick, label = '返回' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="shi-back" onClick={onClick} aria-label={label}>
      <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
        <path
          d="M19.5 7 11 16l8.5 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** 进度条 —— 必须配文字「18 / 20」，不靠长度推断。 */
export function Progress({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="shi-progress">
      <div
        className="shi-progress-track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? '进度'}
      >
        <div className="shi-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="shi-progress-label shi-tnum">
        {value} / {max}
      </div>
    </div>
  );
}

/**
 * 完成标记 —— 绝不只靠颜色。
 * 已完成 = 实心 ✓ 图形 + 文字；未完成 = 空心圆 + 文字。
 */
export function DoneMark({ done, size = 44 }: { done: boolean; size?: number }) {
  return (
    <span
      className={`shi-donemark${done ? ' is-done' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {done ? (
        <svg viewBox="0 0 32 32" width={size * 0.55} height={size * 0.55}>
          <path
            d="M7 17.2 13 23 25 9.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}