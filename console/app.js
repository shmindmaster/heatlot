/**
 * Heatlot inspection console. Vanilla ES modules, no build step; every number on screen comes
 * from the HTTP API (/api/*). The console decides nothing: verdicts, refusals and the receipt
 * chain are the server's. It only shows them, cited.
 */
import { DocViewer } from './pdfview.js';
import {
  DOC_ABBR, DOC_NAME, GROUPS, REJECTION, STATUS_LABEL, UNTRUSTED_WHY,
  describeField, describeReceipt, describeRule, refusalWords, shortDate,
} from './words.js';

/* ── tiny DOM helpers ─────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}
const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M7.8 12.3l2.8 2.8 5.6-6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.2"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  pass: '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M5.3 8.2l1.9 1.9 3.6-3.9"/></svg>',
  fail: '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>',
  missing: '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke-dasharray="2.6 2.2"/><path d="M5.2 8h5.6"/></svg>',
  lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>',
  info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2V11"/><circle cx="8" cy="5" r=".5" fill="currentColor"/></svg>',
  seal: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3l10 4v8c0 6.5-4.3 11.3-10 13.5C10.3 26.3 6 21.5 6 15V7z"/><path d="M11.5 16l3.2 3.2 6-6.5"/></svg>',
  broken: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3l10 4v8c0 6.5-4.3 11.3-10 13.5C10.3 26.3 6 21.5 6 15V7z"/><path d="M12 12l8 8M20 12l-8 8"/></svg>',
};
function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstChild;
}
const VERDICT_ICON = { ACCEPT: 'check', INCOMPLETE: 'warn', NONCONFORMING: 'stop' };
const STATUS_ORDER = ['all', 'received', 'quarantined', 'awaiting-release', 'released'];
const citeLabel = (c) => `${DOC_ABBR[c.doc] ?? c.doc} p${c.page} · l${c.line}`;
const citeKey = (c) => `${c.doc}:${c.page}:${c.line}`;
const short = (s, n = 8) => (s ? String(s).slice(0, n) : '');

/* ── API ──────────────────────────────────────────────────────────── */
class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
    this.rule = body?.error?.rule;
  }
}
async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/* ── state ────────────────────────────────────────────────────────── */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
};
const state = {
  packets: null,
  queueError: null,
  filter: 'all',
  cursor: null, // packet id under the keyboard cursor
  open: null, // packet id open in the viewer
  detail: null,
  doc: 'mtr',
  fit: 'page',
  lines: new Map(), // `${packet}/${doc}` -> lines
  inspections: new Map(),
  inspectError: new Map(),
  approvals: new Map(), // packet -> { auth, by }
  approveRefusal: new Map(),
  released: new Map(), // packet -> release record
  releaseRefusal: new Map(),
  receipts: new Map(), // packet -> chain
  busy: null,
  selected: null, // finding rule
  focused: null, // { doc, page, line }
  untrustedIdx: -1,
  inspector: store.get('heatlot.inspector') ?? '',
};

const viewer = new DocViewer({ well: $('#doc-well'), pages: $('#doc-pages'), state: $('#doc-state') });

function announce(text, assertive = false) {
  const el = assertive ? $('#announce-assertive') : $('#announce-polite');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}

/* ── queue ────────────────────────────────────────────────────────── */
const visible = () => (state.packets ?? []).filter((p) => state.filter === 'all' || p.status === state.filter);

function renderFilters() {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, (state.packets ?? []).filter((p) => s === 'all' || p.status === s).length]));
  $('#filters').replaceChildren(...STATUS_ORDER.map((s) => h('button', {
    type: 'button', class: 'filter', 'aria-pressed': String(state.filter === s), dataset: { filter: s },
    onclick: () => setFilter(s),
  }, s === 'all' ? 'All' : STATUS_LABEL[s], h('span', { class: 'n', 'aria-label': `${counts[s]} packets` }, String(counts[s])))));
}

function setFilter(f) {
  state.filter = f;
  const list = visible();
  if (!list.some((p) => p.packet === state.cursor)) state.cursor = list[0]?.packet ?? null;
  renderFilters();
  renderQueue();
  announce(`${f === 'all' ? 'All packets' : STATUS_LABEL[f]}: ${list.length} shown`);
}

function statusPill(status) {
  return h('span', { class: `status ${status}` }, STATUS_LABEL[status] ?? status);
}
function verdictChip(verdict) {
  return h('span', { class: `vchip ${verdict ?? ''}` }, verdict ?? 'not inspected');
}

