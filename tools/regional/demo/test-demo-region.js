/**
 * Runs the regional tools end to end on the made-up Fernhollow region (make-demo-region.js)
 * and checks every case planted in it. No real data is read or written: everything happens in
 * a fresh temp folder, deleted afterwards (pass --keep to look at it).
 *
 *   node tools/regional/demo/test-demo-region.js      (npm run test:regional)
 *
 * Steps: 1-make-roster (twice, to prove uids are stable), 2-make-drive-bundle, and ham-roster
 * build against the demo FCC file with the roster as the club list.
 */
const assert = require('assert/strict')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeDemoRegion } = require('./make-demo-region')

const TOOLS = path.resolve(__dirname, '..')
const keep = process.argv.includes('--keep')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rangertrak-demo-region-'))
let failed = 0, passed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ok    ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message.split('\n').join('\n        ')}`) }
}

// The scripts must only ever see the temp folder, never a real data root on this machine.
const env = { ...process.env }
delete env.RANGERTRAK_DATA
delete env.REGION
const run = (script, ...args) =>
  execFileSync(process.execPath, [path.join(TOOLS, script), ...args], { cwd: tmp, env, encoding: 'utf8' })

const csvRows = file => {
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)
  const cells = l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).slice(0, -1)
    .map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'))
  const head = cells(lines.shift())
  return lines.map(l => Object.fromEntries(cells(l).map((v, i) => [head[i], v])))
}

try {
  const demo = makeDemoRegion(tmp)
  const at = (...p) => path.join(demo.region, ...p)
  console.log(`Fernhollow demo region in ${tmp}\n`)

  // ---- 1-make-roster ------------------------------------------------------------------------
  run('roster-build/1-make-roster.js', demo.region)
  const roster = JSON.parse(fs.readFileSync(at('rangers', 'Fernhollow-roster.json'), 'utf8')).rangers
  const byId = id => roster.filter(r => r.id === id)
  console.log('1-make-roster')

  check('12 people: no-id row, duplicate row and merged credential left out', () => {
    assert.equal(roster.length, 12)
    assert.equal(byId('DM-0003').length, 0)
    assert.equal(byId('DM-0004').length, 1)
    assert.ok(!roster.some(r => /Windham/.test(r.fullName)))
  })
  check('callsign is the ham call, else the credential', () => {
    assert.equal(byId('DM-0001')[0].callsign, 'WZ0HAZ')
    assert.equal(byId('DM-0004')[0].callsign, 'DM-0004')
  })
  check('a shared credential keeps both people, with their own uids', () => {
    const pair = byId('DM-0007')
    assert.deepEqual(pair.map(r => r.fullName).sort(), ['Boone Tidepool', 'Marge Tidepool'])
    assert.notEqual(pair[0].uid, pair[1].uid)
  })
  check('the kept person notes the merged credential', () => {
    assert.match(byId('DM-0016')[0].note, /^also DM-0003/)
    assert.equal(byId('DM-0016')[0].uid, demo.uid(16))
  })
  check('team from the organisation, TEW and status normalised', () => {
    const teams = {}
    roster.forEach(r => { teams[r.team] = (teams[r.team] || 0) + 1 })
    assert.deepEqual(teams, { EOC: 2, Radio: 3, CERT: 6, MRC: 1 })
    assert.equal(byId('DM-0005')[0].role, 'TEW / In process')
    assert.equal(byId('DM-0002')[0].role, 'REW / Active')
  })
  check('no address and no legacy rew field in the output', () => {
    assert.ok(roster.every(r => !('address' in r) && !('rew' in r)))
  })

  const ids1 = csvRows(at('rangers', 'ranger-ids.csv'))
  check('people new to the crosswalk get a fresh uid, marked for review', () => {
    const fresh = ids1.filter(r => r.id === 'DM-0010' || r.id === 'DM-0011')
    assert.equal(fresh.length, 2)
    assert.ok(fresh.every(r => /^[0-9a-f-]{36}$/.test(r.uid) && r.note === 'new - review'))
  })
  check('crosswalk rows for people who left the table are kept', () => {
    assert.ok(ids1.some(r => r.id === 'DM-0012'))
  })

  run('roster-build/1-make-roster.js', demo.region)
  const again = JSON.parse(fs.readFileSync(at('rangers', 'Fernhollow-roster.json'), 'utf8')).rangers
  check('a rebuild keeps every uid', () => {
    assert.deepEqual(again.map(r => r.uid), roster.map(r => r.uid))
    assert.equal(csvRows(at('rangers', 'ranger-ids.csv')).length, ids1.length)
  })

  // ---- 2-make-drive-bundle ------------------------------------------------------------------
  run('roster-build/2-make-drive-bundle.js', demo.region)
  const bundle = at('rangers', 'Fernhollow-roster-and-photos')
  const photos = fs.readdirSync(path.join(bundle, 'photos')).sort()
  const bundled = JSON.parse(fs.readFileSync(path.join(bundle, 'roster.json'), 'utf8')).rangers
  console.log('\n2-make-drive-bundle')

  check('photos matched by credential code, any prefix, and renamed to the callsign', () => {
    assert.ok(photos.includes('WZ0HAZ.jpg'), 'DM-0001.jpg')
    assert.ok(photos.includes('WZ0OLF.jpg'), 'DM-002 Ollie.jpg (short code)')
    assert.ok(photos.includes('DM-0004.jpg'), 'DM-0004 headshot.jpg')
    assert.ok(photos.includes('DM-0009.jpg'), 'dm-0009 sunny.jpg (lower case)')
  })
  check('a hand assignment in the crosswalk places a photo with no code', () => {
    assert.ok(photos.includes('WZ0IVY.jpg'))
  })
  check('no photo for a shared credential; duplicates and unknowns placed once or not at all', () => {
    assert.ok(!photos.some(p => /WZ0MRG|DM-0007/.test(p)))
    assert.equal(photos.length, 5, photos.join(', '))
  })
  check('no person\'s name in any bundled filename', () => {
    assert.ok(!photos.some(p => /[a-z]{3}/.test(p.replace(/\.jpe?g$|\.png$/i, ''))))
  })
  check('roster image fields point at the bundled photos', () => {
    assert.equal(bundled.filter(r => r.image).length, 5)
    assert.ok(bundled.filter(r => r.image).every(r => photos.includes(r.image)))
  })
  check('the zip is written', () => {
    assert.ok(fs.statSync(`${bundle}.zip`).size > 1000)
  })

  // make-photo-worksheet.js is not covered yet: it still defaults to the 2022 FCC dump as its
  // roster (the source D-36 retired) and needs a generalising pass first.

  // ---- ham-roster ---------------------------------------------------------------------------
  const work = at('work', 'ham-roster')
  run('ham-roster/ham-roster.js', 'build', '--fcc', demo.fcc, '--zips', demo.zips.join(','),
    '--club', at('rangers', 'Fernhollow-roster.json'), '--out', work)
  const merge = csvRows(path.join(work, 'club-merge.csv'))
  const kind = k => merge.filter(r => r.kind === k)
  console.log('\nham-roster')

  check('a vanity call change is caught through the previous call', () => {
    assert.equal(kind('call-changed').length, 1)
    assert.equal(kind('call-changed')[0].club_call, 'WZ0OLF')
    assert.equal(kind('call-changed')[0].callsign, 'KZ0OF')
  })
  check('matched calls, with lapsed and renewable licences noted', () => {
    assert.deepEqual(kind('matched').map(r => r.club_call).sort(), ['WZ0CHP', 'WZ0HAZ', 'WZ0IVY', 'WZ0MRG'])
    assert.match(kind('matched').find(r => r.club_call === 'WZ0CHP').note, /lapsed/)
    assert.match(kind('matched').find(r => r.club_call === 'WZ0MRG').note, /renewable/)
  })
  check('a name match is only a proposal', () => {
    assert.equal(kind('name-proposal').length, 1)
    assert.equal(kind('name-proposal')[0].callsign, 'WZ0BFG')
  })
  check('area hams not on the list are fcc-only; hams outside the area are ignored', () => {
    assert.deepEqual(kind('fcc-only').map(r => r.callsign), ['WZ0MSA'])
    assert.ok(!merge.some(r => r.callsign === 'WZ0PIP'))
  })
  check('the club roster holds matched and call-changed people only', () => {
    const out = JSON.parse(fs.readFileSync(path.join(work, 'rangertrak-roster.json'), 'utf8')).rangers
    assert.equal(out.length, 5)
    assert.ok(out.some(r => r.callsign === 'KZ0OF'))
  })
} catch (e) {
  failed++
  console.error(`\nFAIL: ${e.stack || e.message}`)
} finally {
  if (keep) console.log(`\nKept: ${tmp}`)
  else fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
