import { describe, expect, it } from 'vitest';
import { classifySyncAttempt } from './classify';

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

  it('classifies other 4xx as rejected', () => {
    expect(classifySyncAttempt({ threw: false, status: 400, errorCode: 'INVALID_BODY' })).toEqual({
      kind: 'rejected',
      reason: 'INVALID_BODY',
    });
    expect(classifySyncAttempt({ threw: false, status: 403, errorCode: 'FORBIDDEN' })).toEqual({
      kind: 'rejected',
      reason: 'FORBIDDEN',
    });
    expect(classifySyncAttempt({ threw: false, status: 422 })).toEqual({
      kind: 'rejected',
      reason: 'Request was rejected',
    });
  });

  it('classifies 5xx as retry-later (transient)', () => {
    expect(classifySyncAttempt({ threw: false, status: 500 })).toEqual({ kind: 'retry-later' });
    expect(classifySyncAttempt({ threw: false, status: 503 })).toEqual({ kind: 'retry-later' });
  });
});
