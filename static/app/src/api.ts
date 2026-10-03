import { makeInvoke } from '@forge/bridge';
import type { Defs } from '../../../src/shared/defs';
import { appError } from '../../../src/shared/messages';
import type { AppError, Result } from '../../../src/shared/types';

export const invoke = makeInvoke<Defs>();

export class RequestFailed extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'RequestFailed';
    this.error = error;
  }
}

export async function call<T>(promise: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await promise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const rateLimited = /429|rate limit/i.test(message);
    throw new RequestFailed(
      rateLimited
        ? appError('UPSTREAM_ERROR', 'errors.rateLimited', undefined, { detail: message })
        : appError('INTERNAL', 'errors.backendUnreachable', undefined, { detail: message }),
    );
  }
  if (!result || typeof result !== 'object') throw new RequestFailed(appError('INTERNAL', 'errors.unexpectedResponse'));
  if (!result.ok) throw new RequestFailed(result.error);
  return result.value;
}

/**
 * Errors only an admin can fix, shown to readers as a plain "not available".
 * Editors (and the settings preview) still get the full message and hint.
 * The view decides who's editing for display only; nothing here is a check.
 */
const SETUP_ERRORS = new Set(['errors.hostsNotSynced']);

export function forReaders(error: AppError, showSetupErrors: boolean, fallbackKey: 'errors.docsUnavailable' | 'errors.tryItOutUnavailable'): AppError {
  if (showSetupErrors || !error.key || !SETUP_ERRORS.has(error.key)) return error;
  return appError(error.code, fallbackKey);
}

export const toAppError = (err: unknown): AppError =>
  err instanceof RequestFailed ? err.error : appError('INTERNAL', 'errors.generic', undefined, { detail: err instanceof Error ? err.message : String(err) });
