import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import EligibilityApp from './EligibilityApp';
import { readAppCheckToken } from '../../../src/auth/firebase';
import { setApiSecurityTokenProvider } from '../../../src/shared/api';

setApiSecurityTokenProvider(async () => {
  const token = await readAppCheckToken();
  return token ? { 'X-Firebase-AppCheck': token } : {};
});

createRoot(document.getElementById('root')!).render(
  <StrictMode><EligibilityApp /></StrictMode>,
);
