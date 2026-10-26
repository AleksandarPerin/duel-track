import { afterEach, describe, it, expect, vi } from 'vitest';
import PDFDocument from 'pdfkit';
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

  it('embeds the Unicode font, so non-Latin (Cyrillic) names render instead of blanks', async () => {
    // pdfkit's standard fonts don't throw on Cyrillic — they render blank
    // glyphs — so not throwing proves nothing. The embedded font's name in
    // the (uncompressed) font dictionary does.
    const cyrillic = await buildPairingsPdf(
      { round_number: 1 },
      [pairing({ player1_name: 'Владимир', player2_name: 'Ольга' })],
    );
    expect(cyrillic.toString('latin1')).toMatch(/\/BaseFont \/[A-Z]{6}\+DejaVuSans/);
  });

  it('produces a larger document for more pairings', async () => {
    const one = await buildPairingsPdf({ round_number: 1 }, [pairing()]);
    const many = await buildPairingsPdf(
      { round_number: 1 },
      Array.from({ length: 50 }, (_, i) => pairing({ id: `p${i}`, table_number: i + 1 })),
    );
    expect(many.length).toBeGreaterThan(one.length);
  });

  describe('content', () => {
    afterEach(() => vi.restoreAllMocks());
    // The text is stored as font glyph codes in compressed streams, so this
    // checks what is handed to pdfkit rather than parsing the PDF.
    async function linesOf(pairings: PairingRow[]): Promise<string> {
      const text = vi.spyOn(PDFDocument.prototype, 'text');
      await buildPairingsPdf({ round_number: 4 }, pairings);
      return text.mock.calls.map((c) => String(c[0])).join('|');
    }

    it('titles the sheet with the round number', async () => {
      expect(await linesOf([])).toContain('Round 4 Pairings');
    });

    it('lists each table with both player names', async () => {
      const out = await linesOf([pairing({ table_number: 7, player1_name: 'Владимир', player2_name: 'Ольга' })]);
      expect(out).toContain('Table 7|  Владимир  vs  Ольга');
    });

    it('labels a bye as BYE', async () => {
      const out = await linesOf([pairing({ table_number: 3, is_bye: true, player2_id: null, player2_name: null })]);
      expect(out).toContain('Table 3|  Alice  vs  BYE');
    });
  });
});