function renderQueue() {
  const list = $('#queue-list');
  const stateEl = $('#queue-state');
  if (state.queueError) {
    list.replaceChildren();
    stateEl.replaceChildren(
      h('p', null, 'The queue could not be loaded.'),
      h('p', { class: 'mono' }, state.queueError),
      h('button', { type: 'button', class: 'btn outline', onclick: loadQueue }, 'Try again'),
    );
    return;
  }
  if (!state.packets) {
    list.replaceChildren();
    stateEl.replaceChildren(h('div', { class: 'skeleton', 'aria-label': 'Loading the queue' }, h('span'), h('span'), h('span'), h('span')));
    return;
  }
  const rows = visible();
  $('#queue-count').textContent = `${rows.length} of ${state.packets.length}`;
  stateEl.replaceChildren(rows.length ? '' : h('p', null, `No packets are ${STATUS_LABEL[state.filter]?.toLowerCase() ?? 'here'}.`));
  if (!rows.some((p) => p.packet === state.cursor)) state.cursor = rows[0]?.packet ?? null;
  list.replaceChildren(...rows.map((p) => h('li', {
    role: 'option', id: `opt-${p.packet}`, class: `row${p.packet === state.cursor ? ' cursor' : ''}${p.packet === state.open ? ' open' : ''}`,
    'aria-selected': String(p.packet === state.open), dataset: { packet: p.packet, status: p.status },
    onclick: () => { state.cursor = p.packet; openPacket(p.packet); },
  },
  h('span', { class: 'row-id' }, p.packet),
  h('span', { class: 'row-date' }, h('time', { datetime: p.received }, shortDate(p.received))),
  h('span', { class: 'row-sub' }, `${p.po} · ${p.supplier}`),
  h('span', { class: 'row-tags' }, statusPill(p.status), verdictChip(p.verdict), p.resubmits ? h('span', { class: 'resubmit' }, `resubmits ${p.resubmits}`) : null))));
  if (state.cursor) list.setAttribute('aria-activedescendant', `opt-${state.cursor}`);
  else list.removeAttribute('aria-activedescendant');
}

function moveCursor(delta) {
  const rows = visible();
  if (!rows.length) return;
  const i = rows.findIndex((p) => p.packet === state.cursor);
  const next = rows[Math.max(0, Math.min(rows.length - 1, (i < 0 ? 0 : i + delta)))];
  state.cursor = next.packet;
  renderQueue();
  document.getElementById(`opt-${next.packet}`)?.scrollIntoView({ block: 'nearest' });
}

async function loadQueue() {
  state.queueError = null;
  try {
    const { packets } = await api('/api/packets');
    state.packets = packets;
  } catch (err) {
    state.queueError = err.message;
  }
  renderFilters();
  renderQueue();
}
async function refreshQueue() {
  try { state.packets = (await api('/api/packets')).packets; } catch { /* keep the last good queue */ }
  renderFilters();
  renderQueue();
}
const summaryOf = (id) => state.packets?.find((p) => p.packet === id) ?? null;

/* ── viewer ───────────────────────────────────────────────────────── */
async function ensureLines(id, doc) {
  const key = `${id}/${doc}`;
  if (!state.lines.has(key)) state.lines.set(key, (await api(`/api/packets/${id}/documents/${doc}/lines`)).lines);
  return state.lines.get(key);
}

function renderViewerHead() {
  const title = $('#viewer-h');
  const meta = $('#packet-meta');
  if (!state.open) {
    title.replaceChildren('No packet open');
    meta.textContent = 'Choose a packet from the receiving queue.';
    return;
  }
  const s = summaryOf(state.open);
  const d = state.detail?.packet === state.open ? state.detail : null;
  title.replaceChildren(h('span', { class: 'mono' }, state.open), d ? ` · ${d.po} line ${d.po_line.line}` : s ? ` · ${s.po}` : '');
  meta.replaceChildren(...(d
    ? [h('b', null, d.supplier), ` · ${d.item} · `, h('b', null, `${d.po_line.spec} Rev ${d.po_line.spec_revision}`), ` · Drawing ${d.po_line.drawing?.number ?? '—'} Rev ${d.po_line.drawing?.revision ?? '—'} · ${d.po_line.quantity}`]
    : [s ? `${s.supplier} · ${s.item}` : '']));
}

function renderTabs() {
  const r = state.inspections.get(state.open);
  for (const doc of ['mtr', 'coc']) {
    const tab = $(`#tab-${doc}`);
    const selected = state.doc === doc;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const flagged = r?.untrusted.filter((u) => u.doc === doc).length ?? 0;
    const flag = tab.querySelector('.tab-flag');
    flag.hidden = !flagged;
    tab.setAttribute('aria-label', `${DOC_NAME[doc]}${flagged ? `, ${flagged} untrusted line${flagged === 1 ? '' : 's'}` : ''}`);
  }
  $('#doc-well').setAttribute('aria-labelledby', `tab-${state.doc}`);
  $('#fit-toggle').setAttribute('aria-pressed', String(state.fit === 'width'));
  $('#viewer').classList.toggle('wide', $('#viewer').clientWidth > 760);
}

function marksFor(doc) {
  const r = state.inspections.get(state.open);
  const sel = r?.findings.find((f) => f.rule === state.selected);
  const rej = r && state.selected?.startsWith('rejected:') ? r.rejected[Number(state.selected.split(':')[1])] : null;
  const cites = sel ? sel.cites : rej?.cite ? [rej.cite] : [];
  return {
    untrusted: (r?.untrusted ?? []).filter((u) => u.doc === doc),
    cited: cites.filter((c) => c.doc === doc),
    focused: state.focused?.doc === doc ? state.focused : null,
  };
}

