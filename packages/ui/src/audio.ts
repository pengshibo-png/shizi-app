/**
 * 音频播放 —— 全部走预生成文件，不依赖设备 TTS。
 *
 * 为什么不用 speechSynthesis：中国 Android 的 WebView 常缺 zh-CN 语音包，
 * UC/百度浏览器根本不支持。对不认字的老人，"听"是唯一入口，不能赌设备。
 */

export type AudioKey = string;

let current: HTMLAudioElement | null = null;
let baseUrl = '/audio/';

export function setAudioBaseUrl(url: string): void {
  baseUrl = url.endsWith('/') ? url : `${url}/`;
}

/** key 形如 "c/人"、"cw/重"、"w/重要"。中文文件名必须编码后才能作为 URL。 */
export function audioUrl(key: AudioKey): string {
  const [dir, ...rest] = key.split('/');
  const name = rest.join('/');
  return `${baseUrl}${dir}/${encodeURIComponent(name)}.mp3`;
}

export interface PlayOptions {
  /** 播放速率，老人听读建议 0.85–0.95 */
  rate?: number;
  onEnd?: () => void;
  onError?: () => void;
}

/**
 * 播放一条预生成音频。任何新播放都会打断上一条（老人连点不应该叠音）。
 */
export function playAudio(key: AudioKey, opts: PlayOptions = {}): void {
  stopAudio();
  const el = new Audio(audioUrl(key));
  el.playbackRate = opts.rate ?? 0.92;
  el.preload = 'auto';
  current = el;

  el.addEventListener('ended', () => {
    if (current === el) current = null;
    opts.onEnd?.();
  });
  el.addEventListener('error', () => {
    if (current === el) current = null;
    opts.onError?.();
  });

  void el.play().catch(() => {
    // 自动播放被拦截或文件缺失，交给调用方决定是否重试
    if (current === el) current = null;
    opts.onError?.();
  });
}

export function stopAudio(): void {
  if (current) {
    current.pause();
    current.src = '';
    current = null;
  }
}

export function isPlaying(): boolean {
  return current !== null;
}

/**
 * 预热一组音频，减少首播延迟。
 * 在"我的字"或下一批字的空闲时刻调用。
 */
export function preloadAudio(keys: AudioKey[]): void {
  for (const k of keys) {
    try {
      const a = new Audio();
      a.preload = 'auto';
      a.src = audioUrl(k);
      // 不加入 DOM 也能触发预取
    } catch {
      /* 预取失败不影响正式播放 */
    }
  }
}