import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardCheck, HeartPulse, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { CONDITIONS, conditionLabel } from '@hhh/domain';
import { createEligibilitySubmission, getPublicPharmacy } from '../../../src/shared/api';
import type { EligibilitySubmissionInput, PublicPharmacy } from '../../../src/shared/contracts';
import { tenantThemeVariables } from '../../../src/utils/tenantTheme';

const LOCAL_PREVIEW_TOKEN = 'local-preview';
const LOCAL_PREVIEW_PHARMACY: PublicPharmacy = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Holistic Health Pharmacy',
  tradingName: 'Holistic Health Pharmacy',
  logoText: 'HH',
  gphcNumber: '9012345',
  superintendent: 'Local preview',
  address: 'Local preview — no patient data is stored',
  primaryColour: '#0f766e',
};

export default function EligibilityApp() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const isLocalPreview = import.meta.env.DEV && token === LOCAL_PREVIEW_TOKEN;
  const [pharmacy, setPharmacy] = useState<PublicPharmacy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [selectedConditions, setSelectedConditions] = useState<string[]>([]);
  const [primaryCondition, setPrimaryCondition] = useState('');
  const [conditionError, setConditionError] = useState('');
  const [treatmentHistory, setTreatmentHistory] = useState<'' | 'yes' | 'no'>('');
  const conditionMenuRef = useRef<HTMLDetailsElement>(null);
  const themeStyle = tenantThemeVariables(pharmacy?.primaryColour ?? '#0f766e') as CSSProperties;

  useEffect(() => {
    if (isLocalPreview) { setPharmacy(LOCAL_PREVIEW_PHARMACY); setLoading(false); return; }
    if (!token) { setError('This pharmacy link is missing its referral token.'); setLoading(false); return; }
    getPublicPharmacy(token)
      .then(setPharmacy)
      .catch(() => setError('This pharmacy link is not valid or is no longer active.'))
      .finally(() => setLoading(false));
  }, [isLocalPreview, token]);

  useEffect(() => {
    const closeConditionMenu = (event: PointerEvent) => {
      const menu = conditionMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.removeAttribute('open');
    };
    const closeConditionMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !conditionMenuRef.current?.open) return;
      conditionMenuRef.current.removeAttribute('open');
      conditionMenuRef.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', closeConditionMenu);
    document.addEventListener('keydown', closeConditionMenuWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeConditionMenu);
      document.removeEventListener('keydown', closeConditionMenuWithKeyboard);
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pharmacy) return;
    if (treatmentHistory === 'no') return;
    if (selectedConditions.length < 1 || selectedConditions.length > 3) {
      setConditionError('Select between one and three conditions.');
      return;
    }
    if (!primaryCondition || !selectedConditions.includes(primaryCondition)) {
      setConditionError('Choose one of your selected conditions as the primary condition.');
      return;
    }
    setSubmitting(true); setError('');
    const data = new FormData(event.currentTarget);
    const input: EligibilitySubmissionInput = {
      referralToken: token,
      firstName: String(data.get('firstName')), surname: String(data.get('surname')),
      dob: String(data.get('dob')), mobile: String(data.get('mobile')), email: String(data.get('email')),
      postcode: String(data.get('postcode')), conditions: selectedConditions, primaryCondition,
      tried2: data.get('tried2') === 'yes', psychExclusion: data.get('psychExclusion') === 'yes',
      consentReferral: data.get('consentReferral') === 'on', consentShare: data.get('consentShare') === 'on',
      marketing: data.get('marketing') === 'on', source: String(data.get('source') || 'Not provided'),
    };
    try {
      if (!isLocalPreview) await createEligibilitySubmission(input);
      setEligible(input.tried2 && !input.psychExclusion);
      setComplete(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not submit the form. Please try again.');
    } finally { setSubmitting(false); }
  };

  const toggleCondition = (conditionId: string) => {
    const isSelected = selectedConditions.includes(conditionId);
    if (!isSelected && selectedConditions.length >= 3) return;
    const next = isSelected
      ? selectedConditions.filter(id => id !== conditionId)
      : [...selectedConditions, conditionId];
    setSelectedConditions(next);
    if (primaryCondition === conditionId) setPrimaryCondition(next.length === 1 ? next[0] ?? '' : '');
    else if (next.length === 1) setPrimaryCondition(next[0] ?? '');
    setConditionError('');
  };

  if (loading) return <main className="eligibility-shell tenant-surface" style={themeStyle}><section className="eligibility-card eligibility-message"><LoaderCircle className="spin" size={34} /><h1>Checking your pharmacy link</h1></section></main>;
  if (error && !pharmacy) return <main className="eligibility-shell tenant-surface" style={themeStyle}><section className="eligibility-card eligibility-message"><AlertTriangle size={36} /><h1>Unable to open this form</h1><p>{error}</p><p>Please ask your pharmacy for its current eligibility link.</p></section></main>;
  if (!pharmacy) return null;

  if (complete) return <main className="eligibility-shell tenant-surface" style={themeStyle}><section className="eligibility-card eligibility-message"><div className={`eligibility-result-icon ${eligible ? 'pass' : 'review'}`}><CheckCircle2 size={32} /></div><p className="section-label">Submitted via {pharmacy.name}</p><h1>{eligible ? 'Thank you — your pharmacy will be in touch' : 'Thank you — your answers need a clinical review'}</h1><p>Your enquiry has been securely linked to {pharmacy.name}. This is not a diagnosis or guarantee of treatment.</p></section></main>;

  return <main className="eligibility-shell tenant-surface" style={themeStyle}>
    <header className="eligibility-brand">
      <div className="eligibility-brand__identity"><div className="gateway-logo">{pharmacy.logoText}</div><div><strong>{pharmacy.name}</strong><span>In partnership with Holistic Health Hub</span></div></div>
      <span className="eligibility-brand__secure"><LockKeyhole size={14} /> Private and secure</span>
    </header>
    <div className="eligibility-layout">
      <aside className="eligibility-intro">
        <p className="section-label">Private pre-screening · about 2 minutes</p>
        <h1>Could specialist care be right for you?</h1>
        <p className="eligibility-intro__lead">Answer a few confidential questions so {pharmacy.tradingName} can understand whether a referral may be appropriate.</p>
        <div className="eligibility-trust"><span><ShieldCheck size={17} /> Linked directly to your pharmacy</span><span><LockKeyhole size={17} /> Health information handled securely</span></div>
        <div className="eligibility-next-steps">
          <p>What happens next</p>
          <ol>
            <li><span>1</span><div><strong>Complete this check</strong><small>Tell us about you and the support you need.</small></div></li>
            <li><span>2</span><div><strong>Pharmacy review</strong><small>Your answers are reviewed securely.</small></div></li>
            <li><span>3</span><div><strong>Hear from the team</strong><small>The pharmacy explains any suitable next step.</small></div></li>
          </ol>
        </div>
        <p className="eligibility-intro__note"><HeartPulse size={16} /> This check is not a diagnosis and does not guarantee a consultation or prescription.</p>
      </aside>
      <form className="eligibility-card eligibility-form" onSubmit={submit}>
        <header className="eligibility-form-header"><span><ClipboardCheck size={17} /> Eligibility check</span><h2>Tell us a little about yourself</h2><p>Fields marked with an asterisk are required.</p></header>
        <section className="eligibility-form-section" aria-labelledby="eligibility-about-you">
          <div className="eligibility-section-heading"><span>01</span><div><h3 id="eligibility-about-you">About you</h3><p>Your details help the pharmacy contact the right person.</p></div></div>
          <div className="eligibility-form-grid"><label>First name <em>*</em><input className="input" name="firstName" required autoComplete="given-name" /></label><label>Surname <em>*</em><input className="input" name="surname" required autoComplete="family-name" /></label><label>Date of birth <em>*</em><input className="input" name="dob" type="date" required /></label><label>Postcode <em>*</em><input className="input" name="postcode" required autoComplete="postal-code" /></label><label>Email <em>*</em><input className="input" name="email" type="email" required autoComplete="email" /></label><label>Mobile number <em>*</em><input className="input" name="mobile" type="tel" required autoComplete="tel" /></label></div>
        </section>
        <section className="eligibility-form-section" aria-labelledby="eligibility-health-needs">
          <div className="eligibility-section-heading"><span>02</span><div><h3 id="eligibility-health-needs">Your health needs</h3><p>Select up to three conditions, then choose the main one.</p></div></div>
          <fieldset className={`eligibility-condition-field ${conditionError ? 'has-error' : ''}`} aria-describedby={conditionError ? 'condition-error' : undefined}>
            <legend>Conditions you would like support with <em>*</em></legend>
            <details ref={conditionMenuRef} className="eligibility-condition-menu">
              <summary><span><strong>{selectedConditions.length ? `${selectedConditions.length} condition${selectedConditions.length === 1 ? '' : 's'} selected` : 'Choose conditions'}</strong><small>{selectedConditions.length ? selectedConditions.map(conditionLabel).join(', ') : 'Select up to three from the list'}</small></span><ChevronDown size={18} /></summary>
              <div className="eligibility-condition-options">
                <div className="eligibility-condition-options__head"><strong>Choose up to three</strong><span>{selectedConditions.length}/3 selected</span></div>
                {CONDITIONS.map(condition => {
                  const checked = selectedConditions.includes(condition.id);
                  const disabled = !checked && selectedConditions.length >= 3;
                  return <label key={condition.id} className={disabled ? 'disabled' : ''}><input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleCondition(condition.id)} /><span>{condition.label}</span></label>;
                })}
              </div>
            </details>
            {conditionError && <span className="eligibility-field-error" id="condition-error" role="alert">{conditionError}</span>}
          </fieldset>
          <label>Primary condition <em>*</em><select className="input select" value={primaryCondition} disabled={selectedConditions.length === 0} required onChange={event => { setPrimaryCondition(event.target.value); setConditionError(''); }}><option value="">Select the main condition</option>{selectedConditions.map(conditionId => <option key={conditionId} value={conditionId}>{conditionLabel(conditionId)}</option>)}</select></label>
          <fieldset><legend>Have you tried at least two licensed treatments or therapies? <em>*</em></legend><div className="eligibility-choice"><label><input type="radio" name="tried2" value="yes" required checked={treatmentHistory === 'yes'} onChange={() => setTreatmentHistory('yes')} /><span><strong>Yes</strong><small>I have tried two or more</small></span></label><label><input type="radio" name="tried2" value="no" checked={treatmentHistory === 'no'} onChange={() => setTreatmentHistory('no')} /><span><strong>No</strong><small>Not yet or I am unsure</small></span></label></div>{treatmentHistory === 'no' && <div className="eligibility-screening-stop" role="alert"><AlertTriangle size={18} /><div><strong>You are not eligible to submit this check yet</strong><p>At least two licensed treatments or therapies must have been tried before a referral can be considered. If you are unsure what counts, please contact the pharmacy.</p></div></div>}</fieldset>
          <fieldset><legend>Have you or an immediate family member been diagnosed with psychosis or schizophrenia? <em>*</em></legend><div className="eligibility-choice"><label><input type="radio" name="psychExclusion" value="yes" required /><span><strong>Yes</strong><small>This applies to me or family</small></span></label><label><input type="radio" name="psychExclusion" value="no" /><span><strong>No</strong><small>This does not apply</small></span></label></div></fieldset>
        </section>
        <section className="eligibility-form-section eligibility-form-section--consent" aria-labelledby="eligibility-consent">
          <div className="eligibility-section-heading"><span>03</span><div><h3 id="eligibility-consent">Consent and referral</h3><p>Review how your information will be used.</p></div></div>
          <label>Where did you hear about this service?<select className="input select" name="source"><option>Poster</option><option>Text</option><option>Leaflet</option><option>Website</option><option>Google</option><option>TV ad</option></select></label>
          <div className="eligibility-consents"><label><input type="checkbox" name="consentReferral" required /><span>I understand the consultation and medicine may involve costs, and I want the pharmacy to consider me for referral. <em>*</em></span></label><label><input type="checkbox" name="consentShare" required /><span>I explicitly consent to my health information being collected and shared with this pharmacy and relevant specialist healthcare services for this enquiry. <em>*</em></span></label><label className="eligibility-consent--optional"><input type="checkbox" name="marketing" /><span>I would like to receive optional service news and offers. I can withdraw this consent at any time. <small>Optional</small></span></label></div>
        </section>
        {error && <div className="banner banner-red"><AlertTriangle size={16} /> {error}</div>}
        <footer className="eligibility-form-footer"><button className="btn btn-primary eligibility-submit" type="submit" disabled={submitting || treatmentHistory === 'no'}>{submitting ? 'Submitting securely…' : treatmentHistory === 'no' ? 'Not eligible to submit' : 'Submit eligibility check'}</button><p>{treatmentHistory === 'no' ? <><AlertTriangle size={13} /> Submission is unavailable based on your treatment history.</> : <><LockKeyhole size={13} /> Your answers are sent securely to {pharmacy.tradingName}.</>}</p></footer>
        <p className="eligibility-legal">{isLocalPreview ? 'Local preview only — this form does not transmit or store the information entered.' : 'HHH is a platform of Healius Consulting. The approved live privacy notice must identify the verified legal entity and explain the pharmacy and platform operator’s data-protection roles before patient information is accepted.'}</p>
      </form>
    </div>
  </main>;
}