async function renderDoc({ scroll = false } = {}) {
  renderTabs();
  if (!state.open) { viewer.clear(''); return; }
  const id = state.open;
  const doc = state.doc;
  let lines;
  try {
    lines = await ensureLines(id, doc);
  } catch (err) {
    viewer.clear(`Could not read the ${DOC_NAME[doc].toLowerCase()}: ${err.message}`);
    return;
  }
  if (state.open !== id || state.doc !== doc) return;
  viewer.marks = { cited: [], untrusted: [], focused: null, ...marksFor(doc) };
  await viewer.show({ key: `${id}/${doc}`, url: `/api/packets/${id}/documents/${doc}/pdf`, lines, label: `${DOC_NAME[doc]} (${DOC_ABBR[doc]})` });
  if (scroll) viewer.scrollToFocused();
}

function setDoc(doc, { focusTab = false } = {}) {
  if (!state.open || state.doc === doc) { if (focusTab) $(`#tab-${doc}`).focus(); return; }
  state.doc = doc;
  renderDoc();
  if (focusTab) $(`#tab-${doc}`).focus();
}

function focusLine(cite, { select } = {}) {
  if (select !== undefined) state.selected = select;
  state.focused = { doc: cite.doc, page: cite.page, line: cite.line };
  renderPanel();
  if (state.doc !== cite.doc) {
    state.doc = cite.doc;
    renderDoc({ scroll: true });
  } else {
    viewer.setMarks(marksFor(state.doc));
    viewer.scrollToFocused();
  }
  const lines = state.lines.get(`${state.open}/${cite.doc}`) ?? [];
  const line = lines.find((l) => l.page === cite.page && l.line === cite.line);
  if (line) announce(`${citeLabel(cite)}: ${line.text}`);
}

function selectFinding(rule) {
  state.selected = state.selected === rule ? null : rule;
  state.focused = null;
  const r = state.inspections.get(state.open);
  const f = r?.findings.find((x) => x.rule === state.selected);
  renderPanel();
  if (f?.cites.length && !f.cites.some((c) => c.doc === state.doc)) {
    state.doc = f.cites[0].doc;
    renderDoc();
  } else {
    viewer.setMarks(marksFor(state.doc));
  }
}

/* ── open + actions ──────────────────────────────────────────────── */
async function openPacket(id) {
  if (state.open === id) return;
  state.open = id;
  state.detail = null;
  state.doc = 'mtr';
  state.selected = null;
  state.focused = null;
  state.untrustedIdx = -1;
  closeReceipts({ restoreFocus: false });
  renderQueue();
  renderViewerHead();
  renderPanel();
  renderActions();
  renderDoc();
  announce(`Opened ${id}`);
  try {
    const detail = await api(`/api/packets/${id}`);
    if (state.open !== id) return;
    state.detail = detail;
    renderViewerHead();
  } catch { /* the header keeps the queue summary */ }
  // A packet inspected earlier opens on its stored inspection: every cited finding, no new receipts.
  if (!state.inspections.has(id) && summaryOf(id)?.verdict) {
    try {
      const stored = await api(`/api/packets/${id}/inspection`);
      if (state.open !== id) return;
      state.inspections.set(id, stored);
      renderPanel();
      renderActions();
      renderDoc();
    } catch { /* not inspected yet: the panel offers Inspect */ }
  }
  loadReceipts(id);
}

async function runInspect() {
  const id = state.open;
  if (!id || state.busy) return;
  state.busy = 'inspect';
  state.inspectError.delete(id);
  renderPanel();
  renderActions();
  announce(`Inspecting ${id}`);
  try {
    const r = await api(`/api/packets/${id}/inspect`, { method: 'POST' });
    state.inspections.set(id, r);
    state.approveRefusal.delete(id);
    state.releaseRefusal.delete(id);
    state.selected = null;
    state.focused = null;
    state.untrustedIdx = -1;
    if (r.untrusted.length) {
      const u = r.untrusted[0];
      state.untrustedIdx = 0;
      state.focused = { doc: u.doc, page: u.page, line: u.line };
      state.doc = u.doc;
    }
    const why = r.reasons.map((x) => describeRule(x).title).join('; ');
    announce(`Verdict ${r.verdict}${why ? `: ${why}` : ''}.${r.untrusted.length ? ` ${r.untrusted.length} untrusted line flagged; it cannot change the outcome.` : ''}${r.ncr ? ` Quarantined under ${r.ncr.id}.` : ''}`, true);
  } catch (err) {
    state.inspectError.set(id, err.message);
    announce(`Inspection failed: ${err.message}`, true);
  } finally {
    state.busy = null;
  }
  if (state.open !== id) return;
  renderPanel();
  renderActions();
  renderDoc({ scroll: true });
  await refreshQueue();
  loadReceipts(id);
}

