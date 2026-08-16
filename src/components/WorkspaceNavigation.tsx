import { MoreHorizontal, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useModalFocus } from '../accessibility/useModalFocus';

export interface WorkspaceNavItem<Key extends string = string> {
  key: Key;
  label: string;
  shortLabel?: string;
  icon: ReactNode;
  count?: number;
}

export interface WorkspaceNavGroup<Key extends string = string> {
  label: string;
  items: WorkspaceNavItem<Key>[];
}

interface WorkspaceNavigationProps<Key extends string> {
  ariaLabel: string;
  activeKey: Key;
  groups: WorkspaceNavGroup<Key>[];
  mobilePrimaryKeys: Key[];
  onNavigate: (key: Key) => void;
  brand: { title: string; subtitle: string; partner?: string; logoText?: string; logoSrc?: string; logo?: ReactNode };
  user: { initials: string; name: string; role: string };
  exitAction: { label: string; icon: ReactNode; onClick: () => void };
  moreTitle?: string;
}

export default function WorkspaceNavigation<Key extends string>({
  ariaLabel,
  activeKey,
  groups,
  mobilePrimaryKeys,
  onNavigate,
  brand,
  user,
  exitAction,
  moreTitle = 'More workspace tools',
}: WorkspaceNavigationProps<Key>) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useModalFocus<HTMLElement>(mobileMenuOpen, () => setMobileMenuOpen(false));
  const items = groups.flatMap(group => group.items);
  const mobilePrimary = mobilePrimaryKeys.map(key => items.find(item => item.key === key)).filter((item): item is WorkspaceNavItem<Key> => Boolean(item));
  const mobileMore = items.filter(item => !mobilePrimaryKeys.includes(item.key));
  const mobileMoreActive = mobileMore.some(item => item.key === activeKey);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const closeDesktopSheet = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileMenuOpen(false);
    };
    media.addEventListener('change', closeDesktopSheet);
    return () => media.removeEventListener('change', closeDesktopSheet);
  }, []);

  const navigate = (key: Key) => {
    onNavigate(key);
    setMobileMenuOpen(false);
  };

  const renderDesktopItem = (item: WorkspaceNavItem<Key>) => (
    <button
      type="button"
      key={item.key}
      className={`sidebar-item ${activeKey === item.key ? 'active' : ''}`}
      onClick={() => navigate(item.key)}
      aria-current={activeKey === item.key ? 'page' : undefined}
      title={item.label}
    >
      <span className="sidebar-item-content">{item.icon}<span>{item.label}</span></span>
      {item.count ? <span className="nav-queue-count" aria-label={`${item.count} items`}>{item.count}</span> : null}
    </button>
  );

  return (
    <>
      <aside className="sidebar workspace-sidebar" aria-label={ariaLabel}>
        <div className="sidebar-header">
          <div className="sidebar-brand" title={brand.title}>
            {brand.logo
              ? <div className="workspace-sidebar-brand-mark">{brand.logo}</div>
              : brand.logoSrc
                ? <img className="workspace-sidebar-wordmark" src={brand.logoSrc} alt="" />
                : <div className="sidebar-logo" aria-hidden="true">{brand.logoText}</div>}
            <span className={brand.partner ? 'sidebar-brand-copy sidebar-brand-copy--cobrand' : 'sidebar-brand-copy'}>
              <strong>{brand.title}</strong>
              {brand.partner
                ? <><i className="sidebar-brand-joiner" aria-hidden="true">×</i><small>{brand.partner}</small></>
                : <small>{brand.subtitle}</small>}
            </span>
          </div>
        </div>
        <nav className="sidebar-menu" aria-label={`${ariaLabel} navigation`}>
          {groups.map((group, index) => (
            <div className="workspace-nav-group" key={group.label}>
              {index > 0 ? <span className="sidebar-section-separator" aria-hidden="true" /> : null}
              <span className={`sidebar-menu-label${index ? ' sidebar-menu-label--spaced' : ''}`}>{group.label}</span>
              {group.items.map(renderDesktopItem)}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-profile-card">
            <div className="user-profile-avatar" aria-hidden="true">{user.initials}</div>
            <div className="user-profile-info"><span className="user-profile-name">{user.name}</span><span className="user-profile-role">{user.role}</span></div>
          </div>
          <button type="button" className="btn btn-sm sidebar-exit" title={exitAction.label} aria-label={exitAction.label} onClick={exitAction.onClick}>{exitAction.icon}<span>{exitAction.label}</span></button>
        </div>
      </aside>

      <nav className="mobile-bottom-nav" aria-label={`${ariaLabel} mobile navigation`}>
        {mobilePrimary.map(item => (
          <button type="button" key={item.key} className={activeKey === item.key ? 'active' : ''} aria-current={activeKey === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}>
            <span className="mobile-nav-icon">{item.icon}{item.count ? <i aria-label={`${item.count} items`}>{item.count}</i> : null}</span>
            <span>{item.shortLabel ?? item.label}</span>
          </button>
        ))}
        <button type="button" className={mobileMenuOpen || mobileMoreActive ? 'active' : ''} aria-expanded={mobileMenuOpen} aria-controls="mobile-more-menu" onClick={() => setMobileMenuOpen(open => !open)}>
          <span className="mobile-nav-icon"><MoreHorizontal size={19} /></span><span>More</span>
        </button>
      </nav>

      {mobileMenuOpen && (
        <div className="mobile-more-layer">
          <button type="button" className="mobile-more-backdrop" aria-label="Close more navigation" onClick={() => setMobileMenuOpen(false)} />
          <section id="mobile-more-menu" className="mobile-more-sheet" ref={mobileMenuRef} role="dialog" aria-modal="true" aria-labelledby="mobile-more-title" tabIndex={-1}>
            <header><span><small>{brand.title}</small><strong id="mobile-more-title">{moreTitle}</strong></span><button type="button" className="icon-button" aria-label="Close more navigation" onClick={() => setMobileMenuOpen(false)}><X size={17} /></button></header>
            <div className="mobile-more-grid">
              {mobileMore.map(item => <button type="button" key={item.key} className={activeKey === item.key ? 'active' : ''} aria-current={activeKey === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}><span>{item.icon}</span><strong>{item.label}</strong><small>{item.count ? `${item.count} waiting` : 'Open workspace'}</small></button>)}
            </div>
            <footer><span><strong>{user.name}</strong><small>{user.role}</small></span><button type="button" className="btn btn-sm" onClick={() => { setMobileMenuOpen(false); exitAction.onClick(); }}>{exitAction.icon}{exitAction.label}</button></footer>
          </section>
        </div>
      )}
    </>
  );
}
