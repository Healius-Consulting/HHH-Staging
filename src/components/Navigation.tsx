import { useApp, type Screen } from '../context/AppContext';
import { Home, Users, FlaskConical, FilePlus, Clock, Package, UserSearch } from 'lucide-react';

const TABS: { key: Screen; label: string; icon: React.ReactNode }[] = [
  { key: 'home',      label: 'Home',             icon: <Home size={14} /> },
  { key: 'referrals', label: 'Referrals',        icon: <Users size={14} /> },
  { key: 'formulary', label: 'Formulary',        icon: <FlaskConical size={14} /> },
  { key: 'create',    label: 'Create order',     icon: <FilePlus size={14} /> },
  { key: 'review',    label: 'Awaiting payment', icon: <Clock size={14} /> },
  { key: 'orders',    label: 'Orders',           icon: <Package size={14} /> },
  { key: 'patients',  label: 'Patients',         icon: <UserSearch size={14} /> },
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
    <nav className="nav-tabs">
      {TABS.map(tab => (
        <button
          key={tab.key}
          className={`nav-tab ${state.screen === tab.key ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: tab.key })}
        >
          {tab.icon}
          {tab.label}
          {badges[tab.key] && (
            <span 
              key={badges[tab.key]!.count} 
              className={`tab-badge ${badges[tab.key]!.warn ? 'warn' : ''} badge-pop`}
            >
              {badges[tab.key]!.count}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
