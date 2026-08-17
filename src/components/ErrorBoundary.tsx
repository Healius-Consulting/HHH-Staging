import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Portal Crash Boundary]', error, errorInfo);
  }

  private handleHardReload = () => {
    try {
      sessionStorage.clear();
      localStorage.removeItem('hhh_staff_session');
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--bg-app, #f8fafc)',
          color: 'var(--text-primary, #0f172a)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{
            maxWidth: '440px',
            width: '100%',
            background: 'var(--bg-surface, #ffffff)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            textAlign: 'center',
          }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: '#fee2e2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <AlertTriangle size={22} />
            </div>
            <h1 style={{ fontSize: '18px', fontWeight: 650, margin: '0 0 8px' }}>Workspace Recovery</h1>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
              A cached application version or temporary browser script issue occurred. Clearing the workspace cache will restore your session.
            </p>
            {this.state.error ? (
              <pre style={{
                background: '#f1f5f9',
                padding: '10px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#475569',
                textAlign: 'left',
                overflowX: 'auto',
                marginBottom: '20px',
                maxHeight: '120px',
              }}>
                {this.state.error.message || 'Unknown runtime error'}
              </pre>
            ) : null}
            <button
              type="button"
              onClick={this.handleHardReload}
              style={{
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: '#0d9488',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={15} /> Reload Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
