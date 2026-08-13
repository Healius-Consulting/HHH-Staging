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
    gdprPassed: testAccount || companyGdprPassed,
    gdprExempt: testAccount,
    curaleafPassed,
    curaleafEnvironment: expectedEnvironment,
    curaleafValidatedAt: typeof validation.validatedAt === 'string' ? validation.validatedAt : null,
    secretStored,
  };
}
