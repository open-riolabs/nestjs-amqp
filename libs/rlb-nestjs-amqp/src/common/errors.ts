/**
 * Error classes whose `name` matches the status mapping in the gateway HTTP handler
 * (BadRequestError→400, UnauthorizedError→401, ForbiddenError→403, NotFoundError→404,
 * InvalidParamsErrror→400). Throw these from handlers to drive the gateway response code.
 */
export class BrokerHttpError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends BrokerHttpError { }
export class UnauthorizedError extends BrokerHttpError { }
export class ForbiddenError extends BrokerHttpError { }
export class NotFoundError extends BrokerHttpError { }
// Name kept intentionally (matches the gateway switch which uses this exact spelling).
export class InvalidParamsErrror extends BrokerHttpError { }