async function runApprove() {
  const id = state.open;
  const by = state.inspector.trim();
  if (!id || state.busy || !by) return;
  state.busy = 'approve';
  renderActions();
  try {
    const auth = await api(`/api/packets/${id}/approve`, { method: 'POST', body: { by } });
    state.approvals.set(id, { auth, by });
    state.approveRefusal.delete(id);
    announce(`Release authorized by ${by}. Single use, bound to this decision.`, true);
  } catch (err) {
    if (err.status !== 409) state.approveRefusal.set(id, { code: err.body?.error?.code ?? 'error', message: err.message });
    else state.approveRefusal.set(id, err.body.error);
    announce(`Approval refused: ${refusalWords(err.rule, err.message)}`, true);
  } finally {
    state.busy = null;
  }
  renderActions();
  await refreshQueue();
  loadReceipts(id);
  if (state.approvals.has(id)) $('#release')?.focus();
}

async function runRelease() {
  const id = state.open;
  const held = state.approvals.get(id);
  if (!id || state.busy || !held) return;
  state.busy = 'release';
  renderActions();
  try {
    const record = await api(`/api/packets/${id}/release`, { method: 'POST', body: { authorization: held.auth } });
    state.released.set(id, record);
    state.releaseRefusal.delete(id);
    announce(`${id} released. Authorization ${short(held.auth.id)} consumed.`, true);
  } catch (err) {
    state.releaseRefusal.set(id, err.status === 409 ? err.body.error : { code: err.body?.error?.code ?? 'error', message: err.message });
    announce(`Release refused: ${refusalWords(err.rule, err.message)}`, true);
  } finally {
    state.busy = null;
  }
  renderActions();
  await refreshQueue();
  renderPanel();
  loadReceipts(id);
  $('#release')?.focus();
}

/* ── verdict panel ───────────────────────────────────────────────── */
function citeButton(c, { untrusted = false, owner = null } = {}) {
  const pressed = state.focused && citeKey(state.focused) === citeKey(c);
  return h('button', {
    type: 'button', class: `cite${untrusted ? ' untrusted' : ''}`, 'aria-pressed': String(Boolean(pressed)),
    'aria-label': `Show ${DOC_NAME[c.doc]} page ${c.page} line ${c.line}`, dataset: { cite: citeKey(c) },
    onclick: (e) => { e.stopPropagation(); focusLine(c, owner === null ? {} : { select: owner }); },
  }, citeLabel(c));
}
function uniqueCites(cites) {
  const seen = new Set();
  return cites.filter((c) => { const k = citeKey(c); if (seen.has(k)) return false; seen.add(k); return true; });
}

function renderPanel() {
  const root = $('#panel-scroll');
  const id = state.open;
  const s = id ? summaryOf(id) : null;
  const r = id ? state.inspections.get(id) : null;
  $('#receipts-open').disabled = !id;
  if (!id) {
    root.replaceChildren(h('div', { class: 'empty' },
      h('h3', null, 'No packet open'),
      h('p', null, 'Open a packet from the queue to read its certificates, inspect them against the PO and the specification, and release what passes.'),
      h('p', null, h('kbd', null, 'j'), ' ', h('kbd', null, 'k'), ' to move, ', h('kbd', null, 'Enter'), ' to open.')));
    return;
  }
  if (state.busy === 'inspect') {
    root.replaceChildren(h('div', { class: 'progress', role: 'presentation' }), h('div', { class: 'empty', role: 'status', 'aria-busy': 'true' },
      h('h3', null, `Inspecting ${id}`),
      h('p', null, 'Reading the text layer, checking every extracted value against its cited line, then applying the specification rules.')));
    return;
  }
  const err = state.inspectError.get(id);
  if (!r) {
    const already = s && s.verdict;
    root.replaceChildren(
      already ? verdictCard({ verdict: s.verdict, reasons: [], draft_verdict: null }, { summaryOnly: true }) : null,
      h('div', { class: 'empty' },
        h('h3', null, already ? 'Findings not loaded in this session' : 'Not inspected yet'),
        h('p', null, already
          ? 'The verdict above is the last one recorded. Inspect again to recompute it from the same files and load every cited finding.'
          : 'The model extracts the fields. Deterministic rules decide the verdict, and every finding is cited to a document, page and line.'),
        err ? h('p', { class: 'reason blocked', role: 'alert' }, icon('info'), `Inspection failed: ${err}`) : null,
        h('button', { type: 'button', class: 'btn primary', id: 'inspect', 'aria-keyshortcuts': 'i', onclick: runInspect }, already ? 'Inspect again' : 'Inspect packet', h('kbd', { 'aria-hidden': 'true' }, 'i'))));
    return;
  }

  const kids = [verdictCard(r)];
  if (r.untrusted.length) {
    kids.push(h('section', { class: 'section', 'aria-labelledby': 'untrusted-h' },
      h('div', { class: 'section-head' }, h('h3', { id: 'untrusted-h' }, 'Untrusted text'), h('span', { class: 'tally' }, String(r.untrusted.length))),
      ...r.untrusted.map((u) => {
        const line = (state.lines.get(`${id}/${u.doc}`) ?? []).find((l) => l.page === u.page && l.line === u.line);
        return h('article', { class: 'card alarm untrusted-card', dataset: { line: String(u.line) } }, h('div', { class: 'card-body' },
          h('div', { class: 'card-row' },
            h('span', { class: 'tag danger' }, u.why === 'hidden-text' ? `Hidden text${line ? ` · ${line.font_pt} pt` : ''}` : UNTRUSTED_WHY[u.why] ?? u.why),
            citeButton(u, { untrusted: true })),
          h('p', { class: 'quote' }, `“${u.text}”`),
          h('p', { class: 'consequence' }, 'Flagged untrusted and recorded in the receipts. It cannot change the verdict or authorize a release.')));
      })));
  }
  if (r.rejected.length) {
    kids.push(h('section', { class: 'section', 'aria-labelledby': 'rejected-h' },
      h('div', { class: 'section-head' }, h('h3', { id: 'rejected-h' }, 'Rejected extractions'), h('span', { class: 'tally' }, String(r.rejected.length))),
      ...r.rejected.map((x, i) => {
        const isUntrusted = x.cite && r.untrusted.some((u) => u.doc === x.cite.doc && u.page === x.cite.page && u.line === x.cite.line);
        return h('article', { class: 'card rejected-card' }, h('div', { class: 'card-body' },
          h('div', { class: 'card-row' }, h('strong', null, describeField(x.field)), h('span', { class: 'tag muted' }, 'Not admitted')),
          h('dl', { class: 'kv' },
            h('dt', null, 'Model claimed'), h('dd', null, h('span', { class: 'mono' }, JSON.stringify(x.value))),
            h('dt', null, 'Citing'), h('dd', null, x.cite?.doc ? citeButton({ doc: x.cite.doc, page: x.cite.page, line: x.cite.line }, { untrusted: isUntrusted, owner: `rejected:${i}` }) : 'no citation'),
            h('dt', null, 'Why'), h('dd', null, REJECTION[x.reason] ?? x.reason))));
      })));
  }
  if (r.ncr) kids.push(ncrCard(r));
  kids.push(findingsSection(r));
  root.replaceChildren(...kids);
}

