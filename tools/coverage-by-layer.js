/**
 * P5 (2026-11 architecture pass): unit-test coverage, reported per layer and per area. A report, not a gate.
 *
 * Runs every spec once with coverage on (`ng test --coverage`, @vitest/coverage-v8, through tools/unit-test.js
 * so Chrome's profile stays in the run folder), then groups coverage/coverage-summary.json by the layers in
 * tools/check-layers.js (ADR D-73). The full HTML report is in coverage/ (git-ignored).
 *
 *   npm run test:coverage
 *   npm run test:coverage -- --report-only     re-read the last run without running the tests again
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { NAMES, areaOf, layerOf } = require('./check-layers')

const root = path.resolve(__dirname, '..')
const summaryFile = path.join(root, 'coverage', 'rangertrak', 'coverage-summary.json')
const fallbackSummary = path.join(root, 'coverage', 'coverage-summary.json')

if (!process.argv.includes('--report-only')) {
  const r = spawnSync(process.execPath,
    [path.join(__dirname, 'unit-test.js'), '--coverage', '--coverage-reporters=json-summary', '--coverage-reporters=html'],
    { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('Unit tests failed; no coverage report.')
    process.exit(r.status ?? 1)
  }
}

const file = [summaryFile, fallbackSummary].find(f => fs.existsSync(f))
if (!file) {
  console.error(`No coverage summary found (looked for ${path.relative(root, summaryFile)} and ${path.relative(root, fallbackSummary)}).`)
  process.exit(1)
}
const summary = JSON.parse(fs.readFileSync(file, 'utf8'))

const blank = () => ({ files: 0, lines: 0, covered: 0, branches: 0, bCovered: 0 })
const byArea = new Map()
const byLayer = new Map()
const add = (map, key, s) => {
  const t = map.get(key) ?? blank()
  t.files++; t.lines += s.lines.total; t.covered += s.lines.covered
  t.branches += s.branches.total; t.bCovered += s.branches.covered
  map.set(key, t)
}
for (const [f, s] of Object.entries(summary)) {
  if (f === 'total') continue
  const area = areaOf(path.resolve(root, f))
  if (!area) continue
  const layer = layerOf(area)
  add(byArea, area, s)
  add(byLayer, layer === undefined ? '?' : `${layer} ${NAMES[layer]}`, s)
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-').padStart(5)
const row = (name, t) => `${name.padEnd(28)} ${String(t.files).padStart(5)}  ${pct(t.covered, t.lines)}  ${pct(t.bCovered, t.branches)}`
const head = `${''.padEnd(28)} files  lines  branches`

console.log('\nCoverage by layer (files with at least one spec run against them)\n' + head)
for (const k of [...byLayer.keys()].sort()) console.log(row(k, byLayer.get(k)))
console.log('\nBy area\n' + head)
for (const k of [...byArea.keys()].sort((a, b) => (layerOf(a) ?? 9) - (layerOf(b) ?? 9) || a.localeCompare(b))) console.log(row(k, byArea.get(k)))
const t = summary.total
console.log(`\nTotal: lines ${t.lines.pct}%, branches ${t.branches.pct}%. HTML report: coverage/`)
