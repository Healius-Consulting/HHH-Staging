import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import EligibilityApp from '../apps/eligibility/src/EligibilityApp'
import { readAppCheckToken } from './auth/firebase'
import { setApiSecurityTokenProvider } from './shared/api'
import CuraleafCatalogPreview from './dev/CuraleafCatalogPreview'
import PaymentReturn, { type PaymentReturnStatus } from './pages/PaymentReturn'

const mode = new URLSearchParams(window.location.search).get('mode')
const payment = new URLSearchParams(window.location.search).get('payment')
const paymentReturnStatus: PaymentReturnStatus | null = window.location.pathname === '/payment-complete' || payment === 'success'
  ? 'complete'
  : window.location.pathname === '/payment-cancelled' || payment === 'cancelled'
    ? 'cancelled'
    : null

if (mode === 'eligibility') {
  setApiSecurityTokenProvider(async () => {
    const token = await readAppCheckToken()
    const headers: Record<string, string> = {}
    if (token) headers['X-Firebase-AppCheck'] = token
    return headers
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {paymentReturnStatus
      ? <PaymentReturn status={paymentReturnStatus} />
      : mode === 'eligibility'
        ? <EligibilityApp />
        : mode === 'curaleaf-catalog'
          ? <CuraleafCatalogPreview />
          : <App />}
  </StrictMode>,
)
