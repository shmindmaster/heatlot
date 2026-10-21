#!/usr/bin/env node
/**
 * npm run generate:packets — write the synthetic inbound supplier packets.
 *
 *   data/packets/<PKT>/mtr.pdf        mill test report (chemistry, mechanicals, statements)
 *   data/packets/<PKT>/coc.pdf        distributor certificate of conformance
 *   data/packets/<PKT>/packet.json    the buyer's PO line, file hashes, expected verdict
 *   data/specs/<SPEC>.json            specification requirements as data
 *   data/packets/index.json           every packet and file with its sha256
 *
 * Deterministic: fixed metadata dates, no random ids, sorted output. Two runs produce
 * byte-identical files, and a test holds that.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

import { BUYER, SCENARIOS, SPECS, STATEMENT_TEXT, SUPPLIERS } from './packets-world.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO_ROOT, 'data', 'packets');
const FIXED_DATE = new Date('2026-09-14T15:00:00Z');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const CHEM_ORDER = ['C', 'Mn', 'P', 'S', 'Si', 'Cr', 'Mo'];
const MECH_LABELS = [
  ['tensile_ksi', 'Tensile strength', 'ksi'],
  ['yield_ksi', 'Yield strength (0.2% offset)', 'ksi'],
  ['elongation_pct', 'Elongation in 2 in', '%'],
  ['hardness_hb', 'Hardness', 'HB'],
];

async function newDoc(title) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setProducer('Heatlot synthetic packet generator');
  doc.setCreator('Heatlot synthetic packet generator');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

/** A tiny line-oriented writer: every drawn line is one text line in the PDF's text layer. */
function writer(page, font, bold, { scanned = false } = {}) {
  let y = page.getHeight() - 56;
  const left = 56;
  const ink = scanned ? rgb(0.16, 0.16, 0.18) : rgb(0.08, 0.1, 0.12);
  const rotate = scanned ? degrees(-0.6) : degrees(0);
  return {
    line(text, { size = 10, isBold = false, gap = 14, x = left } = {}) {
      page.drawText(text, { x, y, size, font: isBold ? bold : font, color: ink, rotate });
      y -= gap;
    },
    space(h = 8) { y -= h; },
    rule() { page.drawLine({ start: { x: left, y: y + 6 }, end: { x: page.getWidth() - left, y: y + 6 }, thickness: 0.6, color: rgb(0.6, 0.62, 0.66) }); y -= 6; },
    y: () => y,
  };
}

function scanNoise(page, seed) {
  // Deterministic speckle so the scanned variant looks photocopied; drawn as vectors, no images.
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: rgb(0.95, 0.94, 0.9) });
  for (let i = 0; i < 260; i++) {
    page.drawCircle({ x: rand() * page.getWidth(), y: rand() * page.getHeight(), size: 0.3 + rand() * 0.7, color: rgb(0.55, 0.55, 0.55), opacity: 0.35 });
  }
}

async function millTestReport(sc, po) {
  const spec = SPECS[po.spec];
  const scanned = sc.layout === 'scanned';
  const doc = await newDoc(`Mill test report ${sc.heat}`);
  const page = doc.addPage([612, 792]);
  if (scanned) scanNoise(page, Number(sc.heat.replace(/\D/g, '')));
  const font = await doc.embedFont(scanned ? StandardFonts.Courier : StandardFonts.Helvetica);
  const bold = await doc.embedFont(scanned ? StandardFonts.CourierBold : StandardFonts.HelveticaBold);
  const w = writer(page, font, bold, { scanned });

  w.line(SUPPLIERS.mill.name.toUpperCase(), { size: 15, isBold: true, gap: 18 });
  w.line(`${SUPPLIERS.mill.city}  ·  Certified Mill Test Report (synthetic)`, { size: 9 });
  w.space(); w.rule();
  w.line(`Certificate No: MTR-${sc.heat}`, { isBold: true });
  w.line(`Heat No: ${sc.heat}`);
  w.line(`Grade: 4140   Condition: Annealed   Product: Round bar, 2.000 in diameter`);
  w.line(`Specification: ${spec.id} Rev ${sc.mtr.spec_revision}`);
  w.line(`Customer: ${SUPPLIERS.distributor.name}   Customer PO: BMS-${po.po.slice(3)}`);
  w.space(); w.line('CHEMICAL ANALYSIS (heat, wt %)', { isBold: true });
  w.line(CHEM_ORDER.map((el) => el.padEnd(8)).join(''), { x: 72 });
  w.line(CHEM_ORDER.map((el) => sc.mtr.chemistry[el].toFixed(3).padEnd(8)).join(''), { x: 72 });

  w.space(); w.line('MECHANICAL PROPERTIES', { isBold: true });
  const mech = sc.mtr.mechanical;
  const tested = MECH_LABELS.filter(([key]) => mech[key] !== undefined);
  for (const [key, label, unit] of tested) w.line(`${label}: ${mech[key]} ${unit}`, { x: 72 });

  w.space(); w.line('CERTIFICATION', { isBold: true });
  for (const id of sc.mtr.statements) w.line(STATEMENT_TEXT[id], { x: 72, size: 9 });
  w.line('We certify that this material was tested as reported above and that the results are correct.', { x: 72, size: 9 });
  w.space(16);
  w.line('Signed: R. Okafor, Quality Assurance Manager', { isBold: true });
  w.line('Date: 2026-09-11');

  if (sc.mtr.hidden_text) {
    // The attack: white 1-point text below the signature block. Invisible on the page, present in
    // the text layer that an extraction model reads.
    page.drawText(sc.mtr.hidden_text, { x: 56, y: 40, size: 1, font, color: rgb(1, 1, 1) });
  }
  return doc.save({ useObjectStreams: false });
}