function verdictCard(r, { summaryOnly = false } = {}) {
  const reasons = r.reasons.map((x) => describeRule(x).title);
  const agrees = r.draft_verdict === r.verdict || (r.draft_verdict === 'COMPLETE' && r.verdict === 'ACCEPT');
  return h('div', { class: `verdict-card ${r.verdict}`, id: 'verdict-card' },
    h('div', { class: 'verdict-top' },
      h('div', null,
        h('span', { class: 'verdict-label' }, summaryOnly ? 'Last recorded' : 'Decided by the rules'),
        h('p', { class: `verdict-word ${r.verdict}`, id: 'verdict-word' }, icon(VERDICT_ICON[r.verdict]), r.verdict)),
      r.draft_verdict ? h('div', { class: `draft${agrees ? ' agrees' : ''}`, id: 'model-draft', 'aria-label': `Model draft ${r.draft_verdict}, ${agrees ? 'agrees, but was' : 'overruled and'} not acted on` },
        h('span', { class: 'draft-label' }, 'Model draft'),
        h('span', { class: 'draft-value' }, r.draft_verdict),
        h('span', { class: 'draft-note' }, agrees ? 'agrees · not relied on' : 'not acted on')) : null),
    reasons.length ? h('ul', { class: 'verdict-why' }, ...reasons.map((x) => h('li', null, x))) : summaryOnly ? null : h('p', { class: 'verdict-why' }, 'Every rule passed, each one cited to the page.'),
    !summaryOnly && r.extraction_provenance ? h('p', { class: 'provenance' }, h('strong', null, `Extraction source: ${r.extraction_provenance.kind}. `), r.extraction_provenance.note ?? '') : null);
}

function ncrCard(r) {
  return h('section', { class: 'section', 'aria-labelledby': 'ncr-h' },
    h('div', { class: 'section-head' }, h('h3', { id: 'ncr-h' }, 'Nonconformance'), h('span', { class: 'tally' }, 'quarantined')),
    h('article', { class: 'card ncr-card' }, h('div', { class: 'card-body' },
      h('div', { class: 'card-row' }, h('span', { class: 'ncr-head' }, icon('lock'), h('span', { class: 'ncr-id', id: 'ncr-id' }, r.ncr.id)), statusPill('quarantined')),
      h('ul', { class: 'ncr-reasons' }, ...r.ncr.reasons.map((f) => h('li', null,
        h('strong', null, describeRule(f.rule).title), ' — ', f.reason,
        f.cites.length ? h('div', { class: 'cites' }, ...uniqueCites(f.cites).map((c) => citeButton(c, { owner: f.rule }))) : h('div', { class: 'no-cite' }, 'No supporting line in either document.')))),
      h('p', { class: 'ncr-foot' }, `Opened from receipt ${short(r.ncr.opened_from_receipt, 12)} · material held until a corrected packet passes.`))));
}

