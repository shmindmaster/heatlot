/**
 * The PDF text layer as numbered lines: the unit every citation points at.
 *
 * Each line carries its page, 1-based line number, text, bounding box (PDF points, origin bottom
 * left), font size, and sha256 of its text. A line set in a font smaller than HIDDEN_FONT_PT is
 * flagged `hidden`: it is in the text layer an extractor reads but not legible on the page.
 */
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const HIDDEN_FONT_PT = 3;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export async function textLines(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    // Distance along the page's "up" axis, measured perpendicular to each item's baseline, so a
    // skewed scan still groups into lines. Items within 40% of a font height share a line.
    const placed = [];
    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;
      const [a, b, , d, x, y] = item.transform;
      const size = Math.hypot(a, b) || Math.abs(d);
      const theta = Math.atan2(b, a);
      placed.push({ str: item.str, width: item.width, size, x, y, along: x * Math.cos(theta) + y * Math.sin(theta), up: -x * Math.sin(theta) + y * Math.cos(theta) });
    }
    placed.sort((u, v) => v.up - u.up);
    const ordered = [];
    for (const part of placed) {
      const row = ordered.at(-1);
      if (row && Math.abs(row.up - part.up) <= 0.4 * Math.max(row.size, part.size)) {
        row.parts.push(part);
        row.size = Math.max(row.size, part.size);
      } else {
        ordered.push({ up: part.up, y: part.y, size: part.size, parts: [part] });
      }
    }
    ordered.forEach((row, i) => {
      row.parts.sort((u, v) => u.along - v.along);
      const text = row.parts.map((part) => part.str).join(' ').replace(/\s+/g, ' ').trim();
      const x0 = Math.min(...row.parts.map((part) => part.x));
      const last = row.parts.reduce((m, part) => (part.x + part.width > m.x + m.width ? part : m));
      const yMin = Math.min(...row.parts.map((part) => part.y));
      lines.push({
        page: p, line: i + 1, text, sha256: sha256(text),
        bbox: [round(x0), round(yMin), round(last.x + last.width), round(Math.max(...row.parts.map((part) => part.y)) + row.size)],
        font_pt: round(row.size), hidden: row.size < HIDDEN_FONT_PT,
      });
    });
  }
  await task.destroy();
  return lines;
}

const round = (n) => Math.round(n * 100) / 100;
