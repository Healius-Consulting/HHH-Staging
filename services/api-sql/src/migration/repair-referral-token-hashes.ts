import { dataConnect } from '../bootstrap/firebase.js';

type TokenRecord = {
  id: string;
  organisationId: string;
  tokenHash: string;
  intakeVersion: string;
  revokedAt: string | null;
};

// Frozen SHA-256 hashes for the four protected long-lived links and the two
// printed short aliases. Raw referral tokens are deliberately not stored here.
const desiredHashesByOrganisation = new Map<string, readonly string[]>([
  ['f486a221223644a5b072f06de399ab0e', [
    '4bbc90128434dc615429c7157742aee1670e11aef0f43e2363efb45ee11fe4c2',
  ]],
  ['6d0176bb89a04e329bcec934c9557c42', [
    '1ae3847fe37bf19d7a6bda29ee2b599c781c2d76c2697a58a82fb8be1d27e13d',
    '70f966e53ad1fab18d70dfd04ad0d702653de099446187c9c173443087e27984',
  ]],
  ['3e9f74ff4fed497d904d4d3ee3e5e126', [
    'bf090d34c7d94b07e2c27b4a2a84240a48b93ae66f179506a34535ca56837252',
    '7b1ce5e49fae2dac13db1b326e1fbb9db44a0cd7efcb7ad8113e42aecf4b3ced',
  ]],
  ['70913a3071c34a41952ed532927af58c', [
    '2866e80d8a85d6d0f8998b619473ede0d8fc719f1eaeba70c06929604d417009',
  ]],
]);

const LIST_TOKENS_GQL = `
  query ListReferralTokensForRepair {
    referralTokens {
      id
      organisationId
      tokenHash
      intakeVersion
      revokedAt
    }
  }
`;

const UPDATE_TOKEN_HASH_GQL = `
  mutation RepairReferralTokenHash($id: UUID!, $tokenHash: String!) {
    referralToken_update(key: { id: $id }, data: { tokenHash: $tokenHash })
  }
`;

const INSERT_TOKEN_HASH_GQL = `
  mutation InsertProtectedReferralTokenHash($organisationId: UUID!, $tokenHash: String!) {
    referralToken_insert(data: {
      organisationId: $organisationId
      tokenHash: $tokenHash
      intakeVersion: "v2"
    })
  }
`;

async function listTokens(): Promise<TokenRecord[]> {
  const result = await dataConnect.executeGraphql<{ referralTokens: TokenRecord[] }, Record<string, never>>(
    LIST_TOKENS_GQL,
  );
  return result.data.referralTokens ?? [];
}

async function repair(apply: boolean) {
  const current = await listTokens();
  const protectedHashes = new Set([...desiredHashesByOrganisation.values()].flat());
  const actions: Array<{
    type: 'update' | 'insert';
    organisationId: string;
    id?: string;
    tokenHash: string;
  }> = [];

  for (const [organisationId, desiredHashes] of desiredHashesByOrganisation) {
    const organisationRows = current.filter(row => row.organisationId === organisationId && !row.revokedAt);
    const existingHashes = new Set(organisationRows.map(row => row.tokenHash));
    const primaryHash = desiredHashes[0]!;

    if (!existingHashes.has(primaryHash)) {
      const incorrectlyStored = organisationRows.find(row => !protectedHashes.has(row.tokenHash));
      if (incorrectlyStored) {
        actions.push({ type: 'update', organisationId, id: incorrectlyStored.id, tokenHash: primaryHash });
        existingHashes.add(primaryHash);
      } else {
        actions.push({ type: 'insert', organisationId, tokenHash: primaryHash });
        existingHashes.add(primaryHash);
      }
    }

    for (const aliasHash of desiredHashes.slice(1)) {
      if (!existingHashes.has(aliasHash)) {
        actions.push({ type: 'insert', organisationId, tokenHash: aliasHash });
        existingHashes.add(aliasHash);
      }
    }
  }

  console.log(JSON.stringify({ apply, currentRows: current.length, plannedActions: actions.map(action => ({
    type: action.type,
    organisationId: action.organisationId,
    existingRow: Boolean(action.id),
  })) }, null, 2));

  if (!apply) return;

  for (const action of actions) {
    if (action.type === 'update') {
      await dataConnect.executeGraphql(UPDATE_TOKEN_HASH_GQL, {
        variables: { id: action.id!, tokenHash: action.tokenHash },
      });
    } else {
      await dataConnect.executeGraphql(INSERT_TOKEN_HASH_GQL, {
        variables: { organisationId: action.organisationId, tokenHash: action.tokenHash },
      });
    }
  }

  const repaired = await listTokens();
  const activeProtected = repaired.filter(row => !row.revokedAt && protectedHashes.has(row.tokenHash));
  if (activeProtected.length !== protectedHashes.size) {
    throw new Error(`Referral-token repair verification failed: expected ${protectedHashes.size}, found ${activeProtected.length}.`);
  }
  console.log(JSON.stringify({ verified: true, protectedActiveRows: activeProtected.length }));
}

void repair(process.argv.includes('--apply'));
