/**
 * 图标集「描红」—— 自绘 SVG，统一 1.8px 描边、圆角端点。
 *
 * 每个图标都画成老人能认出来的**实物**，不用通用 App 抽象符号：
 *   田字格 / 线装册 / 印章 / 方孔铜钱 / 回环箭头 / 信封 / 喇叭 / 毛笔
 * 不用图标库：老人端只需这几个，引库要背几百个图形的体积，
 * 而且通用库的抽象度对老人偏高（「列表」图标老人不认识）。
 */

export type IconName =
  | 'grid'      // 田字格 —— 今天习字
  | 'book'      // 线装册 —— 生活百科
  | 'seal'      // 印章 —— 我的 / 记录
  | 'math'      // 方孔铜钱 —— 生活数学
  | 'science'   // 册页 —— 百科条目
  | 'review'    // 回环 —— 复习
  | 'chars'     // 翻开的本子 —— 我的字
  | 'message'   // 信封 —— 家人留言
  | 'sound'     // 喇叭
  | 'brush'     // 毛笔 —— 接着习字
  | 'play';

const paths: Record<IconName, string> = {
  // 田字格：外方框 + 虚十字（虚线用两段短线示意）
  grid: 'M4 4h16v16H4V4Zm8 0v5m0 6v5M4 12h5m6 0h5',
  // 线装册：竖长方 + 左侧装订孔
  book: 'M6.5 3.5h12v17h-12v-17Zm0 0v17M3.6 6.4h2.9M3.6 12h2.9M3.6 17.6h2.9M10 8h5.2M10 12h5.2',
  // 印章：方印 + 印钮
  seal: 'M5.5 9.5h13v11h-13v-11Zm3.2-6h6.6v6H8.7v-6ZM9 14h6M9 17.2h4',
  // 方孔铜钱 —— 中国老人一眼认得的「钱」
  math: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-3.2 5.8h6.4v6.4H8.8V8.8Z',
  // 册页：翻开的两页
  science:
    'M12 6.6C10.4 5.2 8.2 4.6 5 4.8v12.6c3.2-.2 5.4.4 7 1.8 1.6-1.4 3.8-2 7-1.8V4.8c-3.2-.2-5.4.4-7 1.8Zm0 0v13.2',
  // 回环箭头 —— 复习
  review:
    'M4.6 9.2a7.8 7.8 0 0 1 13.3-2.6M19.8 3.4v3.4h-3.4M19.4 14.8A7.8 7.8 0 0 1 6.1 17.4M4.2 20.6v-3.4h3.4',
  chars:
    'M12 6.6C10.4 5.2 8.2 4.6 5 4.8v12.6c3.2-.2 5.4.4 7 1.8 1.6-1.4 3.8-2 7-1.8V4.8c-3.2-.2-5.4.4-7 1.8Zm0 0v13.2',
  message: 'M3.6 7.2h16.8v10.2H3.6V7.2Zm0 0 8.4 6 8.4-6',
  sound: 'M8 12.5h4.2L19 7.6v16.8l-6.8-4.9H8v-7Z',
  // 毛笔：笔杆 + 笔锋
  brush: 'M15.6 3.4l5 5-8.2 8.2-5-5 8.2-8.2Zm-8.2 8.2l-2.6 7.6 7.6-2.6M4.8 19.2l2.4-2.4',
  play: 'M9 6.4v11.2l9-5.6-9-5.6Z',
};

export function Icon({
  name,
  size = 40,
  color = 'currentColor',
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}