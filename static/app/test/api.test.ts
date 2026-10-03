import { describe, expect, it, vi } from 'vitest';
import { appError } from '../../../src/shared/messages';
import { call, forReaders, RequestFailed, toAppError } from '../src/api';

vi.mock('@forge/bridge', () => ({ makeInvoke: () => vi.fn() }));

describe('call', () => {
  it('unwraps ok results and throws the backend error otherwise', async () => {
    await expect(call(Promise.resolve({ ok: true, value: 42 }))).resolves.toBe(42);
    const error = appError('NOT_FOUND', 'errors.generic');
    await expect(call(Promise.resolve({ ok: false, error }))).rejects.toMatchObject({ error });
  });

  it('turns bridge failures into errors readers can act on', async () => {
    await expect(call(Promise.reject(new Error('HTTP 429')))).rejects.toMatchObject({ error: { key: 'errors.rateLimited' } });
    await expect(call(Promise.reject(new Error('socket hang up')))).rejects.toMatchObject({ error: { key: 'errors.backendUnreachable' } });
    await expect(call(Promise.resolve(undefined as never))).rejects.toMatchObject({ error: { key: 'errors.unexpectedResponse' } });
  });
});

describe('toAppError', () => {
  it('keeps backend errors and wraps anything else', () => {
    const error = appError('NOT_FOUND', 'errors.generic');
    expect(toAppError(new RequestFailed(error))).toBe(error);
    expect(toAppError(new Error('boom'))).toMatchObject({ code: 'INTERNAL', key: 'errors.generic', detail: 'boom' });
  });
});

describe('forReaders', () => {
  const setup = appError('EGRESS_NOT_APPROVED', 'errors.hostsNotSynced', undefined, { hint: 'hints.openSettingsToSync' });

  it('hides admin-only setup errors from readers', () => {
    expect(forReaders(setup, false, 'errors.docsUnavailable')).toEqual(appError('EGRESS_NOT_APPROVED', 'errors.docsUnavailable'));
    expect(forReaders(setup, false, 'errors.tryItOutUnavailable').key).toBe('errors.tryItOutUnavailable');
  });

  it('shows editors the full error, and leaves other errors alone', () => {
    expect(forReaders(setup, true, 'errors.docsUnavailable')).toBe(setup);
    const other = appError('NOT_FOUND', 'errors.generic');
    expect(forReaders(other, false, 'errors.docsUnavailable')).toBe(other);
  });
});
