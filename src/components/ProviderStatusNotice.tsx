import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react';

interface ProviderStatusNoticeProps {
  action?: ReactNode;
  detail: string;
  state?: 'available' | 'attention' | 'loading' | 'waiting';
  title: string;
}

export default function ProviderStatusNotice({
  action,
  detail,
  state = 'attention',
  title,
}: ProviderStatusNoticeProps) {
  const Icon = state === 'available'
    ? CheckCircle2
    : state === 'loading'
      ? LoaderCircle
      : state === 'waiting'
        ? Clock3
        : AlertTriangle;

  return (
    <div className={`provider-notice provider-notice--${state}`} role="status" aria-live="polite">
      <span className="provider-notice__icon" aria-hidden="true">
        <Icon className={state === 'loading' ? 'spin' : undefined} size={16} />
      </span>
      <span className="provider-notice__copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {action ? <span className="provider-notice__action">{action}</span> : null}
    </div>
  );
}
