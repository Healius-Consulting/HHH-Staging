import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

const organisationIdSchema = z.string().regex(/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i);

const financeDateRangeSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict();

describe('portal finance query validation', () => {
  it('accepts compact tenant ids for admin finance filters', () => {
    const organisationId = '70913a3071c34a41952ed532927af58c';
    assert.doesNotThrow(() => organisationIdSchema.parse(organisationId));
  });

  it('accepts date-only filters for pharmacy prescription finance', () => {
    const parsed = financeDateRangeSchema.parse({ from: '2026-05-19' });
    assert.equal(parsed.from, '2026-05-19');
    assert.equal(parsed.to, undefined);
  });
});
