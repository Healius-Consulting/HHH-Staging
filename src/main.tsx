import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import EligibilityApp from '../apps/eligibility/src/EligibilityApp'
import { readAppCheckToken } from './auth/firebase'
import { setApiSecurityTokenProvider } from './shared/api'

const mode = new URLSearchParams(window.location.search).get('mode')

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
    {mode === 'eligibility' ? <EligibilityApp /> : <App />}
  </StrictMode>,
)
