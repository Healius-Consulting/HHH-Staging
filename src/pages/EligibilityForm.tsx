import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useApp, type EligibilitySubmission } from '../context/AppContext';
import { tenantThemeVariables } from '../utils/tenantTheme';

const CONDITIONS = ['Anxiety', 'Arthritis', 'ADHD', 'Chronic Pain', 'Crohn’s Disease', 'Depression', 'Endometriosis', 'Epilepsy', 'Fibromyalgia', 'Insomnia', 'Migraine', 'Multiple Sclerosis', 'Neuropathic Pain', 'PTSD', 'Other'];

export default function EligibilityForm() {
  const { state, dispatch } = useApp();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const organisation = useMemo(() => state.organisations.find(org => org.referralToken === token), [state.organisations, token]);
  const [complete, setComplete] = useState(false);
  const [eligible, setEligible] = useState(false);
  const themeStyle = tenantThemeVariables(organisation?.brand.primary ?? '#0f766e') as React.CSSProperties;

  if (!organisation) {
    return (
      <main className="eligibility-shell tenant-surface" style={themeStyle}>
        <section className="eligibility-card eligibility-message">
          <AlertTriangle size={36} />
          <h1>This pharmacy link is not valid</h1>
          <p>Please scan the QR code again or ask your pharmacy for its current eligibility link.</p>
        </section>
      </main>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tried2 = data.get('tried2') === 'yes';
    const psychExclusion = data.get('psychExclusion') === 'yes';
    const passes = tried2 && !psychExclusion;
    const submission: EligibilitySubmission = {
      id: Date.now(),
      name: `${data.get('firstName')} ${data.get('surname')}`,
      dob: String(data.get('dob')),
      mobile: String(data.get('mobile')),
      email: String(data.get('email')),
      postcode: String(data.get('postcode')),
      condition: String(data.get('condition')),
      tried2,
      psychExclusion,
      consentReferral: data.get('consentReferral') === 'on',
      consentShare: data.get('consentShare') === 'on',
      marketing: data.get('marketing') === 'on',
      source: String(data.get('source') || 'Not provided'),
      status: 'New', recordsUploaded: false, calls: [], reviewedAt: null, reviewedBy: null, decisionNote: null,
      submittedAt: new Date(), organisationId: organisation.id, pharmacyName: organisation.name,
      referralToken: organisation.referralToken,
    };
    dispatch({ type: 'ADD_SUBMISSION', submission });
    setEligible(passes);
    setComplete(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (complete) {
    return (
      <main className="eligibility-shell tenant-surface" style={themeStyle}>
        <section className="eligibility-card eligibility-message">
          <div className={`eligibility-result-icon ${eligible ? 'pass' : 'review'}`}><CheckCircle2 size={32} /></div>
          <p className="section-label">Submitted via {organisation.name}</p>
          <h1>{eligible ? 'Thank you — HHH will review your enquiry' : 'Thank you — your answers need further review'}</h1>
          <p>{eligible ? 'Your enquiry has been linked securely to your chosen pharmacy. Holistic Health Hub will contact you and decide whether to approve programme onboarding.' : 'This screening does not provide a diagnosis or guarantee treatment. Holistic Health Hub will explain the next appropriate step.'}</p>
          <button className="btn btn-primary" onClick={() => dispatch({ type: 'SET_PORTAL_MODE', mode: 'gateway' })}>Return to portal gateway</button>
        </section>
      </main>
    );
  }

  return (
    <main className="eligibility-shell tenant-surface" style={themeStyle}>
      <header className="eligibility-brand">
        <div className="gateway-logo">{organisation.logoText}</div>
        <div><strong>{organisation.name}</strong><span>In partnership with Holistic Health Hub</span></div>
      </header>
      <section className="eligibility-card eligibility-intro">
        <p className="section-label">Private pre-screening · about 2 minutes</p>
        <h1>Check whether you may be eligible for a specialist consultation</h1>
        <p>This initial check helps the pharmacy understand whether a referral may be appropriate. It does not guarantee a prescription or replace clinical advice.</p>
        <div className="eligibility-trust"><span><ShieldCheck size={16} /> Pharmacy-linked referral</span><span><LockKeyhole size={16} /> Health information handled securely</span></div>
      </section>
      <form className="eligibility-card eligibility-form" onSubmit={submit}>
        <div className="eligibility-form-grid">
          <label>First name<input className="input" name="firstName" required autoComplete="given-name" /></label>
          <label>Surname<input className="input" name="surname" required autoComplete="family-name" /></label>
          <label>Date of birth<input className="input" name="dob" type="date" required /></label>
          <label>Postcode<input className="input" name="postcode" required autoComplete="postal-code" /></label>
          <label>Email<input className="input" name="email" type="email" required autoComplete="email" /></label>
          <label>Mobile number<input className="input" name="mobile" type="tel" required autoComplete="tel" /></label>
        </div>
        <label>Condition you would like support with<select className="input select" name="condition" required><option value="">Select a condition</option>{CONDITIONS.map(condition => <option key={condition}>{condition}</option>)}</select></label>
        <fieldset><legend>Have you tried at least two licensed treatments or therapies?</legend><div className="eligibility-choice"><label><input type="radio" name="tried2" value="yes" required /> Yes</label><label><input type="radio" name="tried2" value="no" /> No</label></div></fieldset>
        <fieldset><legend>Have you or an immediate family member been diagnosed with psychosis or schizophrenia?</legend><div className="eligibility-choice"><label><input type="radio" name="psychExclusion" value="yes" required /> Yes</label><label><input type="radio" name="psychExclusion" value="no" /> No</label></div></fieldset>
        <label>How did you hear about the service?<select className="input select" name="source"><option>Pharmacy leaflet / QR</option><option>Pharmacy website</option><option>Word of mouth</option><option>Search engine</option><option>Other</option></select></label>
        <div className="eligibility-consents">
          <label><input type="checkbox" name="consentReferral" required /> I understand the consultation and medicine may involve costs, and I want the pharmacy to consider me for referral.</label>
          <label><input type="checkbox" name="consentShare" required /> I explicitly consent to my health information being collected and shared with this pharmacy and relevant specialist healthcare services for this enquiry.</label>
          <label><input type="checkbox" name="marketing" /> I would like to receive optional service news and offers. I can withdraw this consent at any time.</label>
        </div>
        <button className="btn btn-primary eligibility-submit" type="submit">Submit eligibility check</button>
        <p className="eligibility-legal">HHH is a platform of Healius Consulting. Prototype wording only: the approved live privacy notice must identify the verified legal entity and explain the pharmacy and platform operator’s roles before patient information is accepted.</p>
      </form>
    </main>
  );
}
