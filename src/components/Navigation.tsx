import { useApp, PHARMACY, type Screen } from '../context/AppContext';
import { Home, Users, FilePlus, Clock, Package, UserSearch, LogOut } from 'lucide-react';

const MENU_ITEMS: { key: Screen; label: string; icon: React.ReactNode }[] = [
  { key: 'home',      label: 'Dashboard',     icon: <Home size={16} /> },
  { key: 'referrals', label: 'Clinic Intake',  icon: <Users size={16} /> },
  { key: 'create',    label: 'Rx Builder',     icon: <FilePlus size={16} /> },
  { key: 'review',    label: 'Payments',       icon: <Clock size={16} /> },
  { key: 'orders',    label: 'Supplier Orders', icon: <Package size={16} /> },
  { key: 'patients',  label: 'Patients CRM',   icon: <UserSearch size={16} /> },
];

export default function Navigation() {
  const { state, dispatch } = useApp();

  // Badge counts
  const newReferrals = state.submissions.filter(s => s.status !== 'Completed').length;
  const draftOrders = state.orders.filter(o => o.payment.status === 'none' && o.prescriptions.some(r => r.items.length > 0)).length;
  const awaitingPayment = state.orders.filter(o => o.payment.status === 'sent').length;
  const activeOrders = state.orders.filter(o => o.payment.status === 'paid' && o.prescriptions.some(r => r.status !== 'ready')).length;

  const badges: Partial<Record<Screen, { count: number; warn?: boolean }>> = {};
  if (newReferrals > 0) badges.referrals = { count: newReferrals };
  if (draftOrders > 0) badges.create = { count: draftOrders };
  if (awaitingPayment > 0) badges.review = { count: awaitingPayment, warn: true };
  if (activeOrders > 0) badges.orders = { count: activeOrders };

  return (
    <aside className="sidebar">
      {/* Sidebar Top Header */}
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="sidebar-logo">{PHARMACY.logoText}</div>
          <span>{PHARMACY.brandName}</span>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav className="sidebar-menu">
        {MENU_ITEMS.map(item => (
          <button
            key={item.key}
            className={`sidebar-item ${state.screen === item.key ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SCREEN', screen: item.key })}
          >
            <div className="sidebar-item-content">
              {item.icon}
              <span>{item.label}</span>
            </div>
            {badges[item.key] && (
              <span 
                key={badges[item.key]!.count} 
                className={`tab-badge ${badges[item.key]!.warn ? 'warn' : ''} badge-pop`}
              >
                {badges[item.key]!.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Sidebar Footer User Profile */}
      <div className="sidebar-footer">
        <div className="user-profile-card">
          <div className="user-profile-avatar">SP</div>
          <div className="user-profile-info">
            <span className="user-profile-name">S. Patel</span>
            <span className="user-profile-role">Pharmacist Admin</span>
          </div>
        </div>
        <button
          className="btn btn-sm sidebar-exit"
          onClick={() => dispatch({ type: 'SET_PORTAL_MODE', mode: 'gateway' })}
        >
          <LogOut size={13} /> Exit to Gateway
        </button>
      </div>
    </aside>
  );
}
