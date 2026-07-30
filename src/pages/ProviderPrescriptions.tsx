import { useMemo, useState } from 'react';
import { FileCheck2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import ProviderStatusNotice from '../components/ProviderStatusNotice';
import SummaryTiles from '../components/SummaryTiles';
import { useApp } from '../context/AppContext';
import { useCuraleafActivity } from '../integrations/useCuraleafActivity';

function providerDate(value: string) {
  if (!value) return 'Not supplied';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function stateClass(state: string) {
  if (['ACTIVE', 'FULFILLED'].includes(state)) return 'pill-green';
  if (state === 'PENDING') return 'pill-info';
  if (['EXPIRED', 'CANCELLED'].includes(state)) return 'pill-neutral';
  return 'pill-amber';
}

export default function ProviderPrescriptions() {
  const { state } = useApp();
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const { activity, enabled, error, loading, refresh } = useCuraleafActivity(
    state.currentOrganisationId,
    state.workspaceMode,
  );
  const prescriptions = useMemo(() => activity?.prescriptions ?? [], [activity?.prescriptions]);
  const states = useMemo(
    () => [...new Set(prescriptions.map(prescription => prescription.state))].sort(),
    [prescriptions],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return prescriptions.filter(prescription => {
      const searchable = [
        prescription.serialNumber,
        prescription.id,
        prescription.prescriberName,
        ...prescription.items.map(item => item.formulaName),
      ].join(' ').toLowerCase();
      return (stateFilter === 'all' || prescription.state === stateFilter)
        && (!needle || searchable.includes(needle));
    });
  }, [prescriptions, query, stateFilter]);
  const active = prescriptions.filter(prescription => prescription.state === 'ACTIVE').length;
  const pending = prescriptions.filter(prescription => prescription.state === 'PENDING').length;
  const expired = prescriptions.filter(prescription => prescription.state === 'EXPIRED').length;
  const refreshedAt = activity?.fetchedAt
    ? new Date(activity.fetchedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="page-body provider-prescriptions-page">
      <section className="operations-brief provider-prescriptions-brief">
        <div className="operations-brief__lead">
          <p className="section-label">Curaleaf account</p>
          <h2>Provider prescriptions</h2>
          <p>Read-only prescriptions returned for this pharmacy’s linked Curaleaf customer account. These records are separate from HHH patient orders until the pharmacy links them through the prescription workspace.</p>
        </div>
        <button type="button" className="btn operations-brief__action" disabled={!enabled || loading} onClick={() => void refresh()}>
          <RefreshCw className={loading ? 'spin' : undefined} size={14} />
          {loading ? 'Refreshing' : 'Refresh records'}
        </button>
      </section>

      {!enabled ? (
        <ProviderStatusNotice
          state="waiting"
          title="Provider records are available in the live workspace"
          detail="Training mode does not read pharmacy account records from Curaleaf."
        />
      ) : error ? (
        <ProviderStatusNotice
          title="Curaleaf prescriptions are temporarily unavailable"
          detail="Wait and try again. If this continues, contact your HHH administrator; pharmacy staff do not need to change the connection."
          action={<button type="button" className="btn btn-sm" onClick={() => void refresh()}>Try again</button>}
        />
      ) : loading && !activity ? (
        <ProviderStatusNotice
          state="loading"
          title="Refreshing provider prescriptions"
          detail="Retrieving the latest prescription records for this pharmacy’s Curaleaf account."
        />
      ) : activity ? (
        <ProviderStatusNotice
          state="available"
          title={`${activity.environment === 'production' ? 'Production' : 'Test'} Curaleaf account connected`}
          detail={refreshedAt ? `Last refreshed ${refreshedAt}. Prescription states and assignments are supplied by Curaleaf.` : 'Prescription states and assignments are supplied by Curaleaf.'}
        />
      ) : null}

      <SummaryTiles
        className="summary-tiles--compact"
        label="Provider prescription summary"
        items={[
          { label: 'Returned', value: activity?.prescriptionTotal ?? prescriptions.length, detail: 'provider prescriptions' },
          { label: 'Active', value: active, detail: 'available to order' },
          { label: 'Pending', value: pending, detail: 'awaiting provider action' },
          { label: 'Expired', value: expired, detail: 'no longer orderable' },
        ]}
      />

      <section className="provider-prescription-ledger">
        <header className="provider-prescription-ledger__header">
          <span>
            <small>Provider register</small>
            <strong>{filtered.length} prescription{filtered.length === 1 ? '' : 's'} shown</strong>
          </span>
          <label className="provider-prescription-search">
            <Search size={15} />
            <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search serial, prescriber or medicine" aria-label="Search provider prescriptions" />
          </label>
          <label className="workspace-filter-field">
            <span>State</span>
            <select className="input select" value={stateFilter} onChange={event => setStateFilter(event.target.value)}>
              <option value="all">All states</option>
              {states.map(providerState => <option value={providerState} key={providerState}>{providerState}</option>)}
            </select>
          </label>
        </header>

        {filtered.length ? (
          <div className="provider-prescription-table" role="table" aria-label="Curaleaf provider prescriptions">
            <div className="provider-prescription-table__head" role="row">
              <span role="columnheader">Prescription</span>
              <span role="columnheader">Prescriber</span>
              <span role="columnheader">Medicine and assignment</span>
              <span role="columnheader">Issue / expiry</span>
              <span role="columnheader">State</span>
            </div>
            {filtered.map(prescription => (
              <article className="provider-prescription-row" role="row" key={prescription.id}>
                <span className="provider-prescription-row__identity" role="cell">
                  <small>Serial number</small>
                  <strong>{prescription.serialNumber}</strong>
                  <code>{prescription.id}</code>
                </span>
                <span role="cell">
                  <small>Prescriber</small>
                  <strong>{prescription.prescriberName}</strong>
                  <em>{prescription.prescriberId}</em>
                </span>
                <span className="provider-prescription-medicines" role="cell">
                  <small>Medicine and assignment</small>
                  {prescription.items.map(item => (
                    <span key={item.id}>
                      <strong>{item.formulaName}</strong>
                      <em>{item.unitsAssignedCount} of {item.unitsNeededCount} {item.unit} assigned</em>
                    </span>
                  ))}
                </span>
                <span role="cell">
                  <small>Issue / expiry</small>
                  <strong>{providerDate(prescription.issueDate)}</strong>
                  <em>{providerDate(prescription.expiryDate)}</em>
                </span>
                <span role="cell"><span className={`pill ${stateClass(prescription.state)}`}>{prescription.state}</span></span>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state provider-prescription-empty">
            <div className="empty-icon"><FileCheck2 size={26} /></div>
            <h3>No provider prescriptions match</h3>
            <p className="empty-desc">{prescriptions.length ? 'Clear the search or select another state.' : 'Curaleaf has not returned any prescriptions for this pharmacy account.'}</p>
          </div>
        )}

        <footer className="provider-prescription-ledger__footer">
          <ShieldCheck size={14} />
          <span>Curaleaf’s prescription list does not expose patient identity. HHH does not infer or merge patients from serial numbers; patient linkage must come from the pharmacy’s verified prescription workflow.</span>
        </footer>
      </section>
    </div>
  );
}