function findingsSection(r) {
  const groups = new Map(GROUPS.map((g) => [g, []]));
  for (const f of r.findings) groups.get(describeRule(f.rule).group).push(f);
  const pass = r.findings.filter((f) => f.status === 'pass').length;
  return h('section', { class: 'section', 'aria-labelledby': 'findings-h' },
    h('div', { class: 'section-head' }, h('h3', { id: 'findings-h' }, 'Rule by rule'), h('span', { class: 'tally' }, `${pass} of ${r.findings.length} pass`)),
    ...[...groups].filter(([, fs]) => fs.length).map(([name, fs]) => {
      const bad = fs.filter((f) => f.status === 'fail').length;
      const gap = fs.filter((f) => f.status === 'missing').length;
      const ok = fs.length - bad - gap;
      const open = bad + gap > 0 || fs.some((f) => f.rule === state.selected);
      return h('details', { class: 'group', open, dataset: { group: name } },
        h('summary', null, h('span', { class: 'group-name' }, name), h('span', { class: 'group-tally' },
          bad ? h('span', { class: 'bad' }, `${bad} fail`) : null,
          gap ? h('span', { class: 'gap' }, `${gap} missing`) : null,
          h('span', { class: ok === fs.length ? 'ok' : '' }, `${ok}/${fs.length} pass`))),
        h('ul', { class: 'findings' }, ...fs.map((f) => {
          const d = describeRule(f.rule);
          const selected = state.selected === f.rule;
          return h('li', { class: `finding ${f.status}${selected ? ' selected' : ''}`, dataset: { rule: f.rule }, onclick: () => selectFinding(f.rule) },
            icon(f.status),
            h('button', { type: 'button', class: 'finding-title', 'aria-pressed': String(selected), onclick: (e) => { e.stopPropagation(); selectFinding(f.rule); } },
              d.title, h('span', { class: 'st' }, f.status)),
            h('p', { class: 'finding-reason' }, f.reason),
            f.cites.length ? h('div', { class: 'cites' }, ...uniqueCites(f.cites).map((c) => citeButton(c, { owner: f.rule }))) : h('p', { class: 'no-cite' }, 'No supporting line in either document.'));
        })));
    }));
}

/* ── actions ─────────────────────────────────────────────────────── */
function blockReason(id, r) {
  const s = summaryOf(id);
  if (state.released.has(id) || s?.status === 'released') return { text: ['Already released. A packet is released once.'] };
  if (r.verdict !== 'ACCEPT') return { blocked: true, rule: 'verdict-not-accept', text: [`The verdict is ${r.verdict}. `, refusalWords('verdict-not-accept')] };
  if (r.untrusted.length) return { blocked: true, rule: 'untrusted-input', text: [refusalWords('untrusted-input')] };
  if (state.approvals.has(id)) return { text: ['Authorization issued. Release below.'] };
  if (!state.inspector.trim()) return { text: ["Enter the inspector's name to approve."] };
  return null;
}

function outcomeBox(kind, title, body, rule) {
  return h('div', { class: `outcome ${kind}`, role: kind === 'refused' ? 'alert' : 'status', id: kind === 'refused' ? undefined : 'release-ok' },
    icon(kind === 'ok' ? 'check' : 'stop'),
    h('strong', null, title, rule ? ' ' : '', rule ? h('span', { class: 'rule-code' }, rule) : null),
    h('p', null, body));
}

