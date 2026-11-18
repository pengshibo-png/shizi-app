import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 老人学习端 —— Android 原生壳
 *
 * webDir 指向 Vite 构建产物；basename 用 shizi-learner 以区分两个 APK。
 * 全部内容（字表/音频/字体）都打进 assets，运行期不需要网络。
 */
const config: CapacitorConfig = {
  appId: 'cn.shizi.learner',
  appName: '识字',
  webDir: 'dist',
  android: {
    // 离线优先：不允许系统在低存储时随意清掉我们的数据
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    /**
     * targetSdk 36 在 Android 15+ 强制 edge-to-edge，状态栏/导航栏颜色由系统忽略。
     * 若让原生去垫安全区内边距，WebView 就不铺到系统栏后面 —— 实测那条会露出
     * 窗口底色（深色界面上顶一条浅色横条）。
     * 所以这里显式要求 css 处理：WebView 铺满整屏，画布色自己盖住系统栏区域，
     * 内容避让交给 CSS 的 env(safe-area-inset-*)（index.html 已有 viewport-fit=cover）。
     */
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;