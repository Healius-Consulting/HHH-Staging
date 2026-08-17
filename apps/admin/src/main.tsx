import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import App from '../../../src/App';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
