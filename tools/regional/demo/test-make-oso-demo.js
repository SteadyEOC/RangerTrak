/**
 * Tests make-oso-demo.js (E-195), the Oso config of the shared generator.
 *
 *   node tools/regional/demo/test-make-oso-demo.js      (part of npm run test:regional)
 *
 * 1. A tiny made-up fixture proves what is Oso's own: ICS-213 rows carry an f213 block (subject,
 *    message body, addressee, reply wanted) and the three new place types map. The softened-only
 *    rule and the fatality net are the shared generator's and are tested in
 *    test-make-montecito-demo.js; one case here shows they hold for Oso's config too.
 * 2. When the scenario tables are on this machine (rangertrak-InternalDocs\E-195 Oso), the real
 *    tables are generated in memory: no fatality text, every place resolves, counts, ICS-213
 *    count, and the committed module still matches what the tables produce.
 */
const assert = require('assert/strict')
const fs = require('fs')
const { makeOso, render, readTables, DEFAULT_IN, DEFAULT_OUT } = require('./make-oso-demo')

let failed = 0, passed = 0
function check(name, fn) {
  try { fn(); passed++; console.log(`  ok    ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message.split('\n').join('\n        ')}`) }
}

const teams = [
  { id: 'T01', tactical_call: 'Command West', type: 'incident command', agency_type: 'Local fire district (west)', members: '3', first_op_period: '0' },
  { id: 'T02', tactical_call: 'Net Control', type: 'ACS net control', agency_type: 'County ACS (volunteer)', members: '2', first_op_period: '0' },
  { id: 'T03', tactical_call: 'PIO', type: 'public information', agency_type: 'County communications', members: '2', first_op_period: '1' },
]
const places = [
  { id: 'P01', label: 'Command Post West', type: 'command post', lat: '48.1993', lon: '-122.1249', note: '' },
  { id: 'P03', label: 'County EOC', type: 'eoc', lat: '47.979', lon: '-122.2021', note: '' },
  { id: 'P25', label: 'Division A', type: 'search division', lat: '48.2755', lon: '-121.852', note: '' },
  { id: 'P49', label: 'Decon Station 1', type: 'decon', lat: '48.2735', lon: '-121.8345', note: '' },
  { id: 'P41', label: 'River gauge 1', type: 'river gauge', lat: '48.2078', lon: '-122.06', note: '' },
]
const row = (id, time, op, from, to, kind, message, extra = {}) => ({
  id, scenario_time: time, op_period: String(op), from, to, channel: 'Tac West', message, place_id: 'P25', kind,
  delivery: 'background', casualty_recorded: '', casualty_softened: '', form: '', ics213_subject: '', ...extra,
})
const ICS = (id, time, to, subject, body, reply) => row(id, time, 1, 'PIO', to, 'message',
  `ICS-213 message. To: ${to}. From: PIO. Subject: ${subject}. Message: ${body} Reply: ${reply}`,
  { channel: 'ICS-213', form: 'ICS-213', ics213_subject: subject, place_id: 'P01' })
const msel = [
  row('M1', '2014-03-22T10:50', 1, 'Net Control', 'All', 'status', 'Net Control is up.', { place_id: '' }),
  ICS('M2', '2014-03-22T11:30', 'Command West', 'Media briefing', 'Request briefing at 1000 and 1600.', 'pending.'),
  ICS('M3', '2014-03-22T12:00', 'Operations', 'Cots', 'Request 20 cots on call.', 'noted, will advise.'),
  row('M4', '2014-03-22T12:30', 2, 'Command West', 'PIO', 'casualty', 'placeholder',
    { casualty_recorded: 'One deceased in Division A, notify the coroner.', casualty_softened: 'One patient, critical, request hoist.' }),
]

check('turns ICS-213 rows into f213 blocks, and leaves other rows without one', () => {
  const out = makeOso({ msel, places, teams })
  assert.equal(out.rows.find(r => r.id === 'M1').f213, undefined)
  const m2 = out.rows.find(r => r.id === 'M2')
  assert.deepEqual(m2.f213, { subject: 'Media briefing', message: 'Request briefing at 1000 and 1600.', to: 'Command West', reply: true })
  assert.equal(m2.to, 'Command West') // addressed to a team: a To station as well
  const m3 = out.rows.find(r => r.id === 'M3')
  assert.deepEqual(m3.f213, { subject: 'Cots', message: 'Request 20 cots on call.', to: 'Operations', reply: false })
  assert.equal(m3.to, undefined) // "Operations" is a section, not a station
  assert.match(m2.notes, /^ICS-213 message\./)
})

check('maps the three new place types and puts Dispatch and Net Control traffic at the EOC', () => {
  const out = makeOso({ msel, places, teams })
  const type = id => out.places.find(p => p.id === id).type
  assert.equal(type('P25'), 'Search Division')
  assert.equal(type('P49'), 'Decon')
  assert.equal(type('P41'), 'River Gauge')
  assert.equal(type('P01'), 'Command Post')
  assert.equal(out.rows.find(r => r.id === 'M1').place, 'P03')
  assert.equal(out.center.place, 'P01')
})

check('keeps the softened-only rule and the fatality net, and uses western Washington area codes', () => {
  const out = makeOso({ msel, places, teams })
  assert.equal(out.rows.find(r => r.id === 'M4').notes, 'One patient, critical, request hoist.')
  assert.doesNotMatch(JSON.stringify(out), /deceased|coroner/i)
  const bad = msel.map(r => r.id === 'M3' ? { ...r, message: 'Caller says the occupant is deceased.' } : r)
  assert.throws(() => makeOso({ msel: bad, places, teams }), /no fatality text/)
  out.rangers.forEach(r => assert.match(r.phone, /^(360|425|206)-555-01\d\d$/))
})

const tablesHere = fs.existsSync(DEFAULT_IN) && fs.existsSync(`${DEFAULT_IN}/msel.csv`)
if (!tablesHere) {
  console.log(`  skip  scenario tables not found at ${DEFAULT_IN} - real-table checks not run`)
} else {
  const out = makeOso(readTables(DEFAULT_IN))
  check('real tables: no fatality text, every place resolves, expected counts', () => {
    assert.doesNotMatch(JSON.stringify(out), /deceased|coroner/i)
    const ids = new Set(out.places.map(p => p.id))
    assert.ok(out.rows.every(r => ids.has(r.place)))
    assert.equal(out.rows.length, 510) // 524 rows, minus 9 media and 5 test
    assert.equal(out.rows.filter(r => r.f213).length, 51)
    assert.equal(out.rows.filter(r => r.rr).length, 3) // E-283 resource requests
    assert.equal(out.places.length, 73)
    assert.equal(out.tacticalCalls.length, 40)
    assert.ok(out.rangers.length >= 128 && out.rangers.length <= 150)
    assert.ok(out.places.every(p => p.type !== 'Hazard' || /^(Hazard|Landmark)/.test(p.label)),
      'a place type fell through to the Hazard default')
  })
  check('real tables: the committed module is what the tables produce', () => {
    assert.equal(fs.readFileSync(DEFAULT_OUT, 'utf8'), render(out),
      'sample-data-oso.ts is stale - rerun make-oso-demo.js')
  })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
