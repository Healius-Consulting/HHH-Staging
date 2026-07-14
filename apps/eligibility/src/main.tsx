import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import EligibilityApp from './EligibilityApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode><EligibilityApp /></StrictMode>,
);
