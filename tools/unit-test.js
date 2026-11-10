/**
 * Unit tests (E-226): `ng test` on Angular's Vitest runner, in headless Chrome, run once.
 *
 *   npm test                         every spec, once
 *   npm test -- --include=src/app/domain/heading.spec.ts
 *   npm test -- --filter="Board retry"
 *   npm run test:watch               re-runs on save (stop it with Ctrl+C)
 *
 * Why a wrapper and not plain `ng test`:
 * - Playwright drives the Chrome already installed (CHROME_BIN, found the same way as tools/e2e.js),
 *   so nobody has to download Playwright's own browser.
 * - On Windows, Chrome's profile and its scoped_dir* files go in one run folder under .tmp\, deleted when
 *   the run ends, however it ends (tools/temp-run.js; leftover profiles once slowed Windows sign-in).
 * - On Windows the builder compares paths case-sensitively, and a lowercase d:\ working directory
 *   made every file "not found in TypeScript compilation". The drive letter is forced to upper case.
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { makeTempRun } = require('./temp-run')

function findChrome() { // same search as tools/e2e.js
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN
  const candidates = process.platform === 'win32'
    ? [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  const hit = candidates.find(p => p && fs.existsSync(p))
  if (!hit) throw new Error('Chrome not found. Set CHROME_BIN.')
  return hit
}

const root = path.resolve(__dirname, '..').replace(/^[a-z]:/, d => d.toUpperCase())
const ng = path.join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js')

// The run folder is for Windows, where leftovers in %TEMP% slow sign-in. Elsewhere it would break
// Chrome: its SingletonSocket lives under TMPDIR, and a Unix socket path is capped at ~104-108
// characters, which .tmp/rangertrak-unit-*/_temp/... inside a CI checkout exceeds (CI, 2026-11-10).
// Playwright deletes its own profile there.
const run = process.platform === 'win32' ? makeTempRun('rangertrak-unit-') : null

const child = spawn(process.execPath, [ng, 'test', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...(run ? run.env : process.env), CHROME_BIN: findChrome() },
})
if (run) run.track(child)

child.on('exit', (code, signal) => {
  if (run) run.cleanup()
  process.exit(code ?? (signal ? 1 : 0))
})
