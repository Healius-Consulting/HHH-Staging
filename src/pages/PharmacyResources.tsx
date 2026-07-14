import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, ExternalLink, FileArchive, Link2, QrCode } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { downloadContentPack, downloadDataUrl, eligibilityUrl, qrDataUrl } from '../utils/pharmacyResources';

export default function PharmacyResources() {
  const { state, dispatch } = useApp();
  const organisation = useMemo(() => state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0], [state]);
  const [qr, setQr] = useState('');
  const formUrl = eligibilityUrl(organisation);

  useEffect(() => { void qrDataUrl(organisation).then(setQr); }, [organisation]);

  const notify = (message: string) => dispatch({ type: 'ADD_TOAST', message, toastType: 'success' });
  const copyLink = async () => { await navigator.clipboard.writeText(formUrl); notify('Pharmacy eligibility link copied to clipboard.'); };

  return (
    <div className="page-body resource-page">
      <div className="banner banner-green resource-banner">
        <Link2 size={18} />
        <div><strong>Every submission from this link is attributed to {organisation.name}</strong><span>Keep this token pharmacy-specific. Generate a new token if it is ever exposed to another organisation.</span></div>
      </div>
      <div className="resource-grid">
        <section className="card resource-link-card">
          <div className="resource-icon"><Link2 size={20} /></div>
          <p className="section-label">Unique patient intake link</p>
          <h2>Share the eligibility form</h2>
            <p className="text-secondary">The form stays hosted by HHH. Use this URL as the destination for the pharmacy’s own designed page or button.</p>
          <div className="resource-url">{formUrl}</div>
          <div className="flex gap-sm flex-wrap">
            <button className="btn btn-primary" onClick={copyLink}><Copy size={14} /> Copy link</button>
            <a className="btn" href={formUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Preview form</a>
          </div>
        </section>
        <section className="card resource-qr-card">
          <div className="resource-icon"><QrCode size={20} /></div>
          <p className="section-label">Print-ready QR code</p>
            <h2>Website, leaflets, posters and counter cards</h2>
          {qr ? <img className="resource-qr" src={qr} alt={`Eligibility QR code for ${organisation.name}`} /> : <div className="resource-qr-placeholder">Generating QR…</div>}
          <button className="btn btn-primary" disabled={!qr} onClick={() => { downloadDataUrl(qr, `${organisation.slug}-eligibility-qr.png`); notify('High-resolution QR code saved.'); }}><Download size={14} /> Save QR code</button>
        </section>
      </div>
      <section className="card content-pack-card">
        <div className="content-pack-copy">
          <div className="resource-icon"><FileArchive size={20} /></div>
          <div>
            <p className="section-label">Developer hand-off</p>
            <h2>Download the pharmacy website content pack</h2>
            <p>Includes suggested page copy, the exact hosted-form link, link-out instructions, QR usage notes and the high-resolution QR image. It contains no form or embed code.</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={async () => { await downloadContentPack(organisation); notify('Developer content pack created.'); }}><FileArchive size={15} /> Download content pack (.zip)</button>
      </section>
      <section className="card resource-checklist">
        <h2>Before publishing</h2>
        <div className="resource-check-grid">
          <span>1. Verify the pharmacy’s live website domain</span><span>2. Confirm GPhC and superintendent details</span><span>3. Complete staging form submission UAT</span><span>4. Approve privacy and consent wording</span>
        </div>
      </section>
    </div>
  );
}
