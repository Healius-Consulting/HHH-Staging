type RecordLike = Record<string, unknown>;

function record(value: unknown): RecordLike {
  return value && typeof value === 'object' ? value as RecordLike : {};
}

function environment(value: unknown) {
  const normalised = String(value ?? '').trim().toLowerCase();
  if (normalised === 'test') return 'test' as const;
  if (normalised === 'live' || normalised === 'production') return 'production' as const;
  return null;
}

export function isExplicitCuraleafTestAccount(organisation: RecordLike) {
  return organisation.testAccount === true
    && organisation.gdprExempt === true
    && /^TRAINING-[A-Z0-9_-]+$/i.test(String(organisation.gphcNumber ?? ''));
}

/**
 * A real-patient allocation holding workspace can keep an approved Curaleaf
 * TEST connection for its historic synthetic cases without being presented as
 * a training tenant. It is excluded from the public directory, but its existing
 * dedicated link remains a fixed destination. New cases stay HHH-only until an
 * administrator completes and activates the referral.
 */
export function isAllocationHoldingAccount(organisation: RecordLike) {
  return organisation.workspaceClassification === 'allocation_holding'
    && isExplicitCuraleafTestAccount(organisation);
}

export function canAcceptPublicIntake(organisation: RecordLike) {
  const status = String(organisation.status ?? '');
  return isExplicitCuraleafTestAccount(organisation)
    ? status === 'live'
    : status === 'intake_live' || status === 'live';
}

export function canAutoActivateIntake(organisation: RecordLike) {
  if (isExplicitCuraleafTestAccount(organisation)) return false;
  const status = String(organisation.status ?? '');
  if (status === 'onboarding') return true;
  if (status !== 'paused') return false;
  return organisation.gdprComplianceFlag === true
    || ['go_live_gate_audit_failed', 'intake_gdpr_gate_audit_failed'].includes(String(organisation.pausedReason ?? ''));
}

export function goLiveGateState(
  organisation: RecordLike,
  companyGdprPassed: boolean,
  curaleafConnection: RecordLike | null,
) {
  const testAccount = isExplicitCuraleafTestAccount(organisation);
  const validation = record(testAccount ? organisation.curaleafTestValidation : organisation.curaleafLiveValidation);
  const expectedEnvironment = testAccount ? 'test' : 'production';
  const validationEnvironment = environment(validation.environment);
  const connectionStatus = String(curaleafConnection?.status ?? '').toLowerCase();
  const secretStored = testAccount
    ? ['connected', 'validated'].includes(connectionStatus)
    : typeof organisation.curaleafLiveSecretStoredAt === 'string';
  const curaleafPassed = validationEnvironment === expectedEnvironment
    && typeof validation.validatedAt === 'string'
    && secretStored;

  return {
    testAccount,
    allocationHolding: isAllocationHoldingAccount(organisation),
    gdprPassed: testAccount || companyGdprPassed,
    gdprExempt: testAccount,
    curaleafPassed,
    curaleafEnvironment: expectedEnvironment,
    curaleafValidatedAt: typeof validation.validatedAt === 'string' ? validation.validatedAt : null,
    secretStored,
  };
}
