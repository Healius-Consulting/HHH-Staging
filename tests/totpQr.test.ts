import assert from 'node:assert/strict';
import test from 'node:test';
import { totpQrDataUrl } from '../src/auth/totpQr.ts';

test('TOTP enrolment draws a PNG QR from an otpauth URL', async () => {
  const image = await totpQrDataUrl('otpauth://totp/Holistic%20Health%20Hub:staff@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Holistic%20Health%20Hub');
  assert.ok(image?.startsWith('data:image/png;base64,'));
});

test('non-otpauth values are not rendered as a QR image', async () => {
  assert.equal(await totpQrDataUrl('https://example.test'), null);
  assert.equal(await totpQrDataUrl(''), null);
});
