import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, LabelHTMLAttributes, PropsWithChildren, ReactNode } from 'react';

export function SecureAppShell({ children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div {...props} className={`hhh-secure-app-shell ${props.className ?? ''}`.trim()}>{children}</div>;
}

export function WorkspaceHeader({ eyebrow, title, metadata, action }: { eyebrow: string; title: string; metadata: ReactNode; action?: ReactNode }) {
  return <header className="hhh-workspace-header"><div><p>{eyebrow}</p><h1>{title}</h1><div>{metadata}</div></div>{action}</header>;
}

export function SummaryTile({ label, value, detail, ...props }: { label: string; value: number; detail: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`hhh-summary-tile hhh-focusable ${props.className ?? ''}`.trim()}><span>{label}</span><strong>{value}</strong><small>{detail}</small></button>;
}

export function PriorityQueue({ heading, count, children }: PropsWithChildren<{ heading: string; count: number }>) {
  return <section className="hhh-priority-queue" aria-label={heading}><header><h2>{heading}</h2><span>{count} open</span></header>{children}</section>;
}

export function OperationalStatus({ state, children }: PropsWithChildren<{ state: 'success' | 'warning' | 'danger' | 'neutral' }>) {
  return <span className={`hhh-operational-status hhh-operational-status--${state}`}>{children}</span>;
}

function StatePanel({ kind, title, children }: PropsWithChildren<{ kind: string; title: string }>) {
  return <section className={`hhh-state-panel hhh-state-panel--${kind}`}><h2>{title}</h2>{children}</section>;
}

export const LoadingState = ({ children }: PropsWithChildren) => <StatePanel kind="loading" title="Loading">{children}</StatePanel>;
export const EmptyState = ({ children }: PropsWithChildren) => <StatePanel kind="empty" title="Nothing to show">{children}</StatePanel>;
export const StaleState = ({ children }: PropsWithChildren) => <StatePanel kind="stale" title="Data may be out of date">{children}</StatePanel>;
export const FailureState = ({ children }: PropsWithChildren) => <StatePanel kind="failure" title="Something went wrong">{children}</StatePanel>;
export function ReducedMotion({ children }: PropsWithChildren) { return <div className="hhh-motion">{children}</div>; }

export function PublicButton({ tone = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'secondary' | 'quiet' }) {
  return <button {...props} className={`hhh-public-button hhh-public-button--${tone} hhh-focusable ${props.className ?? ''}`.trim()} />;
}

export function PublicLinkButton({ tone = 'primary', ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: 'primary' | 'secondary' | 'quiet' }) {
  return <a {...props} className={`hhh-public-button hhh-public-button--${tone} hhh-focusable ${props.className ?? ''}`.trim()} />;
}

export function FieldShell({ label, hint, error, children, ...props }: PropsWithChildren<{ label: ReactNode; hint?: ReactNode; error?: ReactNode } & LabelHTMLAttributes<HTMLLabelElement>>) {
  return <label {...props} className={`hhh-field-shell ${props.className ?? ''}`.trim()}><span>{label}</span>{children}{hint && <small>{hint}</small>}{error && <strong role="alert">{error}</strong>}</label>;
}

export function Notice({ tone = 'info', children, ...props }: PropsWithChildren<{ tone?: 'info' | 'success' | 'warning' | 'danger' } & HTMLAttributes<HTMLDivElement>>) {
  return <div {...props} className={`hhh-notice hhh-notice--${tone} ${props.className ?? ''}`.trim()} role={tone === 'danger' ? 'alert' : props.role}>{children}</div>;
}

export function StatusBadge({ tone = 'neutral', children }: PropsWithChildren<{ tone?: 'success' | 'warning' | 'danger' | 'neutral' }>) {
  return <span className={`hhh-status-badge hhh-status-badge--${tone}`}>{children}</span>;
}

export function PublicCard({ children, ...props }: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
  return <section {...props} className={`hhh-public-card ${props.className ?? ''}`.trim()}>{children}</section>;
}

export function SkipLink({ href = '#main-content', children = 'Skip to main content' }: PropsWithChildren<{ href?: string }>) {
  return <a className="hhh-skip-link hhh-focusable" href={href}>{children}</a>;
}

export function PageContainer({ children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div {...props} className={`hhh-page-container ${props.className ?? ''}`.trim()}>{children}</div>;
}
