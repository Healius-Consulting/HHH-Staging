export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = 'ERROR',
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Record not found.', code = 'NOT_FOUND') {
    super(404, message, code);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Access denied.', code = 'FORBIDDEN') {
    super(403, message, code);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Authentication required.', code = 'UNAUTHENTICATED') {
    super(401, message, code);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'The resource state has changed. Please refresh and try again.', code = 'CONFLICT') {
    super(409, message, code);
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, details?: unknown, code = 'INVALID_INPUT') {
    super(400, message, code, details);
  }
}
