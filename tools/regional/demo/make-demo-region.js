/**
 * Writes a made-up community, "Fernhollow", for the regional tools to run on: a volunteer
 * table, an ID crosswalk, photos and a tiny FCC licence file. Nobody in it is real.
 *
 * Why it exists: the real data the tools are for (rosters, crosswalks, photos) may never be
 * committed (ADR D-35), so without this there is nothing to test the tools against in CI and
 * nothing to show another community what their own folder should look like. It is the "demo
 * pack for a made-up community" in the regional-data plan.
 *
 *   node make-demo-region.js <data folder>
 *
 * writes, under <data folder> (laid out like rangertrak-regional-data):
 *   us/zz/demo/fernhollow/region.json
 *   us/zz/demo/fernhollow/sources/volunteers/volunteers.csv
 *   us/zz/demo/fernhollow/sources/photos/*.jpg       (the app's own AI demo faces)
 *   us/zz/demo/fernhollow/rangers/ranger-ids.csv
 *   us/_national/fcc/demo/l_amat.zip                 (EN/HD/AM records, FCC layout)
 *
 * The data folder must be outside this repo; the script refuses otherwise. Run the whole
 * pipeline on it with test-demo-region.js.
 *
 * Made-up, by construction: names come from the same whimsical stock as the app's sample
 * missions (SampleDataService); phones are 555-01xx (reserved for fiction); ZIPs 00001/00002
 * and state "ZZ" do not exist; credentials use a "DM-" prefix no county issues. Call signs
 * have to pass the tools' US-format check, so they are invented in the rarely issued WZ0/KZ0
 * blocks. A real station could hold one by coincidence; they never appear beside a real name.
 *
 * Every case the tools handle on real rosters is planted here, so a test can check each:
 *   DM-0001  ham, FCC active, call matches                       -> matched; photo by code
 *   DM-0002  crosswalk has the OLD call; FCC shows a vanity call -> call-changed
 *   DM-0003  an old credential of the person later issued DM-0016 -> merged_into, left out
 *   DM-0004  not a ham; listed twice in the volunteer table      -> one person, callsign = id
 *   DM-0005  TEW (temporary worker), in process
 *   DM-0006  ham whose licence lapsed 4 years ago                -> matched, "license lapsed"
 *   DM-0007  held by TWO people in one household                  -> both kept; no photo
 *   DM-0008  not a ham in the crosswalk, but the FCC has the name -> name-proposal
 *   DM-0009  medical (MRC), photo filename in lower case
 *   DM-0010, DM-0011  in the volunteer table, not in the crosswalk -> new uid, "new - review"
 *   DM-0012  in the crosswalk, gone from the volunteer table      -> kept, reported
 *   (no id)  a row with no credential                             -> skipped
 *   FCC only: one area ham not on the list (fcc-only), one ham outside the area (ignored)
 *   Photos: one with no code (needs the worksheet), one with no code assigned by hand in the
 *   crosswalk's photo column, one duplicate under a second name. The DM- prefix is deliberate:
 *   photo codes must match whatever prefix the community's credentials use, not only VI-.
 */
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../../..')
const DEMO_PHOTOS = path.join(REPO, 'src/assets/imgs/rangers')
const REGION = 'us/zz/demo/fernhollow'
const FCC = 'us/_national/fcc/demo/l_amat.zip'
const ZIPS = ['00001', '00002']

// Volunteer table rows, in the column layout 1-make-roster.js reads (a county REW export).
const ORG = { cert: 'Fernhollow CERT', eoc: 'Fernhollow EOC', radio: 'Fernhollow Radio Club', mrc: 'Fernhollow MRC' }
const VOLUNTEERS = [
  // id,       kind,  first,     last,           phone,   org,        status,       assignment,          qualifications
  ['DM-0001', 'REW', 'Hazel',   'Winterbourne', '0101', ORG.eoc,   'Active',     'EOC manager',       'ICS-300'],
  ['DM-0002', 'REW', 'Ollie',   'Fogbank',      '0102', ORG.radio, 'active',     'Net control',       'General class'],
  ['DM-0003', 'REW', 'Ivy',     'Loudhailer',   '0103', ORG.eoc,   'EXited',     '',                  ''],
  ['DM-0004', 'REW', 'Gus',     'Underbrush',   '0104', ORG.cert,  'Active',     'North loop',        'CERT Basic'],
  ['DM-0004', 'REW', 'Gus',     'Underbrush',   '0104', ORG.cert,  'Active',     'North loop',        'CERT Basic'],
  ['DM-0005', 'TEW', 'Wanda',   'Woodsy',       '0105', ORG.cert,  'In Process', '',                  ''],
  ['DM-0006', 'REW', 'Chip',    'Trailblaze',   '0106', ORG.radio, 'Active',     'Mobile relay',      'Technician class'],
  ['DM-0007', 'REW', 'Marge',   'Tidepool',     '0107', ORG.cert,  'Active',     'Shoreline',         'CERT Basic'],
  ['DM-0007', 'REW', 'Boone',   'Tidepool',     '0108', ORG.cert,  'Active',     'Shoreline',         'CERT Basic'],
  ['DM-0008', 'REW', 'Barnaby', 'Fogg',         '0109', ORG.cert,  'Active',     'Harbor patrol',     ''],
  ['DM-0009', 'REW', 'Sunny',   'Skipper',      '0110', ORG.mrc,   'Active',     'First-aid post',    'EMT'],
  ['DM-0010', 'REW', 'Dana',    'Fernbrook',    '0111', ORG.radio, 'Active',     '',                  ''],
  ['DM-0011', 'REW', 'Wren',    'Cliffside',    '0112', ORG.cert,  'Exited',     '',                  ''],
  ['',        'REW', 'Talus',   'Windham',      '0113', ORG.cert,  'In process', '',                  ''],
  ['DM-0016', 'REW', 'Ivy',     'Loudhailer',   '0103', ORG.eoc,   'Active',     'Public information', 'ICS-300'],
]

