import { HttpError } from '../common/errors.js';

export function curaleafMoneyPence(value: unknown, field = 'price') {
  const price = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price);
  if (!match || match[2]?.slice(2).match(/[1-9]/)) {
    throw new HttpError(502, `Curaleaf returned an invalid ${field}.`, 'INVALID_SUPPLIER_PRICE');
  }
  const pence = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0').slice(0, 2) || '0');
  if (pence > 10_000_000n) {
    throw new HttpError(502, `Curaleaf returned a ${field} outside the supported range.`, 'INVALID_SUPPLIER_PRICE');
  }
  return Number(pence);
}

export function penceToCuraleafMoney(pence: number) {
  const whole = Math.floor(pence / 100);
  const fraction = String(pence % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}
