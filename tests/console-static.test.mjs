/**
 * The console's static routes: served from the API process, never described in the OpenAPI
 * document, locked to the console directory and the named pdf.js files, with a CSP that keeps
 * every request on this origin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApp } from '../src/api/app.mjs';

const app = createApp({ out: mkdtempSync(path.join(tmpdir(), 'heatlot-console-static-')) });

test('console: / serves the console page with a same-origin CSP', async () => {
  const res = await app.request('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /https?:/, 'no third-party origin is allowed');
  const html = await res.text();
  assert.match(html, /<script type="module" src="\/console\/app\.js">/);
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//, 'the page references no external resource');
});

test('console: assets and the two pdf.js files are served with their types', async () => {
  for (const [url, type] of [['/console/app.js', /javascript/], ['/console/styles.css', /text\/css/], ['/vendor/pdfjs/pdf.mjs', /javascript/], ['/vendor/pdfjs/pdf.worker.mjs', /javascript/], ['/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf', /font\/ttf/]]) {
    const res = await app.request(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), type, url);
  }
});

test('console: nothing outside the console directory or the named pdf.js files is reachable', async () => {
  for (const url of ['/console/..%2fpackage.json', '/console/%2e%2e/src/api/app.mjs', '/console/../package.json', '/vendor/pdfjs/pdf.sandbox.mjs', '/vendor/pdfjs/..%2f..%2fpackage.json', '/vendor/pdfjs/standard_fonts/..%2f..%2fpackage.json', '/console/nope.js']) {
    const res = await app.request(url);
    assert.equal(res.status, 404, url);
    assert.equal((await res.json()).error.code, 'not-found', url);
  }
});

test('console: the static routes are not part of the API contract', async () => {
  const doc = await (await app.request('/openapi.json')).json();
  const paths = Object.keys(doc.paths);
  assert.ok(paths.every((p) => p.startsWith('/api/')), paths.join(', '));
});
