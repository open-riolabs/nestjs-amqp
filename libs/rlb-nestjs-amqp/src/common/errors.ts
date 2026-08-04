/**
 * Error classes whose `name` matches the status mapping in the gateway HTTP handler
 * (BadRequestError→400, UnauthorizedError→401, ForbiddenError→403, NotFoundError→404,
 * ConflictError→409, InvalidParamsErrror→400). Throw these from handlers to drive the response code.
 */
export class BrokerHttpError extends Error {
  /** Optional structured payload surfaced in the unified error envelope as `details` (e.g. a
   *  ConflictError carrying the list of conflicting routes). */
  readonly details?: unknown;
  constructor(message?: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class BadRequestError extends BrokerHttpError { }
export class UnauthorizedError extends BrokerHttpError { }
export class ForbiddenError extends BrokerHttpError { }
export class NotFoundError extends BrokerHttpError { }
export class ConflictError extends BrokerHttpError { }
export class ServerError extends BrokerHttpError { }
// Name kept intentionally (matches the gateway switch which uses this exact spelling).
export class InvalidParamsErrror extends BrokerHttpError { }
