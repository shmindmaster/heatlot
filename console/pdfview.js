/**
 * The document viewer: pdf.js renders each page into a canvas at device-pixel resolution, and an
 * absolutely positioned overlay draws boxes from the text layer's line bboxes (PDF points, origin
 * bottom-left), converted through the page viewport so they sit exactly on the rendered text.
 *
 * Supplier text is untrusted: it is only ever written with textContent, never parsed as markup.
 */
import * as pdfjs from '/vendor/pdfjs/pdf.mjs';
import { DOC_ABBR, UNTRUSTED_WHY } from './words.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';

const PAD = 22;
const fmtPt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export class DocViewer {
  constructor({ well, pages, state }) {
    this.well = well;
    this.pagesEl = pages;
    this.stateEl = state;
    this.docs = new Map(); // url -> Promise<PDFDocumentProxy>
    this.current = null; // { key, url, lines, label }
    this.rendered = []; // [{ pageNum, viewport, pageEl, overlay }]
    this.marks = { cited: [], untrusted: [], focused: null };
    this.fit = 'page';
    this.token = 0;
    this.tasks = [];
    let timer = null;
    new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (this.current) this.render(); }, 120);
    }).observe(this.well);
  }

  load(url) {
    if (!this.docs.has(url)) {
      const task = pdfjs.getDocument({ url, isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' });
      const p = task.promise;
      p.catch(() => this.docs.delete(url));
      this.docs.set(url, p);
    }
    return this.docs.get(url);
  }

  clear(message = '') {
    this.token += 1;
    this.current = null;
    this.rendered = [];
    this.pagesEl.replaceChildren();
    this.stateEl.textContent = message;
  }

  async show({ key, url, lines, label }) {
    const same = this.current?.key === key;
    this.current = { key, url, lines, label, byRef: new Map(lines.map((l) => [`${l.page}:${l.line}`, l])) };
    if (!same) this.well.scrollTop = 0;
    await this.render();
  }

  setFit(fit) {
    this.fit = fit;
    if (this.current) this.render();
  }

  /** cited: [{page,line}], untrusted: [{page,line,why}], focused: {page,line} | null */
  setMarks(marks) {
    this.marks = { cited: [], untrusted: [], focused: null, ...marks };
    this.drawAll();
  }

  async render() {
    const token = ++this.token;
    const { url, label } = this.current;
    for (const t of this.tasks) t.cancel();
    this.tasks = [];
    if (!this.rendered.length) this.stateEl.textContent = `Loading ${label}…`;
    let pdf;
    try {
      pdf = await this.load(url);
    } catch (err) {
      if (token === this.token) { this.pagesEl.replaceChildren(); this.stateEl.textContent = `Could not open ${label}: ${err.message}`; }
      return;
    }
    if (token !== this.token) return;
    const width = this.well.clientWidth - PAD * 2;
    const height = this.well.clientHeight - PAD * 2;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const built = [];
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      if (token !== this.token) return;
      const base = page.getViewport({ scale: 1 });
      const fitWidth = width / base.width;
      const scale = Math.max(0.3, this.fit === 'width' ? Math.min(fitWidth, 2.5) : Math.min(fitWidth, height / base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${label}, page ${n} of ${pdf.numPages}, as received`);
      const pageEl = document.createElement('div');
      pageEl.className = 'page';
      pageEl.dataset.page = String(n);
      pageEl.style.width = canvas.style.width;
      pageEl.style.height = canvas.style.height;
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      pageEl.append(canvas, overlay);
      frag.append(pageEl);
      const task = page.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      this.tasks.push(task);
      built.push({ pageNum: n, viewport, pageEl, overlay, done: task.promise });
    }
    this.pagesEl.replaceChildren(frag);
    this.rendered = built;
    this.drawAll();
    try {
      await Promise.all(built.map((b) => b.done));
    } catch (err) {
      if (err?.name === 'RenderingCancelledException') return;
      if (token === this.token) this.stateEl.textContent = `Could not render ${label}: ${err.message}`;
      return;
    }
    if (token !== this.token) return;
    this.stateEl.textContent = '';
    this.pagesEl.dataset.rendered = this.current.key;
  }

  rect(viewport, line) {
    // PDF points (origin bottom-left) -> CSS pixels (origin top-left) through the page transform.
    const [x1, y1] = viewport.convertToViewportPoint(line.bbox[0], line.bbox[1]);
    const [x2, y2] = viewport.convertToViewportPoint(line.bbox[2], line.bbox[3]);
    let left = Math.min(x1, x2) - 4;
    let top = Math.min(y1, y2) - 3;
    let w = Math.abs(x2 - x1) + 8;
    let hgt = Math.abs(y2 - y1) + 6;
    if (hgt < 12) { top -= (12 - hgt) / 2; hgt = 12; }
    if (w < 24) { left -= (24 - w) / 2; w = 24; }
    return { left, top, width: w, height: hgt };
  }

  drawAll() {
    if (!this.current) return;
    const { byRef } = this.current;
    const { cited, untrusted, focused } = this.marks;
    const isFocused = (m) => focused && focused.page === m.page && focused.line === m.line;
    for (const { pageNum, viewport, overlay, pageEl } of this.rendered) {
      overlay.replaceChildren();
      const seen = new Set();
      const place = (m, cls) => {
        const line = byRef.get(`${m.page}:${m.line}`);
        if (!line || m.page !== pageNum) return null;
        const r = this.rect(viewport, line);
        const box = document.createElement('div');
        box.className = `box ${cls}${isFocused(m) ? ' focused' : ''}`;
        box.dataset.doc = this.current.key.split('/')[1];
        box.dataset.page = String(m.page);
        box.dataset.line = String(m.line);
        Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        overlay.append(box);
        return { box, line, r };
      };
      for (const m of untrusted) {
        const key = `${m.page}:${m.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const placed = place(m, `untrusted ${m.why === 'hidden-text' ? 'hidden-line' : 'instruction-line'}`);
        if (!placed) continue;
        const tag = document.createElement('span');
        tag.className = 'box-label';
        tag.textContent = m.why === 'hidden-text' ? `hidden text (${fmtPt(placed.line.font_pt)} pt)` : (UNTRUSTED_WHY[m.why] ?? m.why).toLowerCase();
        placed.box.append(tag);
      }
      for (const m of cited) {
        const key = `${m.page}:${m.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        place(m, 'cited');
      }
      if (focused && focused.page === pageNum && !seen.has(`${focused.page}:${focused.line}`)) place(focused, 'cited');
      if (focused && focused.page === pageNum) this.caption(overlay, pageEl, viewport, focused, untrusted.find((u) => isFocused(u)));
    }
  }

  caption(overlay, pageEl, viewport, focused, untrustedMark) {
    const line = this.current.byRef.get(`${focused.page}:${focused.line}`);
    if (!line) return;
    const r = this.rect(viewport, line);
    const cap = document.createElement('div');
    cap.className = `caption${untrustedMark ? ' untrusted' : ''}`;
    cap.id = 'line-caption';
    const ref = document.createElement('span');
    ref.className = 'cap-ref';
    const doc = this.current.key.split('/')[1];
    ref.textContent = `${DOC_ABBR[doc]} p${line.page} · l${line.line}${untrustedMark ? ` · ${untrustedMark.why === 'hidden-text' ? `hidden, ${fmtPt(line.font_pt)} pt` : 'addressed to a reviewer'}` : ''}`;
    const text = document.createElement('span');
    text.textContent = line.text;
    cap.append(ref, text);
    overlay.append(cap);
    const pageW = viewport.width;
    const pageH = viewport.height;
    const cw = cap.offsetWidth;
    const ch = cap.offsetHeight;
    const left = Math.max(8, Math.min(r.left, pageW - cw - 8));
    const labelGap = untrustedMark ? 30 : 8;
    const below = r.top + r.height + 8 + ch < pageH - 8;
    const top = below && !untrustedMark ? r.top + r.height + 8 : r.top - labelGap - ch;
    Object.assign(cap.style, { left: `${left}px`, top: `${Math.max(8, top)}px` });
  }

  scrollToFocused() {
    const f = this.marks.focused;
    if (!f) return;
    const box = this.pagesEl.querySelector(`.box[data-page="${f.page}"][data-line="${f.line}"]`);
    box?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}
