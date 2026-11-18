import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 设计令牌必须先于任何组件样式加载，否则 var(--shi-*) 全部落空，
// 页面会退化成浏览器默认的白底黑字（实测踩到过）。
import '@shi/ui/tokens.css';
import { App } from './App.js';

const el = document.getElementById('root');
if (!el) throw new Error('#root 不存在');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);