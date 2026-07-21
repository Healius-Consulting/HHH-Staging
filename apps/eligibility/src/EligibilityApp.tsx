import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { createEligibilitySubmission, getPublicPharmacy } from '../../../src/shared/api';
import type { EligibilitySubmissionInput, PublicPharmacy } from '../../../src/shared/contracts';
import { tenantThemeVariables } from '../../../src/utils/tenantTheme';

const CONDITIONS = ['Anxiety', 'Arthritis', 'ADHD', 'Chronic Pain', 'Crohn’s Disease', 'Depression', 'Endometriosis', 'Epilepsy', 'Fibromyalgia', 'Insomnia', 'Migraine', 'Multiple Sclerosis', 'Neuropathic Pain', 'PTSD', 'Other'];

export default function EligibilityApp() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [pharmacy, setPharmacy] = useState<PublicPharmacy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [eligible, setEligible] = useState(false);
  const themeStyle = tenantThemeVariables(pharmacy?.primaryColour ?? '#0f766e') as CSSProperties;

  useEffect(() => {
    if (!token) { setError('This pharmacy link is missing its referral token.'); setLoading(false); return; }
    getPublicPharmacy(token)
      .then(setPharmacy)
      .catch(() => setError('This pharmacy link is not valid or is no longer active.'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pharmacy) return;
    setSubmitting(true); setError('');
    const data = new FormData(event.currentTarget);
    const input: EligibilitySubmissionInput = {
      referralToken: token,
      firstName: String(data.get('firstName')), surname: String(data.get('surname')),
      dob: String(data.get('dob')), mobile: String(data.get('mobile')), email: String(data.get('email')),
      postcode: String(data.get('postcode')), condition: String(data.get('condition')),
      tried2: data.get('tried2') === 'yes', psychExclusion: data.get('psychExclusion') === 'yes',
      consentReferral: data.get('consentReferral') === 'on', consentShare: data.get('consentShare') === 'on',
      marketing: data.get('marketing') === 'on', source: String(data.get('source') || 'Not provided'),
    };
    try {
      await createEligibilitySubmission(input);
      setEligible(input.tried2 && !input.psychExclusion);
      setComplete(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not submit the form. Please try again.');
    } finally { setSubmitting(false); }
  };

  if (loading) return <main className="eligibility-shell tenant-surface" style={themeStyle}><section className="eligibility-card eligibility-message"><LoaderCircle className="spin" size={34} /><h1>Checking your pharmacy link</h1></section></main>;
  if (error && !pharmacy) return <main className="eligibility-shell tenant-surface" style={themeStyle}><section className="eligibility-card eligibility-message"><AlertTriangle size={36} /><h1>Unable to open this form</h1><p>{error}</p><p>Please ask your pharmacy for its current eligibility link.</p></section></main>;
  if (!pharmacy) return null;

  if (complete) return <main className="eligibility-shell tenant-surface" style={themeStyle}><section className="eligibility-card eligibility-message"><div className={`eligibility-result-icon ${eligible ? 'pass' : 'review'}`}><CheckCircle2 size={32} /></div><p className="section-label">Submitted via {pharmacy.name}</p><h1>{eligible ? 'Thank you — your pharmacy will be in touch' : 'Thank you — your answers need a clinical review'}</h1><p>Your enquiry has been securely linked to {pharmacy.name}. This is not a diagnosis or guarantee of treatment.</p></section></main>;

  return <main className="eligibility-shell tenant-surface" style={themeStyle}>
    <header className="eligibility-brand"><div className="gateway-logo">{pharmacy.logoText}</div><div><strong>{pharmacy.name}</strong><span>In partnership with Holistic Health Hub</span></div></header>
    <section className="eligibility-card eligibility-intro"><p className="section-label">Private pre-screening · about 2 minutes</p><h1>Check whether you may be eligible for a specialist consultation</h1><p>This initial check helps the pharmacy understand whether a referral may be appropriate. It does not guarantee a prescription or replace clinical advice.</p><div className="eligibility-trust"><span><ShieldCheck size={16} /> Linked to {pharmacy.tradingName}</span><span><LockKeyhole size={16} /> Health information handled securely</span></div></section>
    <form className="eligibility-card eligibility-form" onSubmit={submit}>
      <div className="eligibility-form-grid"><label>First name<input className="input" name="firstName" required autoComplete="given-name" /></label><label>Surname<input className="input" name="surname" required autoComplete="family-name" /></label><label>Date of birth<input className="input" name="dob" type="date" required /></label><label>Postcode<input className="input" name="postcode" required autoComplete="postal-code" /></label><label>Email<input className="input" name="email" type="email" required autoComplete="email" /></label><label>Mobile number<input className="input" name="mobile" type="tel" required autoComplete="tel" /></label></div>
      <label>Condition you would like support with<select className="input select" name="condition" required><option value="">Select a condition</option>{CONDITIONS.map(condition => <option key={condition}>{condition}</option>)}</select></label>
      <fieldset><legend>Have you tried at least two licensed treatments or therapies?</legend><div className="eligibility-choice"><label><input type="radio" name="tried2" value="yes" required /> Yes</label><label><input type="radio" name="tried2" value="no" /> No</label></div></fieldset>
      <fieldset><legend>Have you or an immediate family member been diagnosed with psychosis or schizophrenia?</legend><div className="eligibility-choice"><label><input type="radio" name="psychExclusion" value="yes" required /> Yes</label><label><input type="radio" name="psychExclusion" value="no" /> No</label></div></fieldset>
      <label>How did you hear about the service?<select className="input select" name="source"><option>Pharmacy leaflet / QR</option><option>Pharmacy website</option><option>Word of mouth</option><option>Search engine</option><option>Other</option></select></label>
      <div className="eligibility-consents"><label><input type="checkbox" name="consentReferral" required /> I understand the consultation and medicine may involve costs, and I want the pharmacy to consider me for referral.</label><label><input type="checkbox" name="consentShare" required /> I explicitly consent to my health information being collected and shared with this pharmacy and relevant specialist healthcare services for this enquiry.</label><label><input type="checkbox" name="marketing" /> I would like to receive optional service news and offers. I can withdraw this consent at any time.</label></div>
      {error && <div className="banner banner-red"><AlertTriangle size={16} /> {error}</div>}
      <button className="btn btn-primary eligibility-submit" type="submit" disabled={submitting}>{submitting ? 'Submitting securely…' : 'Submit eligibility check'}</button>
      <p className="eligibility-legal">HHH is a platform of Healius Consulting. The approved live privacy notice must identify the verified legal entity and explain the pharmacy and platform operator’s data-protection roles before patient information is accepted.</p>
    </form>
  </main>;
}
