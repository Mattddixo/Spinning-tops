import type { Params } from '../shared/i18n';
import { appError, type ErrorExtra } from '../shared/messages';
import type { AppError, ErrorCode, Result } from '../shared/types';

// Thrown inside backend code and turned into a Result at the resolver boundary.
export class AppFailure extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'AppFailure';
    this.error = error;
  }

  get code(): ErrorCode {
    return this.error.code;
  }
}

export const fail = (code: ErrorCode, key: string, params?: Params, extra?: ErrorExtra): never => {
  throw new AppFailure(appError(code, key, params, extra));
};

export const failWith = (error: AppError): never => {
  throw new AppFailure(error);
};

// Wraps a resolver so it always returns a Result. Unknown errors get logged
// (without payloads) and shown as a generic message.
export async function asResult<T>(name: string, body: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await body() };
  } catch (err) {
    if (err instanceof AppFailure) return { ok: false, error: err.error };
    console.error(`[${name}] unexpected error: ${err instanceof Error ? `${err.name}: ${err.message}` : 'unknown'}`);
    return { ok: false, error: appError('INTERNAL', 'errors.generic') };
  }
}
