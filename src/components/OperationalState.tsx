import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, LoaderCircle } from 'lucide-react';

interface OperationalStateProps {
  action?: ReactNode;
  description: string;
  title: string;
  type?: 'empty' | 'error' | 'loading';
}

export default function OperationalState({
  action,
  description,
  title,
  type = 'empty',
}: OperationalStateProps) {
  const Icon = type === 'loading' ? LoaderCircle : type === 'error' ? AlertTriangle : Inbox;

  return (
    <div className={`operational-state operational-state--${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <span className="operational-state__icon" aria-hidden="true">
        <Icon className={type === 'loading' ? 'operational-state__spinner' : undefined} size={21} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action && <div className="operational-state__action">{action}</div>}
    </div>
  );
}
