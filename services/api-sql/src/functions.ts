import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  accrueAnnualPatientFees,
  updatePatientRetentionStates,
} from './application/patient-finance/patient-finance.js';
import { createApp } from './bootstrap/app.js';
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
