/**
 * The PDF text layer as numbered lines: the unit every citation points at.
 *
 * Each line carries its page, 1-based line number, text, bounding box (PDF points, origin bottom
 * left), font size, and sha256 of its text. A line is flagged `hidden` when it is in the text
 * layer an extractor reads but a reader cannot see it: set in a font smaller than HIDDEN_FONT_PT,
 * or hidden any other way subtext-scan detects (colour against what is behind it, off the page,
 * covered or clipped, invisible render mode, transparent, or in a layer that is switched off).
 */
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { scan } from 'subtext-scan';

export const HIDDEN_FONT_PT = 3;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Boxes of text a reader cannot see, by page. */
async function unseenBoxes(bytes) {
  const { findings } = await scan(new Uint8Array(bytes), { format: 'pdf', minFontPt: HIDDEN_FONT_PT });
  const byPage = new Map();
  for (const f of findings) {
    if (f.rule !== 'hidden-text' || !f.bbox) continue;
    if (!byPage.has(f.page)) byPage.set(f.page, []);
    byPage.get(f.page).push(f.bbox);
  }
  return byPage;
}

const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);

export async function textLines(bytes) {
  const unseen = await unseenBoxes(bytes);
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
      const bbox = [round(x0), round(yMin), round(last.x + last.width), round(Math.max(...row.parts.map((part) => part.y)) + row.size)];
      // A line is unseen when a hidden run covers at least a quarter of the smaller of the two boxes.
      const covered = (unseen.get(p) ?? []).some((box) => overlap(box, bbox) >= 0.25 * Math.min(area(box), area(bbox) || Infinity));
      lines.push({
        page: p, line: i + 1, text, sha256: sha256(text), bbox,
        font_pt: round(row.size), hidden: row.size < HIDDEN_FONT_PT || covered,
      });
    });
  }
  await task.destroy();
  return lines;
}

const round = (n) => Math.round(n * 100) / 100;