function renderActions() {
  const el = $('#actions');
  const id = state.open;
  const r = id ? state.inspections.get(id) : null;
  if (!r || state.busy === 'inspect') { el.hidden = true; el.replaceChildren(); return; }
  el.hidden = false;
  const why = blockReason(id, r);
  const busy = state.busy;
  const held = state.approvals.get(id);
  const released = state.released.get(id);
  const refusedApprove = state.approveRefusal.get(id);
  const refusedRelease = state.releaseRefusal.get(id);

  const reasonEl = why ? h('p', { class: `reason${why.blocked ? ' blocked' : ''}`, id: 'approve-reason' },
    icon(why.blocked ? 'lock' : 'info'),
    h('span', null, why.blocked ? h('strong', null, 'Blocked. ') : null, ...why.text, why.rule ? [' ', h('code', null, why.rule)] : [])) : null;

  const input = h('input', {
    id: 'inspector', type: 'text', autocomplete: 'name', spellcheck: 'false', placeholder: 'e.g. J. Mendez, receiving inspector',
    value: state.inspector, maxlength: '200', 'aria-describedby': why ? 'approve-reason' : null,
    disabled: why?.blocked || Boolean(held) || Boolean(released) || null,
  });
  input.addEventListener('input', () => {
    state.inspector = input.value;
    store.set('heatlot.inspector', input.value);
    const btn = $('#approve');
    const reason = blockReason(id, r);
    btn.disabled = Boolean(reason) || Boolean(state.busy);
    const current = $('#approve-reason');
    if (reason && !current) renderActions();
    else if (!reason && current) current.remove();
    $('#inspector').focus();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#approve').disabled) runApprove(); });

  const approve = h('div', { class: 'step', id: 'approve-step' },
    h('div', { class: 'field' },
      h('label', { for: 'inspector' }, 'Inspector'),
      input,
      h('button', {
        type: 'button', class: 'btn primary', id: 'approve', disabled: Boolean(why) || Boolean(busy) || null,
        'aria-describedby': why ? 'approve-reason' : null, 'aria-busy': busy === 'approve' ? 'true' : null, onclick: runApprove,
      }, busy === 'approve' ? 'Approving…' : 'Approve release')),
    reasonEl,
    refusedApprove ? outcomeBox('refused', 'Approval refused', refusalWords(refusedApprove.rule, refusedApprove.message), refusedApprove.rule) : null);

  const steps = held ? [] : [approve];
  if (held) {
    steps.push(h('div', { class: 'step', id: 'release-step' },
      h('dl', { class: 'auth', id: 'authorization', 'aria-label': 'Release authorization' },
        h('dt', null, 'Authorization'), h('dd', null, `${short(held.auth.id)} · single use`),
        h('dt', null, 'Approved by'), h('dd', { style: null }, held.by),
        h('dt', null, 'Bound to'), h('dd', null, `decision ${short(held.auth.payload_sha256, 12)}`)),
      h('button', {
        type: 'button', class: `btn wide ${released ? 'outline' : 'dark'}`, id: 'release', disabled: Boolean(busy) || null,
        'aria-busy': busy === 'release' ? 'true' : null, onclick: runRelease,
      }, busy === 'release' ? 'Releasing…' : released ? 'Release again with the same authorization' : 'Release material'),
      released ? outcomeBox('ok', 'Released to stock', `${released.po} · authorization ${short(released.authorization_id)} consumed. The broker will not accept it again.`) : null,
      refusedRelease ? outcomeBox('refused', 'Release refused', refusalWords(refusedRelease.rule, refusedRelease.message), refusedRelease.rule) : null));
  }
  el.replaceChildren(...steps);
}

/* ── receipts ─────────────────────────────────────────────────────── */
async function loadReceipts(id) {
  try {
    const chain = await api(`/api/packets/${id}/receipts`);
    state.receipts.set(id, chain);
  } catch (err) {
    state.receipts.set(id, { error: err.message });
  }
  if (state.open !== id) return;
  const chain = state.receipts.get(id);
  $('#receipts-count').textContent = chain.receipts ? String(chain.receipts.length) : '';
  if (!$('#receipts').hidden) renderReceipts();
}

function renderReceipts() {
  const body = $('#receipts-body');
  const id = state.open;
  $('#receipts-h').textContent = id ? `Receipt chain · ${id}` : 'Receipt chain';
  const chain = id ? state.receipts.get(id) : null;
  if (!chain) { body.replaceChildren(h('p', { class: 'empty', role: 'status' }, 'Loading receipts…')); return; }
  if (chain.error) { body.replaceChildren(h('p', { class: 'empty', role: 'alert' }, `Receipts could not be loaded: ${chain.error}`)); return; }
  if (!chain.receipts.length) {
    body.replaceChildren(h('div', { class: 'empty' }, h('h3', null, 'No receipts yet'), h('p', null, 'Every step leaves a signed receipt. Inspect the packet to start its chain.')));
    return;
  }
  const keyId = chain.receipts[0]?.key_id;
  const seal = chain.verified
    ? h('div', { class: 'seal', id: 'seal', role: 'status' }, icon('seal'),
      h('strong', null, 'Verified · chain and signatures intact'),
      h('span', null, `${chain.receipts.length} receipts · Ed25519 · SHA-256 hash chain`))
    : h('div', { class: 'seal broken', id: 'seal', role: 'alert' }, icon('broken'),
      h('strong', null, `Broken at receipt ${chain.broken_at}`),
      h('span', null, chain.reason ?? 'the chain does not verify'));
  const items = [];
  let run = 0;
  const runs = [];
  for (const rc of chain.receipts) {
    if (rc.kind === 'packet_received' || !runs.length) runs.push([]);
    runs.at(-1).push(rc);
  }
  for (const group of runs) {
    run += 1;
    const kinds = new Set(group.map((x) => x.kind));
    const what = kinds.has('effect_denied') ? 'release attempt' : kinds.has('effect_performed') ? 'release' : kinds.has('authorization_minted') || kinds.has('authorization_refused') ? 'approval' : 'inspection';
    items.push(h('li', { class: 'run-head', 'aria-hidden': 'true' }, `Run ${run} · ${what}`));
    for (const rc of group) {
      const d = describeReceipt(rc);
      const broken = !chain.verified && chain.broken_at !== null && rc.seq >= chain.broken_at;
      items.push(h('li', { class: `receipt${d.tone ? ` ${d.tone}` : ''}${broken ? ' broken-link' : ''}`, dataset: { seq: String(rc.seq), kind: rc.kind } },
        h('span', { class: 'dot', 'aria-hidden': 'true' }, String(rc.seq).padStart(2, '0')),
        h('span', { class: 'what' }, h('span', { class: 'kind' }, h('span', { class: 'sr-only' }, `Receipt ${rc.seq}: `), d.label), d.detail ? h('span', { class: 'detail' }, d.detail) : null),
        h('span', { class: 'hash', title: rc.receipt_sha256 }, h('span', { class: 'sr-only' }, 'hash '), short(rc.receipt_sha256, 10))));
    }
  }
  body.replaceChildren(h('div', { class: 'seal-wrap' }, seal),
    h('p', { class: 'key' }, `Signing key ${short(keyId, 16)} · approval and release each recompute the verdict from the files before they act, so each leaves its own run.`),
    h('ol', { class: 'timeline', 'aria-label': 'Receipts, oldest first' }, ...items));
}

let receiptsReturn = null;
function openReceipts() {
  if (!state.open) return;
  receiptsReturn = document.activeElement;
  $('#receipts').hidden = false;
  $('#receipts-open').setAttribute('aria-expanded', 'true');
  renderReceipts();
  loadReceipts(state.open).then(() => { const b = $('#receipts-body'); b.scrollTop = b.scrollHeight; });
  $('#receipts-h').focus();
}
function closeReceipts({ restoreFocus = true } = {}) {
  if ($('#receipts').hidden) return;
  $('#receipts').hidden = true;
  $('#receipts-open').setAttribute('aria-expanded', 'false');
  if (restoreFocus) (receiptsReturn && document.contains(receiptsReturn) ? receiptsReturn : $('#receipts-open')).focus();
}

/* ── keyboard ─────────────────────────────────────────────────────── */
function nextUntrusted() {
  const r = state.inspections.get(state.open);
  if (!r?.untrusted.length) { announce('No untrusted lines in this packet.'); return; }
  state.untrustedIdx = (state.untrustedIdx + 1) % r.untrusted.length;
  focusLine(r.untrusted[state.untrustedIdx]);
}

function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const help = $('#help');
  if (help.open) return;
  const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
  if (e.key === 'Escape') {
    if (!$('#receipts').hidden) { closeReceipts(); e.preventDefault(); return; }
    if (state.focused) { state.focused = null; viewer.setMarks(marksFor(state.doc)); renderPanel(); }
    return;
  }
  if (typing) return;
  const inList = e.target === $('#queue-list');
  switch (e.key) {
    case 'j': moveCursor(1); $('#queue-list').focus(); break;
    case 'k': moveCursor(-1); $('#queue-list').focus(); break;
    case 'ArrowDown': if (!inList) return; moveCursor(1); break;
    case 'ArrowUp': if (!inList) return; moveCursor(-1); break;
    case 'Home': if (!inList) return; state.cursor = visible()[0]?.packet ?? null; renderQueue(); break;
    case 'End': if (!inList) return; state.cursor = visible().at(-1)?.packet ?? null; renderQueue(); break;
    case 'Enter': if (!inList || !state.cursor) return; openPacket(state.cursor); break;
    case 'f': setFilter(STATUS_ORDER[(STATUS_ORDER.indexOf(state.filter) + 1) % STATUS_ORDER.length]); break;
    case 'i': runInspect(); break;
    case '1': setDoc('mtr'); break;
    case '2': setDoc('coc'); break;
    case 'w': toggleFit(); break;
    case 'u': nextUntrusted(); break;
    case 'a': { const target = $('#inspector:not(:disabled)') ?? $('#approve'); if (target) { target.scrollIntoView({ block: 'nearest' }); target.focus(); } else announce('Inspect the packet first.'); break; }
    case 'r': if ($('#receipts').hidden) openReceipts(); else closeReceipts(); break;
    case '?': openHelp(); break;
    default: return;
  }
  e.preventDefault();
}

function toggleFit() {
  state.fit = state.fit === 'page' ? 'width' : 'page';
  $('#fit-toggle').setAttribute('aria-pressed', String(state.fit === 'width'));
  viewer.setFit(state.fit);
}

let helpReturn = null;
function openHelp() {
  helpReturn = document.activeElement;
  $('#help').showModal();
}

/* ── wiring ───────────────────────────────────────────────────────── */
document.addEventListener('keydown', onKey);
$('#help-open').addEventListener('click', openHelp);
$('#help-close').addEventListener('click', () => $('#help').close());
$('#help').addEventListener('close', () => helpReturn?.focus?.());
$('#help').addEventListener('click', (e) => { if (e.target === $('#help')) $('#help').close(); });
$('#receipts-open').addEventListener('click', () => ($('#receipts').hidden ? openReceipts() : closeReceipts()));
$('#receipts-close').addEventListener('click', () => closeReceipts());
$('#fit-toggle').addEventListener('click', toggleFit);
for (const doc of ['mtr', 'coc']) $(`#tab-${doc}`).addEventListener('click', () => setDoc(doc));
$('#doc-tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  setDoc(state.doc === 'mtr' ? 'coc' : 'mtr', { focusTab: true });
});
$('#queue-list').addEventListener('focus', () => { if (!state.cursor) { state.cursor = visible()[0]?.packet ?? null; renderQueue(); } });
new ResizeObserver(() => $('#viewer').classList.toggle('wide', $('#viewer').clientWidth > 760)).observe($('#viewer'));

renderFilters();
renderQueue();
renderViewerHead();
renderPanel();
renderTabs();
viewer.clear('Open a packet to see its certificates exactly as received.');
loadQueue().then(() => {
  const wanted = new URLSearchParams(location.search).get('packet');
  if (wanted && summaryOf(wanted)) { state.cursor = wanted; openPacket(wanted); }
});
