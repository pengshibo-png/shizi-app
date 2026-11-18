import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildAlerts,
  claimPairing,
  fetchReport,
  getBaseUrl,
  getLearnerId,
  saveConfig,
  sendMessage,
  setBaseUrl,
  setLearnerId,
  type Report,
} from './api.js';
import './monitor.css';

type Tab = 'today' | 'trend' | 'settings';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function aggOf(rep: Report | null, key = todayKey()) {
  return rep?.days.find((d) => d.date === key) ?? null;
}

export function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [baseUrl, setBase] = useState(() => getBaseUrl());
  const [learnerId, setLearner] = useState(() => getLearnerId());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState('');
  const [msg, setMsg] = useState('');
  const [newPerDay, setNewPerDay] = useState('20');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseUrl || !learnerId) return;
    setLoading(true);
    setError(null);
    try {
      const rep = await fetchReport(learnerId, 30);
      setReport(rep);
      if (rep.message?.text) setMsg(rep.message.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, learnerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const alerts = useMemo(() => (report ? buildAlerts(report, new Date()) : []), [report]);
  const today = aggOf(report);
  const accuracy = today && today.total > 0 ? today.correct / today.total : null;
  const durationMin = Math.round((today?.durationSec ?? 0) / 60);

  const itemsDone =
    (today?.newLearned ?? 0) > 0 ? 1 : 0;
  const mathDone = Boolean(today?.mathDone);
  const scienceDone = Boolean(today?.scienceDone);
  const reviewedDone = (today?.reviewed ?? 0) > 0 ? 1 : 0;

  async function handlePair() {
    setError(null);
    setNotice(null);
    try {
      setBaseUrl(baseUrl);
      const id = await claimPairing(pairCode.trim());
      setLearner(id);
      setNotice('配对成功，已开始同步');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSaveMsg() {
    setError(null);
    setNotice(null);
    try {
      await sendMessage(learnerId, msg.trim());
      setNotice('留言已送到老人端');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSaveConfig() {
    setError(null);
    setNotice(null);
    try {
      await saveConfig(learnerId, { newPerDay: Number(newPerDay) || 20 });
      setNotice('已保存，明天生效');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ---------------- 未配置：引导配对
  if (!baseUrl || !learnerId) {
    return (
      <div className="mon-app">
        <div className="mon-top">
          <h1>家人学习情况</h1>
        </div>
        <div className="mon-card">
          <div className="mon-sub" style={{ marginTop: 0 }}>
            先在老人端「设置」里生一个配对码，填到这里就能开始同步。
          </div>
          <div className="mon-field">
            <label htmlFor="base">同步地址</label>
            <input
              id="base"
              value={baseUrl}
              onChange={(e) => setBase(e.target.value)}
              placeholder="http://192.168.1.10:8787"
              inputMode="url"
            />
          </div>
          <div className="mon-field">
            <label htmlFor="code">6 位配对码</label>
            <input
              id="code"
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              maxLength={6}
            />
          </div>
          <button type="button" className="mon-btn" onClick={handlePair} disabled={!baseUrl || !pairCode}>
            配对
          </button>
          {error && <div className="mon-alert danger">{error}</div>}
          {notice && <div className="mon-alert info">{notice}</div>}
          <div className="mon-note">
            同步地址是家里那台常开机器的地址。老人端不上传也能自己正常学，只是这边看不到。
          </div>
        </div>
      </div>
    );
  }

  const last7 = (report?.days ?? []).slice(0, 7).reverse();
  const maxReviewed = Math.max(1, ...last7.map((d) => d.reviewed));

  return (
    <div className="mon-app">
      <div className="mon-top">
        <h1>家人学习情况</h1>
        <button
          type="button"
          onClick={() => void load()}
          style={{ fontSize: 18, color: 'var(--shi-color-text-muted)' }}
        >
          {loading ? '刷新中' : '刷新'}
        </button>
      </div>

      {error && <div className="mon-alert danger">{error}</div>}
      {notice && <div className="mon-alert info">{notice}</div>}

      <div className="mon-tabs">
        {(
          [
            ['today', '今天'],
            ['trend', '趋势'],
            ['settings', '设置'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`mon-tab${tab === k ? ' is-active' : ''}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <>
          <div className="mon-card">
            <div
              className={`mon-status ${
                today && (today.total > 0 || today.newLearned > 0) ? 'is-ok' : 'is-idle'
              }`}
            >
              <span className="dot" aria-hidden="true" />
              <span>
                {today && (today.total > 0 || today.newLearned > 0)
                  ? '今天学过了'
                  : loading
                    ? '正在读取'
                    : '今天还没开始'}
              </span>
            </div>
            <div className="mon-sub">
              {report?.streak
                ? `连续第 ${report.streak} 天 · 昨天学了 ${aggOf(report, yesterdayKey())?.newLearned ?? 0} 个字`
                : '还没有连续记录'}
            </div>

            <div className="mon-items">
              <div className={`mon-item${itemsDone ? ' is-done' : ''}`}>
                <span className="mark" aria-hidden="true">
                  {itemsDone ? '✓' : ''}
                </span>
                <span className="label">学新字</span>
                <span className="val">{today?.newLearned ?? 0} 个</span>
              </div>
              <div className={`mon-item${reviewedDone ? ' is-done' : ''}`}>
                <span className="mark" aria-hidden="true">
                  {reviewedDone ? '✓' : ''}
                </span>
                <span className="label">复习</span>
                <span className="val">{today?.reviewed ?? 0} 个</span>
              </div>
              <div className={`mon-item${mathDone ? ' is-done' : ''}`}>
                <span className="mark" aria-hidden="true">
                  {mathDone ? '✓' : ''}
                </span>
                <span className="label">生活数学</span>
                <span className="val">{mathDone ? '做了' : '没做'}</span>
              </div>
              <div className={`mon-item${scienceDone ? ' is-done' : ''}`}>
                <span className="mark" aria-hidden="true">
                  {scienceDone ? '✓' : ''}
                </span>
                <span className="label">科普</span>
                <span className="val">{scienceDone ? '看了' : '没看'}</span>
              </div>
            </div>
          </div>

          {alerts.map((a, i) => (
            <div key={i} className={`mon-alert ${a.level}`}>
              <span aria-hidden="true">{a.level === 'danger' ? '!' : '·'}</span>
              <span>{a.text}</span>
            </div>
          ))}

          <div className="mon-stats">
            <div className="mon-stat">
              <div className="k">正确率</div>
              <div className="v">
                {accuracy === null ? '—' : Math.round(accuracy * 100)}
                {accuracy !== null && <small>%</small>}
              </div>
            </div>
            <div className="mon-stat">
              <div className="k">用时</div>
              <div className="v">
                {durationMin}
                <small> 分钟</small>
              </div>
            </div>
          </div>

          {report?.message && (
            <div className="mon-alert info">
              老人端留言：{report.message.text}
            </div>
          )}
        </>
      )}

      {tab === 'trend' && (
        <>
          <div className="mon-card">
            <div className="mon-sub" style={{ marginTop: 0 }}>
              最近 7 天的复习量
            </div>
            <div className="mon-heat" role="img" aria-label="最近 7 天复习量条形图">
              {last7.length === 0 && <div className="mon-empty">还没有数据</div>}
              {last7.map((d) => {
                const h = Math.max(4, Math.round((d.reviewed / maxReviewed) * 48));
                const active = d.reviewed > 0 || d.newLearned > 0;
                return (
                  <div
                    key={d.date}
                    className="cell"
                    style={{
                      height: h,
                      background: active ? 'var(--shi-color-action)' : 'var(--shi-color-border)',
                    }}
                    title={`${d.date} 复习 ${d.reviewed} 个，新字 ${d.newLearned} 个`}
                  />
                );
              })}
            </div>
            <div className="mon-note">
              {last7
                .map((d) => WEEK[new Date(`${d.date}T00:00:00`).getDay()])
                .join(' ')}
            </div>
          </div>

          <div className="mon-stats">
            <div className="mon-stat">
              <div className="k">累计新字</div>
              <div className="v">
                {(report?.days ?? []).reduce((s, d) => s + d.newLearned, 0)}
                <small> 个</small>
              </div>
            </div>
            <div className="mon-stat">
              <div className="k">连续天数</div>
              <div className="v">
                {report?.streak ?? 0}
                <small> 天</small>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'settings' && (
        <div className="mon-card">
          <div className="mon-field">
            <label htmlFor="msg">给老人留言</label>
            <textarea
              id="msg"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              rows={3}
              placeholder="写一句鼓励的话，老人端会看到"
            />
          </div>
          <button type="button" className="mon-btn" onClick={handleSaveMsg} disabled={!msg.trim()}>
            发送留言
          </button>

          <div className="mon-field" style={{ marginTop: 32 }}>
            <label htmlFor="npd">每天学几个新字</label>
            <input
              id="npd"
              value={newPerDay}
              onChange={(e) => setNewPerDay(e.target.value)}
              inputMode="numeric"
              maxLength={2}
            />
          </div>
          <button type="button" className="mon-btn" onClick={handleSaveConfig}>
            保存
          </button>
          <div className="mon-note">
            老人觉得吃力就调低一些。目前计划是 90 天认 1800 字。
          </div>

          <button
            type="button"
            className="mon-btn-ghost"
            onClick={() => {
              setLearnerId('');
              setLearner('');
              setReport(null);
            }}
          >
            解除配对
          </button>
        </div>
      )}
    </div>
  );
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}