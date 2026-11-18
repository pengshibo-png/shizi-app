/**
 * api.ts — 监护端与同步服务通信
 *
 * 同步地址由用户填写（家里的常开机器/小服务器），存在本机。
 * 全部读操作带重试；写操作（配置、留言）失败要给明确原因，不能静默。
 */

const KEY_BASE = 'shi.monitor.baseUrl';
const KEY_MONITOR = 'shi.monitor.id';
const KEY_LEARNER = 'shi.monitor.learnerId';

export interface DayAgg {
  date: string;
  newLearned: number;
  reviewed: number;
  correct: number;
  total: number;
  mathDone: number;
  scienceDone: number;
  durationSec: number;
}

export interface Report {
  learnerId: string;
  days: DayAgg[];
  streak: number;
  today: DayAgg | null;
  message: { text: string; at: number } | null;
}

export function getBaseUrl(): string {
  try {
    return localStorage.getItem(KEY_BASE) ?? '';
  } catch {
    return '';
  }
}

export function setBaseUrl(url: string): void {
  try {
    localStorage.setItem(KEY_BASE, url.replace(/\/+$/, ''));
  } catch {
    /* ignore */
  }
}

export function getMonitorId(): string {
  try {
    let v = localStorage.getItem(KEY_MONITOR);
    if (!v) {
      v = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(KEY_MONITOR, v);
    }
    return v;
  } catch {
    return `m${Date.now().toString(36)}`;
  }
}

export function getLearnerId(): string {
  try {
    return localStorage.getItem(KEY_LEARNER) ?? '';
  } catch {
    return '';
  }
}

export function setLearnerId(id: string): void {
  try {
    localStorage.setItem(KEY_LEARNER, id);
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init?: RequestInit, retries = 2): Promise<T> {
  const base = getBaseUrl();
  if (!base) throw new Error('还没填同步地址');
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`服务返回 ${res.status}${text ? `：${text.slice(0, 80)}` : ''}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('请求失败');
}

export async function fetchReport(learnerId: string, days = 30): Promise<Report> {
  return request<Report>(`/api/report/${encodeURIComponent(learnerId)}?days=${days}`);
}

export async function claimPairing(code: string): Promise<string> {
  const r = await request<{ learnerId: string }>(
    `/api/pairing/${encodeURIComponent(code)}/claim`,
    { method: 'POST', body: JSON.stringify({ monitorId: getMonitorId() }) },
  );
  setLearnerId(r.learnerId);
  return r.learnerId;
}

export async function sendMessage(learnerId: string, text: string): Promise<void> {
  await request(`/api/message/${encodeURIComponent(learnerId)}`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function saveConfig(
  learnerId: string,
  config: { newPerDay?: number; remindAt?: string },
): Promise<void> {
  await request(`/api/config/${encodeURIComponent(learnerId)}`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/** 生成告警：只列真正需要注意的，不制造焦虑 */
export interface Alert {
  level: 'info' | 'warn' | 'danger';
  text: string;
}

export function buildAlerts(report: Report, now: Date): Alert[] {
  const alerts: Alert[] = [];
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const todayAgg = report.days.find((d) => d.date === todayKey);

  const activeToday = Boolean(todayAgg && (todayAgg.total > 0 || todayAgg.newLearned > 0));
  if (!activeToday && now.getHours() >= 20) {
    alerts.push({ level: 'warn', text: '今天还没开始学习' });
  }

  // 连续中断天数
  const activeDates = new Set(report.days.filter((d) => d.total > 0 || d.newLearned > 0).map((d) => d.date));
  let gap = 0;
  const cursor = new Date(now.getTime());
  if (!activeDates.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  while (gap < 30) {
    const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate(),
    ).padStart(2, '0')}`;
    if (activeDates.has(k)) break;
    gap++;
    cursor.setDate(cursor.getDate() - 1);
  }
  if (gap >= 2) {
    alerts.push({ level: 'danger', text: `已经 ${gap} 天没学了，要不要打个电话` });
  }

  // 最近 7 天正确率
  const recent = report.days.slice(0, 7).filter((d) => d.total > 0);
  if (recent.length >= 3) {
    const correct = recent.reduce((s, d) => s + d.correct, 0);
    const total = recent.reduce((s, d) => s + d.total, 0);
    const acc = total > 0 ? correct / total : 1;
    if (acc < 0.6) {
      alerts.push({
        level: 'warn',
        text: `最近 7 天正确率 ${Math.round(acc * 100)}%，可能有点吃力，建议调低每天的字数`,
      });
    }
  }

  return alerts;
}