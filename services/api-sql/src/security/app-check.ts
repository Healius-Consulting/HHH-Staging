import type { NextFunction, Request, Response } from 'express';
import { getAppCheck } from 'firebase-admin/app-check';
import { app } from '../bootstrap/firebase.js';
import { HttpError } from '../domain/common/errors.js';
import { appCheckIsRequired, isAppCheckExempt } from './app-check-policy.js';

const appCheck = getAppCheck(app);

export { appCheckIsRequired, isAppCheckExempt };

export async function requireAppCheck(request: Request, _response: Response, next: NextFunction): Promise<void> {
  if (!appCheckIsRequired() || isAppCheckExempt(request.method, request.path)) {
    next();
    return;
  }

  try {
    const token = request.get('x-firebase-appcheck');
    if (!token) throw new Error('missing');
    await appCheck.verifyToken(token);
    next();
  } catch {
    next(new HttpError(401, 'App attestation is required.', 'APP_CHECK_REQUIRED'));
  }
}
