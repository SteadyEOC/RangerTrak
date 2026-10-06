/**
 * Builds a region's thumb-drive bundle: volunteer roster + photos named by callsign.
 *
 * CONFIDENTIAL - its output stays in the region folder, never in a repo (D-35).
 *
 * Photos are matched to people by CREDENTIAL NUMBER, not by name: the photo filenames carry
 * codes like VI-0004 (any prefix) and the roster carries `id` (older rosters: `rew`), so the
 * join is exact and needs no worksheet.
 * That is the payoff of D-36 - anchoring identity on the credential number rather than the
 * ham callsign.
 *
 *   node 2-make-drive-bundle.js us/wa/king/vashon
 *
 * Reads <region>/rangers/<name>-roster.json and <region>/sources/photos/, writes
 * <region>/rangers/<name>-roster-and-photos/ and its .zip.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const R = require('./region')()

const ROSTER = process.env.ROSTER || R.at('rangers', `${R.name}-roster.json`)
const PHOTO_DIR = process.env.PHOTO_DIR || R.at('sources', 'photos')
const OUT = process.env.OUT || R.at('rangers', `${R.name}-roster-and-photos`)

const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8')).rangers
// "VI-001" in a filename is the same credential as "VI-0001" in the roster: compare the
// number, not the digits.
const key = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]+)0*(\d)/, '$1$2')
const credOf = r => r.id || r.rew      // `rew` in rosters built before the switch to RangerType.id
// A REW id held by two people (a source-data error) gets no photo: a wrong photo is worse
// than none.
const idCount = {}
roster.filter(credOf).forEach(r => { idCount[key(credOf(r))] = (idCount[key(credOf(r))] || 0) + 1 })
const byRew = new Map(roster.filter(r => credOf(r) && idCount[key(credOf(r))] === 1).map(r => [key(credOf(r)), r]))

function walk(d) {
  let o = []
  if (!fs.existsSync(d)) return o
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) o = o.concat(walk(p))
    else if (/\.(jpe?g|png)$/i.test(e.name)) o.push(p)
  }
  return o
}

// Dedupe by content: the collection stores the same photograph under several names, and
// without this the same face arrives two or three times claiming one callsign.
const clusters = new Map()
for (const p of walk(PHOTO_DIR)) {
  const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  if (!clusters.has(h)) clusters.set(h, [])
  clusters.get(h).push(p)
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'photos'), { recursive: true })

const assigned = new Map()
const place = (ranger, file) => {
  const name = `${ranger.callsign}${path.extname(file).toLowerCase()}`
  fs.copyFileSync(file, path.join(OUT, 'photos', name))
  assigned.set(ranger.callsign, name)
}

// 1. Hand assignments from the crosswalk's `photo` column (a filename anywhere under
//    PHOTO_DIR), joined on uid. These win over the automatic REW-number match.
const IDS = process.env.IDS || R.at('rangers', 'ranger-ids.csv')
const manual = { used: 0, missing: [] }
if (fs.existsSync(IDS)) {
  const rows = fs.readFileSync(IDS, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
  const cells = l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'))
  const h = cells(rows.shift()).map(s => s.trim())
  const byUid = new Map(roster.filter(r => r.uid).map(r => [r.uid, r]))
  const byFile = new Map(walk(PHOTO_DIR).map(p => [path.basename(p).toLowerCase(), p]))
  for (const l of rows.filter(Boolean)) {
    const c = cells(l), photo = (c[h.indexOf('photo')] || '').trim(), ranger = byUid.get((c[h.indexOf('uid')] || '').trim())
    if (!photo || !ranger) continue
    const file = byFile.get(path.basename(photo).toLowerCase())
    if (!file) { manual.missing.push(photo); continue }
    place(ranger, file); manual.used++
  }
}

// 2. Automatic: a credential code in the filename, joined on the roster's id. Any prefix the
//    community uses (VI-0004, DM-12, DSW1234), not only Vashon's VI-: every letters-then-digits
//    token in the cluster's filenames is tried, and the first that IS a roster credential wins.
//    A token that names nobody (IMG1234) simply matches nothing.
for (const group of clusters.values()) {
  const codes = group.flatMap(p => path.basename(p).match(/[A-Z]{1,5}-?\d+/gi) || [])
  const ranger = codes.map(c => byRew.get(key(c))).find(Boolean)
  if (!ranger || assigned.has(ranger.callsign)) continue

  // Prefer the largest file in the cluster - same image, best quality copy.
  place(ranger, group.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0])
}
if (manual.used) console.log(`  photos from ranger-ids.csv: ${manual.used}`)
if (manual.missing.length) console.log(`  WARNING: ranger-ids.csv photos not found under ${PHOTO_DIR}: ${manual.missing.join(', ')}`)

const out = roster.map(r => ({ ...r, image: assigned.get(r.callsign) || '' }))
fs.writeFileSync(path.join(OUT, 'roster.json'), JSON.stringify({ rangers: out }, null, 2))

const teams = {}
out.forEach(r => { teams[r.team || '(none)'] = (teams[r.team || '(none)'] || 0) + 1 })

fs.writeFileSync(path.join(OUT, 'README.txt'),
  `RangerTrak - ${R.name} roster bundle\n` +
  `Built ${new Date().toISOString().slice(0, 10)}\n\n` +
  `roster.json   ${out.length} people\n` +
  `photos/       ${assigned.size} photographs, each named for its callsign\n` +
  `teams         ${Object.entries(teams).map(([k, v]) => `${k}=${v}`).join(', ')}\n\n` +
  `HOW TO LOAD, on the command post browser:\n` +
  `  1. Rangers page -> "Import roster (JSON)" -> pick roster.json\n` +
  `  2. Rangers page -> "Import photos" -> select everything in photos/\n\n` +
  `Both stay on that device. Nothing is uploaded. Photos never leave the browser.\n\n` +
  `CONFIDENTIAL: real names, phone numbers and photographs of volunteers.\n` +
  `Do not email it, do not put it in source control, wipe the drive after the mission.\n`)

// Zip it here rather than leaving a second command to remember.
//
// NOT PowerShell's Compress-Archive: it writes BACKSLASH path separators ("photos\X.jpg"),
// which violates the zip spec (APPNOTE 4.4.17.1, forward slashes required). The app now
// tolerates that, because a volunteer on Windows will reach for Compress-Archive too - but
// the bundle we ship should be correct rather than rely on the reader being forgiving.
const { zipSync } = require('../ham-roster/vendor/fflate.cjs')

const zipName = `${OUT}.zip`
const toZip = {}
const collect = (dir, prefix) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    // Always forward slashes in the archive, whatever the host OS uses on disk.
    const key = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) collect(full, key)
    else toZip[key] = new Uint8Array(fs.readFileSync(full))
  }
}
collect(OUT, '')

try {
  fs.rmSync(zipName, { force: true })
  fs.writeFileSync(zipName, Buffer.from(zipSync(toZip, { level: 6 })))
} catch (e) {
  console.error(`Could not create ${zipName}: ${e.message}`)
  console.error(`Zip the ${OUT}/ folder by hand.`)
}

console.log(`${OUT}/  and  ${zipName}`)
console.log(`  roster.json : ${out.length} people`)
console.log(`  photos/     : ${assigned.size} matched by REW number (exact)`)
console.log(`  teams       : ${Object.entries(teams).map(([k, v]) => `${k}=${v}`).join(', ')}`)
console.log(`  ${out.length - assigned.size} people will show the silhouette.`)
if (fs.existsSync(zipName)) {
  console.log(`\nPut ${zipName} on the thumb drive. ${(fs.statSync(zipName).size / 1048576).toFixed(1)} MB.`)
}
