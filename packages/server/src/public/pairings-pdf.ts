import PDFDocument from 'pdfkit';
import path from 'node:path';

// pdfkit's built-in standard fonts only support WinAnsi (Latin-1-ish) encoding —
// any other character silently renders as a blank glyph. DejaVu Sans adds
// Latin Extended, Cyrillic, Greek, and several other alphabetic scripts.
// It does not cover CJK or Arabic — those need a much larger CJK font plus
// (for Arabic) bidi/shaping support pdfkit doesn't have; out of scope here.
const UNICODE_FONT = path.join(__dirname, '../../assets/fonts/DejaVuSans.ttf');

export interface PairingRow {
  id: string;
  table_number: number;
  is_bye: boolean;
  player1_id: string;
  player1_name: string;
  player2_id: string | null;
  player2_name: string | null;
}

export interface PairingsPdfRound {
  round_number: number;
}

export function buildPairingsPdf(round: PairingsPdfRound, pairings: PairingRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font(UNICODE_FONT);
    doc.fontSize(18).text(`Round ${round.round_number} Pairings`, { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(11);
    for (const p of pairings) {
      const opponent = p.is_bye ? 'BYE' : (p.player2_name ?? '');
      doc.text(`Table ${p.table_number}`, { continued: true, width: 100 });
      doc.text(`  ${p.player1_name}  vs  ${opponent}`);
    }

    doc.end();
  });
}
