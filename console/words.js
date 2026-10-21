/**
 * Plain words for machine identifiers: rule ids, refusal rules, receipt kinds, rejection reasons.
 * Anything unknown falls back to the identifier itself, so nothing is ever hidden.
 */

export const DOC_ABBR = { mtr: 'MTR', coc: 'CoC' };
export const DOC_NAME = { mtr: 'Mill test report', coc: 'Certificate of conformance' };

const ELEMENTS = { C: 'Carbon', Mn: 'Manganese', P: 'Phosphorus', S: 'Sulfur', Si: 'Silicon', Cr: 'Chromium', Mo: 'Molybdenum', Ni: 'Nickel', V: 'Vanadium', Cu: 'Copper' };
const MECHANICAL = { tensile_ksi: 'Tensile strength', yield_ksi: 'Yield strength', elongation_pct: 'Elongation', hardness_hb: 'Hardness (HB)', reduction_of_area_pct: 'Reduction of area' };
const TESTS = { chemistry: 'Chemistry', tensile: 'Tensile', hardness: 'Hardness' };
const STATEMENTS = {
  'heat-traceability': 'Heat number stated',
  'spec-and-revision': 'Specification and revision stated',
  'domestic-melt': 'Domestic melt statement',
  'mercury-free': 'Mercury-free statement',
  'conformance-signature': 'Signed statement of conformance',
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const unslug = (s) => cap(String(s).replace(/[_-]+/g, ' '));

export const GROUPS = ['Required tests', 'Chemistry', 'Mechanical', 'Specification', 'Traceability', 'Statements', 'Other'];

/** { group, title } for a rule id such as `chemistry-out-of-range:Mn`. */
export function describeRule(rule) {
  const [head, arg = ''] = rule.split(':');
  switch (head) {
    case 'required-test-present': return { group: 'Required tests', title: `${TESTS[arg] ?? unslug(arg)} results reported` };
    case 'required-test-missing': return { group: 'Required tests', title: `${TESTS[arg] ?? unslug(arg)} results missing` };
    case 'chemistry-in-range': return { group: 'Chemistry', title: `${ELEMENTS[arg] ?? arg} (${arg}) within limits` };
    case 'chemistry-out-of-range': return { group: 'Chemistry', title: `${ELEMENTS[arg] ?? arg} (${arg}) out of range` };
    case 'mechanical-in-range': return { group: 'Mechanical', title: `${MECHANICAL[arg] ?? unslug(arg)} within limits` };
    case 'mechanical-out-of-range': return { group: 'Mechanical', title: `${MECHANICAL[arg] ?? unslug(arg)} out of range` };
    case 'spec-revision-match': return { group: 'Specification', title: `${DOC_ABBR[arg] ?? arg} certifies the PO revision` };
    case 'spec-revision-missing': return { group: 'Specification', title: `${DOC_ABBR[arg] ?? arg} states no specification revision` };
    case 'spec-revision-mismatch': return { group: 'Specification', title: 'Specification revision does not match the PO' };
    case 'heat-traceability': return { group: 'Traceability', title: 'PO → CoC → heat traces end to end' };
    case 'heat-traceability-broken': return { group: 'Traceability', title: 'Heat traceability broken' };
    case 'po-traceability-broken': return { group: 'Traceability', title: 'CoC does not cite the PO' };
    case 'required-statement-present': return { group: 'Statements', title: STATEMENTS[arg] ?? unslug(arg) };
    case 'required-statement-missing': return { group: 'Statements', title: `${STATEMENTS[arg] ?? unslug(arg)} missing` };
    default: return { group: 'Other', title: unslug(rule) };
  }
}

/** A field path from an extraction, e.g. `mechanical.tensile_ksi`. */
export function describeField(field) {
  const [area, key] = String(field).split('.');
  if (area === 'mechanical' && MECHANICAL[key]) return `${MECHANICAL[key]}${key.endsWith('_ksi') ? ' (ksi)' : key.endsWith('_pct') ? ' (%)' : ''}`;
  if (area === 'chemistry' && ELEMENTS[key]) return `${ELEMENTS[key]} (${key})`;
  return unslug(field.replace('.', ' · '));
}

export const REJECTION = {
  'no-citation': 'The model gave no citation, so the value cannot be checked against the page.',
  'unknown-document': 'The citation points at a document that is not in this packet.',
  'cited-line-missing': 'The cited line does not exist in the document.',
  'cited-line-hidden': 'The cited line is hidden text: present in the file, invisible on the printed page.',
  'value-not-on-cited-line': 'The value does not appear on the line the model cited.',
};

export const UNTRUSTED_WHY = {
  'hidden-text': 'Hidden text',
  'instruction-shaped': 'Addressed to a reviewer',
};

/** Plain words for a broker refusal rule. */
export const REFUSAL = {
  'verdict-not-accept': 'Only an ACCEPT verdict can be released.',
  'untrusted-input': 'Untrusted text from the supplier fed this decision, so it cannot authorize a release.',
  'already-used': 'This authorization was already used. A release runs once per authorization.',
  'never-minted': 'The broker never issued this authorization.',
  'payload-changed': 'The decision changed after approval, so the authorization no longer matches it.',
  'mint-mismatch': 'The authorization does not match the receipt it was minted with.',
  'no-authorization': 'No authorization was presented.',
  'wrong-tool': 'The authorization was issued for a different action.',
  'ledger-broken': 'The receipt chain is broken, so nothing can be released.',
};
export const refusalWords = (rule, fallback) => REFUSAL[rule] ?? fallback ?? 'The broker refused the request.';

export const STATUS_LABEL = { received: 'Received', quarantined: 'Quarantined', 'awaiting-release': 'Awaiting release', released: 'Released' };

/** Receipt kinds, in plain words, with a tone for the timeline dot and a one-line detail. */
export function describeReceipt(r) {
  const p = r.payload ?? {};
  const short = (h) => (typeof h === 'string' ? h.slice(0, 8) : '');
  switch (r.kind) {
    case 'packet_received': return { label: 'Packet received', detail: `${p.po ?? ''}${p.resubmits ? ` · resubmits ${p.resubmits}` : ''} · ${Object.keys(p.files ?? {}).map((d) => DOC_ABBR[d] ?? d).join(' + ')} hashed` };
    case 'tripwire_fired': return { tone: 'bad', label: 'Untrusted text flagged', detail: `${DOC_ABBR[p.doc] ?? p.doc} p${p.page} · l${p.line} · ${UNTRUSTED_WHY[p.reason] ?? p.reason}${p.font_pt ? ` · ${p.font_pt} pt` : ''}` };
    case 'text_layer_read': return { label: 'Text layer read', detail: Object.entries(p).map(([d, v]) => `${DOC_ABBR[d] ?? d} ${v.lines} lines`).join(' · ') };
    case 'extraction_drafted': return { label: 'Model extraction drafted', detail: `draft ${p.draft_verdict ?? 'none'} · recorded as evidence, not acted on` };
    case 'citations_checked': {
      const n = (p.rejected ?? []).length;
      return { tone: n ? 'warn' : undefined, label: 'Citations checked', detail: n ? `${n} extraction${n === 1 ? '' : 's'} rejected` : 'every extracted value found on its cited line' };
    }
    case 'verdict_computed': return { tone: p.verdict === 'ACCEPT' ? 'good' : p.verdict === 'NONCONFORMING' ? 'bad' : 'warn', label: `Verdict computed: ${p.verdict}`, detail: p.reasons?.length ? p.reasons.join(', ') : 'every rule passed' };
    case 'ncr_opened': return { tone: 'bad', label: 'Nonconformance opened', detail: `${p.id} · ${p.disposition}` };
    case 'authorization_refused': return { tone: 'bad', label: 'Approval refused', detail: `${p.rule}${p.by ? ` · requested by ${p.by}` : ''}` };
    case 'authorization_minted': return { tone: 'good', label: 'Release authorized', detail: `${p.by ? `by ${p.by} · ` : ''}single use · ${short(p.id)}` };
    case 'authorization_consumed': return { label: 'Authorization consumed', detail: short(p.id) };
    case 'effect_performed': return { tone: 'good', label: 'Material released', detail: `authorization ${short(p.authorization_id)}` };
    case 'effect_failed': return { tone: 'bad', label: 'Release failed', detail: p.error ?? '' };
    case 'effect_denied': return { tone: 'bad', label: 'Release refused', detail: `${p.rule}${p.authorization_id ? ` · ${short(p.authorization_id)}` : ''}` };
    case 'read_performed': return { label: 'Read performed', detail: p.tool ?? '' };
    default: return { label: unslug(r.kind), detail: '' };
  }
}

/** "2026-09-14" -> "Sep 14", without time-zone drift. */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${Number(m[3])}`;
}
