import { compactPatientName } from '../utils/patientName';

interface CompactPatientCellProps {
  name: string;
  email?: string;
  mobile?: string;
}

export default function CompactPatientCell({ name, email, mobile }: CompactPatientCellProps) {
  return (
    <div className="compact-patient-cell">
      <strong className="compact-patient-name" title={name} aria-label={name}>{compactPatientName(name)}</strong>
      {(email || mobile) && (
        <small className="compact-patient-contact">
          {email && <span className="compact-email" title={email}>{email}</span>}
          {email && mobile && <span className="compact-contact-separator" aria-hidden="true">·</span>}
          {mobile && <span className="compact-mobile">{mobile}</span>}
        </small>
      )}
    </div>
  );
}
