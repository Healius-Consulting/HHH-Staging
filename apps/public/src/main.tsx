import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import EligibilityApp from '../../eligibility/src/EligibilityApp';
import PaymentReturn from '../../../src/pages/PaymentReturn';
import HhhBrandMark from '../../../src/components/HhhBrandMark';
import { readPublicAppCheckToken } from '../../../src/auth/appCheck';
import { setApiSecurityTokenProvider } from '../../../src/shared/api';

setApiSecurityTokenProvider(async () => {
  const token = await readPublicAppCheckToken();
  return token ? { 'X-Firebase-AppCheck': token } : {};
});

export function PublicApp() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/eligibility') return <EligibilityApp />;
  if (path === '/payments/complete') return <PaymentReturn status="complete" />;
  if (path === '/payments/cancelled') return <PaymentReturn status="cancelled" />;
  return (
    <main className="payment-return-page">
      <section className="payment-return-card">
        <div className="payment-return-brand"><HhhBrandMark /><span>Holistic Health Hub</span></div>
        <h1>Connected pharmacy care</h1>
        <p>Use the secure link supplied by your pharmacy to check eligibility. Pharmacy staff should use their dedicated authenticated workspace.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><PublicApp /></StrictMode>);
