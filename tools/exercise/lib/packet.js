// SPDX-License-Identifier: AGPL-3.0-or-later
// RangerTrak exercise console (E-196 phase 0). Free software under the GNU AGPL v3 or later.
import { rebaseMs } from './clock.js'
import { hashId } from './settings.js'
import { opPeriodAt } from './package.js'

/**
 * Report Packet writer. The shape is the app's own `ReportPacket`
 * (src/app/shared/export/report-packet.ts, schemaVersion 1): plain JSON with
 *   { schemaVersion, notice, exportedAt, appVersion, mission, event, opPeriod, operator, entries }
 * and entries shaped like `RadioLogEntryType` (src/app/domain/model/radio-log-entry.interface.ts).
 * `entry-merge.ts` rejects an entry unless: `id` is a finite number, `callsign` and `status` are
 * strings, `uid` (if present) is non-blank text, `date` parses, and `location` has lat in
 * [-90, 90] and lng in [-180, 180]. Everything below satisfies that. tools/exercise/app-accepts.test.js
 * runs the app's own parseReportPacket() and mergeEntries() over a packet built here.
 *
 * Those app files are read, never imported or changed.
 */
export const REPORT_PACKET_SCHEMA_VERSION = 1

/** The app's own confidentiality notice, with the exercise warning in front. */
export const PACKET_NOTICE = 'EXERCISE, EXERCISE, EXERCISE: made-up training traffic, not a real incident. '
  + 'CONFIDENTIAL: may name real people and describe an active incident '
  + '(locations, status, notes). Do not route this file through a service you do not '
  + 'control, and delete it once its reports have been merged at the main station.'

export const EXERCISE_OPERATOR = 'EXERCISE controller'
export const APP_VERSION_MARK = 'exercise-console'
export const NOTE_PREFIX = '[EXERCISE] '

/** The app's status names (DEFAULT_RADIO_LOG_STATUSES). An unknown name would still merge, but would have no colour. */
export const STATUS = Object.freeze({
  normal: 'Normal', location: 'Location Report', evidence: 'Evidence Report', rest: 'Need Rest/Food',
  checkIn: 'Incident Check-in', checkOut: 'Incident Check-out', urgent: 'Urgent',
})

/** A status for a scenario row, from its kind and words. Same spirit as the Montecito demo generator. */
export function statusFor(row) {
  const text = String(row.message ?? '').toLowerCase()
  if (row.kind === 'casualty') return STATUS.urgent
  if (row.kind === 'hazard') return STATUS.evidence
  if (row.kind === 'find') return /request|need|injur|trapp|extract|hoist|medic|critical/.test(text) ? STATUS.urgent : STATUS.evidence
  if (/\b(shift change|rotate|rotation|need(s)? (food|water))\b/.test(text)) return STATUS.rest
  if (/pull(ing)? out|returning to quarters|releas|demobiliz|stand(ing)? down|checking out|back in service/.test(text)) return STATUS.checkOut
  if (row.kind === 'resource' && /check(ing|ed)? in|on location|arrived|en route|reporting/.test(text)) return STATUS.checkIn
  if (row.kind === 'traffic' && /trapp|roof|cannot walk|oxygen|water rising|injur|collapsed|rescue/.test(text)) return STATUS.urgent
  return STATUS.normal
}

/** The middle of the scenario's places: where an entry with no place_id is pinned. */
export function centroid(places) {
  const good = places.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  if (!good.length) return { lat: 0, lng: 0 }
  return {
    lat: good.reduce((a, p) => a + p.lat, 0) / good.length,
    lng: good.reduce((a, p) => a + p.lon, 0) / good.length,
  }
}

