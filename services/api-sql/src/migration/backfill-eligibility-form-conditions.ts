import { executeGraphqlViaFirebaseCli } from './dataconnect-cli.js';

async function main() {
  const listed = await executeGraphqlViaFirebaseCli<{
    eligibilityConditions: Array<{ submissionId: string; conditionCode: string; primary: boolean }>;
    eligibilitySubmissions: Array<{ id: string; conditionCodes: string[] | null; primaryConditionCode: string | null }>;
  }>(`
    query ListEligibilityConditionsForBackfill {
      eligibilityConditions(limit: 500) { submissionId conditionCode primary }
      eligibilitySubmissions(limit: 200) { id conditionCodes primaryConditionCode }
    }
  `);

  const bySubmission = new Map<string, Array<{ conditionCode: string; primary: boolean }>>();
  for (const row of listed.data.eligibilityConditions ?? []) {
    const current = bySubmission.get(row.submissionId) ?? [];
    current.push(row);
    bySubmission.set(row.submissionId, current);
  }

  let updated = 0;
  for (const submission of listed.data.eligibilitySubmissions ?? []) {
    const rows = bySubmission.get(submission.id) ?? [];
    if (!rows.length) continue;
    if (Array.isArray(submission.conditionCodes) && submission.conditionCodes.length) continue;
    const codes = [...new Set(rows.map((row) => row.conditionCode))];
    const primary = rows.find((row) => row.primary)?.conditionCode ?? codes[0] ?? null;
    await executeGraphqlViaFirebaseCli(`
      mutation BackfillSubmissionConditions($id: UUID!, $conditionCodes: [String!], $primaryConditionCode: String) {
        eligibilitySubmission_update(
          key: { id: $id }
          data: { conditionCodes: $conditionCodes, primaryConditionCode: $primaryConditionCode }
        )
      }
    `, { id: submission.id, conditionCodes: codes, primaryConditionCode: primary });
    updated += 1;
    console.log(JSON.stringify({ id: submission.id, codes, primary }));
  }

  console.log(JSON.stringify({
    submissions: listed.data.eligibilitySubmissions.length,
    linked: bySubmission.size,
    updated,
  }));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
