#!/usr/bin/env node
/**
 * ham-roster - a current list of licensed amateur radio operators in your area, built from the
 * FCC's public license file and optionally merged with your own club or team list.
 *
 * Everything runs on this machine. The only network call is the optional `download` step,
 * which fetches the FCC's public file and sends nothing. Your club list is read locally and
 * never leaves the computer.
 *
 *   node ham-roster.js download --out <dir>
 *       Fetch l_amat.zip (about 200 MB, refreshed by the FCC every Sunday). Or download it
 *       yourself from https://data.fcc.gov/download/pub/uls/complete/l_amat.zip
 *
 *   node ham-roster.js build --fcc <l_amat.zip | folder of .dat files> --zips 98070,98013
 *                            [--club <list.csv | roster.json>] [--out <dir>] [--all]
 *       --zips      ZIP codes that make up your area (comma-separated, or a text file, one per line)
 *       --states    alternative to --zips: two-letter states, e.g. WA,OR
 *       --club      your list. CSV with a call sign column, and/or name columns. A RangerTrak
 *                   roster export (JSON) works too.
 *       --all       keep expired and cancelled licenses in region-hams.csv (default: active
 *                   and still-renewable only)
 *
 * Outputs, all in --out (default ./ham-roster-out):
 *   region-hams.csv          one row per person licensed in your area
 *   club-merge.csv           (with --club) every club entry matched, or not, plus area hams
 *                            who are not on the club list
 *   rangertrak-roster.json   ready for RangerTrak: Rangers page > Import roster
 *   README.txt               where the data came from, and the counts
 *
 * Nothing here decides who is still alive. The FCC does not record deaths and a license runs
 * ten years, so "active" means "licensed", not "here". Every match below a call-sign match is
 * a proposal for a person to confirm.
 */
const fs = require('fs')
const path = require('path')

const FCC_URL = 'https://data.fcc.gov/download/pub/uls/complete/l_amat.zip'
const GRACE_YEARS = 2                 // FCC lets an expired license be renewed for two years

// Field positions (0-based) from the FCC's public_access_database_definitions, tables EN/HD/AM.
const EN = { usi: 1, call: 4, entityType: 5, entityName: 7, first: 8, mi: 9, last: 10, suffix: 11, phone: 12,
  email: 14, street: 15, city: 16, state: 17, zip: 18, poBox: 19, frn: 22 }
const HD = { usi: 1, call: 4, status: 5, service: 6, grant: 7, expired: 8, cancelled: 9,
  effective: 42, lastAction: 43 }
const AM = { usi: 1, call: 4, opClass: 5, prevCall: 15, prevClass: 16 }

const CLASS = { E: 'Extra', A: 'Advanced', G: 'General', T: 'Technician', N: 'Novice', P: 'Technician Plus' }
const STATUS = { A: 'Active', E: 'Expired', C: 'Cancelled', T: 'Terminated' }

// ---------------------------------------------------------------------------------------------
// arguments

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]
      else out[k] = true
    } else out._.push(a)
  }
  return out
}

