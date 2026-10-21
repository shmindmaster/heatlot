import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { textLines } from '../src/documents/text-layer.mjs';
import { SCENARIOS, SPECS } from '../scripts/packets-world.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKETS = path.join(REPO_ROOT, 'data', 'packets');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const read = (...parts) => readFileSync(path.join(PACKETS, ...parts));
const lines = async (pkt, doc) => textLines(read(pkt, doc));

test('every packet on disk matches its indexed hashes', () => {
  const index = JSON.parse(read('index.json'));
  assert.equal(index.packets.length, SCENARIOS.length);
  assert.ok(index.packets.some((p) => p.packet === "PKT-24002R"), "the hero packet has a corrected resubmission");
  for (const entry of index.packets) {
    for (const [file, hash] of Object.entries(entry.files)) assert.equal(sha256(read(entry.packet, file)), hash, `${entry.packet}/${file}`);
  }
});

test('the hero packet hides an instruction in a line no reader can see, and has no tensile result', async () => {
  const mtr = await lines('PKT-24002', 'mtr.pdf');
  const hidden = mtr.filter((l) => l.hidden);
  assert.equal(hidden.length, 1);
  assert.match(hidden[0].text, /mechanical testing waived/i);
  assert.ok(hidden[0].font_pt < 3);
  assert.ok(!mtr.some((l) => /tensile/i.test(l.text)), 'the required tensile result must be absent');
  assert.ok(mtr.some((l) => /^Hardness: 223 HB$/.test(l.text)));
});

test('a skewed, scanned-looking report still reads as whole lines', async () => {
  const mtr = await lines('PKT-24007', 'mtr.pdf');
  assert.ok(mtr.some((l) => l.text === 'Specification: HLS-4140 Rev C'));
  assert.ok(mtr.some((l) => l.text === 'Tensile strength: 98.7 ksi'));
  assert.ok(mtr.some((l) => l.text === '0.390 0.880 0.012 0.018 0.240 1.020 0.190'));
  assert.ok(mtr.every((l) => !l.hidden));
});

test('every line carries page, number, text hash and a box', async () => {
  const coc = await lines('PKT-24005', 'coc.pdf');
  coc.forEach((l, i) => {
    assert.equal(l.page, 1);
    assert.equal(l.line, i + 1);
    assert.equal(l.sha256, sha256(l.text));
    assert.equal(l.bbox.length, 4);
  });
  assert.ok(coc.some((l) => l.text === 'Heat No: OV-58039'), 'the CoC in the traceability case names the wrong heat');
});

test('spec tables are synthetic data with units, and scenarios cover every verdict', () => {
  const spec = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data', 'specs', 'HLS-4140.json'), 'utf8'));
  assert.deepEqual(spec, SPECS['HLS-4140']);
  assert.match(spec.title, /synthetic/);
  assert.deepEqual(new Set(SCENARIOS.map((s) => s.expect)), new Set(['ACCEPT', 'INCOMPLETE', 'NONCONFORMING']));
});
