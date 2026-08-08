import { ArrowUpRight, BadgePoundSterling, FileCheck2, FilePlus, Home, LogOut, Package, QrCode, Settings, Tags, UserSearch, Users } from 'lucide-react';

import { useAuth } from '../auth/useAuth';
import { useApp, type Screen } from '../context/AppContext';
import HhhBrandMark from './HhhBrandMark';
import WorkspaceNavigation, { type WorkspaceNavGroup } from './WorkspaceNavigation';

export default function Navigation() {
  const { state, dispatch } = useApp();
  const { signOutStaff } = useAuth();
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const tenantOrders = state.orders.filter(order => order.organisationId === organisation.id);
  const isAdminViewingClient = state.staffSession?.role === 'admin';
  const staffName = state.staffSession?.name || 'Staff User';
  const staffInitials = staffName.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
  const counts: Partial<Record<Screen, number>> = {
    referrals: state.submissions.filter(s => s.organisationId === organisation.id && (s.status === 'New' || s.status === 'Under HHH review')).length,
    create: tenantOrders.filter(o => o.payment.status === 'none' && o.prescriptions.some(r => r.items.length > 0)).length,
    review: tenantOrders.filter(o => o.payment.status === 'sent').length,
    orders: tenantOrders.filter(o => o.payment.status === 'paid' && o.prescriptions.some(r => !['ready', 'collected'].includes(r.status))).length,
  };

  const groups: WorkspaceNavGroup<Screen>[] = [
    {
      label: 'Operations',
      items: [
        { key: 'home', label: 'Overview', icon: <Home size={17} /> },
        { key: 'referrals', label: 'Patient onboarding', shortLabel: 'Onboarding', icon: <Users size={17} />, count: counts.referrals },
        { key: 'create', label: 'Prescription workspace', shortLabel: 'Rx', icon: <FilePlus size={17} />, count: counts.create },
        { key: 'orders', label: 'Customer Orders', shortLabel: 'Orders', icon: <Package size={17} />, count: counts.orders },
        ...(organisation.modules.rx ? [{ key: 'provider-prescriptions' as const, label: 'Provider prescriptions', icon: <FileCheck2 size={17} /> }] : []),
        ...(organisation.modules.patients ? [{ key: 'patients' as const, label: 'Patient directory', icon: <UserSearch size={17} /> }] : []),
      ],

    },
    {
      label: 'Workspace',
      items: [
        { key: 'finance', label: 'Prescription financials', shortLabel: 'Financials', icon: <BadgePoundSterling size={17} /> },
        ...(organisation.modules.rx ? [{ key: 'formulary' as const, label: 'Curaleaf catalogue', shortLabel: 'Catalogue', icon: <Tags size={17} /> }] : []),
        ...(organisation.modules.resources ? [{ key: 'resources' as const, label: 'Forms & resources', icon: <QrCode size={17} /> }] : []),
        { key: 'settings', label: 'Organisation', icon: <Settings size={17} /> },
      ],
    },
  ];

  return (
    <WorkspaceNavigation
      ariaLabel="Pharmacy workspace"
      activeKey={state.screen}
      groups={groups}
      mobilePrimaryKeys={['home', 'referrals', 'create', 'review']}
      onNavigate={screen => dispatch({ type: 'SET_SCREEN', screen })}
      brand={{ title: 'Holistic Health Hub', subtitle: 'Pharmacy operations', partner: organisation.tradingName, logo: <HhhBrandMark /> }}
      user={{ initials: staffInitials, name: staffName, role: isAdminViewingClient ? 'HHH administrator' : `Pharmacy staff · ${organisation.status}` }}
      exitAction={{
        label: isAdminViewingClient ? 'Return to administration' : 'Sign out',
        icon: isAdminViewingClient ? <ArrowUpRight size={14} /> : <LogOut size={14} />,
        onClick: () => { if (isAdminViewingClient) dispatch({ type: 'SET_PORTAL_MODE', mode: 'admin' }); else void signOutStaff(); },
      }}
    />
  );
}
