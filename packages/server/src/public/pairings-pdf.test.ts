import { describe, it, expect } from 'vitest';
import { buildPairingsPdf } from './pairings-pdf';
import type { PairingRow } from './pairings-pdf';

function pairing(overrides: Partial<PairingRow> = {}): PairingRow {
  return {
    id: 'p1',
    table_number: 1,
    is_bye: false,
    player1_id: 'a1',
    player1_name: 'Alice',
    player2_id: 'a2',
    player2_name: 'Bob',
    ...overrides,
  };
}

describe('buildPairingsPdf', () => {
  it('produces a well-formed PDF buffer', async () => {
    const pdf = await buildPairingsPdf({ round_number: 3 }, [pairing()]);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('ascii').trim()).toBe('%%EOF');
  });

  it('handles a bye pairing without a second player', async () => {
    const pdf = await buildPairingsPdf(
      { round_number: 1 },
      [pairing({ is_bye: true, player2_id: null, player2_name: null })],
    );
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles an empty pairings list', async () => {
    const pdf = await buildPairingsPdf({ round_number: 1 }, []);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles non-Latin (Cyrillic) player names without throwing', async () => {
    const pdf = await buildPairingsPdf(
      { round_number: 1 },
      [pairing({ player1_name: 'Владимир', player2_name: 'Ольга' })],
    );
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('produces a larger document for more pairings', async () => {
    const one = await buildPairingsPdf({ round_number: 1 }, [pairing()]);
    const many = await buildPairingsPdf(
      { round_number: 1 },
      Array.from({ length: 50 }, (_, i) => pairing({ id: `p${i}`, table_number: i + 1 })),
    );
    expect(many.length).toBeGreaterThan(one.length);
  });
});
