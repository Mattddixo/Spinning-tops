import { makeInvoke } from '@forge/bridge';
import type { Defs } from '../../../src/shared/defs';
import type { AppError, Result } from '../../../src/shared/types';

/** Type-safe resolver calls shared with the backend definitions. */
export const invoke = makeInvoke<Defs>();

export class RequestFailed extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'RequestFailed';
    this.error = error;
  }
}

/** Unwrap a resolver `Result`, turning platform failures into an `AppError`. */
export async function call<T>(promise: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await promise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const rateLimited = /429|rate limit/i.test(message);
    throw new RequestFailed({
      code: rateLimited ? 'UPSTREAM_ERROR' : 'INTERNAL',
      message: rateLimited ? 'Too many requests right now. Please wait a moment and try again.' : 'SpecPage could not reach its backend. Please reload the page.',
      detail: message,
    });
  }
  if (!result || typeof result !== 'object') {
    throw new RequestFailed({ code: 'INTERNAL', message: 'Unexpected response from the SpecPage backend.' });
  }
  if (!result.ok) throw new RequestFailed(result.error);
  return result.value;
}

export const toAppError = (err: unknown): AppError =>
  err instanceof RequestFailed ? err.error : { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
