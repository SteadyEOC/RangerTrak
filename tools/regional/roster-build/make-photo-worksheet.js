/**
 * Builds a thumb-drive roster bundle: roster JSON + photos renamed to callsign.
 *
 * CONFIDENTIAL TOOLING. Its data stays in the region folder, never in a repo. Its inputs and
 * its output both contain real names, addresses, phone numbers and photographs of identifiable
 * people (the Architectural Decision Record, D-35).
 *
 *   node make-photo-worksheet.js worksheet us/wa/king/vashon   # write <region>/rangers/photo-callsign-map.csv
 *   node make-photo-worksheet.js build us/wa/king/vashon       # read it, emit <region>/rangers/out/ ready to zip
 *
 * Why a worksheet instead of just matching automatically: matching photo filenames to the
 * FCC-derived roster by name yields 14 of 122, with 6 callsigns claiming more than one
 * photo. A photo beside a callsign is an identity confirmation for someone working under
 * stress - a WRONG one is worse than none, because a missing photo shows a silhouette and
 * announces itself, while a wrong one quietly misleads. So automatic matches are proposals
 * for a human to confirm, never the final answer.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const R = require('./region')(process.argv.slice(3))

const ROSTER = process.env.ROSTER || R.at('sources', 'fcc', 'Rangers.3Feb22.json')
// <region>/sources/photos (formerly archived/REW) is the complete set - 89 distinct images by content hash, and every image
// in the wider tree is a subset of it. Backup.18Jul2022/.../rew holds only 36 and adds
// nothing. Its "Photos of the people" subfolder contributes alternate versions of a few
// people, no new people.
const PHOTO_DIRS = (process.env.PHOTO_DIRS || R.at('sources', 'photos')).split(';')
// Overridable because this file gets opened in Excel, which locks it.
const MAP_CSV = process.env.MAP_CSV || R.at('rangers', 'photo-callsign-map.csv')
const OUT = R.at('rangers', 'out')

/** Generic silhouettes, not people - they are the fallback, never a roster photo. */
const PLACEHOLDERS = /^(male|female|androgynous|person)\.(png|jpe?g)$/i

/**
 * King County's Registered Emergency Worker table, which is what the VI-#### codes in the
 * photo filenames actually are. Optional: without it, VI-numbered photos are anonymous and
 * a human has to recognise the face. With it, 30 of the 43 numbered photos resolve to a
 * name automatically.
 */
const REW_CSV = process.env.REW_CSV || R.setting(R.cfg.roster && R.cfg.roster.rewMerged) || ''

const norm = s => String(s).toLowerCase()
  .replace(/\.(jpe?g|png)$/i, '')
  .replace(/vi-?\d+/gi, ' ')          // VI-0004 style REW codes are not name tokens
  .replace(/\b(photo|eoc|darker|medium|crop|orig|copy)\b/gi, ' ')
  .replace(/[^a-z]+/g, ' ').trim().split(/\s+/).filter(t => t.length > 1)

function walk(dir) {
  let out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out = out.concat(walk(p))
    else if (/\.(jpe?g|png)$/i.test(e.name)) out.push(p)
  }
  return out
}

const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8'))
const photos = PHOTO_DIRS.flatMap(walk)

/** Best-guess callsign for a photo, with a confidence score (number of shared name tokens). */
function propose(photoPath) {
  const pt = new Set(norm(path.parse(photoPath).name))
  let best = null, score = 0
  for (const e of roster) {
    const lt = new Set(norm(e.licensee || e.fullName || ''))
    let n = 0
    for (const t of pt) if (lt.has(t)) n++
    if (n > score) { score = n; best = e }
  }
  return { callsign: score >= 2 ? best.callsign : '', score }
}

const csvEscape = s => /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s)

/**
 * Groups files by CONTENT hash, not filename. The collection stores the same photograph
 * under several names, which matters twice over:
 *
 *  - one row per image instead of per file, so a human corrects 89 rows and not 122; and
 *  - the *set* of names for one image is itself evidence. Where a cluster contains a
 *    filename that IS a roster callsign, the mapping is decoded outright with no name
 *    guessing at all - "Pat.Example.VI-0004.jpg" and "N0CALL.jpg" being the same
 *    bytes proves VI-0004 is N0CALL.
 *
 * Before this, those aliases looked like several photos competing for one callsign, and
 * the build refused to run.
 */
