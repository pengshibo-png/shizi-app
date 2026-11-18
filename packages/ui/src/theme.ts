/**
 * 主题切换：按系统时钟在「纸」与「墨」之间自动切换。
 *
 * 这不是装饰性皮肤，而是功能：老人夜里畏光，18:00 后背景自动转暗。
 * 用户也可以手动锁定，手动选择优先于时钟。
 */

export type ThemeName = 'paper' | 'ink';
export type ThemeMode = 'auto' | 'paper' | 'ink';

const KEY = 'shi.themeMode';

/** 6:00–18:00 用纸，其余用墨 */
export function themeForHour(hour: number): ThemeName {
  return hour >= 6 && hour < 18 ? 'paper' : 'ink';
}

export function resolveTheme(mode: ThemeMode, now: Date): ThemeName {
  if (mode === 'paper' || mode === 'ink') return mode;
  return themeForHour(now.getHours());
}

export function loadThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'paper' || v === 'ink' || v === 'auto') return v;
  } catch {
    /* 隐私模式可能不可用 */
  }
  return 'auto';
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* 存不下也不影响使用 */
  }
}

export function applyTheme(name: ThemeName, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = name;
}

/**
 * 启动主题：先按当前时刻定一次，之后每分钟检查一次是否该换装。
 * 返回取消订阅函数。
 */
export function startThemeWatcher(
  getMode: () => ThemeMode,
  onChange: (t: ThemeName) => void,
): () => void {
  let last: ThemeName | null = null;

  const tick = () => {
    const t = resolveTheme(getMode(), new Date());
    if (t !== last) {
      last = t;
      applyTheme(t);
      onChange(t);
    }
  };

  tick();
  const id = window.setInterval(tick, 60_000);
  return () => window.clearInterval(id);
}