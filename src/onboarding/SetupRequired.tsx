import { LockKeyhole, Settings } from 'lucide-react';

export function SetupRequired({ onOpenSetup }: { onOpenSetup: () => void }) {
  return (
    <div className="page-body setup-required-page">
      <section className="card setup-required" role="status">
        <span className="resource-icon"><LockKeyhole size={22} /></span>
        <p className="section-label">Limited access</p>
        <h2>Complete pharmacy setup to use this workspace</h2>
        <p>Patient processing, payments and Curaleaf actions remain locked until the mandatory pharmacy checks are complete. You can still use the Dashboard and Resources areas.</p>
        <button type="button" className="btn btn-primary" onClick={onOpenSetup}><Settings size={16} /> Continue setup</button>
      </section>
    </div>
  );
}