// The crosswalk as a coordinator would have left it. DM-0010 and DM-0011 are missing on purpose.
const UID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`   // fixed, so tests can assert on them
const CROSSWALK = [
  // uid,    id,        name,                callsign, other_calls, frn,          photo,                    merged_into
  [UID(1),  'DM-0001', 'Hazel Winterbourne', 'WZ0HAZ', '', '0099000001', '', ''],
  [UID(2),  'DM-0002', 'Ollie Fogbank',      'WZ0OLF', '', '',           '', ''],
  [UID(3),  'DM-0003', 'Ivy Loudhailer',     '',       '', '',           '', UID(16)],
  [UID(4),  'DM-0004', 'Gus Underbrush',     '',       '', '',           '', ''],
  [UID(5),  'DM-0005', 'Wanda Woodsy',       '',       '', '',           '', ''],
  [UID(6),  'DM-0006', 'Chip Trailblaze',    'WZ0CHP', '', '',           '', ''],
  [UID(7),  'DM-0007', 'Marge Tidepool',     'WZ0MRG', '', '',           '', ''],
  [UID(8),  'DM-0007', 'Boone Tidepool',     '',       '', '',           '', ''],
  [UID(9),  'DM-0008', 'Barnaby Fogg',       '',       '', '',           '', ''],
  [UID(10), 'DM-0009', 'Sunny Skipper',      '',       '', '',           '', ''],
  [UID(12), 'DM-0012', 'Rusty Sagebrush',    '',       '', '',           '', ''],
  [UID(16), 'DM-0016', 'Ivy Loudhailer',     'WZ0IVY', '', '',           'Ivy at the fair.jpg', ''],
]

// Photos: [demo face in src/assets/imgs/rangers, filename in the region's sources/photos].
const PHOTOS = [
  ['ic-actual.jpg', 'DM-0001.jpg'],
  ['ic-actual.jpg', 'DM-0001 copy.jpg'],         // same image twice: deduped by content
  ['ops-chief.jpg', 'DM-002 Ollie.jpg'],         // short code: VI-002 style, matched by number
  ['cert1.jpg',     'DM-0004 headshot.jpg'],
  ['cert3.jpg',     'DM-0007.jpg'],              // shared id: a wrong photo is worse than none
  ['medic1.jpg',    'dm-0009 sunny.jpg'],
  ['pio.jpg',       'Unknown at the drill.jpg'], // no code: only the worksheet can place it
  ['plan-chief.jpg', 'Ivy at the fair.jpg'],     // no code, but assigned by hand in the crosswalk
]

// FCC licences: [usi, call, first, last, zip, status, expires (years from now), prevCall, class, frn]
const LICENCES = [
  [1001, 'WZ0HAZ', 'Hazel',   'Winterbourne', '00001', 'A',  5, '',       'G', '0099000001'],
  [1002, 'KZ0OF',  'Ollie',   'Fogbank',      '00001', 'A',  9, 'WZ0OLF', 'E', '0099000002'],  // vanity change
  [1006, 'WZ0CHP', 'Chip',    'Trailblaze',   '00002', 'E', -4, '',       'T', '0099000006'],  // lapsed
  [1007, 'WZ0MRG', 'Marge',   'Tidepool',     '00002', 'E', -1, '',       'T', '0099000007'],  // renewable
  [1008, 'WZ0BFG', 'Barnaby', 'Fogg',         '00002', 'A',  3, '',       'T', '0099000008'],  // name only
  [1016, 'WZ0IVY', 'Ivy',     'Loudhailer',   '00001', 'A',  6, '',       'G', '0099000016'],
  [1020, 'WZ0MSA', 'Mesa',    'Longstride',   '00001', 'A',  7, '',       'T', '0099000020'],  // fcc-only
  [1021, 'WZ0PIP', 'Piper',   'Overlook',     '99999', 'A',  7, '',       'T', '0099000021'],  // out of area
]

const csvCell = v => /[",\r\n]/.test(v = String(v ?? '')) ? `"${v.replace(/"/g, '""')}"` : v
const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

