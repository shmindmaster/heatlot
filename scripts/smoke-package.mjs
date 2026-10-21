#!/usr/bin/env node
/**
 * npm run smoke:package — pack heatlot exactly as npm would publish it, install the tarball into
 * an empty directory, and run the CLI from there. Proves the published package works on its own:
 * no repository files, no dev dependencies, output written to the caller's directory.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const work = mkdtempSync(path.join(tmpdir(), 'heatlot-pack-'));
const shell = process.platform === 'win32';
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

try {
  const [{ filename, files }] = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', work], { cwd: REPO_ROOT, encoding: 'utf8', shell }));
  const paths = files.map((f) => f.path);
  check('tarball carries the CLI, the library, the API, the MCP server and the demo packets',
    ['bin/heatlot.mjs', 'src/inspection/inspect.mjs', 'src/api/app.mjs', 'mcp-servers/heatlot/src/server.mjs', 'data/packets/PKT-24002/mtr.pdf', 'fixtures/extraction/PKT-24002.json'].every((p) => paths.includes(p)));
  check('tarball leaves out tests, scripts and the foundry example', !paths.some((p) => /^(tests|tests-browser|scripts|evals|src\/providers|src\/effects|data\/docs)\//.test(p)));
  const app = path.join(work, 'app');
  execFileSync(npm, ['init', '-y'], { cwd: (writeFileSync(path.join(work, '.keep'), ''), work), stdio: 'ignore', shell });
  execFileSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--prefix', app, path.join(work, filename)], { stdio: 'ignore', shell });
  const bin = path.join(app, 'node_modules', 'heatlot', 'bin', 'heatlot.mjs');
  const demo = spawnSync(process.execPath, [bin, 'demo'], { cwd: app, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', HEATLOT_OUT: '' } });
  check('installed `heatlot demo` exits 3 (INCOMPLETE) and names the missing tensile test', demo.status === 3 && /required-test-missing:tensile/.test(demo.stdout), `exit ${demo.status} ${demo.stderr.slice(0, 300)}`);
  check('output goes to the working directory, not into node_modules', existsSync(path.join(app, '.heatlot')) && !existsSync(path.join(app, 'node_modules', 'heatlot', '.heatlot')));
  const ok = spawnSync(process.execPath, [bin, 'verify', path.join(app, 'node_modules', 'heatlot', 'data', 'packets', 'PKT-24002R')], { cwd: app, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', HEATLOT_OUT: '' } });
  check('installed `heatlot verify` accepts the corrected resubmission', ok.status === 0, `exit ${ok.status}`);
  check('one tarball written', readdirSync(work).filter((f) => f.endsWith('.tgz')).length === 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `\npackage smoke: ${failed} FAILED` : '\npackage smoke: all checks passed');
process.exit(failed ? 1 : 0);