function clusterByContent(files) {
  const byHash = new Map()
  for (const p of files) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    if (!byHash.has(hash)) byHash.set(hash, [])
    byHash.get(hash).push(p)
  }
  return [...byHash.values()]
}

/** VI-#### -> {first,last}, from the REW table. Empty if the table is not present. */
function loadRewTable() {
  const byVi = new Map()
  if (!fs.existsSync(REW_CSV)) return byVi
  const rows = parseCsv(fs.readFileSync(REW_CSV, 'utf8'))
  const head = rows.shift().map(h => h.replace(/^﻿/, '').trim())
  const iId = head.findIndex(h => /^ID \(REW\)/i.test(h))
  const iLast = head.findIndex(h => /^LAST NAME$/i.test(h))
  const iFirst = head.findIndex(h => /^FIRST NAME$/i.test(h))
  if (iId < 0) return byVi
  for (const r of rows) {
    const id = (r[iId] || '').trim()
    if (!id) continue
    byVi.set(id.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]+)0*(\d)/, '$1$2'), {
      last: (r[iLast] || '').trim(), first: (r[iFirst] || '').trim(),
    })
  }
  return byVi
}

if (process.argv[2] === 'worksheet') {
  const callsigns = new Map(roster.map(e => [String(e.callsign).trim().toUpperCase(), String(e.callsign).trim()]))
  const clusters = clusterByContent(photos)
  const rew = loadRewTable()

  const nrm = s => String(s).toLowerCase().replace(/[^a-z]/g, '')
  /** Roster entry whose licensee looks like this REW person. */
  const rosterFor = person => roster.find(e => {
    const L = nrm(e.licensee || e.fullName || '')
    const last = nrm(person.last), first = nrm(person.first)
    return last.length > 2 && first.length > 2 && L.includes(last) && L.includes(first.slice(0, 4))
  })

  const rows = [['image', 'aka', 'vi_code', 'rew_name', 'suggested_callsign', 'how', 'CORRECTED_CALLSIGN']]
  let decoded = 0, guessed = 0, placeholders = 0, named = 0

  for (const group of clusters) {
    const names = group.map(p => path.basename(p))
    if (names.every(n => PLACEHOLDERS.test(n))) { placeholders++; continue }

    // 1. Strongest: a filename that IS a callsign in the roster.
    let callsign = '', how = 'NONE'
    for (const n of names) {
      const stem = path.parse(n).name.trim().toUpperCase()
      if (callsigns.has(stem)) { callsign = callsigns.get(stem); how = 'filename-is-callsign'; break }
    }

    const vi = names.map(n => (n.match(/VI-?\d+/i) || [])[0]).filter(Boolean)[0] || ''

    // 2. The REW table turns a bare VI-#### into a person. Even when that person is not
    //    in the roster, having the NAME on the row is most of the work: it turns
    //    "VI-0005.jpg -> ?" into "VI-0005.jpg -> <person> -> which callsign?", which
    //    someone who knows the team can answer at a glance.
    let rewName = ''
    if (vi) {
      const person = rew.get(vi.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]+)0*(\d)/, '$1$2'))
      if (person) {
        rewName = `${person.last}, ${person.first}`.replace(/^, |, $/, '')
        named++
        if (!callsign) {
          const hit = rosterFor(person)
          if (hit) { callsign = hit.callsign; how = 'rew-table'; decoded++ }
        }
      }
    }

    // 3. Last resort: match the photo's filename against roster names.
    if (!callsign) {
      const best = group.map(propose).sort((a, b) => b.score - a.score)[0]
      if (best.score >= 2) { callsign = best.callsign; how = `name-match(${best.score})`; guessed++ }
    } else if (how === 'filename-is-callsign') {
      decoded++
    }

    rows.push([
      path.relative('.', group[0]),
      names.length > 1 ? names.slice(1).join(' | ') : '',
      vi, rewName, callsign, how, callsign,
    ])
  }

  fs.writeFileSync(MAP_CSV, rows.map(r => r.map(csvEscape).join(',')).join('\n'))
  console.log(`${photos.length} files -> ${clusters.length} distinct images (by content hash).`)
  console.log(`  ${placeholders} generic silhouettes skipped (male/female placeholders).`)
  console.log(`  ${rew.size ? rew.size + ' REW ids loaded' : 'REW table NOT found - VI codes stay anonymous'}`)
  console.log(`  ${decoded} decoded (filename is a callsign, or REW table -> roster).`)
  console.log(`  ${guessed} proposed by name match - CHECK THESE.`)
  console.log(`  ${named} rows carry a person's name from the REW table, which makes the rest answerable.`)
  console.log(`  ${rows.length - 1 - decoded - guessed} still need a callsign from you.`)
  console.log(`\nWrote ${MAP_CSV}. Edit CORRECTED_CALLSIGN (blank = skip), then: node make-photo-worksheet.js build ${R.dir}`)
  process.exit(0)
}

