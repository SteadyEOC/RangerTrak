/**
 * Fails when the app's own TypeScript files import each other in a circle.
 *
 * 2026-11-10 (E-226): shared/header imported Utility from the shared/index.ts barrel, which itself
 * re-exports HeaderComponent and PageComponent. When a bundle happened to load the barrel first,
 * PageComponent's `imports: [HeaderComponent]` read HeaderComponent before it existed, and 8 unit-test
 * files failed with "Cannot read properties of undefined (reading 'ɵcmp')". Services importing
 * their siblings through './' (services/index.ts) made a second, 26-file circle. Import from the
 * file that defines the name, not from your own folder's barrel.
 *
 * Looks at relative value imports and re-exports in src/**\/*.ts (not specs); `import type` is
 * skipped, since it is erased before anything runs.
 *
 *   npm run check:cycles
 */
const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', 'src')
const APP = path.join(SRC, 'app')

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
  for (const candidate of [base + '.ts', path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

// `import x from`, `import { a } from`, `export { a } from`, `export * from`, `import './x'`.
const IMPORT = /^\s*(import|export)\s+(type\s+)?([^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
// `import { type A, type B } from` is type-only too.
const ALL_TYPE_NAMES = /^\s*\{\s*type\s+\w+(\s*,\s*type\s+\w+)*\s*,?\s*\}\s*from\s+$/

const graph = new Map()
for (const file of tsFiles(SRC)) {
  const deps = new Set()
  for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
    if (m[2] || (m[3] && ALL_TYPE_NAMES.test(m[3]))) continue
    const target = resolveImport(file, m[4])
    if (target) deps.add(target)
  }
  graph.set(file, [...deps])
}

// Tarjan's strongly connected components: any component with more than one file is a cycle.
let counter = 0
const stack = [], onStack = new Set(), index = new Map(), low = new Map(), cycles = []
function visit(v) {
  index.set(v, counter); low.set(v, counter); counter++
  stack.push(v); onStack.add(v)
  for (const w of graph.get(v)) {
    if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))) }
    else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)))
  }
  if (low.get(v) === index.get(v)) {
    const group = []
    let w
    do { w = stack.pop(); onStack.delete(w); group.push(w) } while (w !== v)
    if (group.length > 1) cycles.push(group)
  }
}
for (const v of graph.keys()) if (!index.has(v)) visit(v)

const rel = p => path.relative(APP, p).replace(/\\/g, '/')
if (!cycles.length) {
  console.log(`OK: no import cycles among ${graph.size} source files.`)
  process.exit(0)
}
for (const group of cycles) {
  const members = new Set(group)
  console.error(`\nImport cycle (${group.length} files):`)
  for (const f of group.sort()) {
    console.error(`  ${rel(f)} -> ${graph.get(f).filter(d => members.has(d)).map(rel).join(', ')}`)
  }
}
console.error('\nImport each name from the file that defines it, not through a barrel (index.ts) that leads back here.')
process.exit(1)
