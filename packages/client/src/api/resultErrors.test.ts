import { describe, expect, it } from 'vitest';
import { resultErrorMessage } from './resultErrors';

describe('resultErrorMessage', () => {
  it('turns every code the result endpoint throws into a sentence, never the bare code', () => {
    for (const code of [
      'PAIRING_NOT_FOUND',
      'TOURNAMENT_NOT_IN_PROGRESS',
      'FORBIDDEN',
      'BYE_RESULT',
      'INVALID_ELIMINATION_RESULT',
      'INVALID_BODY',
      'INVALID_PARAMS',
    ]) {
      const msg = resultErrorMessage(code);
      expect(msg).not.toContain(code);
      expect(msg.length).toBeGreaterThan(20);
    }
  });

  it('gives every code its own message, never the generic fallback', () => {
    // The generic text also passes "not the code, over 20 chars", so that
    // check alone can't tell a handled code from a forgotten one.
    const codes = ['PAIRING_NOT_FOUND', 'TOURNAMENT_NOT_IN_PROGRESS', 'FORBIDDEN', 'BYE_RESULT', 'INVALID_ELIMINATION_RESULT'];
    const generic = resultErrorMessage('SOMETHING_NEW');
    const messages = codes.map((c) => resultErrorMessage(c));
    for (const m of messages) expect(m).not.toBe(generic);
    expect(new Set(messages).size).toBe(codes.length);
    // INVALID_BODY and INVALID_PARAMS deliberately share one message.
    expect(resultErrorMessage('INVALID_BODY')).not.toBe(generic);
    expect(resultErrorMessage('INVALID_PARAMS')).toBe(resultErrorMessage('INVALID_BODY'));
  });

  it('says to wait on rate limiting, whatever the code', () => {
    expect(resultErrorMessage('REQUEST_ERROR', 429)).toMatch(/wait a minute/);
  });

  it('says to refresh on a stale CSRF token', () => {
    expect(resultErrorMessage('FST_CSRF_INVALID_TOKEN', 403)).toMatch(/refresh the page/i);
  });

  it('falls back to a generic retry message for unknown or missing codes', () => {
    expect(resultErrorMessage('SOMETHING_NEW')).toBe('Failed to record the result. Please try again.');
    expect(resultErrorMessage(undefined)).toBe('Failed to record the result. Please try again.');
  });
});