/** mm/dd/yyyy, years from today (FCC date format). */
function fccDate(years) {
  const d = new Date()
  d.setFullYear(d.getFullYear() + years)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
}

/** One pipe-delimited FCC record with the given fields set, the rest blank. */
function record(type, length, fields) {
  const f = Array(length).fill('')
  f[0] = type
  for (const [i, v] of Object.entries(fields)) f[i] = v
  return f.join('|')
}

function fccZip() {
  const { zipSync, strToU8 } = require('../ham-roster/vendor/fflate.cjs')
  const en = [], hd = [], am = []
  for (const [usi, call, first, last, zip, status, years, prev, cls, frn] of LICENCES) {
    en.push(record('EN', 30, { 1: usi, 4: call, 5: 'L', 7: `${last}, ${first}`.toUpperCase(), 8: first.toUpperCase(),
      10: last.toUpperCase(), 15: '1 DEMO LN', 16: 'FERNHOLLOW', 17: 'ZZ', 18: zip, 22: frn }))
    hd.push(record('HD', 50, { 1: usi, 4: call, 5: status, 6: 'HA', 7: fccDate(years - 10), 8: fccDate(years) }))
    am.push(record('AM', 18, { 1: usi, 4: call, 5: cls, 15: prev }))
  }
  const dat = lines => strToU8(lines.join('\r\n') + '\r\n')
  return zipSync({ 'EN.dat': dat(en), 'HD.dat': dat(hd), 'AM.dat': dat(am) })
}

function makeDemoRegion(dataRoot) {
  dataRoot = path.resolve(dataRoot)
  const rel = path.relative(REPO, dataRoot)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(`${dataRoot} is inside the repo. Write the demo region somewhere else (a temp folder).`)
  }
  const region = path.join(dataRoot, REGION)
  const at = (...p) => path.join(region, ...p)
  for (const d of ['sources/volunteers', 'sources/photos', 'rangers', 'locations', 'teams', 'work']) {
    fs.mkdirSync(at(d), { recursive: true })
  }

  fs.writeFileSync(at('region.json'), JSON.stringify({
    name: 'Fernhollow',
    note: 'A made-up community for testing and demonstrating the regional tools. Nobody in it is real.',
    zips: ZIPS,
    roster: { volunteers: 'sources/volunteers/volunteers.csv' },
  }, null, 2) + '\n')

  fs.writeFileSync(at('sources/volunteers/volunteers.csv'), csv([
    ['Last Name', 'First Name', 'ID (REW)', 'TEW/REW', 'Cell Phone', 'Home Phone', 'Team',
      'Assignment', 'Status', 'Qualifications', 'Organization Name (REW)'],
    ...VOLUNTEERS.map(([id, kind, first, last, phone, org, status, assignment, quals]) =>
      [last, first, id, kind, `360-555-${phone}`, '', '', assignment, status, quals, org]),
  ]))

  fs.writeFileSync(at('rangers/ranger-ids.csv'), csv([
    ['uid', 'id', 'name', 'callsign', 'other_calls', 'frn', 'photo', 'checked', 'source', 'merged_into', 'note'],
    ...CROSSWALK.map(([uid, id, name, call, other, frn, photo, merged]) =>
      [uid, id, name, call, other, frn, photo, '', 'demo', merged, '']),
  ]))

  for (const [from, to] of PHOTOS) fs.copyFileSync(path.join(DEMO_PHOTOS, from), at('sources/photos', to))

  const fcc = path.join(dataRoot, FCC)
  fs.mkdirSync(path.dirname(fcc), { recursive: true })
  fs.writeFileSync(fcc, fccZip())

  return { dataRoot, region, fcc, zips: ZIPS, name: 'Fernhollow', uid: UID }
}

module.exports = { makeDemoRegion, REGION, FCC }

if (require.main === module) {
  const out = process.argv[2]
  if (!out) {
    console.error('Usage: node make-demo-region.js <data folder outside the repo>')
    process.exit(1)
  }
  const r = makeDemoRegion(out)
  console.log(`Demo region written: ${r.region}`)
  console.log(`Demo FCC file:       ${r.fcc}`)
}
