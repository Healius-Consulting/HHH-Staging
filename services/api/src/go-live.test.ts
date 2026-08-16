import assert from 'node:assert/strict';
import test from 'node:test';
import { canAcceptPublicIntake, canAutoActivateIntake, goLiveGateState, isAllocationHoldingAccount, isExplicitCuraleafTestAccount } from './go-live.js';

const trainingOrganisation = {
  testAccount: true,
  gdprExempt: true,
  gphcNumber: 'TRAINING-PHARM1',
  curaleafTestValidation: { environment: 'TEST', validatedAt: '2026-08-08T01:45:14.661Z' },
};

test('only explicitly flagged TRAINING organisations receive the test exemption', () => {
  assert.equal(isExplicitCuraleafTestAccount(trainingOrganisation), true);
  assert.equal(isExplicitCuraleafTestAccount({ ...trainingOrganisation, gdprExempt: false }), false);
  assert.equal(isExplicitCuraleafTestAccount({ ...trainingOrganisation, gphcNumber: '1099224' }), false);
});

test('public intake accepts explicit live training tenants and GDPR-cleared intake tenants', () => {
  assert.equal(canAcceptPublicIntake({ ...trainingOrganisation, status: 'live' }), true);
  assert.equal(canAcceptPublicIntake({ ...trainingOrganisation, status: 'paused' }), false);
  assert.equal(canAcceptPublicIntake({ status: 'intake_live', gphcNumber: '1099224' }), true);
  assert.equal(canAcceptPublicIntake({ status: 'live', gphcNumber: '1099224' }), true);
  assert.equal(canAcceptPublicIntake({ status: 'onboarding', gphcNumber: '1099224' }), false);
});

test('GDPR completion auto-activates onboarding and GDPR-paused real pharmacies only', () => {
  assert.equal(canAutoActivateIntake({ status: 'onboarding', gphcNumber: '1099224' }), true);
  assert.equal(canAutoActivateIntake({ status: 'paused', gphcNumber: '1099224', pausedReason: 'go_live_gate_audit_failed' }), true);
  assert.equal(canAutoActivateIntake({ status: 'paused', gphcNumber: '1099224', pausedReason: 'manual_security_pause' }), false);
  assert.equal(canAutoActivateIntake({ ...trainingOrganisation, status: 'onboarding' }), false);
  assert.equal(canAutoActivateIntake({ status: 'live', gphcNumber: '1099224' }), false);
});

test('a validated connected TEST account bypasses production GDPR and LIVE-key gates', () => {
  assert.deepEqual(
    goLiveGateState(trainingOrganisation, false, { status: 'connected' }),
    {
      testAccount: true,
      allocationHolding: false,
      gdprPassed: true,
      gdprExempt: true,
      curaleafPassed: true,
      curaleafEnvironment: 'test',
      curaleafValidatedAt: '2026-08-08T01:45:14.661Z',
      secretStored: true,
    },
  );
});

test('allocation holding remains an explicit TEST integration without training classification', () => {
  const organisation = { ...trainingOrganisation, workspaceClassification: 'allocation_holding' };
  assert.equal(isExplicitCuraleafTestAccount(organisation), true);
  assert.equal(isAllocationHoldingAccount(organisation), true);
  assert.equal(isAllocationHoldingAccount(trainingOrganisation), false);
  assert.equal(goLiveGateState(organisation, false, { status: 'connected' }).allocationHolding, true);
});

test('test accounts still fail closed without a validated connected Curaleaf TEST key', () => {
  assert.equal(goLiveGateState(trainingOrganisation, false, { status: 'attention' }).curaleafPassed, false);
  assert.equal(goLiveGateState({ ...trainingOrganisation, curaleafTestValidation: null }, false, { status: 'connected' }).curaleafPassed, false);
});

test('normal organisations still require GDPR evidence and a production secret', () => {
  const organisation = {
    gphcNumber: '1099224',
    curaleafLiveValidation: { environment: 'production', validatedAt: '2026-08-08T01:45:14.661Z' },
    curaleafLiveSecretStoredAt: '2026-08-08T01:45:14.661Z',
  };
  const gates = goLiveGateState(organisation, false, { status: 'connected' });
  assert.equal(gates.testAccount, false);
  assert.equal(gates.gdprPassed, false);
  assert.equal(gates.curaleafPassed, true);
});
