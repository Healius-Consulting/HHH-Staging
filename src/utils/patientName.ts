export function compactPatientName(name: string | null | undefined, fallback = 'Unknown patient') {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts.at(-1)![0].toUpperCase()}.`;
}
