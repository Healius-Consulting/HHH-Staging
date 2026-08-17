import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ELIGIBILITY_FORM_URL, safeEligibilityFormBase } from '../src/utils/pharmacyResources.ts';

test('invalid or insecure eligibility configuration falls back without crashing Settings', () => {
  assert.equal(safeEligibilityFormBase('not-a-url', false).toString(), DEFAULT_ELIGIBILITY_FORM_URL);
  assert.equal(safeEligibilityFormBase('http://example.test/eligibility', false).toString(), DEFAULT_ELIGIBILITY_FORM_URL);
  assert.equal(safeEligibilityFormBase('https://holistichealthhub.live/eligibility', false).toString(), 'https://holistichealthhub.live/eligibility');
});

test('only loopback HTTP is accepted for local eligibility development', () => {
  assert.equal(safeEligibilityFormBase('http://localhost:5174/eligibility', true).toString(), 'http://localhost:5174/eligibility');
  assert.equal(safeEligibilityFormBase('http://public.example/eligibility', true).toString(), DEFAULT_ELIGIBILITY_FORM_URL);
});
