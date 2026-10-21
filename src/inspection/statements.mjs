/**
 * Required statements on a certificate, found by pattern in visible lines.
 *
 * Each required statement in a spec table has an id. This module maps ids to the patterns that
 * recognise them and returns, per id, the citing line or null. It is a small, explicit stand-in
 * for the clause scanner (`packages/clauses`) and has the same contract: lines in, a cited match
 * or nothing out. Hidden lines never satisfy a statement.
 */

export const STATEMENT_PATTERNS = {
  'domestic-melt': /\bmelted and manufactured in the United States\b/i,
  'mercury-free': /\bfree of mercury contamination\b/i,
};

export function findStatements(ids, docs) {
  const found = {};
  for (const id of ids) {
    const pattern = STATEMENT_PATTERNS[id];
    found[id] = null;
    if (!pattern) continue;
    for (const [doc, lines] of Object.entries(docs)) {
      const hit = lines.find((l) => !l.hidden && pattern.test(l.text));
      if (hit) { found[id] = { doc, page: hit.page, line: hit.line, text: hit.text, sha256: hit.sha256 }; break; }
    }
  }
  return found;
}