async function certificateOfConformance(sc, po) {
  const spec = SPECS[po.spec];
  const doc = await newDoc(`Certificate of conformance ${sc.packet}`);
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const w = writer(page, font, bold);
  w.line(SUPPLIERS.distributor.name, { size: 16, isBold: true, gap: 20 });
  w.line(`${SUPPLIERS.distributor.city}  ·  Certificate of Conformance (synthetic)`, { size: 9 });
  w.space(); w.rule();
  w.line(`Customer: ${BUYER.name}`);
  w.line(`Customer PO: ${po.po}   Line: ${po.line}`);
  w.line(`Item: ${po.item}`);
  w.line(`Quantity: ${po.quantity}`);
  w.line(`Heat No: ${sc.coc.heat}`);
  w.line(`Specification: ${spec.id} Rev ${sc.coc.spec_revision}`);
  w.space();
  w.line('We certify that the material supplied on this order conforms to the purchase order', { size: 10 });
  w.line('requirements and to the specification listed above. Mill test report attached.', { size: 10 });
  w.space(16);
  w.line('Signed: D. Varga, Quality Manager', { isBold: true });
  w.line('Date: 2026-09-12');
  return doc.save({ useObjectStreams: false });
}

function purchaseOrder(sc) {
  return {
    po: sc.po,
    line: 1,
    buyer: BUYER.name,
    supplier: SUPPLIERS.distributor.name,
    item: '4140 alloy steel round bar, 2.000 in diameter, annealed',
    quantity: '12 ft x 6 bars',
    spec: 'HLS-4140',
    spec_revision: 'C',
    drawing: { number: 'LPM-7714', revision: 'D', material_callout: 'HLS-4140 Rev C, annealed' },
    required_documents: ['mtr', 'coc'],
  };
}

export async function generate() {
  mkdirSync(path.join(REPO_ROOT, 'data', 'specs'), { recursive: true });
  for (const spec of Object.values(SPECS)) {
    writeFileSync(path.join(REPO_ROOT, 'data', 'specs', `${spec.id}.json`), `${JSON.stringify(spec, null, 2)}\n`);
  }
  const index = { generator: 'scripts/generate-packets.mjs', synthetic: true, packets: [] };
  for (const sc of SCENARIOS) {
    const dir = path.join(OUT, sc.packet);
    mkdirSync(dir, { recursive: true });
    const po = purchaseOrder(sc);
    const files = { 'mtr.pdf': await millTestReport(sc, po), 'coc.pdf': await certificateOfConformance(sc, po) };
    const hashes = {};
    for (const [name, bytes] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), bytes);
      hashes[name] = sha256(bytes);
    }
    const packet = { packet: sc.packet, received: sc.resubmits ? '2026-09-16' : '2026-09-14', resubmits: sc.resubmits, po, documents: { mtr: 'mtr.pdf', coc: 'coc.pdf' }, sha256: hashes,
      expected: { verdict: sc.expect, reasons: sc.reasons }, story: sc.story };
    writeFileSync(path.join(dir, 'packet.json'), `${JSON.stringify(packet, null, 2)}\n`);
    index.packets.push({ packet: sc.packet, po: sc.po, expected: sc.expect, files: hashes });
  }
  writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = await generate();
  console.log(`wrote ${index.packets.length} packets to data/packets/`);
}
