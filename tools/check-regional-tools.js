// Gate: tools/regional/ holds scripts and docs only, never regional data.
//
// The regional tools (roster-build, ham-roster) read real volunteer tables, ID crosswalks,
// photos and FCC extracts, and write rosters and zips full of names and phone numbers. All of
// that is operator data (ADR D-35) and lives outside every repo, in rangertrak-regional-data\.
// The scripts live here. This check is what keeps the two from mixing: one stray
// `ranger-ids.csv` or `photos/` folder in a commit would publish real people.
//
// Run by CI (deploy.yml) and by the pre-commit hook in .githooks/ (enable it once with
// `git config core.hooksPath .githooks`). .gitignore has a second net for `us/` and
// `ranger-ids*.csv`.
//
// Two rules, both over every file git would track under tools/regional/ (committed, staged,
// or untracked and not ignored):
//   1. File types: .js, .cjs, .md, .txt, or a licence file. Anything else (CSV, JSON, zip,
//      image, .dat) fails, whatever it holds. Demo data is generated at test time into a temp
//      folder (tools/regional/demo/), never committed.
//   2. Contents: no phone number outside the 555-0100..0199 range reserved for fiction, and no
//      email address outside the reserved example domains. The vendored library is skipped.
//
// It prints the file and line of a hit, never the matched value.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DIR = 'tools/regional/'

const ALLOWED = /\.(c?js|md|txt)$/i
const LICENCE = /(^|\.)(LICEN[CS]E|COPYING)(\.|$)/i
const VENDOR = /\/vendor\//

// 206-555-0123, (206) 555 0123, 555-0123, 206.555.0123 - and the same with any other exchange.
const PHONE = /(?<![\d-])(?:\(?\d{3}\)?[\s.-]?)?(\d{3})[\s.-](\d{4})(?![\d-])/g
const fictionalPhone = (exchange, line) => exchange === '555' && /^01\d\d$/.test(line)
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g
const fictionalEmail = (addr) => /@(example\.(com|org|net)|[^@]+\.(example|test|invalid))$/i.test(addr)

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
}

function main() {
  const files = [...new Set([
    ...git('ls-files', '--', DIR),
    ...git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '--', DIR),
    ...git('ls-files', '--others', '--exclude-standard', '--', DIR),
  ])].sort()

  const problems = []
  for (const rel of files) {
    const base = path.basename(rel)
    if (!ALLOWED.test(base) && !LICENCE.test(base)) {
      problems.push(`${rel}: not a script or doc - data files never go in the repo`)
      continue
    }
    if (VENDOR.test(rel) || LICENCE.test(base)) continue
    const full = path.join(ROOT, rel)
    if (!fs.existsSync(full)) continue                 // staged deletion
    fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((text, i) => {
      for (const m of text.matchAll(PHONE)) {
        if (!fictionalPhone(m[1], m[2])) problems.push(`${rel}:${i + 1}: a phone number outside 555-01xx`)
      }
      for (const m of text.matchAll(EMAIL)) {
        if (!fictionalEmail(m[0])) problems.push(`${rel}:${i + 1}: an email address outside the example domains`)
      }
    })
  }

  console.log(`Checked ${files.length} files under ${DIR}`)
  if (!problems.length) {
    console.log('OK: scripts and docs only, no personal contact details.')
    return
  }
  console.error(`\nFAIL: ${DIR} must hold no regional data (ADR D-35).\n`)
  for (const p of new Set(problems)) console.error('  ' + p)
  console.error(`
Real rosters, crosswalks, photos and tool outputs belong in rangertrak-regional-data\\, outside
git. Examples in comments use the fictional demo region (tools/regional/demo/) or 555-01xx.
`)
  process.exit(1)
}

main()
