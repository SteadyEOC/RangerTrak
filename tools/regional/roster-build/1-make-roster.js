/**
 * Builds a RangerTrak roster from the EOC volunteer table, not the FCC licensee dump.
 *
 * CONFIDENTIAL TOOLING - outside every git repo (D-35).
 *
 * The model, per the operator:
 *   - Everyone on a mission has a permanent REW number (WA state, King County administered).
 *     That is the identity anchor.
 *   - Some are also licensed hams. Most hams never show up on a mission - which is why
 *     Rangers.3Feb22.json (every licensee in ZIP 98070/98013) was the wrong roster: it is
 *     mostly people who will never appear, and misses volunteers who are not hams.
 *   - TEW = Temporary Emergency Worker: a day-of volunteer with a temporary number, pending
 *     a 2-3 month credentialling step. The source table already distinguishes these.
 *
 * callsign is what a report gets filed against, so it is the thing said on the radio:
 *   ham callsign if they have one, otherwise the REW/TEW number.
 *
 * ranger-ids.csv is the crosswalk: one row per person tying together every identifier they
 * have - the app's hidden `uid` (ADR D-42 surrogate key), REW/TEW id, name, ham call, previous
 * calls, FCC registration number, photo. It is hand-edited (Excel is fine) and is the ONLY
 * source of ham calls. This script reads it, and appends a row - with a freshly minted uid -
 * for anyone in the volunteer table it has not seen before. A uid is never changed once
 * written: every device that imports the roster then agrees on who is who.
 *
 * To refresh calls: run ../ham-roster with this roster as --club, review club-merge.csv, edit
 * ranger-ids.csv, rebuild.
 *
 *   node 1-make-roster.js us/wa/king/vashon
 *
 * Reads <region>/<roster.volunteers from region.json> and <region>/rangers/ranger-ids.csv,
 * writes <region>/rangers/<name>-roster.json.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const R = require('./region')()

const VOL = process.env.VOL || R.setting(R.cfg.roster && R.cfg.roster.volunteers)
if (!VOL) { console.error(`${R.dir}/region.json has no roster.volunteers, and VOL= is not set`); process.exit(1) }
const IDS = process.env.IDS || R.at('rangers', 'ranger-ids.csv')
const OUT = process.env.OUT || R.at('rangers', `${R.name}-roster.json`)

const IDS_COLUMNS = ['uid', 'id', 'name', 'callsign', 'other_calls', 'frn', 'photo', 'checked', 'source', 'merged_into', 'note']

function parseCsv(t) {
  const rows = []; let row = [], cur = '', q = false
  t = t.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim()))
}
const csvCell = v => /[",\r\n]/.test(v = String(v ?? '')) ? `"${v.replace(/"/g, '""')}"` : v

const idKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const nameKey = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
// Keyed on id AND name: the source table has two people sharing one REW id on purpose
// (e.g. VI-0001 held by two members of one household), so the id alone would merge them.
const personKey = (id, name) => idKey(id) + '|' + nameKey(name)

// ---- the crosswalk ---------------------------------------------------------------------
let idsHead = IDS_COLUMNS.slice(), idsRows = []
if (fs.existsSync(IDS)) {
  const t = parseCsv(fs.readFileSync(IDS, 'utf8'))
  idsHead = t.shift().map(h => h.trim())
  for (const c of IDS_COLUMNS) if (!idsHead.includes(c)) idsHead.push(c)
  idsRows = t.map(r => Object.fromEntries(idsHead.map((h, i) => [h, (r[i] ?? '').trim()])))
}
// Excel strips leading zeros from numbers; an FRN is always 10 digits.
idsRows.forEach(r => { if (/^\d{1,9}$/.test(r.frn)) r.frn = r.frn.padStart(10, '0') })
const byPerson = new Map(idsRows.map(r => [personKey(r.id, r.name), r]))
const uids = new Set(idsRows.map(r => r.uid).filter(Boolean))
const badUids = idsRows.filter(r => !r.uid)
// merged_into: this row is the same person as the row with that uid (e.g. someone issued VI-0002
// and later VI-0003). The merged row stays in the crosswalk for lookup but not in the roster.
const alsoIds = new Map()
idsRows.filter(r => r.merged_into).forEach(r => alsoIds.set(r.merged_into, [...(alsoIds.get(r.merged_into) || []), r.id]))
const newUid = () => { let u; do { u = crypto.randomUUID() } while (uids.has(u)); uids.add(u); return u }

// ---- the volunteer table ---------------------------------------------------------------
const rows = parseCsv(fs.readFileSync(VOL, 'utf8'))
const head = rows.shift().map(h => h.trim())
const col = re => head.findIndex(h => re.test(h))

const iLast = col(/^Last Name$/i), iLastR = col(/^Last Name \(REW\)$/i)
const iFirst = col(/^First Name$/i), iFirstR = col(/^First Name \(REW\)$/i)
const iId = col(/^ID \(REW\)$/i), iKind = col(/^TEW\/REW/i)
const iCell = col(/^Cell Phone$/i), iHome = col(/^Home Phone$/i)
const iTeam = col(/^Team$/i), iAssign = col(/^Assignment$/i), iStatus = col(/^Status$/i)
const iQual = col(/^Qualifications$/i), iOrg = col(/^Organization Name \(REW\)$/i)

const seen = new Set(), sharedIds = new Set(), added = []
const out = []
const stats = { rows: 0, noId: 0, ham: 0, tew: 0, dupes: 0, merged: 0 }
const today = new Date().toISOString().slice(0, 10)

for (const r of rows) {
  if (!r[iLast] && !r[iLastR]) continue
  stats.rows++

  const last = (r[iLast] || r[iLastR] || '').trim()
  const first = (r[iFirst] || r[iFirstR] || '').trim()
  const id = (r[iId] || '').trim()
  const kind = (r[iKind] || '').trim()

  if (!id) { stats.noId++; continue }      // no credential number - cannot be on a mission
  if (/tew/i.test(kind)) stats.tew++

  // One entry per person-and-credential. (This used to dedupe on callsign, which silently
  // dropped a second person whenever the old name match gave two people the same call.)
  const fullName = [first, last].filter(Boolean).join(' ')
  const who = personKey(id, fullName)
  if (seen.has(who)) { stats.dupes++; continue }
  if ([...seen].some(k => k.startsWith(idKey(id) + '|'))) sharedIds.add(id)
  seen.add(who)

  let x = byPerson.get(who)
  if (!x) {
    x = Object.fromEntries(idsHead.map(h => [h, '']))
    Object.assign(x, { uid: newUid(), id, name: fullName, source: `volunteer table, added ${today}`, note: 'new - review' })
    idsRows.push(x); byPerson.set(who, x); added.push(x)
  } else if (!x.uid) x.uid = newUid()
  if (x.merged_into) { stats.merged++; continue }

  const ham = String(x.callsign || '').trim().toUpperCase()
  if (ham) stats.ham++

  // The Team column is empty in every one of these exports. Organization Name (REW) is
  // filled for all credentialled rows and has exactly four values, which is what the
  // team actually is: CERT, EOC, Radio, MRC.
  const org = (r[iOrg] || '').trim()
  const team = (r[iTeam] || '').trim()
    || (/CERT/i.test(org) ? 'CERT' : /Radio/i.test(org) ? 'Radio'
      : /MRC/i.test(org) ? 'MRC' : /EOC/i.test(org) ? 'EOC' : '')

  // Status is hand-typed: "Active"/"active", "Exited"/"EXited", "In Process"/"In process".
  const status = (r[iStatus] || '').trim()
    .replace(/^in process$/i, 'In process')
    .replace(/^active$/i, 'Active')
    .replace(/^exited$/i, 'Exited')
    .replace(/asngmnt/i, 'assignment')

  out.push({
    uid: x.uid,                                    // the app's surrogate key (ADR D-42), from ranger-ids.csv
    callsign: ham || id,                           // the identifier a report is filed against
    fullName,
    phone: (r[iCell] || r[iHome] || '').trim(),
    image: '',                                     // filled by 2-make-drive-bundle.js
    id,                                            // the REW/TEW credential (RangerType.id)
    team,
    role: [/tew/i.test(kind) ? 'TEW' : 'REW', status].filter(Boolean).join(' / '),
    note: [alsoIds.has(x.uid) ? 'also ' + alsoIds.get(x.uid).join(', ') : '', (r[iAssign] || '').trim(), (r[iQual] || '').trim()]
      .filter(Boolean).join(' | ').slice(0, 300),
  })
}

fs.writeFileSync(OUT, JSON.stringify({ rangers: out }, null, 2))
if (added.length || badUids.length) {
  fs.writeFileSync(IDS, '﻿' + [idsHead, ...idsRows.map(r => idsHead.map(h => r[h]))]
    .map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n')
}

console.log(`source rows              : ${stats.rows}`)
console.log(`skipped, no REW/TEW id   : ${stats.noId}`)
console.log(`skipped, duplicate row   : ${stats.dupes}`)
console.log(`skipped, merged into another person: ${stats.merged}`)
console.log(`roster written           : ${out.length}  -> ${OUT}`)
console.log(`  with a ham callsign    : ${stats.ham}   (callsign = ham callsign)`)
console.log(`  without                : ${out.length - stats.ham}   (callsign = REW/TEW number)`)
console.log(`  flagged TEW            : ${stats.tew}`)
console.log(`  with a team            : ${out.filter(r => r.team).length}`)
if (added.length) console.log(`ADDED to ${path.basename(IDS)}: ${added.length} new people with fresh uids - review them`)

const unused = idsRows.filter(r => !seen.has(personKey(r.id, r.name)))
if (unused.length) console.log(`NOTE: ${path.basename(IDS)} rows not in the volunteer table (kept): ${unused.map(r => r.id || r.name).join(', ')}`)
if (sharedIds.size) console.log(`NOTE: REW ids held by more than one person in the source: ${[...sharedIds].join(', ')}`)
const byCall = {}
out.forEach(r => { byCall[r.callsign] = (byCall[r.callsign] || 0) + 1 })
const clash = Object.keys(byCall).filter(c => byCall[c] > 1)
if (clash.length) console.log(`WARNING: call signs used by more than one person: ${clash.join(', ')}`)
