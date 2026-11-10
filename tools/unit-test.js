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
 * - Chrome's profile and its scoped_dir* files go in one run folder under .tmp\ that is deleted when
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
const run = makeTempRun('rangertrak-unit-')
const ng = path.join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js')

const child = run.track(spawn(process.execPath, [ng, 'test', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...run.env, CHROME_BIN: findChrome() },
}))

child.on('exit', (code, signal) => {
  run.cleanup()
  process.exit(code ?? (signal ? 1 : 0))
})
