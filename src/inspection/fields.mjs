/**
 * Field extraction: what the model is asked to produce, and a deterministic reference reader.
 *
 * An extraction is plain data: for each document, each field is `{ value, cite }` where `cite`
 * names the document, page and line the value was read from, or `null` when the field is absent.
 * The model's draft verdict rides along as evidence; nothing downstream acts on it.
 *
 * `readFields()` is the reference reader. It is how the authored replay fixtures were produced,
 * and it is what an honest extraction of these synthetic layouts looks like. Live model
 * extractions are checked against the same citation rules, never against this reader.
 */

export const CHEM_ELEMENTS = ['C', 'Mn', 'P', 'S', 'Si', 'Cr', 'Mo'];
export const MECH_FIELDS = {
  tensile_ksi: /^Tensile strength:\s*([\d.]+)\s*ksi$/i,
  yield_ksi: /^Yield strength(?: \(0\.2% offset\))?:\s*([\d.]+)\s*ksi$/i,
  elongation_pct: /^Elongation(?: in 2 in)?:\s*([\d.]+)\s*%$/i,
  hardness_hb: /^Hardness:\s*([\d.]+)\s*HB$/i,
};

const cite = (doc, line) => ({ doc, page: line.page, line: line.line });

/** Read one document's visible lines into fields. Hidden lines are never read as data. */
export function readFields(doc, lines) {
  const visible = lines.filter((l) => !l.hidden);
  const fields = { heat_number: null, spec_id: null, spec_revision: null, signatory: null };
  if (doc === 'mtr') {
    fields.chemistry = Object.fromEntries(CHEM_ELEMENTS.map((el) => [el, null]));
    fields.mechanical = Object.fromEntries(Object.keys(MECH_FIELDS).map((k) => [k, null]));
  } else {
    fields.customer_po = null;
  }
  visible.forEach((line, i) => {
    let m;
    if ((m = line.text.match(/^Heat No:\s*(\S+)$/))) fields.heat_number = { value: m[1], cite: cite(doc, line) };
    if ((m = line.text.match(/^Specification:\s*(\S+)\s+Rev\s+(\S+)$/))) {
      fields.spec_id = { value: m[1], cite: cite(doc, line) };
      fields.spec_revision = { value: m[2], cite: cite(doc, line) };
    }
    if ((m = line.text.match(/^Signed:\s*(.+)$/))) fields.signatory = { value: m[1], cite: cite(doc, line) };
    if (doc === 'coc' && (m = line.text.match(/^Customer PO:\s*(PO-\d+)/))) fields.customer_po = { value: m[1], cite: cite(doc, line) };
    if (doc === 'mtr') {
      const header = line.text.split(/\s+/);
      if (header.length === CHEM_ELEMENTS.length && header.every((h, k) => h === CHEM_ELEMENTS[k]) && visible[i + 1]) {
        const values = visible[i + 1].text.split(/\s+/).map(Number);
        CHEM_ELEMENTS.forEach((el, k) => { if (Number.isFinite(values[k])) fields.chemistry[el] = { value: values[k], cite: cite(doc, visible[i + 1]) }; });
      }
      for (const [key, re] of Object.entries(MECH_FIELDS)) {
        if ((m = line.text.match(re))) fields.mechanical[key] = { value: Number(m[1]), cite: cite(doc, line) };
      }
    }
  });
  return fields;
}
