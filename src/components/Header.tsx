import { User } from 'lucide-react';

export default function Header() {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-logo">HH</div>
        <div className="brand-text">
          <h1>Holistic Health Hub — Ordering &amp; Payments</h1>
          <p>Live formulary via Curaleaf Rocky API · patient records via HHH CRM</p>
        </div>
      </div>
      <div className="header-user">
        <div className="user-avatar"><User size={14} /></div>
        S. Patel
      </div>
    </header>
  );
}
