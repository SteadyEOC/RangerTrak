/**
 * Fails when one area of src/app imports an area above it (ADR D-73, P6 of the 2026-11 architecture pass).
 *
 * Every folder is put in a layer. An import may go to its own area, to any lower layer, or sideways to another
 * area in the same layer, except that one page never imports another page. Type-only imports count too: they
 * say which way the code depends, even though they are erased at runtime. Specs are not checked.
 *
 *   7 app       the files at the top of src/app (routes, root component, config)
 *   6 pages     entry, map, mission, radio-log, rangers, messages, summary, log, after-action, lazy, x404,
 *               app-shell
 *   5 engines   mapLeaflet (a page may host it; it never imports a page)
 *   4 ui        every other shared/<folder>, the shared/index.ts barrel, map-core
 *   3 services  shared/services
 *   2 infra     shared/storage, shared/export, shared/mapping
 *   1 util      the plain files at the top of shared/ (utility, redact, build-stamp, ...), shared/crypto
 *   0 domain    domain (D-57: it imports only itself; also enforced by ESLint)
 *
 * A new top-level folder fails the check until it is given a layer here. The edges that point the wrong way
 * today are listed in KNOWN, one file at a time, with the reason; each is due to go in the post-1.0 re-filing
 * (Q4/Q5 of the plan). A KNOWN entry that no longer happens also fails, so the list can only shrink.
 *
 *   npm run check:layers
 */
const fs = require('fs')
const path = require('path')

const APP = path.resolve(__dirname, '..', 'src', 'app')

const PAGES = ['entry', 'map', 'mission', 'radio-log', 'rangers', 'messages', 'summary', 'log', 'after-action',
  'lazy', 'x404', 'app-shell']
const LAYER = { domain: 0, util: 1, 'shared/crypto': 1, 'shared/storage': 2, 'shared/export': 2, 'shared/mapping': 2,
  'shared/services': 3, 'map-core': 4, mapLeaflet: 5 }
const NAMES = ['domain', 'util', 'infra', 'services', 'ui', 'engines', 'pages', 'app']

/** Wrong-way edges that exist today: "from file (relative to src/app) -> to area". Remove a line when it is fixed. */
const KNOWN = {
  'shared/storage/unlock-form.ts -> shared/services': 'reaches into the attachment and photo services (plan §3.2)',
  'shared/export/backup-prompts.ts -> shared/services': 'type-only; prompt types live beside the services',
  'shared/export/ics213-pdf.ts -> ui': 'imports the print-brand component for the PDF header',
  'shared/mapping/demo-map.ts -> shared/services': 'demo config, not map code; goes to a demo/ area (Q4)',
  'shared/mapping/location-icon.ts -> shared/services': 'location icon ids are defined in services (Q4)',
  'shared/mapping/location-marker.ts -> shared/services': 'location categories are defined in services (Q4)',
  'shared/mapping/map.ts -> shared/services': 'reads mission settings through the services barrel (Q4)',
  'shared/mapping/report-marker-status.ts -> shared/services': 'status colours are defined in services (Q4)',
  'shared/services/global-error-handler.ts -> ui': 'opens the feedback component on an error',
  'shared/mapping/pmtiles-config.ts -> shared/services': 'demo map regions come from sample-scenarios (Q4)',
  'shared/guide/guide-drawer.component.ts -> pages': 'the guide drawer shows help tabs from lazy/help (plan §4.4)',
}

function areaOf(file) {
  const parts = path.relative(APP, file).replace(/\\/g, '/').split('/')
  if (parts[0].startsWith('..')) return null // outside src/app (environments, ...)
  if (parts.length === 1) return 'app-root'
  if (parts[0] !== 'shared') return parts[0]
  if (parts.length === 2) return parts[1] === 'index.ts' ? 'shared/index' : 'util'
  return 'shared/' + parts[1]
}

function layerOf(area) {
  if (area === 'app-root') return 7
  if (PAGES.includes(area)) return 6
  if (area in LAYER) return LAYER[area]
  if (area === 'shared/index' || area.startsWith('shared/')) return 4
  return undefined
}

/** The KNOWN key's target names an area, or a layer name for a whole layer (ui, pages). */
const keyTargets = (area) => [area, NAMES[layerOf(area)]]

function tsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) tsFiles(p, out)
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) out.push(p)
  }
  return out
}

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), spec)
  for (const candidate of [base + '.ts', path.join(base, 'index.ts')]) if (fs.existsSync(candidate)) return candidate
  return null
}

// tools/coverage-by-layer.js groups its report by the same table.
if (require.main !== module) {
  module.exports = { APP, NAMES, areaOf, layerOf }
  return
}

const IMPORT = /^\s*(import|export)\s+(type\s+)?([^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm

const errors = []
const unplaced = new Set()
const usedKnown = new Set()
let edges = 0
const files = tsFiles(APP)
for (const file of files) {
  const from = areaOf(file)
  const fromLayer = layerOf(from)
  if (fromLayer === undefined) { unplaced.add(from); continue }
  const rel = path.relative(APP, file).replace(/\\/g, '/')
  for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
    const target = resolveImport(file, m[4])
    if (!target) continue
    const to = areaOf(target)
    if (to === null || to === from) continue
    const toLayer = layerOf(to)
    if (toLayer === undefined) { unplaced.add(to); continue }
    edges++
    const ok = toLayer < fromLayer || (toLayer === fromLayer && fromLayer !== 6)
    if (ok) continue
    const key = keyTargets(to).map(t => `${rel} -> ${t}`).find(k => k in KNOWN)
    if (key) { usedKnown.add(key); continue }
    errors.push(`  ${rel} (${from}, ${NAMES[fromLayer]}) imports ${m[4]} (${to}, ${NAMES[toLayer]})`)
  }
}

let failed = false
if (unplaced.size) {
  failed = true
  console.error(`Folders with no layer: ${[...unplaced].join(', ')}. Give each one a layer in tools/check-layers.js (and ADR D-73).`)
}
if (errors.length) {
  failed = true
  console.error(`\n${errors.length} import(s) point up the layers:\n${errors.join('\n')}`)
  console.error('\nMove the shared code down (into domain/, a service, or shared/mapping), or import from a lower layer. See ADR D-73.')
}
const stale = Object.keys(KNOWN).filter(k => !usedKnown.has(k))
if (stale.length) {
  failed = true
  console.error(`\nKNOWN entries that no longer happen (delete them from tools/check-layers.js):\n${stale.map(s => '  ' + s).join('\n')}`)
}
if (failed) process.exit(1)
console.log(`OK: ${edges} cross-area imports among ${files.length} source files all point down the layers (${Object.keys(KNOWN).length} known exceptions).`)
