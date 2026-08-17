import { LockKeyhole, Settings } from 'lucide-react';

export function SetupRequired({ onOpenSetup, mode = 'setup' }: { onOpenSetup: () => void; mode?: 'setup' | 'intake' }) {
  const intakeOnly = mode === 'intake';
  return (
    <div className="page-body setup-required-page">
      <section className="card setup-required" role="status">
        <span className="resource-icon"><LockKeyhole size={22} /></span>
        <p className="section-label">Limited access</p>
        <h2>{intakeOnly ? 'This action requires full pharmacy activation' : 'Complete pharmacy setup to use this workspace'}</h2>
        <p>{intakeOnly
          ? 'Eligibility-link attribution and HHH-managed enquiry notices are active. Patient details, prescriptions, orders, payments and Curaleaf actions remain locked until HHH completes the referral and the LIVE integration gate is complete.'
          : 'Patient processing, payments and Curaleaf actions remain locked until the mandatory pharmacy checks are complete. You can still use Overview, Catalogue, and Settings & Assets.'}</p>
        <button type="button" className="btn btn-primary" onClick={onOpenSetup}><Settings size={16} /> Continue setup</button>
      </section>
    </div>
  );
}
