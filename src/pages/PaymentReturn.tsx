import { useEffect } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import HhhBrandMark from '../components/HhhBrandMark';

export type PaymentReturnStatus = 'complete' | 'cancelled';

export default function PaymentReturn({ status }: { status: PaymentReturnStatus }) {
  const completed = status === 'complete';

  useEffect(() => {
    document.title = completed ? 'Payment completed' : 'Payment not completed';
  }, [completed]);

  return (
    <main className="payment-return-page">
      <section className="payment-return-card" aria-live="polite">
        <div className="payment-return-brand" aria-label="Holistic Health Hub">
          <HhhBrandMark />
          <span>Holistic Health Hub</span>
        </div>
        <div className={`payment-return-icon payment-return-icon--${status}`} aria-hidden="true">
          {completed ? <CheckCircle2 size={36} /> : <XCircle size={36} />}
        </div>
        <h1>{completed ? 'Payment completed' : 'Payment not completed'}</h1>
        <p>{completed
          ? 'Your payment has been received. You can safely close this page.'
          : 'No payment was completed. You can safely close this page and use the original payment link to try again.'}</p>
      </section>
    </main>
  );
}
