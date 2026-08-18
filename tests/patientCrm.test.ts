import assert from 'node:assert/strict';
import test from 'node:test';
import {
  patientCrmGroup,
  patientCrmRecordKey,
  patientCrmStatusMeta,
  recordMatchesPatientFilter,
} from '../src/utils/patientCrm.ts';

const enquiry = {
  kind: 'enquiry' as const,
  journey: 'enquiry' as const,
  hasCrmRecord: false,
  hasOpenOrder: false,
  needsAction: false,
  readyForCollection: false,
};

const active = {
  kind: 'patient' as const,
  journey: 'active' as const,
  hasCrmRecord: true,
  hasOpenOrder: false,
  needsAction: false,
  readyForCollection: false,
};

const onOrder = { ...active, hasOpenOrder: true };
const needsAction = { ...active, hasOpenOrder: true, needsAction: true };
const ready = { ...active, hasOpenOrder: true, readyForCollection: true };
const declined = { ...active, journey: 'declined' as const, hasCrmRecord: true, hasOpenOrder: false };

test('all filter includes enquiries and patients together', () => {
  assert.equal(recordMatchesPatientFilter(enquiry, 'all'), true);
  assert.equal(recordMatchesPatientFilter(active, 'all'), true);
  assert.equal(recordMatchesPatientFilter(declined, 'all'), true);
});

test('status filters keep enquiries and operational patients distinct', () => {
  assert.equal(recordMatchesPatientFilter(enquiry, 'enquiries'), true);
  assert.equal(recordMatchesPatientFilter(active, 'enquiries'), false);
  assert.equal(recordMatchesPatientFilter(active, 'active'), true);
  assert.equal(recordMatchesPatientFilter(enquiry, 'active'), false);
  assert.equal(recordMatchesPatientFilter(onOrder, 'on-order'), true);
  assert.equal(recordMatchesPatientFilter(needsAction, 'needs-action'), true);
  assert.equal(recordMatchesPatientFilter(ready, 'ready'), true);
  assert.equal(recordMatchesPatientFilter(declined, 'declined'), true);
  assert.equal(recordMatchesPatientFilter(active, 'declined'), false);
});

test('grouped all-view ranks action, enquiries and care without overlap', () => {
  assert.equal(patientCrmGroup(needsAction), 'needs-action');
  assert.equal(patientCrmGroup(enquiry), 'enquiries');
  assert.equal(patientCrmGroup(ready), 'ready');
  assert.equal(patientCrmGroup(onOrder), 'on-order');
  assert.equal(patientCrmGroup(active), 'care');
  assert.equal(patientCrmGroup(declined), 'declined');
});

test('status copy stays textual for colour-independent reading', () => {
  const meta = patientCrmStatusMeta({ kind: 'enquiry', statusLabel: 'New enquiry', enquiryAwaitingReferral: true });
  assert.match(meta.description, /HHH/);
  assert.equal(meta.tone, 'info');
  assert.equal(patientCrmRecordKey('patient', 'abc'), 'patient:abc');
});
