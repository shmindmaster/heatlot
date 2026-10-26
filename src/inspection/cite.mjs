/**
 * The citation check: a value is admitted only if the line it cites says it.
 *
 * For every `{ value, cite }` the check requires that the cited document, page and line exist,
 * that the cited document is the one the field was extracted for, that the line is visible (hidden
 * text is never evidence), and that the value appears in the line's text (numbers compared as numbers, strings as whole tokens). An admitted value keeps the
 * cited line's sha256, so a later edit to the document breaks the citation.
 *
 * Rejected values are dropped from the evidence and reported with the reason. The rules then see
 * the field as absent, which is how a hallucinated or planted value turns into INCOMPLETE rather
 * than ACCEPT.
 */

const NUM = /-?\d+(?:\.\d+)?/g;

function lineSays(text, value) {
  if (typeof value === 'number') return (text.match(NUM) ?? []).some((token) => Number(token) === value);
  if (typeof value !== 'string' || value.trim() === '') return false;
  const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s:,(])${escaped}($|[\\s,.;)])`).test(text);
}

/**
 * Check one cited value against the documents' lines. When `docName` is given, the citation must
 * point into that same document: a field extracted for the CoC cannot be supported by an MTR line.
 */
export function checkCitation(docs, field, docName) {
  if (!field || !field.cite) return { ok: false, reason: 'no-citation' };
  const { doc, page, line } = field.cite;
  if (docName !== undefined && doc !== docName) return { ok: false, reason: 'cross-document-citation' };
  const lines = docs[doc];
  if (!lines) return { ok: false, reason: 'unknown-document' };
  const target = lines.find((l) => l.page === page && l.line === line);
  if (!target) return { ok: false, reason: 'cited-line-missing' };
  if (target.hidden) return { ok: false, reason: 'cited-line-hidden', line: target };
  if (!lineSays(target.text, field.value)) return { ok: false, reason: 'value-not-on-cited-line', line: target };
  return { ok: true, line: target };
}

/** Walk an extraction, admit what the pages support, and report what they do not. */
export function verifyExtraction(docs, extraction) {
  const admitted = {};
  const rejected = [];
  const visit = (docName, fields, prefix, out) => {
    for (const [key, field] of Object.entries(fields ?? {})) {
      const name = `${prefix}${key}`;
      if (field && typeof field === 'object' && !('value' in field) && !('cite' in field)) {
        out[key] = {};
        visit(docName, field, `${name}.`, out[key]);
        continue;
      }
      if (field === null || field === undefined) { out[key] = null; continue; }
      const result = checkCitation(docs, field, docName);
      if (result.ok) {
        out[key] = { value: field.value, cite: { ...field.cite, text: result.line.text, sha256: result.line.sha256 } };
      } else {
        out[key] = null;
        rejected.push({ document: docName, field: name, value: field.value, cite: field.cite, reason: result.reason });
      }
    }
  };
  for (const [docName, fields] of Object.entries(extraction.documents ?? {})) {
    admitted[docName] = {};
    visit(docName, fields, '', admitted[docName]);
  }
  return { admitted, rejected };
}
