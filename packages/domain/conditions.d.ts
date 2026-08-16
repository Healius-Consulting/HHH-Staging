export type ConditionId = string;
export interface ConditionDefinition { readonly id: ConditionId; readonly label: string }
export const CONDITIONS: readonly ConditionDefinition[];
export const CONDITION_IDS: readonly [ConditionId, ...ConditionId[]];
export function isConditionId(value: unknown): value is ConditionId;
export function conditionLabel(value: string | null | undefined): string;
export function normaliseConditionId(value: unknown): ConditionId | null;
