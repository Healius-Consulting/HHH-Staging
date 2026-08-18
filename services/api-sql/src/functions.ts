import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  accrueAnnualPatientFees,
  updatePatientRetentionStates,
} from './application/patient-finance/patient-finance.js';
import { refreshAllCuraleafQuoteBanks } from './application/integrations/curaleaf-quote-bank.service.js';
import { createApp } from './bootstrap/app.js';
import { SqlCuraleafQuoteBankRepository } from './repositories/sql/curaleaf-quote-bank.sql.js';
import { SqlIntegrationRepository } from './repositories/sql/integration.sql.js';
import { SqlPatientFinanceRepository } from './repositories/sql/patient-finance.sql.js';
import { SqlPatientRepository } from './repositories/sql/patient.sql.js';

const app = createApp();

function patientFinanceDeps() {
  return {
    patientRepo: new SqlPatientRepository(),
    patientFinanceRepo: new SqlPatientFinanceRepository(),
  };
}

export const apiLondon = onRequest({
  region: 'europe-west2',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 10,
}, app);

export const accrueAnnualPatientFeesLondon = onSchedule({
  schedule: '0 2 * * *',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 1,
}, async () => {
  const summary = await accrueAnnualPatientFees(patientFinanceDeps());
  console.log('Annual patient fee accrual complete', summary);
});

export const updatePatientRetentionLondon = onSchedule({
  schedule: '15 2 * * *',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 1,
}, async () => {
  console.log('Patient retention update complete', await updatePatientRetentionStates(patientFinanceDeps()));
});

export const refreshCuraleafQuoteBankLondon = onSchedule({
  schedule: '0 3 * * *',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  timeoutSeconds: 540,
  memory: '512MiB',
  maxInstances: 1,
  retryCount: 1,
}, async () => {
  const integrationRepo = new SqlIntegrationRepository();
  const quoteBankRepo = new SqlCuraleafQuoteBankRepository();
  const connections = await integrationRepo.listConnections();
  const summary = await refreshAllCuraleafQuoteBanks(connections, quoteBankRepo);
  console.log('Curaleaf quote bank refresh complete', { summary });
});
