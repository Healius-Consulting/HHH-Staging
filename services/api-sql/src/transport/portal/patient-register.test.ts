import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OrganisationRecord } from '../../repositories/ports/organisation.port.js';
import type { PatientRecord } from '../../repositories/ports/patient.port.js';
import { buildPatientRegister } from './patient-register.js';

const organisation = {
  id: '70913a3071c34a41952ed532927af58c', tradingName: 'Primary Branch', name: 'Primary Branch Ltd', gphcNumber: '1234567',
} as OrganisationRecord;
const patient = {
  id: '11111111111141118111111111111111', organisationId: organisation.id, sourceSubmissionId: null,
  firstName: 'Avery', surname: 'Morgan', dob: '1991-04-12', email: 'avery@example.test', mobile: '07000000000',
  address: null, postcode: 'SW1A 1AA', status: 'ACTIVE', activatedAt: null, statusChangedAt: null,
  version: 1, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-17T10:00:00.000Z',
  conditions: [], sourceSubmission: null,
} satisfies PatientRecord;

describe('SQL admin patient register', () => {
  it('projects and filters migrated patients by tenant without changing attribution', () => {
    const result = buildPatientRegister([patient], [], [organisation], {
      query: 'primary', organisationId: organisation.id, status: 'HHH approved', from: '2026-08-17', to: '2026-08-17',
    });
    assert.equal(result.resultCount, 1);
    assert.equal(result.rows[0]?.organisationId, organisation.id);
    assert.equal(result.rows[0]?.stage, 'HHH approved');
    assert.match(result.recordScopeHash, /^[a-f0-9]{64}$/);
  });

  it('does not return a patient for another pharmacy filter', () => {
    const result = buildPatientRegister([patient], [], [organisation], {
      query: '', organisationId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: 'all', from: null, to: null,
    });
    assert.equal(result.resultCount, 0);
  });
});
