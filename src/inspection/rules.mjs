/**
 * The rules: the specification decides, from admitted evidence only.
 *
 * Input is the PO line, the spec table, the admitted (citation-checked) fields and the statements
 * found. Output is one finding per rule, each `{ rule, status, reason, cites }`, and the verdict:
 *
 *   NONCONFORMING  a value is present and outside its limit, or the revision is wrong
 *   INCOMPLETE     something the spec requires is absent or does not trace
 *   ACCEPT         every rule passes
 *
 * NONCONFORMING outranks INCOMPLETE: a packet that is both out of range and missing a test is
 * nonconforming, and the missing test is still listed.
 */

const pass = (rule, reason, cites = []) => ({ rule, status: 'pass', reason, cites });
const fail = (rule, reason, cites = []) => ({ rule, status: 'fail', reason, cites });
const missing = (rule, reason, cites = []) => ({ rule, status: 'missing', reason, cites });
const citeOf = (field) => (field?.cite ? [field.cite] : []);

const REQUIRED_TEST_FIELDS = {
  chemistry: (mtr) => Object.values(mtr.chemistry ?? {}),
  tensile: (mtr) => [mtr.mechanical?.tensile_ksi, mtr.mechanical?.yield_ksi, mtr.mechanical?.elongation_pct],
  hardness: (mtr) => [mtr.mechanical?.hardness_hb],
};

function inRange(value, { min, max }) {
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}
const limitText = ({ min, max }) => [min !== undefined ? `min ${min}` : null, max !== undefined ? `max ${max}` : null].filter(Boolean).join(', ');

export function evaluate({ po, spec, admitted, statements }) {
  const mtr = admitted.mtr ?? {};
  const coc = admitted.coc ?? {};
  const findings = [];

  // Required tests: every field a required test produces must be present and cited.
  for (const test of spec.required_tests) {
    const fields = REQUIRED_TEST_FIELDS[test]?.(mtr) ?? [];
    const absent = fields.length === 0 || fields.some((f) => f === null || f === undefined);
    findings.push(absent
      ? missing(`required-test-missing:${test}`, `The specification requires a ${test} result and the mill test report has none that its pages support.`)
      : pass(`required-test-present:${test}`, `${test} results are present and cited.`, fields.flatMap(citeOf)));
  }

  // Chemistry and mechanical limits, for every value that is present.
  for (const [el, limit] of Object.entries(spec.chemistry_wt_pct)) {
    const f = mtr.chemistry?.[el];
    if (!f) continue;
    findings.push(inRange(f.value, limit)
      ? pass(`chemistry-in-range:${el}`, `${el} ${f.value} wt% within ${limitText(limit)}.`, citeOf(f))
      : fail(`chemistry-out-of-range:${el}`, `${el} ${f.value} wt% is outside ${limitText(limit)}.`, citeOf(f)));
  }
  for (const [key, limit] of Object.entries(spec.mechanical)) {
    const f = mtr.mechanical?.[key];
    if (!f) continue;
    findings.push(inRange(f.value, limit)
      ? pass(`mechanical-in-range:${key}`, `${key} ${f.value} within ${limitText(limit)}.`, citeOf(f))
      : fail(`mechanical-out-of-range:${key}`, `${key} ${f.value} is outside ${limitText(limit)}.`, citeOf(f)));
  }

  // Specification and revision on both certificates must match the PO.
  for (const [name, doc] of [['mtr', mtr], ['coc', coc]]) {
    if (!doc.spec_id || !doc.spec_revision) {
      findings.push(missing(`spec-revision-missing:${name}`, `The ${name} does not state the specification and revision.`));
    } else if (doc.spec_id.value !== po.spec || doc.spec_revision.value !== po.spec_revision) {
      findings.push(fail('spec-revision-mismatch', `The ${name} certifies ${doc.spec_id.value} Rev ${doc.spec_revision.value}; the PO requires ${po.spec} Rev ${po.spec_revision}.`, citeOf(doc.spec_revision)));
    } else {
      findings.push(pass(`spec-revision-match:${name}`, `The ${name} certifies ${po.spec} Rev ${po.spec_revision}, as the PO requires.`, citeOf(doc.spec_revision)));
    }
  }

  // Traceability: PO -> certificate of conformance -> mill heat.
  if (!coc.customer_po || coc.customer_po.value !== po.po) {
    findings.push(missing('po-traceability-broken', `The certificate of conformance does not cite PO ${po.po}.`, citeOf(coc.customer_po)));
  } else if (!mtr.heat_number || !coc.heat_number) {
    findings.push(missing('heat-traceability-broken', 'A heat number is missing from the certificate of conformance or the mill test report.', [...citeOf(mtr.heat_number), ...citeOf(coc.heat_number)]));
  } else if (mtr.heat_number.value !== coc.heat_number.value) {
    findings.push(missing('heat-traceability-broken', `The certificate of conformance names heat ${coc.heat_number.value}; the mill test report is for heat ${mtr.heat_number.value}.`, [...citeOf(coc.heat_number), ...citeOf(mtr.heat_number)]));
  } else {
    findings.push(pass('heat-traceability', `PO ${po.po} → CoC → heat ${mtr.heat_number.value} on the mill test report.`, [...citeOf(coc.customer_po), ...citeOf(coc.heat_number), ...citeOf(mtr.heat_number)]));
  }

  // Required statements.
  for (const required of spec.required_statements) {
    const id = required.id;
    let cites = null;
    if (id === 'heat-traceability') cites = mtr.heat_number && coc.heat_number ? [mtr.heat_number.cite, coc.heat_number.cite] : null;
    else if (id === 'spec-and-revision') cites = mtr.spec_revision && coc.spec_revision ? [mtr.spec_revision.cite, coc.spec_revision.cite] : null;
    else if (id === 'conformance-signature') cites = mtr.signatory && coc.signatory ? [mtr.signatory.cite, coc.signatory.cite] : null;
    else cites = statements[id] ? [statements[id]] : null;
    findings.push(cites
      ? pass(`required-statement-present:${id}`, required.description, cites)
      : missing(`required-statement-missing:${id}`, `Required: ${required.description.charAt(0).toLowerCase()}${required.description.slice(1)}. Not found on any visible line.`));
  }

  const failed = findings.filter((f) => f.status === 'fail');
  const absent = findings.filter((f) => f.status === 'missing');
  const verdict = failed.length ? 'NONCONFORMING' : absent.length ? 'INCOMPLETE' : 'ACCEPT';
  return { verdict, reasons: [...new Set([...failed, ...absent].map((f) => f.rule))], findings };
}
