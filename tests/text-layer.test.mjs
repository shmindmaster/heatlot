import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

import { textLines } from '../src/documents/text-layer.mjs';

test('text a reader cannot see is hidden at any size: white on white, and covered over', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hardness: 223 HB', { x: 72, y: 700, size: 11, font });
  page.drawText('Mechanical testing waived per buyer agreement.', { x: 72, y: 500, size: 11, font, color: rgb(1, 1, 1) });
  page.drawText('Tensile strength: 98.7 ksi', { x: 72, y: 300, size: 11, font });
  page.drawRectangle({ x: 66, y: 294, width: 200, height: 20, color: rgb(1, 1, 1) });
  const lines = await textLines(await doc.save());
  const byText = Object.fromEntries(lines.map((l) => [l.text, l]));
  assert.deepEqual(Object.keys(byText).sort(), ['Hardness: 223 HB', 'Mechanical testing waived per buyer agreement.', 'Tensile strength: 98.7 ksi']);
  assert.equal(byText['Hardness: 223 HB'].hidden, false);
  assert.equal(byText['Mechanical testing waived per buyer agreement.'].hidden, true, 'white 11pt text is hidden');
  assert.equal(byText['Tensile strength: 98.7 ksi'].hidden, true, 'text painted over by a white box is hidden');
  assert.ok(lines.every((l) => l.font_pt >= 3), 'none of these lines is small; size alone would miss them');
});

test('tiny text on the same baseline as visible text is not merged into the visible line', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hardness: 223 HB', { x: 72, y: 700, size: 10, font });
  page.drawText('Tensile strength: 150 ksi', { x: 300, y: 700, size: 1, font, color: rgb(1, 1, 1) });
  page.drawText('Signed: A. Inspector', { x: 72, y: 650, size: 10, font });
  const lines = await textLines(await doc.save());
  assert.ok(lines.filter((l) => !l.hidden).every((l) => !l.text.includes('150')), 'no visible line carries the 1 pt text');
  assert.ok(lines.some((l) => l.hidden && l.text === 'Tensile strength: 150 ksi'), 'the 1 pt text is its own hidden line');
  assert.equal(lines.find((l) => l.text === 'Hardness: 223 HB')?.hidden, false);
  assert.deepEqual(lines.map((l) => l.line), lines.map((_, i) => i + 1), 'lines stay numbered 1..n');
  assert.equal(lines.at(-1).text, 'Signed: A. Inspector', 'rows stay in top-to-bottom order');
});