/** A stable, UUID-shaped uid for an exercise row, so importing two overlapping catch-up files never doubles an entry. */
export function exerciseUid(scenarioId, rowId, runId = '') {
  const h = n => hashId(`${n}|${scenarioId}|${rowId}|${runId}`).toString(16).padStart(8, '0')
  const a = h(1), b = h(2), c = h(3), d = h(4)
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4)}${d}`
}

/** One radio log entry for one scenario row, dated at `dateMs` (a real instant). */
export function entryFromRow(row, { n, dateMs, placeById, fallback, scenarioId, runId }) {
  const place = row.place_id ? placeById.get(row.place_id) : null
  const date = new Date(dateMs).toISOString()
  return {
    uid: exerciseUid(scenarioId, row.id, runId),
    id: n,
    callsign: row.from,
    tacticalCall: row.from,
    toTactical: row.to || undefined,
    location: place
      ? { lat: place.lat, lng: place.lon, address: place.label, derivedFromAddress: false }
      : { lat: fallback.lat, lng: fallback.lng, address: 'EXERCISE (no place given)', derivedFromAddress: false },
    date,
    status: statusFor(row),
    notes: NOTE_PREFIX + row.message,
    source: row.channel === 'Phone' ? 'Phone' : 'Voice',
    operator: EXERCISE_OPERATOR,
    loggedAt: date,
  }
}

/** `rangertrak-report-packet-EXERCISE-<title>-<date>.txt`, matching the app's reportPacketFilename() with EXERCISE in it. */
export function packetFilename(title, exportedAt, suffix = '') {
  const label = (`EXERCISE-${title || 'scenario'}`).replace(/[^a-z0-9_-]+/gi, '_')
  return `rangertrak-report-packet-${label}${suffix ? '-' + suffix : ''}-${exportedAt.slice(0, 10)}.txt`
}

/**
 * The packet envelope around a list of entries. `scenarioMs` (optional) is the scenario wall clock
 * at the moment the file is made, in ms (the console holds scenario time as minutes since the epoch
 * read as UTC); with it the envelope carries `scenarioClock: { realAt, scenarioAt }`, which the app
 * (D-66) offers to set as the mission's scenario clock. Without it the packet is exactly as before.
 */
export function makePacket({ entries, title, opPeriod, nowMs, scenarioMs, appVersion = APP_VERSION_MARK }) {
  const scenarioClock = Number.isFinite(scenarioMs)
    ? { scenarioClock: { realAt: new Date(nowMs).toISOString(), scenarioAt: new Date(scenarioMs).toISOString() } }
    : {}
  return {
    schemaVersion: REPORT_PACKET_SCHEMA_VERSION,
    notice: PACKET_NOTICE,
    exportedAt: new Date(nowMs).toISOString(),
    appVersion,
    mission: `EXERCISE - ${title}`,
    event: 'EXERCISE',
    opPeriod: String(opPeriod ?? ''),
    operator: EXERCISE_OPERATOR,
    ...scenarioClock,
    entries,
  }
}

/**
 * The catch-up file (E-196 4, option A): every BACKGROUND row of the effective script from
 * `fromMin` (exclusive; default: from the start) up to `toMin` (inclusive), rebased so that the
 * scenario moment `toMin` equals `nowMs`, written as a Report Packet the app already imports.
 *
 *   pkg      the loaded package (places, opPeriods, scenario)
 *   script   buildScript(pkg, settings).rows
 *
 * Returns { packet, filename, text, count }. `text` is what goes in the .txt file.
 */
export function buildCatchUp({ pkg, script, toMin, fromMin = -Infinity, nowMs, runId = '' }) {
  const placeById = new Map(pkg.places.map(p => [p.id, p]))
  const fallback = centroid(pkg.places)
  const scenarioId = pkg.scenario?.id || pkg.scenario?.title || 'scenario'
  const due = script.filter(r => r.role === 'background' && r.t > fromMin && r.t <= toMin)
  const entries = due.map((r, i) => entryFromRow(r, {
    n: i + 1, dateMs: rebaseMs(r.t, toMin, nowMs), placeById, fallback, scenarioId, runId,
  }))
  const op = opPeriodAt(pkg.opPeriods, toMin)?.n
  const packet = makePacket({ entries, title: pkg.scenario?.title || 'scenario', opPeriod: op, nowMs, scenarioMs: toMin * 60000 })
  const suffix = `catch-up-to-${opLabel(op)}`
  return { packet, filename: packetFilename(pkg.scenario?.title, packet.exportedAt, suffix), text: JSON.stringify(packet, null, 2), count: entries.length }
}

const opLabel = op => (op == null ? 'start' : `OP${op}`)

/** The places a scenario lists, as plain text for the controller packet (no Setup file is written; see README). */
export function placesList(pkg) {
  return pkg.places.map(p => `${p.id}  ${p.label}  (${p.type})  ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`).join('\n')
}
