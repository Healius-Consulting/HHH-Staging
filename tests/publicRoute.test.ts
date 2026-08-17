import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalEligibilityRedirect, resolvePublicView } from '../apps/public/src/publicRoute.ts';

test('legacy pharmacy QR URLs open the eligibility form from the public root', () => {
  assert.equal(
    resolvePublicView('/', '?mode=eligibility&token=bbd8fc4749934797a49398c0b95e68cf873d4868c33c42a2949d6f65359d44c5'),
    'eligibility',
  );
  assert.equal(resolvePublicView('///', '?token=value&mode=eligibility'), 'eligibility');
});

test('the canonical eligibility path and payment return paths retain their views', () => {
  assert.equal(resolvePublicView('/eligibility', ''), 'eligibility');
  assert.equal(resolvePublicView('/eligibility', '?token=value'), 'eligibility');
  assert.equal(resolvePublicView('/payments/complete', ''), 'payment-complete');
  assert.equal(resolvePublicView('/payment/success', ''), 'payment-complete');
  assert.equal(resolvePublicView('/payments/cancelled/', ''), 'payment-cancelled');
  assert.equal(resolvePublicView('/payment/cancelled', ''), 'payment-cancelled');
});

test('unknown root modes remain on the public site', () => {
  assert.equal(resolvePublicView('/', '?mode=other&token=value'), 'site');
  assert.equal(resolvePublicView('/about', '?mode=eligibility'), 'site');
});

test('legacy eligibility URLs redirect to the rehearsal domain without changing pharmacy tokens', () => {
  assert.equal(
    canonicalEligibilityRedirect(
      'holistichealthhub.live',
      '/',
      '?mode=eligibility&token=bbd8fc4749934797a49398c0b95e68cf873d4868c33c42a2949d6f65359d44c5',
    ),
    'https://holistichealthhub.cc/eligibility?token=bbd8fc4749934797a49398c0b95e68cf873d4868c33c42a2949d6f65359d44c5',
  );
  assert.equal(
    canonicalEligibilityRedirect('holistichealthhub.live', '/eligibility', '?token=eastwood&source=qr&postcode=SW1A1AA&email=person%40example.com&utm_campaign=poster'),
    'https://holistichealthhub.cc/eligibility?token=eastwood&source=qr&utm_campaign=poster',
  );
});

test('all protected production tokens retain every supported URL shape', () => {
  const tokens = [
    '3509a44084ab461aa9aafe603047e9add4e6e7a51e214e40b830753202b7131d',
    '0a93ebde7ab143cfafd7c2a34329b3587148fb1ff9fb4e6fbf02f517fac05d30',
    'bbd8fc4749934797a49398c0b95e68cf873d4868c33c42a2949d6f65359d44c5',
    '68e83b76e7824084997d97b5d2159e1840aefdb4d26f4d5c81b0aed86844f83a',
  ];
  for (const token of tokens) {
    assert.equal(resolvePublicView('/', `?mode=eligibility&token=${token}`), 'eligibility');
    assert.equal(resolvePublicView('/eligibility', `?token=${token}`), 'eligibility');
    assert.equal(canonicalEligibilityRedirect('holistichealthhub.live', '/eligibility', `?token=${token}`), `https://holistichealthhub.cc/eligibility?token=${token}`);
  }
  for (const token of ['kchem-7x4p9k', 'eastwood-3m8q2v']) assert.equal(resolvePublicView('/eligibility', `?token=${token}`), 'eligibility');
});

test('the canonical and unrelated public hosts never redirect themselves', () => {
  assert.equal(canonicalEligibilityRedirect('holistichealthhub.cc', '/eligibility', '?token=value'), null);
  assert.equal(canonicalEligibilityRedirect('holistichealthhub.live', '/about', '?token=value'), null);
  assert.equal(canonicalEligibilityRedirect('holistichealthhub.live', '/eligibility', ''), null);
});
