/**
 * Tests make-montecito-demo.js (E-195).
 *
 *   node tools/regional/demo/test-make-montecito-demo.js      (part of npm run test:regional)
 *
 * 1. A tiny made-up fixture proves what the generator keeps and drops: the softened casualty
 *    text is used and the recorded text never is, media and test rows are left out, and a
 *    fatality word in the input stops the run.
 * 2. When the scenario tables are on this machine (rangertrak-InternalDocs\E-195 Montecito),
 *    the real tables are generated in memory: no fatality text, every place resolves, counts,
 *    and the committed module still matches what the tables produce.
 */
const assert = require('assert/strict')
const fs = require('fs')
const { makeMontecito, render, readTables, DEFAULT_IN, DEFAULT_OUT } = require('./make-montecito-demo')

let failed = 0, passed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ok    ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message.split('\n').join('\n        ')}`) }
}

const teams = [
  { id: 'T01', tactical_call: 'Command 1', type: 'incident command', agency_type: 'Local Fire District', members: '3', first_op_period: '0' },
  { id: 'T02', tactical_call: 'Net Control', type: 'ham radio ACS net control', agency_type: 'ACS volunteers (invented)', members: '2', first_op_period: '0' },
  { id: 'T03', tactical_call: 'SAR 1', type: 'ground SAR', agency_type: 'County SAR (volunteer)', members: '9', first_op_period: '0' },
]
const places = [
  { id: 'P01', label: 'Command Post 1', type: 'command post', lat: '34.43', lon: '-119.63', note: '' },
  { id: 'P05', label: 'County EOC', type: 'eoc', lat: '34.44', lon: '-119.79', note: '' },
  { id: 'P50', label: 'Home site 1', type: 'home site marker', lat: '34.435', lon: '-119.666', note: '' },
]
const row = (id, time, op, from, to, kind, message, extra = {}) => ({
  id, scenario_time: time, op_period: String(op), from, to, channel: 'Tac 1', message, place_id: 'P50', kind,
  delivery: 'background', casualty_recorded: '', casualty_softened: '', ...extra,
})
const msel = [
  row('M1', '2018-01-09T04:00', 1, 'SAR 1', 'Command 1', 'traffic', 'SAR 1 to Command, family on the roof, callback 805-555-0150.'),
  row('M2', '2018-01-09T05:00', 1, 'SAR 1', 'Command 1', 'casualty', 'placeholder',
    { casualty_recorded: 'One deceased at Home site 1, notify the coroner.', casualty_softened: 'One adult patient, critical, request hoist.' }),
  row('M3', '2018-01-09T05:30', 2, 'Room display', 'All', 'media', 'NWS product https://example.org'),
  row('M4', '2018-01-09T06:00', 2, 'Self-Deploy Group', 'Command 1', 'test', 'bait'),
  row('M5', '2018-01-09T07:00', 2, 'Walk-up', 'Command 1', 'find', 'Resident says neighbors have not answered.'),
  row('M6', '2018-01-09T08:00', 2, 'Command 1', 'All units', 'status', 'All units, check in every hour.', { place_id: '' }),
]

check('uses the softened casualty text and never the recorded one', () => {
  const out = makeMontecito({ msel, places, teams })
  const casualty = out.rows.find(r => r.id === 'M2')
  assert.equal(casualty.notes, 'One adult patient, critical, request hoist.')
  assert.doesNotMatch(JSON.stringify(out), /deceased|coroner/i)
})

check('leaves media and test rows out', () => {
  const out = makeMontecito({ msel, places, teams })
  assert.deepEqual(out.rows.map(r => r.id), ['M1', 'M2', 'M5', 'M6'])
})

check('stops if any shipped text carries a fatality word', () => {
  const bad = msel.map(r => r.id === 'M1' ? { ...r, message: 'Caller says the occupant is deceased.' } : r)
  assert.throws(() => makeMontecito({ msel: bad, places, teams }), /no fatality text/)
  const noSoft = msel.map(r => r.id === 'M2' ? { ...r, casualty_softened: '' } : r)
  assert.throws(() => makeMontecito({ msel: noSoft, places, teams }), /no casualty_softened/)
})

check('past-dates the rows, keeps their spacing, and resolves places and callers', () => {
  const out = makeMontecito({ msel, places, teams })
  assert.ok(out.rows.every(r => r.ago > 0))
  assert.equal(out.rows[0].ago - out.rows[1].ago, 60)
  assert.equal(out.rows.find(r => r.id === 'M6').place, 'P01') // no place_id: the command post
  const calls = new Set(out.rangers.map(r => r.callsign))
  assert.ok(out.rows.every(r => calls.has(r.call)))
  assert.equal(out.rows.find(r => r.id === 'M5').call, out.tacticalCalls.find(t => t.name === 'Command 1').callsign)
  assert.equal(out.rows.find(r => r.id === 'M6').to, undefined) // "All units" is not a team
})

check('is deterministic and invents everyone to the Fernhollow conventions', () => {
  const a = makeMontecito({ msel, places, teams }), b = makeMontecito({ msel, places, teams })
  assert.deepEqual(a, b)
  assert.equal(a.rangers.length, 3 + 2 + 4) // member counts, capped at four
  for (const r of a.rangers) {
    assert.match(r.phone, /^\d{3}-555-01\d\d$/)
    assert.match(r.callsign, /^(WZ0|KZ0)[A-Z]{3}$/)
    assert.match(r.id, /^DM-\d{4}$/)
  }
})

const tablesHere = fs.existsSync(DEFAULT_IN) && fs.existsSync(`${DEFAULT_IN}/msel.csv`)
if (!tablesHere) {
  console.log(`  skip  scenario tables not found at ${DEFAULT_IN} - real-table checks not run`)
} else {
  const out = makeMontecito(readTables(DEFAULT_IN))
  check('real tables: no fatality text, every place resolves, expected counts', () => {
    assert.doesNotMatch(JSON.stringify(out), /deceased|coroner/i)
    const ids = new Set(out.places.map(p => p.id))
    assert.ok(out.rows.every(r => ids.has(r.place)))
    assert.equal(out.rows.length, 417) // 437 rows, minus 15 media and 5 test
    assert.equal(out.places.length, 61)
    assert.equal(out.tacticalCalls.length, 31)
    assert.equal(out.rows.filter(r => r.f213).length, 3) // E-283 ICS-213 messages
    assert.equal(out.rows.filter(r => r.rr).length, 2) // E-283 resource requests
  })
  check('real tables: the committed module is what the tables produce', () => {
    assert.equal(fs.readFileSync(DEFAULT_OUT, 'utf8'), render(out),
      'sample-data-montecito.ts is stale - rerun make-montecito-demo.js')
  })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