function listArg(v) {
  if (!v || v === true) return []
  if (fs.existsSync(v) && fs.statSync(v).isFile()) v = fs.readFileSync(v, 'utf8')
  return String(v).split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------------------------
// reading the FCC file

/**
 * Stream the named record files (EN.dat, HD.dat, ...) out of l_amat.zip, or out of a folder the
 * user unzipped by hand, calling handlers[type](fields) for each record. Only the requested
 * entries are inflated; the rest of the zip is skipped.
 */
async function scan(source, handlers) {
  const types = Object.keys(handlers)
  const isDir = fs.statSync(source).isDirectory()

  const makeSink = type => {
    const decoder = new TextDecoder('windows-1252')
    const prefix = type + '|'
    let carry = '', pending = null
    const flush = () => { if (pending !== null) handlers[type](pending.split('|')); pending = null }
    const line = l => {
      if (l.startsWith(prefix)) { flush(); pending = l }
      else if (pending !== null && l) pending += ' ' + l     // a stray newline inside a field
    }
    return {
      push(chunk, final) {
        const text = carry + decoder.decode(chunk, { stream: !final })
        const lines = text.split(/\r?\n/)
        carry = final ? '' : lines.pop()
        lines.forEach(line)
        if (final) { if (carry) line(carry); flush() }
      },
    }
  }

  if (isDir) {
    for (const type of types) {
      const file = path.join(source, `${type}.dat`)
      if (!fs.existsSync(file)) throw new Error(`${file} not found`)
      const sink = makeSink(type)
      for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) sink.push(chunk, false)
      sink.push(new Uint8Array(0), true)
    }
    return
  }

  const { Unzip, UnzipInflate } = require('./vendor/fflate.cjs')
  const seen = new Set()
  await new Promise((resolve, reject) => {
    const unzip = new Unzip()
    unzip.register(UnzipInflate)
    unzip.onfile = file => {
      const type = path.basename(file.name).replace(/\.dat$/i, '').toUpperCase()
      if (!types.includes(type)) return
      seen.add(type)
      const sink = makeSink(type)
      file.ondata = (err, chunk, final) => {
        if (err) return reject(err)
        try { sink.push(chunk, final) } catch (e) { reject(e) }
      }
      file.start()
    }
    const stream = fs.createReadStream(source, { highWaterMark: 1 << 20 })
    stream.on('data', chunk => { try { unzip.push(chunk) } catch (e) { reject(e); stream.destroy() } })
    stream.on('end', () => { try { unzip.push(new Uint8Array(0), true); resolve() } catch (e) { reject(e) } })
    stream.on('error', reject)
  })
  const missing = types.filter(t => !seen.has(t))
  if (missing.length) throw new Error(`${source} has no ${missing.join('/')}.dat - is it l_amat.zip?`)
}

// ---------------------------------------------------------------------------------------------
// small helpers

const upper = s => String(s || '').trim().toUpperCase()
const normCall = s => upper(s).replace(/[^A-Z0-9]/g, '')
const isUsCall = s => /^(A[A-L]|[KNW][A-Z]?)\d[A-Z]{1,3}$/.test(s)
const nameKey = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')

/** Loose: either side's surname appears inside the other's full name ("de la Fern", "Hollow Brook"). */
function sameSurname(c, p) {
  const cl = nameKey(c.last), pl = nameKey(p.last)
  return !!(cl && pl && (cl === pl || nameKey(p.name).includes(cl) || nameKey(c.name).includes(pl)))
}

function fccDate(s) {                       // mm/dd/yyyy -> yyyy-mm-dd
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim())
  return m ? `${m[3]}-${m[1]}-${m[2]}` : ''
}

