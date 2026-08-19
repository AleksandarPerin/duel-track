import { describe, it, expect } from 'vitest';
import { CreateApiTokenSchema } from './api-tokens.schemas';

describe('CreateApiTokenSchema', () => {
  it('accepts a normal label', () => {
    const result = CreateApiTokenSchema.safeParse({ label: 'CI integration' });
    expect(result.success).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const result = CreateApiTokenSchema.safeParse({ label: '  spaced  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.label).toBe('spaced');
  });

  it('rejects an empty label', () => {
    expect(CreateApiTokenSchema.safeParse({ label: '' }).success).toBe(false);
  });

  it('rejects a label that is only whitespace', () => {
    expect(CreateApiTokenSchema.safeParse({ label: '   ' }).success).toBe(false);
  });

  it('accepts a label at exactly 100 characters', () => {
    const label = 'a'.repeat(100);
    expect(CreateApiTokenSchema.safeParse({ label }).success).toBe(true);
  });

  it('rejects a label over 100 characters', () => {
    const label = 'a'.repeat(101);
    expect(CreateApiTokenSchema.safeParse({ label }).success).toBe(false);
  });

  it('rejects a missing label', () => {
    expect(CreateApiTokenSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-string label', () => {
    expect(CreateApiTokenSchema.safeParse({ label: 123 }).success).toBe(false);
  });
});
