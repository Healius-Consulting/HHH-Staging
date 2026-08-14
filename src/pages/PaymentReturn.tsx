import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, XCircle } from 'lucide-react';
import HhhBrandMark from '../components/HhhBrandMark';
import { getPublicPaymentReceipt } from '../shared/api';

export type PaymentReturnStatus = 'complete' | 'cancelled';

export default function PaymentReturn({ status }: { status: PaymentReturnStatus }) {
  const completed = status === 'complete';
  const token = new URLSearchParams(window.location.search).get('receipt');
  const [receipt, setReceipt] = useState<{ status: 'pending' | 'paid' | 'failed' | 'expired'; message: string } | null>(null);

  useEffect(() => {
    document.title = completed ? 'Payment completed' : 'Payment not completed';
  }, [completed]);

  useEffect(() => {
    if (!token) {
      setReceipt({ status: 'expired', message: 'This payment confirmation link is invalid or has expired.' });
      return;
    }
    void getPublicPaymentReceipt(token).then(setReceipt).catch(() => setReceipt({ status: 'pending', message: 'Payment status could not be checked yet. Refresh this page in a moment.' }));
  }, [token]);

  const confirmed = receipt?.status === 'paid';
  const pending = !receipt || receipt.status === 'pending';

  return (
    <main className="payment-return-page">
      <section className="payment-return-card" aria-live="polite">
        <div className="payment-return-brand" aria-label="Holistic Health Hub">
          <HhhBrandMark />
          <span>Holistic Health Hub</span>
        </div>
        <div className={`payment-return-icon payment-return-icon--${confirmed ? 'complete' : pending ? 'pending' : 'cancelled'}`} aria-hidden="true">
          {confirmed ? <CheckCircle2 size={36} /> : pending ? <Clock3 size={36} /> : <XCircle size={36} />}
        </div>
        <h1>{confirmed ? 'Payment confirmed' : pending && completed ? 'Confirming payment' : 'Payment not completed'}</h1>
        <p>{receipt?.message ?? 'Checking the authoritative payment status…'}</p>
      </section>
    </main>
  );
}
