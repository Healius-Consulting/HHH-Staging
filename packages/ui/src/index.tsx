import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren, ReactNode } from 'react';

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
