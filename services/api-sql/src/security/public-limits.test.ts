import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from 'express';
import { publicClientIp } from './public-limits.js';

function requestWith(headers: Record<string, string | undefined>, ip?: string): Request {
  return {
    ip,
    headers: {
      'x-forwarded-for': headers['x-forwarded-for'],
    },
  } as unknown as Request;
}

describe('publicClientIp', () => {
  it('uses the original client address in front of Vercel and Cloud Run hops', () => {
    assert.equal(
      publicClientIp(requestWith({ 'x-forwarded-for': '203.0.113.10, 76.76.21.21, 169.254.1.1' })),
      '203.0.113.10',
    );
  });
});
