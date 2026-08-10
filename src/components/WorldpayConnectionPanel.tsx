import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { connectWorldpayPharmacy, getWorldpayConnectionStatus } from '../shared/api';
import type { WorldpayConnectionStatus } from '../shared/contracts';
import './WorldpayConnectionPanel.css';

const EMPTY_FORM = { username: '', password: '', entityId: '' };

export default function WorldpayConnectionPanel({
  organisationId,
  onConnected,
}: {
  organisationId: string;
  onConnected: (status: WorldpayConnectionStatus) => void;
}) {
  const [status, setStatus] = useState<WorldpayConnectionStatus | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showSecrets, setShowSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onConnectedRef = useRef(onConnected);

  useEffect(() => { onConnectedRef.current = onConnected; }, [onConnected]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await getWorldpayConnectionStatus(organisationId);
      setStatus(result);
      onConnectedRef.current(result);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Worldpay connection status could not be loaded.');
    } finally {
      setBusy(false);
    }
  }, [organisationId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = async () => {
    if (!form.username.trim() || !form.password || !form.entityId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await connectWorldpayPharmacy({
        organisationId,
        username: form.username.trim(),
        password: form.password,
        entityId: form.entityId.trim(),
      });
      setStatus(result);
      setForm(EMPTY_FORM);
      onConnected(result);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Worldpay could not verify these merchant details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="worldpay-connect-panel">
      <header>
        <span className="worldpay-connect-panel__icon"><KeyRound size={17} /></span>
        <span>
          <strong>{status?.connected ? 'Worldpay merchant connected' : status?.configured ? 'Worldpay verification required' : 'Connect this pharmacy’s merchant account'}</strong>
          <small>TRY or live API credentials are verified with Worldpay Payment Queries, then stored in Google Secret Manager. They are never shown again.</small>
        </span>
        {status?.connected ? <span className="pill pill-green"><CheckCircle2 size={11} /> Connected</span> : null}
      </header>

      {status?.maskedIdentifier ? <div className="worldpay-connect-panel__masked"><ShieldCheck size={14} /> Merchant entity {status.maskedIdentifier}</div> : null}

      {!status?.connected && (
        <div className="worldpay-connect-panel__fields">
          <label><span>API username</span><input className="input" autoComplete="off" value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value }))} /></label>
          <label><span>API password</span><input className="input" type={showSecrets ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} /></label>
          <label><span>Merchant entity ID</span><input className="input" autoComplete="off" placeholder="PO…" value={form.entityId} onChange={event => setForm(current => ({ ...current, entityId: event.target.value }))} /></label>
          <button type="button" className="btn btn-sm worldpay-connect-panel__reveal" onClick={() => setShowSecrets(value => !value)}>{showSecrets ? <EyeOff size={13} /> : <Eye size={13} />}{showSecrets ? 'Hide secrets' : 'Show while entering'}</button>
          <button type="button" className="btn btn-primary" disabled={busy || !form.username.trim() || !form.password || !form.entityId.trim()} onClick={() => void connect()}>{busy ? <RefreshCw size={14} className="spin" /> : <ShieldCheck size={14} />}{busy ? 'Verifying with Worldpay…' : 'Save and verify connection'}</button>
        </div>
      )}

      {error ? <p className="worldpay-connect-panel__error">{error}</p> : null}
      {status?.configured ? <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} className={busy ? 'spin' : ''} /> Refresh connection status</button> : null}
    </section>
  );
}
