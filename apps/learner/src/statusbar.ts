/**
 * 系统栏与主题同步。
 *
 * 分工（两条路都留着，覆盖不同系统版本）：
 *  - `android/.../MainActivity.java` 在 onCreate/onResume 按同一个时钟规则设好两条栏，
 *    解决「JS 还没跑」的首帧，以及 Android 14 及以下 WebView 被内边距顶开时露出的窗口底色。
 *  - 这里负责运行中的变化：跨过 18:00 自动换装、用户手动锁纸/锁墨。
 *  - Android 15+（targetSdk 35/36）强制 edge-to-edge，`setBackgroundColor` 会被系统忽略，
 *    但那时内容本来就画到栏后面，画布自己盖住那条，所以这里的调用退化为无害。
 *
 * 只在原生壳生效；浏览器里静默跳过，不影响 dev。
 */

import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { ThemeName } from '@shi/ui';

/** 与 --shi-color-canvas、MainActivity 的 CANVAS_* 保持一致 */
const CANVAS: Record<ThemeName, string> = {
  paper: '#f5efe1',
  ink: '#1a1714',
};

export async function syncStatusBar(theme: ThemeName): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setBackgroundColor({ color: CANVAS[theme] });
  } catch {
    /* Android 15+ 会忽略；不影响界面本身 */
  }
  try {
    // Style.Dark = 深色图标（浅底/纸）；Style.Light = 浅色图标（深底/墨）
    await StatusBar.setStyle({ style: theme === 'paper' ? Style.Dark : Style.Light });
  } catch {
    /* 老设备或缺权限时不阻塞界面 */
  }
}