/** FCC names are often ALL CAPS. Only recase those; leave mixed-case names as typed. */
function properCase(s) {
  s = String(s || '').trim().replace(/\s+/g, ' ')
  if (!s || s !== s.toUpperCase()) return s
  return s.toLowerCase()
    .replace(/(^|[\s\-'/.(])([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
    .replace(/\b(Ii|Iii|Iv|Po|Nw|Ne|Sw|Se)\b/g, w => w.toUpperCase())
}

function csvEscape(v) {
  v = v == null ? '' : String(v)
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
function writeCsv(file, header, rows) {
  const lines = [header, ...rows.map(r => header.map(h => r[h]))]
  fs.writeFileSync(file, '﻿' + lines.map(l => l.map(csvEscape).join(',')).join('\r\n') + '\r\n')
}

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

// ---------------------------------------------------------------------------------------------
// the club list

/**
 * Accepts a CSV (any columns; we look for a call sign column and name columns) or a RangerTrak
 * roster export. Returns [{ call, name, first, last, id, row }]. `id` is whatever the team uses
 * as its own key (REW#, member number) so results can be joined back.
 */
function readClub(file) {
  const text = fs.readFileSync(file, 'utf8')
  let header, rows
  if (/\.json$/i.test(file)) {
    const j = JSON.parse(text.replace(/^﻿/, ''))
    const list = Array.isArray(j) ? j : j.rangers || j.roster || []
    header = [...new Set(list.flatMap(o => Object.keys(o)))]
    rows = list.map(o => header.map(h => o[h] == null ? '' : String(o[h])))
  } else {
    const all = parseCsv(text)
    header = all.shift().map(h => h.trim())
    rows = all
  }
  const find = (...res) => { for (const re of res) { const i = header.findIndex(h => re.test(h)); if (i >= 0) return i } return -1 }
  const iCall = find(/^call\s*sign$/i, /^callsign$/i, /^call$/i, /call/i)
  const iFirst = find(/^first\s*name$/i, /^first$/i, /first/i)
  const iLast = find(/^last\s*name$/i, /^last$/i, /^surname$/i, /last/i)
  const iName = find(/^full\s*name$/i, /^fullname$/i, /^name$/i, /^licensee$/i, /name/i)
  const iId = find(/^rew$/i, /rew/i, /^member/i, /^id$/i)
  if (iCall < 0 && iName < 0 && iLast < 0) throw new Error(`${file}: no call sign or name column found in: ${header.join(', ')}`)

  return rows.map((r, n) => {
    let first = iFirst >= 0 ? r[iFirst] : '', last = iLast >= 0 ? r[iLast] : ''
    let name = iName >= 0 ? r[iName] : [first, last].filter(Boolean).join(' ')
    if (!last && name) {                      // "Last, First" or "First Last"
      const comma = name.split(',')
      if (comma.length === 2 && !/^\s*(jr|sr|i{2,3}|iv)\.?\s*$/i.test(comma[1])) { last = comma[0]; first = comma[1] }
      else { const w = name.trim().split(/\s+/); last = w[w.length - 1]; first = w[0] }
    }
    const raw = iCall >= 0 ? normCall(r[iCall]) : ''
    return {
      row: n + 2, id: iId >= 0 ? String(r[iId] || '').trim() : '',
      call: isUsCall(raw) ? raw : '', name: String(name || '').trim(),
      first: String(first || '').trim(), last: String(last || '').trim(),
    }
  })
}

// ---------------------------------------------------------------------------------------------
// build

async function build(opts) {
  const source = opts.fcc
  if (!source || source === true || !fs.existsSync(source)) die('--fcc <l_amat.zip | folder> is required')
  const zips = new Set(listArg(opts.zips).map(z => z.slice(0, 5)))
  const states = new Set(listArg(opts.states).map(upper))
  if (!zips.size && !states.size) die('give the area with --zips (or --states)')
  const outDir = opts.out && opts.out !== true ? opts.out : 'ham-roster-out'
  const today = new Date().toISOString().slice(0, 10)
  const graceCutoff = new Date(Date.now() - GRACE_YEARS * 365.25 * 864e5).toISOString().slice(0, 10)

  const club = opts.club && opts.club !== true ? readClub(opts.club) : null
  const clubCalls = new Set((club || []).map(c => c.call).filter(Boolean))
  const inArea = f => zips.size ? zips.has(String(f[EN.zip] || '').slice(0, 5)) : states.has(upper(f[EN.state]))

  const t0 = Date.now()
  const log = s => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s] ${s}`)

  // Pass 1 - names and addresses: everyone in the area, plus any club call sign wherever it is.
  const en = new Map()
  log('reading names and addresses (EN)...')
  await scan(source, { EN: f => {
    const area = inArea(f)
    if (!area && !clubCalls.has(normCall(f[EN.call]))) return
    // A license can carry several entity rows (licensee, contact). Prefer the licensee's.
    const prev = en.get(f[EN.usi])
    if (!prev || (upper(prev.f[EN.entityType]) !== 'L' && upper(f[EN.entityType]) === 'L')) en.set(f[EN.usi], { f, area })
  } })
  log(`  ${[...en.values()].filter(e => e.area).length} licenses at addresses in the area`)

  // Pass 2 - operator records: class, and the previous call sign (vanity and upgrade changes).
  // A club member whose call changed shows up here under their new license, so collect those.
  const am = new Map(), renamed = new Set()
  log('reading operator records (AM)...')
  await scan(source, { AM: f => {
    const usi = f[AM.usi]
    if (en.has(usi)) am.set(usi, f)
    else if (clubCalls.has(normCall(f[AM.prevCall]))) { am.set(usi, f); renamed.add(usi) }
  } })

  // Pass 3 - license status and dates, plus the names for licenses found in pass 2.
  const hd = new Map()
  log('reading license status (HD)' + (renamed.size ? ` and ${renamed.size} renamed licenses (EN)` : '') + '...')
  await scan(source, {
    HD: f => { if (en.has(f[HD.usi]) || renamed.has(f[HD.usi])) hd.set(f[HD.usi], f) },
    ...(renamed.size ? { EN: f => { if (renamed.has(f[EN.usi])) en.set(f[EN.usi], { f, area: inArea(f) }) } } : {}),
  })

  // One record per license.
  const licenses = []
  for (const [usi, { f, area }] of en) {
    const h = hd.get(usi) || [], a = am.get(usi) || []
    const expires = fccDate(h[HD.expired])
    const code = upper(h[HD.status])
    let standing
    if (code === 'A' && (!expires || expires >= today)) standing = 'active'
    else if ((code === 'A' || code === 'E') && expires && expires >= graceCutoff) standing = 'renewable'
    else standing = code === 'C' ? 'cancelled' : 'lapsed'
    const first = properCase(f[EN.first]), last = properCase(f[EN.last])
    const name = first || last
      ? [first, upper(f[EN.mi]) || '', last, properCase(f[EN.suffix])].filter(Boolean).join(' ')
      : properCase(f[EN.entityName])
    licenses.push({
      usi, area, call: normCall(f[EN.call]), name, first, last,
      frn: String(f[EN.frn] || '').trim(), email: String(f[EN.email] || '').trim().toLowerCase(),
      phone: String(f[EN.phone] || '').trim(),
      street: properCase(f[EN.street] || (f[EN.poBox] ? `PO Box ${f[EN.poBox]}` : '')),
      city: properCase(f[EN.city]), state: upper(f[EN.state]), zip: String(f[EN.zip] || '').trim(),
      status: STATUS[code] || code, standing, expires,
      granted: fccDate(h[HD.grant]), cancelledOn: fccDate(h[HD.cancelled]),
      opClass: CLASS[upper(a[AM.opClass])] || (first || last ? '' : 'Club station'),
      prevCall: normCall(a[AM.prevCall]),
    })
  }

  // One record per person: licenses sharing an FCC Registration Number (FRN) are the same
  // licensee. The best-standing, most recently granted license is their current call.
  const rank = { active: 0, renewable: 1, lapsed: 2, cancelled: 3 }
  const groups = new Map()
  for (const l of licenses) {
    const k = l.frn || `${nameKey(l.last)}|${nameKey(l.first)}|${l.zip.slice(0, 5)}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(l)
  }
  const people = [...groups.values()].map(ls => {
    ls.sort((x, y) => rank[x.standing] - rank[y.standing] || y.granted.localeCompare(x.granted))
    const cur = ls[0]
    const calls = [...new Set(ls.map(l => l.call).concat(ls.map(l => l.prevCall)).filter(Boolean))]
    return { ...cur, area: ls.some(l => l.area), otherCalls: calls.filter(c => c !== cur.call) }
  })
  const byCall = new Map()
  for (const p of people) for (const c of [p.call, ...p.otherCalls]) if (!byCall.has(c) || byCall.get(c).call !== c) byCall.set(c, p)

  const keep = p => p.area && (opts.all || p.standing === 'active' || p.standing === 'renewable')
  const region = people.filter(keep).sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first))

  fs.mkdirSync(outDir, { recursive: true })
  const personCols = ['callsign', 'name', 'standing', 'status', 'expires', 'class', 'other_calls',
    'street', 'city', 'state', 'zip', 'email', 'phone', 'frn']
  const personRow = p => ({ callsign: p.call, name: p.name, standing: p.standing, status: p.status,
    expires: p.expires, class: p.opClass, other_calls: p.otherCalls.join(' '), street: p.street,
    city: p.city, state: p.state, zip: p.zip, email: p.email, phone: p.phone, frn: p.frn })
  writeCsv(path.join(outDir, 'region-hams.csv'), personCols, region.map(personRow))

  // Merge with the club list.
  const tally = {}
  let rosterPeople = region.filter(p => p.standing === 'active' || p.standing === 'renewable')
  const rosterNotes = new Map()
  if (club) {
    const used = new Set(), rows = []
    const byLast = new Map()
    for (const p of people.filter(p => p.area)) {
      const k = nameKey(p.last)
      if (!byLast.has(k)) byLast.set(k, [])
      byLast.get(k).push(p)
    }
    for (const c of club) {
      let p = c.call ? byCall.get(c.call) : null, kind, note = ''
      if (p) {
        kind = p.call === c.call ? 'matched' : 'call-changed'
        if (kind === 'call-changed') note = `${c.call} is now ${p.call}`
        // Calls are reissued after a license lapses, so a call match with a different
        // surname may be someone else entirely.
        if (c.name && !sameSurname(c, p)) { kind = 'call-name-differs'; note = `FCC holder of ${c.call} is ${p.name}` }
        if (!p.area) note = [note, `FCC address is ${p.city} ${p.state}, outside the area`].filter(Boolean).join('; ')
        if (p.standing !== 'active') note = [note, `license ${p.standing}`].filter(Boolean).join('; ')
      } else {
        // Name proposals: same last name, first name agrees on its first three letters.
        const L = nameKey(c.last), F = nameKey(c.first).slice(0, 3)
        const cands = L.length >= 2 && F ? (byLast.get(L) || []).filter(q => nameKey(q.first).startsWith(F)) : []
        if (cands.length === 1) { p = cands[0]; kind = 'name-proposal'; note = c.call ? `club has ${c.call}, not found at the FCC` : 'confirm this is the same person' }
        else if (cands.length > 1) { kind = 'name-ambiguous'; note = 'possible: ' + cands.map(q => `${q.call} ${q.name}`).join('; ') }
        else { kind = 'club-only'; note = c.call ? `${c.call} not found at the FCC` : 'no license found in the area under this name' }
      }
      if (p) { used.add(p); rosterNotes.set(p, { id: c.id, kind, note }) }
      tally[kind] = (tally[kind] || 0) + 1
      rows.push({ kind, club_row: c.row, club_id: c.id, club_call: c.call, club_name: c.name,
        ...(p ? personRow(p) : {}), note })
    }
    for (const p of region) if (!used.has(p) && (p.standing === 'active' || p.standing === 'renewable')) {
      tally['fcc-only'] = (tally['fcc-only'] || 0) + 1
      rows.push({ kind: 'fcc-only', ...personRow(p), note: 'licensed in the area, not on the club list' })
    }
    const order = ['call-name-differs', 'call-changed', 'name-proposal', 'name-ambiguous', 'matched', 'club-only', 'fcc-only']
    rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    writeCsv(path.join(outDir, 'club-merge.csv'),
      ['kind', 'club_row', 'club_id', 'club_call', 'club_name', ...personCols, 'note'], rows)
    // With a club list, the roster is the club's people who hold a license. Name proposals are
    // left out until someone confirms them.
    rosterPeople = [...rosterNotes].filter(([, n]) => n.kind === 'matched' || n.kind === 'call-changed').map(([p]) => p)
  }

  const roster = rosterPeople.map(p => {
    const n = rosterNotes.get(p) || {}
    return {
      callsign: p.call, fullName: p.name, phone: p.phone,
      image: '', id: n.id || '', team: '', role: p.opClass,
      note: [`FCC ${p.standing}, expires ${p.expires || '?'}`, p.otherCalls.length ? `also ${p.otherCalls.join(' ')}` : '', n.note || '']
        .filter(Boolean).join(' | '),
    }
  })
  fs.writeFileSync(path.join(outDir, 'rangertrak-roster.json'), JSON.stringify({ rangers: roster }, null, 2))

  const srcStat = fs.statSync(source)
  const meta = path.join(path.dirname(source), 'l_amat.source.json')
  const fetched = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, 'utf8')) : null
  const counts = Object.entries(tally).map(([k, v]) => `  ${k.padEnd(15)} ${v}`).join('\n')
  const readme = [
    `ham-roster output, built ${today}`,
    ``,
    `FCC file : ${path.resolve(source)}`,
    `           ${fetched ? `FCC last-modified ${fetched.lastModified}, downloaded ${fetched.downloaded}` : `file date ${srcStat.mtime.toISOString().slice(0, 10)}`}`,
    `Area     : ${zips.size ? 'ZIP ' + [...zips].join(', ') : 'states ' + [...states].join(', ')} (FCC mailing address)`,
    club ? `Club list: ${path.resolve(opts.club)} (${club.length} entries)` : '',
    ``,
    `region-hams.csv         ${region.length} people${opts.all ? ' (all standings)' : ' (active or still renewable)'}`,
    club ? `club-merge.csv\n${counts}` : '',
    `rangertrak-roster.json  ${roster.length} people`,
    ``,
    `standing: active = licensed and unexpired; renewable = expired under ${GRACE_YEARS} years ago;`,
    `lapsed / cancelled = gone from the FCC's point of view. "Active" does not mean alive or`,
    `still here. A person should confirm. So should every name-proposal in club-merge.csv.`,
    ``,
    `This folder holds personal contact details. Keep it on this machine.`,
  ].filter(l => l !== '').join('\n').replace(/\n(?=region-hams|standing:|This folder)/g, '\n\n')
  fs.writeFileSync(path.join(outDir, 'README.txt'), readme + '\n')

  log('done')
  console.log('\n' + readme)
  console.log(`\nWritten to ${path.resolve(outDir)}`)
}

