import type { AppError, ErrorCode, Result } from '../shared/types';

/** Thrown inside backend code and converted to a `Result` at the resolver boundary. */
export class AppFailure extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'AppFailure';
    this.code = code;
    this.detail = detail;
  }

  toError(): AppError {
    return this.detail ? { code: this.code, message: this.message, detail: this.detail } : { code: this.code, message: this.message };
  }
}

export const fail = (code: ErrorCode, message: string, detail?: string): never => {
  throw new AppFailure(code, message, detail);
};

// Wraps a resolver so it always returns a Result. Unknown errors get logged
// (without payloads) and shown as a generic message.
export async function asResult<T>(name: string, body: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await body() };
  } catch (err) {
    if (err instanceof AppFailure) return { ok: false, error: err.toError() };
    console.error(`[${name}] unexpected error: ${err instanceof Error ? `${err.name}: ${err.message}` : 'unknown'}`);
    return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
  }
}
