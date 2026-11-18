import type { IconName } from '@shi/ui';
import { Icon } from '@shi/ui';

/**
 * 底部三槽 TabBar（mobile-design-system：3-5 槽位）。
 * 「今天 / 百科 / 我的」——评审补充三的功能区重构。
 *
 * 老人导航的硬规则：
 *  - 只有三处，图标+文字+当前态三重编码
 *  - 主 tab「今天」始终第一个
 *  - 高 80px（≥64 触控底线）+ 底部安全区避让
 */

export type TabId = 'today' | 'encyclopedia' | 'mine';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'today', label: '习字', icon: 'grid' },
  { id: 'encyclopedia', label: '百科', icon: 'book' },
  { id: 'mine', label: '我的', icon: 'seal' },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
}) {
  return (
    <nav className="shi-tabbar" aria-label="主导航">
      {TABS.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            className={`shi-tab${on ? ' is-active' : ''}`}
            onClick={() => onChange(t.id)}
            aria-current={on ? 'page' : undefined}
            aria-label={t.label}
          >
            <span className="shi-tab-icon" aria-hidden="true">
              <Icon name={t.icon} size={30} />
            </span>
            <span className="shi-tab-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}