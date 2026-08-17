import assert from 'node:assert/strict';
import test from 'node:test';
import { directoryContextFromHistory, patientIdFromSearch, patientProfileUrl } from '../src/utils/patientDirectoryNavigation.js';

test('patient profile URLs preserve unrelated query parameters without patient data', () => {
  assert.equal(patientProfileUrl('https://portal.example.test/?devPortal=pharmacy#main', 'P-123'), '/?devPortal=pharmacy&patient=P-123#main');
  assert.equal(patientProfileUrl('https://portal.example.test/?devPortal=pharmacy&patient=P-123', null), '/?devPortal=pharmacy');
  assert.equal(patientIdFromSearch('?devPortal=pharmacy&patient=sub-abc'), 'sub-abc');
});

test('directory context accepts only the supported filter and sort values', () => {
  const context = { search: 'pain', filter: 'active', sort: 'status', scrollTop: 280, pageScrollY: 120, focusPatientId: 'patient-abc' };
  assert.deepEqual(directoryContextFromHistory({ patientDirectoryContext: context }), context);
  assert.deepEqual(directoryContextFromHistory({ patientDirectoryContext: { ...context, filter: 'enquiries' } }), { ...context, filter: 'enquiries' });
  assert.equal(directoryContextFromHistory({ patientDirectoryContext: { ...context, filter: 'other' } }), null);
});
