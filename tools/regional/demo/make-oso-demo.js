/**
 * Builds the "Oso" sample scenario (E-195) from the scenario tables kept outside the repo
 * (rangertrak-InternalDocs\E-195 Oso\: msel.csv, places.csv, teams.csv) and writes it as one
 * TypeScript data module the app loads lazily:
 *
 *   node tools/regional/demo/make-oso-demo.js [inputFolder] [outFile]
 *
 *   inputFolder  default: ..\rangertrak-InternalDocs\E-195 Oso (a sibling of this repo's
 *                folder), or $OSO_DIR
 *   outFile      default: src/app/shared/services/sample-data-oso.ts
 *
 * The work is done by make-scenario-demo.js, shared with Montecito; this file is only Oso's
 * config. Oso adds what Montecito did not have: ICS-213 message rows (form = ICS-213, which the
 * app files as radio log entries that also generate an ICS-213, so they show on Messages) and
 * three more place types (search division, decon, river gauge).
 */
const shared = require('./make-scenario-demo')

const CONFIG = {
  key: 'oso', name: 'Oso', script: 'make-oso-demo.js', envVar: 'OSO_DIR',
  event: 'Oso landslide (modeled)',
  eventNotes: 'Modeled on the March 22, 2014 SR 530 landslide near Oso, Washington. The people, teams and '
    + 'messages are invented; the scale, phases and problems follow the public record.',
  seed: 2014,
  centerPlace: 'P01', // Command Post West: the mission's default location
  eocPlace: 'P03', // County EOC: where Dispatch and Net Control traffic is logged
  // 360 / 425 / 206 are the western Washington area codes; with 555-01xx they are never real numbers.
  areaCode: n => (n < 50 ? 360 : n < 100 ? 425 : 206),
  locationTypes: { 'search division': 'Search Division', decon: 'Decon', 'river gauge': 'River Gauge' },
  // Real agencies and outlets that must not reach the log (the tables use none today).
  moreRealNames: /\b(OSHA|ARRL|WSDOT|Snohomish)\b/,
  // E-283: three log entries that are also ICS-213RR resource requests (they read as requests).
  resourceRequests: {
    M0213: { priority: 'life-saving', contactName: 'Dana Whitfield', contactPhone: '206-555-0142', lines: [
      { qty: '9', kind: 'Hard hat', description: 'Class E, adjustable' },
      { qty: '9', kind: 'Gloves', description: 'Work gloves, large' },
    ] },
    M0065: { priority: 'incident-stabilization', contactName: 'Marcus Doyle', contactPhone: '206-555-0167', lines: [
      { qty: '4', kind: 'Hard hat', description: 'Class E, adjustable' },
      { qty: '1', kind: 'First aid kit', description: 'Trauma kit, responder size' },
    ] },
    M0091: { priority: 'incident-stabilization', contactName: 'Priya Natarajan', contactPhone: '425-555-0123', lines: [
      { qty: '12', kind: 'Hard hat', description: 'Class E, adjustable' },
      { qty: '2', kind: 'First aid kit', description: 'Trauma kit, responder size' },
    ] },
  },
}

module.exports = {
  makeOso: tables => shared.makeScenario(tables, CONFIG),
  render: data => shared.render(data, CONFIG),
  readTables: shared.readTables,
  DEFAULT_IN: shared.inputDirFor(CONFIG),
  DEFAULT_OUT: shared.outFileFor(CONFIG),
  FATALITY_WORDS: shared.FATALITY_WORDS,
}
if (require.main === module) shared.runCli(CONFIG)
