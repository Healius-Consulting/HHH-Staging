export interface FormConditionRecord {
  conditionCode: string;
  primary: boolean;
}

export function formConditionRecords(input: {
  conditionCodes?: unknown;
  primaryConditionCode?: unknown;
  conditions?: Array<{ conditionCode?: unknown; primary?: unknown }>;
}): FormConditionRecord[] {
  const codes = Array.isArray(input.conditionCodes)
    ? [...new Set(input.conditionCodes.flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim()] : []))]
    : [];
  if (codes.length) {
    const primary = typeof input.primaryConditionCode === 'string' && codes.includes(input.primaryConditionCode)
      ? input.primaryConditionCode
      : codes[0]!;
    return codes.map((conditionCode) => ({ conditionCode, primary: conditionCode === primary }));
  }

  const joined = Array.isArray(input.conditions) ? input.conditions : [];
  return joined.flatMap((entry) => {
    if (!entry || typeof entry.conditionCode !== 'string' || !entry.conditionCode.trim()) return [];
    return [{ conditionCode: entry.conditionCode.trim(), primary: entry.primary === true }];
  });
}

export function primaryConditionCode(records: FormConditionRecord[]): string | null {
  return records.find((record) => record.primary)?.conditionCode ?? records[0]?.conditionCode ?? null;
}
