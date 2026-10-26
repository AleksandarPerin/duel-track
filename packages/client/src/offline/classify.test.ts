import { describe, expect, it } from 'vitest';
import { classifySyncAttempt } from './classify';
import { RESULT_ALREADY_RECORDED_MESSAGE, resultErrorMessage } from '../api/resultErrors';

describe('classifySyncAttempt', () => {
  it('classifies a thrown fetch (network failure) as retry-later', () => {
    expect(classifySyncAttempt({ threw: true })).toEqual({ kind: 'retry-later' });
  });

  it('classifies 2xx as success', () => {
    expect(classifySyncAttempt({ threw: false, status: 200 })).toEqual({ kind: 'success' });
    expect(classifySyncAttempt({ threw: false, status: 201 })).toEqual({ kind: 'success' });
    expect(classifySyncAttempt({ threw: false, status: 299 })).toEqual({ kind: 'success' });
  });

  it('classifies 401 as auth-required', () => {
    expect(classifySyncAttempt({ threw: false, status: 401 })).toEqual({ kind: 'auth-required' });
  });

  it('classifies 409 RESULT_ALREADY_ENTERED as conflict', () => {
    const result = classifySyncAttempt({ threw: false, status: 409, errorCode: 'RESULT_ALREADY_ENTERED' });
    expect(result.kind).toBe('conflict');
  });

  it('classifies a 409 with a different error code as rejected, not conflict', () => {
    const result = classifySyncAttempt({ threw: false, status: 409, errorCode: 'SOME_OTHER_CONFLICT' });
    expect(result.kind).toBe('rejected');
  });

  it('classifies other 4xx as rejected, with a readable reason instead of the raw code', () => {
    expect(classifySyncAttempt({ threw: false, status: 400, errorCode: 'INVALID_BODY' })).toEqual({
      kind: 'rejected',
      reason: resultErrorMessage('INVALID_BODY', 400),
    });
    expect(classifySyncAttempt({ threw: false, status: 403, errorCode: 'FORBIDDEN' })).toEqual({
      kind: 'rejected',
      reason: resultErrorMessage('FORBIDDEN', 403),
    });
    const noCode = classifySyncAttempt({ threw: false, status: 422 });
    expect(noCode).toEqual({ kind: 'rejected', reason: resultErrorMessage(undefined, 422) });
    if (noCode.kind === 'rejected') expect(noCode.reason).not.toMatch(/^[A-Z_]+$/);
  });

  it('treats rate limiting (429) as transient, not a rejection', () => {
    expect(classifySyncAttempt({ threw: false, status: 429, errorCode: 'REQUEST_ERROR' })).toEqual({ kind: 'retry-later' });
  });

  it('treats a stale CSRF token (403 FST_CSRF_*) as transient', () => {
    expect(classifySyncAttempt({ threw: false, status: 403, errorCode: 'FST_CSRF_INVALID_TOKEN' })).toEqual({
      kind: 'retry-later',
    });
    expect(classifySyncAttempt({ threw: false, status: 403, errorCode: 'FST_CSRF_MISSING_SECRET' })).toEqual({
      kind: 'retry-later',
    });
  });

  it("describes an already-recorded result neutrally (often the judge's own lost response)", () => {
    const result = classifySyncAttempt({ threw: false, status: 409, errorCode: 'RESULT_ALREADY_ENTERED' });
    expect(result).toEqual({ kind: 'conflict', reason: RESULT_ALREADY_RECORDED_MESSAGE });
    if (result.kind === 'conflict') expect(result.reason).not.toMatch(/someone else/i);
  });

  it('classifies 5xx as retry-later (transient)', () => {
    expect(classifySyncAttempt({ threw: false, status: 500 })).toEqual({ kind: 'retry-later' });
    expect(classifySyncAttempt({ threw: false, status: 503 })).toEqual({ kind: 'retry-later' });
  });
});
