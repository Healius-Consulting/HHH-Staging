import { compactPatientName } from '../utils/patientName';
import { formatPatientDob } from '../utils/patientDob';

interface CompactPatientCellProps {
  name: string;
  email?: string;
  mobile?: string;
  dob?: string;
}

export default function CompactPatientCell({ name, email, mobile, dob }: CompactPatientCellProps) {
  return (
    <div className="compact-patient-cell">
      <strong className="compact-patient-name" title={name} aria-label={name}>{compactPatientName(name)}</strong>
      {dob && <small className="compact-patient-dob">DOB {formatPatientDob(dob)}</small>}
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
