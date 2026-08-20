export interface MedicineLabelParts {
  title: string;
  strength: string | null;
}

const CANNABINOID_START = String.raw`(?:<\s*)?\d+(?:\.\d+)?\s*%\s*(?:THC|CBD|CBG|CBN)\b|(?:THC|CBD|CBG|CBN)\s*\d+(?:\.\d+)?\s*mg(?:\s*/\s*ml)?\b|\d+(?:\.\d+)?\s*mg(?:\s*/\s*ml)?\b`;
const PACK_MASS = String.raw`\d+(?:\.\d+)?\s*g\b`;
const CANNABINOID_SUFFIX = new RegExp(`^(?:${CANNABINOID_START})`, 'i');
const PACK_MASS_ONLY = new RegExp(`^(?:${PACK_MASS})\\.?$`, 'i');
const TRAILING_PACK_MASS = new RegExp(`(?:,\\s+|\\s+)(?:${PACK_MASS})\\s*$`, 'i');
const CANNABINOID_SEPARATOR = new RegExp(`(?:,\\s+|\\s+)(?=${CANNABINOID_START})`, 'gi');
const PACK_MASS_SEPARATOR = new RegExp(`(?:,\\s+|\\s+)(?=${PACK_MASS})`, 'gi');
const HAS_CANNABINOID = new RegExp(CANNABINOID_START, 'i');

function stripTrailingPackMass(value: string) {
  return value.replace(TRAILING_PACK_MASS, '').trim();
}

function isCannabinoidSuffix(value: string) {
  const text = stripTrailingPackMass(value);
  return Boolean(text) && CANNABINOID_SUFFIX.test(text) && !/^\d+(?:\.\d+)?\s*ml\b/i.test(text);
}

function isPackMassOnly(value: string) {
  return PACK_MASS_ONLY.test(value.trim());
}

function splitAt(name: string, index: number, suffix: string): MedicineLabelParts | null {
  const title = name.slice(0, index).trim();
  const strength = stripTrailingPackMass(suffix).trim();
  return title && strength ? { title, strength } : null;
}

export function splitMedicineLabel(name: string): MedicineLabelParts {
  const trimmed = name.trim();
  if (!trimmed) return { title: name, strength: null };

  const parenthetical = trimmed.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (parenthetical?.[1]?.trim() && parenthetical[2] && isCannabinoidSuffix(parenthetical[2])) {
    return { title: parenthetical[1].trim(), strength: stripTrailingPackMass(parenthetical[2]) };
  }

  let searchFrom = trimmed.length;
  while (searchFrom > 0) {
    const comma = trimmed.lastIndexOf(', ', searchFrom - 1);
    if (comma <= 0) break;
    const suffix = trimmed.slice(comma + 2).trim();
    if (isCannabinoidSuffix(suffix)) {
      const split = splitAt(trimmed, comma, suffix);
      if (split) return split;
    }
    if (isPackMassOnly(suffix) && !HAS_CANNABINOID.test(trimmed.slice(0, comma))) {
      return { title: trimmed.slice(0, comma).trim(), strength: suffix };
    }
    searchFrom = comma;
  }

  CANNABINOID_SEPARATOR.lastIndex = 0;
  const cannabinoid = CANNABINOID_SEPARATOR.exec(trimmed);
  if (cannabinoid && typeof cannabinoid.index === 'number' && cannabinoid.index > 0) {
    const split = splitAt(trimmed, cannabinoid.index, trimmed.slice(cannabinoid.index).replace(/^,\s+/, '').trim());
    if (split) return split;
  }

  if (!HAS_CANNABINOID.test(trimmed)) {
    PACK_MASS_SEPARATOR.lastIndex = 0;
    const pack = PACK_MASS_SEPARATOR.exec(trimmed);
    if (pack && typeof pack.index === 'number' && pack.index > 0) {
      const strength = trimmed.slice(pack.index).replace(/^,\s+/, '').trim();
      const title = trimmed.slice(0, pack.index).trim();
      if (title && isPackMassOnly(strength)) return { title, strength };
    }
  }

  return { title: trimmed, strength: null };
}
