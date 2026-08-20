import type { PharmacyOperationalStatus } from '../shared/contracts';
import { operationalStatusRows } from './setup';

export function OperationalStatusTable({
  operational,
  caption,
}: {
  operational: PharmacyOperationalStatus;
  caption?: string;
}) {
  const rows = operationalStatusRows(operational);
  return (
    <div className="compliance-table table-wrap">
      <table>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            <th>Check</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>
                <strong>{row.title}</strong>
                <small>{row.detail}</small>
              </td>
              <td>
                <span className={`pill ${row.passed ? 'pill-green' : 'pill-amber'}`}>{row.value}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OperationalStatusChips({
  operational,
}: {
  operational: PharmacyOperationalStatus;
}) {
  const rows = operationalStatusRows(operational);
  return (
    <ul className="setup-status-chips" aria-label="Pharmacy operational status">
      {rows.map(row => (
        <li key={row.id}>
          <span>{row.title}</span>
          <span className={`pill ${row.passed ? 'pill-green' : 'pill-amber'}`}>{row.value}</span>
        </li>
      ))}
    </ul>
  );
}