if (process.argv[2] !== 'build') {
  console.log('usage: node make-photo-worksheet.js worksheet|build <region folder>')
  process.exit(1)
}

if (!fs.existsSync(MAP_CSV)) {
  console.error(`Missing ${MAP_CSV}. Run: node make-photo-worksheet.js worksheet ${R.dir}`)
  process.exit(1)
}

// Minimal CSV read - the worksheet is machine-written, but a human edits it, so handle quotes.
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

const csv = parseCsv(fs.readFileSync(MAP_CSV, 'utf8'))
const header = csv.shift()
const iFile = header.indexOf('image'), iFix = header.indexOf('CORRECTED_CALLSIGN')
if (iFile < 0 || iFix < 0) {
  // This silently produced a bundle with zero photos when the worksheet columns were
  // renamed - a build that "succeeds" while doing nothing is the worst failure mode here.
  console.error(`${MAP_CSV} is missing an "image" or "CORRECTED_CALLSIGN" column. Regenerate it with: node make-photo-worksheet.js worksheet ${R.dir}`)
  process.exit(1)
}

const byCallsign = new Map()
const conflicts = []
for (const r of csv) {
  if (!r[iFile]) continue
  const cs = (r[iFix] || '').trim()
  if (!cs) continue
  if (byCallsign.has(cs)) { conflicts.push(cs); continue }
  byCallsign.set(cs, r[iFile])
}

if (conflicts.length) {
  console.error(`Two photos claim the same callsign: ${[...new Set(conflicts)].join(', ')}.`)
  console.error('Resolve in the worksheet - a callsign can only have one face.')
  process.exit(1)
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'photos'), { recursive: true })

const known = new Set(roster.map(e => String(e.callsign).trim()))
const unknown = [...byCallsign.keys()].filter(c => !known.has(c))
if (unknown.length) {
  console.error(`Callsigns not in the roster: ${unknown.join(', ')}`)
  process.exit(1)
}

let copied = 0
const out = roster.map(e => {
  const callsign = String(e.callsign).trim()
  const src = byCallsign.get(callsign)
  let image = ''
  if (src) {
    const ext = path.extname(src).toLowerCase()
    // Rename to the callsign: the app joins on callsign, and it also strips the person's
    // name out of the filename, which is one less place the identity leaks.
    image = `${callsign}${ext}`
    fs.copyFileSync(src, path.join(OUT, 'photos', image))
    copied++
  }
  return {
    callsign,
    fullName: e.fullName ?? e.licensee ?? '',
    phone: e.phone ?? '',
    image, id: e.id ?? e.rew ?? '', team: e.team ?? '',
    role: e.role ?? e.status ?? '', note: e.note ?? '',
  }
})

fs.writeFileSync(path.join(OUT, 'roster.json'), JSON.stringify({ rangers: out }, null, 2))
fs.writeFileSync(path.join(OUT, 'README.txt'),
  `RangerTrak roster bundle\n\n` +
  `roster.json  - ${out.length} rangers\n` +
  `photos/      - ${copied} photographs, each named for its callsign\n\n` +
  `CONFIDENTIAL: real names, addresses, phone numbers and photographs.\n` +
  `Load it into the command post browser before the mission. Do not email it,\n` +
  `do not put it in source control, and wipe the drive when the mission is over.\n`)

console.log(`Built ${OUT}/`)
console.log(`  roster.json : ${out.length} rangers`)
console.log(`  photos/     : ${copied} photographs, renamed to callsign`)
console.log(`  ${out.length - copied} rangers have no photo and will show the silhouette.`)
