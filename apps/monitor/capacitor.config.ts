import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 家属监护端 —— Android 原生壳
 *
 * 与老人端分开打包，appId 不同，可以同时装在同一台手机上。
 * 本身不存内容，只从同步服务拉日报。
 */
const config: CapacitorConfig = {
  appId: 'cn.shizi.monitor',
  appName: '家人学习情况',
  webDir: 'dist',
  android: {
    allowMixedContent: true, // 家用局域网同步地址常是 http
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;