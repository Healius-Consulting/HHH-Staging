function maskWord(value: string) {
  const word = value.trim();
  if (!word) return '';
  const first = word[0] ?? '*';
  return `${first}${'*'.repeat(Math.max(3, word.length - 1))}`;
}

export function maskPersonName(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).map(maskWord).join(' ');
}

export function maskPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const prefix = digits.slice(0, Math.min(2, digits.length));
  return `${prefix}${'*'.repeat(Math.max(3, digits.length - prefix.length))}`;
}

export function maskEmailAddress(value: string) {
  const trimmed = value.trim().toLowerCase();
  const separator = trimmed.indexOf('@');
  if (separator < 1) return maskWord(trimmed);
  const local = trimmed.slice(0, separator);
  const domain = trimmed.slice(separator + 1);
  const labels = domain.split('.').filter(Boolean);
  const domainName = labels[0] || '';
  const tld = labels.slice(1).join('.');
  const localMask = maskWord(local);
  const domainMask = maskWord(domainName);
  return tld ? `${localMask}@${domainMask}.${tld}` : `${localMask}@${domainMask}`;
}

export function enquiryDisplayFields(payload: unknown) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const fullName = [record.firstName, record.surname].filter(value => value != null && String(value).trim()).join(' ')
    || String(record.patientName || record.maskedName || '');
  const phone = String(record.maskedPhone || record.mobile || record.phone || '');
  const email = String(record.maskedEmail || record.email || '');
  return {
    name: String(record.maskedName || '').trim() || maskPersonName(fullName),
    phone: phone.includes('*') ? phone : maskPhoneNumber(phone),
    email: email.includes('*') ? email : maskEmailAddress(email),
  };
}