// ---------------------------------------------------------------------------------------------
// download

async function download(opts) {
  const outDir = opts.out && opts.out !== true ? opts.out : '.'
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, 'l_amat.zip')
  console.log(`Downloading ${FCC_URL}\n  -> ${path.resolve(file)}`)
  const res = await fetch(FCC_URL)
  if (!res.ok) die(`FCC returned ${res.status} ${res.statusText}`)
  const total = Number(res.headers.get('content-length')) || 0
  const tmp = file + '.part'
  const ws = fs.createWriteStream(tmp)
  let got = 0, shown = 0
  for await (const chunk of res.body) {
    got += chunk.length
    if (!ws.write(chunk)) await new Promise(r => ws.once('drain', r))
    if (got - shown > 10 << 20) { shown = got; process.stdout.write(`\r  ${(got / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`) }
  }
  await new Promise((r, j) => ws.end(e => e ? j(e) : r()))
  if (total && got !== total) die(`download incomplete: ${got} of ${total} bytes`)
  fs.renameSync(tmp, file)
  fs.writeFileSync(path.join(outDir, 'l_amat.source.json'), JSON.stringify({
    url: FCC_URL, lastModified: res.headers.get('last-modified'), bytes: got,
    downloaded: new Date().toISOString(),
  }, null, 2))
  console.log(`\r  ${(got / 1048576).toFixed(0)} MB - done. FCC last-modified: ${res.headers.get('last-modified')}`)
}

// ---------------------------------------------------------------------------------------------

function die(msg) { console.error(`ham-roster: ${msg}`); process.exit(1) }

const opts = parseArgs(process.argv.slice(2))
const cmd = opts._[0]
const run = cmd === 'build' ? build : cmd === 'download' ? download : null
if (!run) {
  console.log(fs.readFileSync(__filename, 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ''))
  process.exit(cmd ? 1 : 0)
}
run(opts).catch(e => die(e.stack || e.message))
