import { useApp, type Screen } from '../context/AppContext';
import { Home, Users, FilePlus, Clock, Package, UserSearch, LogOut, QrCode, Settings } from 'lucide-react';
import { useAuth } from '../auth/useAuth';

const MENU_ITEMS: { key: Screen; label: string; icon: React.ReactNode; module?: keyof import('../context/AppContext').PharmacyTenant['modules'] }[] = [
  { key: 'home',      label: 'Dashboard',     icon: <Home size={16} /> },
  { key: 'referrals', label: 'HHH Onboarding',  icon: <Users size={16} />, module: 'intake' },
  { key: 'create',    label: 'Rx Builder',     icon: <FilePlus size={16} />, module: 'rx' },
  { key: 'review',    label: 'Payments',       icon: <Clock size={16} />, module: 'payments' },
  { key: 'orders',    label: 'Supplier Orders', icon: <Package size={16} />, module: 'supplierOrders' },
  { key: 'patients',  label: 'Patients CRM',   icon: <UserSearch size={16} />, module: 'patients' },
  { key: 'resources', label: 'Form & Content Pack', icon: <QrCode size={16} />, module: 'resources' },
  { key: 'settings', label: 'Organisation Settings', icon: <Settings size={16} /> },
];

export default function Navigation() {
  const { state, dispatch } = useApp();
  const { signOutStaff } = useAuth();
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const tenantOrders = state.orders.filter(order => order.organisationId === organisation.id);
  const isAdminViewingClient = state.staffSession?.role === 'admin';
  const staffInitials = (state.staffSession?.name || 'Staff User').split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();

  // Badge counts
  const newReferrals = state.submissions.filter(s => s.organisationId === organisation.id && (s.status === 'New' || s.status === 'Under HHH review')).length;
  const draftOrders = tenantOrders.filter(o => o.payment.status === 'none' && o.prescriptions.some(r => r.items.length > 0)).length;
  const awaitingPayment = tenantOrders.filter(o => o.payment.status === 'sent').length;
  const activeOrders = tenantOrders.filter(o => o.payment.status === 'paid' && o.prescriptions.some(r => !['ready', 'collected'].includes(r.status))).length;

  const badges: Partial<Record<Screen, { count: number; warn?: boolean }>> = {};
  if (newReferrals > 0) badges.referrals = { count: newReferrals };
  if (draftOrders > 0) badges.create = { count: draftOrders };
  if (awaitingPayment > 0) badges.review = { count: awaitingPayment, warn: true };
  if (activeOrders > 0) badges.orders = { count: activeOrders };

  return (
    <aside className="sidebar" aria-label="Pharmacy workspace">
      {/* Sidebar Top Header */}
      <div className="sidebar-header">
        <div className="sidebar-brand" title={organisation.tradingName}>
          <div className="sidebar-logo" aria-hidden="true">{organisation.logoText}</div>
          <span>{organisation.tradingName}</span>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav className="sidebar-menu" aria-label="Primary navigation">
        {MENU_ITEMS.filter(item => !item.module || organisation.modules[item.module]).map(item => (
          <button
            key={item.key}
            className={`sidebar-item ${state.screen === item.key ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SCREEN', screen: item.key })}
            aria-current={state.screen === item.key ? 'page' : undefined}
          >
            <div className="sidebar-item-content">
              {item.icon}
              <span>{item.label}</span>
            </div>
            {badges[item.key] && (
              <span 
                key={badges[item.key]!.count} 
                className={`tab-badge ${badges[item.key]!.warn ? 'warn' : ''} badge-pop`}
                aria-label={`${badges[item.key]!.count} items`}
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
          <div className="user-profile-avatar" aria-hidden="true">{staffInitials}</div>
          <div className="user-profile-info">
            <span className="user-profile-name">{state.staffSession?.name || 'Staff User'}</span>
            <span className="user-profile-role">{isAdminViewingClient ? 'HHH admin viewing client' : `Pharmacy staff · ${organisation.status}`}</span>
          </div>
        </div>
        <button
          className="btn btn-sm sidebar-exit"
          onClick={() => {
            if (isAdminViewingClient) dispatch({ type: 'SET_PORTAL_MODE', mode: 'admin' });
            else void signOutStaff();
          }}
          aria-label={isAdminViewingClient ? 'Back to HHH Admin' : 'Sign out'}
        >
          <LogOut size={13} /> {isAdminViewingClient ? 'Back to HHH Admin' : 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
