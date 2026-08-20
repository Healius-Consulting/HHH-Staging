export interface MedicineLabelParts {
  title: string;
  strength: string | null;
}

/** Curaleaf printed names use a few strength suffixes: flower %, oil/capsule mg or mg/ml, vape g. */

const STRENGTH_START = String.raw`(?:<\s*)?\d+(?:\.\d+)?\s*%\s*(?:THC|CBD|CBG|CBN)\b|(?:THC|CBD|CBG|CBN)\s*\d+(?:\.\d+)?\s*mg(?:\s*/\s*ml)?\b|\d+(?:\.\d+)?\s*mg(?:\s*/\s*ml)?\b|\d+(?:\.\d+)?\s*g\b`;
const STRENGTH_SUFFIX = new RegExp(`^(?:${STRENGTH_START})`, 'i');
const LAST_SEPARATOR = new RegExp(`(?:,\\s+|\\s+)(?=${STRENGTH_START})`, 'gi');

function isStrengthSuffix(value: string) {
  const text = value.trim();
  return Boolean(text) && STRENGTH_SUFFIX.test(text) && !/^\d+(?:\.\d+)?\s*ml\b/i.test(text);
}

export function splitMedicineLabel(name: string): MedicineLabelParts {
  const trimmed = name.trim();
  if (!trimmed) return { title: name, strength: null };

  const parenthetical = trimmed.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (parenthetical?.[1]?.trim() && parenthetical[2] && isStrengthSuffix(parenthetical[2])) {
    return { title: parenthetical[1].trim(), strength: parenthetical[2].trim() };
  }

  const comma = trimmed.lastIndexOf(', ');
  if (comma > 0) {
    const strength = trimmed.slice(comma + 2).trim();
    if (isStrengthSuffix(strength)) return { title: trimmed.slice(0, comma).trim(), strength };
  }

  LAST_SEPARATOR.lastIndex = 0;
  const first = LAST_SEPARATOR.exec(trimmed);
  if (first && typeof first.index === 'number' && first.index > 0) {
    const strength = trimmed.slice(first.index).replace(/^,\s+/, '').trim();
    const title = trimmed.slice(0, first.index).trim();
    if (title && isStrengthSuffix(strength)) return { title, strength };
  }

  return { title: trimmed, strength: null };
}
