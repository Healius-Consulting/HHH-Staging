import { ELIGIBILITY_CONDITIONS } from '../domain/eligibility/conditions.js';
import { dataConnect } from '../bootstrap/firebase.js';

const LIST_CONDITIONS_GQL = `
  query ListConditionReferenceData {
    conditions { code label active displayOrder }
  }
`;

const UPSERT_CONDITION_GQL = `
  mutation UpsertConditionReference(
    $code: String!
    $label: String!
    $displayOrder: Int!
  ) {
    condition_upsert(data: {
      code: $code
      label: $label
      active: true
      displayOrder: $displayOrder
    })
  }
`;

async function seed(apply: boolean) {
  const existing = await dataConnect.executeGraphql<{
    conditions: Array<{ code: string; label: string; active: boolean; displayOrder: number }>;
  }, Record<string, never>>(LIST_CONDITIONS_GQL);
  const byCode = new Map((existing.data.conditions ?? []).map(condition => [condition.code, condition]));
  const changed = ELIGIBILITY_CONDITIONS.filter(([code, label], index) => {
    const current = byCode.get(code);
    return !current || current.label !== label || !current.active || current.displayOrder !== index + 1;
  });
  console.log(JSON.stringify({ apply, existing: byCode.size, plannedUpserts: changed.length }));
  if (!apply) return;

  for (const [code, label] of changed) {
    await dataConnect.executeGraphql(UPSERT_CONDITION_GQL, {
      variables: {
        code,
        label,
        displayOrder: ELIGIBILITY_CONDITIONS.findIndex(([candidate]) => candidate === code) + 1,
      },
    });
  }

  const verified = await dataConnect.executeGraphql<{ conditions: Array<{ code: string }> }, Record<string, never>>(
    LIST_CONDITIONS_GQL,
  );
  const activeCodes = new Set(verified.data.conditions?.map(condition => condition.code) ?? []);
  if (!ELIGIBILITY_CONDITIONS.every(([code]) => activeCodes.has(code))) {
    throw new Error('Eligibility condition reference-data verification failed.');
  }
  console.log(JSON.stringify({ verified: true, conditionCount: activeCodes.size }));
}

void seed(process.argv.includes('--apply'));
