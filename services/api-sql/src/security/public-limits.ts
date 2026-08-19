import { rateLimit } from 'express-rate-limit';
import { SharedRateLimitStore } from './shared-rate-limit-store.js';

const limitResponse = { code: 'RATE_LIMITED', message: 'Too many requests. Wait briefly before trying again.' };

function publicLimiter(prefix: string, windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    store: new SharedRateLimitStore(prefix),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: limitResponse,
  });
}

export const publicSubmissionLimiter = publicLimiter('elig-submit', 60 * 60 * 1000, 20);
export const publicPaymentStatusLimiter = publicLimiter('pay-status', 15 * 60 * 1000, 60);
export const publicWebhookLimiter = publicLimiter('wp-webhook', 15 * 60 * 1000, 300);
export const publicReferralResolveLimiter = publicLimiter('elig-resolve', 15 * 60 * 1000, 120);
export const publicPostcodeSearchLimiter = publicLimiter('postcode', 15 * 60 * 1000, 45);
