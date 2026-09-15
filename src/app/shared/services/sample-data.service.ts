import { Injectable } from '@angular/core'

import {
  RadioLogService, RadioLogType, RadioLogEntryType, LogService, RangerService, RangerType,
  MissionService, MissionLocationService, MissionLocationType
} from './'

/**
 * A named demonstration mission a user can pick, so "load the sample mission" isn't limited
 * to one place. `vashon` stays the default everywhere it's offered (Entry, Mission > Danger
 * zone, Rangers) - it's the original, most-tested scenario. See SAMPLE_SCENARIOS below for
 * the label/hint shown in each picker.
 */
export type SampleScenarioId = 'vashon' | 'grand-canyon' | 'state-fair' | 'near-me'

export type SampleScenarioOption = {
  id: SampleScenarioId
  label: string
  hint: string
}

/**
 * F29-?? (2026-09-14, maintainer's own ask): "other areas as an alternative: Grand Canyon,
 * state fair, and one tied to their own coordinates." Every entry point that used to offer a
 * single "Load sample mission" action now offers this list instead, defaulting to `vashon`.
 *
 * Kept here (not a component) so every picker - Entry, Mission > Danger zone, Rangers - reads
 * the exact same three sentences rather than three hand-copied descriptions drifting apart.
 */
export const SAMPLE_SCENARIOS: ReadonlyArray<SampleScenarioOption> = [
  {
    id: 'vashon',
    label: 'Vashon Island (default)',
    hint: 'The original demo: a missing-hiker search across two real Vashon-Maury parks.',
  },
  {
    id: 'grand-canyon',
    label: 'Grand Canyon, South Rim',
    hint: 'A missing-hiker search near the Bright Angel Trailhead and the Rim Trail.',
  },
  {
    id: 'state-fair',
    label: 'State fair (Puyallup, WA)',
    hint: 'A lost child, heat illness and a crowd-flow incident at the Washington State Fair.',
  },
  {
    id: 'near-me',
    label: 'Near me',
    hint: 'Generated around this device\'s current location (or the mission default if location '
      + 'isn\'t available). Points are rough walking-distance offsets and may land on water or '
      + 'a building - there\'s no way to know what\'s really there without a real map.',
  },
]

/** A plain lat/lng pair, used internally to center a scenario or offset points from it. */
type Center = { lat: number, lng: number }

/**
 * One field-report/message row before it becomes a real `RadioLogEntryType` - see
 * assembleLogEntries() below. Unchanged shape from before scenarios existed.
 */
type Row = {
  callsign: string
  minutesAgo: number
  lat: number
  lng: number
  address: string
  statusIndex: number
  notes: string
  source?: RadioLogEntryType['source']
  operator?: string
  generates213?: boolean
  replyRequested213?: boolean
  subject213?: string
  message213?: string
  recipients213?: string[]
}

/** What a fully-built scenario hands back to loadSampleMission(). */
type ScenarioData = {
  event: string
  eventNotes: string
  rangers: RangerType[]
  rows: Row[]
  locations: MissionLocationType[]
}

/**
 * A ready-made demonstration mission: a roster and a few hours of field reports/messages,
 * offered as a small choice of scenarios (SAMPLE_SCENARIOS) rather than one fixed place.
 *
 * A virgin instance is genuinely empty - no field reports, so the Reports grid says
 * "No Rows To Show" and both maps open on a blank basemap with nothing plotted. That
 * makes it impossible to show the product to anyone, or to eyeball a UI change,
 * without first hand-entering reports one at a time.
 *
 * This used to differ from RadioLogService.generateFakeData() on purpose - that one
 * scattered random points within ~0.001 degrees of the default coordinate with joke
 * notes, useful for load-testing the grid but useless for a demo since every marker
 * landed in one indistinguishable clump. It was removed 2026-08-25 as a dead control
 * (E-94) once its only caller, the Field Reports "fake report generator," was removed
 * too. The data here is hand-authored and fixed: recognizable real-world locations,
 * every status represented so the grid's color coding is visible, and plausible
 * dispatch-log notes.
 *
 * F29-11 (2026-08-29, maintainer's own live note, re-scoped 2026-08-30): three problems with
 * the previous version of this data, fixed here -
 *
 * 1. **Flat roster, no ICS structure.** Twelve interchangeable "Team N" callsigns told no
 *    story about who is actually running an incident. Rewritten around a real command
 *    staff (Incident Commander, Operations Section Chief, Command Post/net control, a PIO)
 *    plus field teams who report to them - using the existing `role` field, no new data
 *    model needed (Teams/Facilities as real entities is D-a, still deferred).
 * 2. **Names that read as real people.** "Radio Team Alpha," "CERT Team One" were at least
 *    honestly generic, but earlier drafts of this kind of data tend to drift toward
 *    realistic-sounding names that could be mistaken for someone real. Every name here is
 *    deliberately, obviously invented - the point is a demo that reads as a demo.
 * 3. **Reports spread the length of the island at driving-distance intervals.** Real field
 *    teams in this app's own scenario (SAR/CERT on foot, not in vehicles) work a tight
 *    search pattern, not a road trip. Field team positions cluster at distances a walking
 *    team would actually cover.
 *
 * Also: two ICS-213 messages per scenario (`generates213`/`message213`/`recipients213`/
 * `subject213`/`operator`) - the ORIGINAL ask behind F29-11 ("sample data should include
 * messages as well as radio log entries") was never actually met by the version before that,
 * which had zero.
 *
 * F-scenarios (2026-09-14, maintainer's own ask): "other areas as an alternative: Grand
 * Canyon, state fair, and one tied to their own coordinates." Every scenario now shares one
 * shape - 12 rangers, 4 command staff at a fixed post plus 4 field teams of 2 (four clearly
 * separate moving trails on the map), and 2 mission Locations (ADR D-49) as the "objectives" -
 * so the unit spec can assert the same invariants across all four rather than special-casing
 * Vashon. Reusing this shape for Vashon also fixed a real gap in the OLD data, caught while
 * writing that spec: it never actually included a "Location Report" status row despite the
 * doc comment's own claim that "every status" was represented - see [[verify-the-measurement-
 * itself]]. Every scenario below deliberately includes one now.
 *
 * Every scenario reuses the same twelve `assets/imgs/rangers/` photos (no new image assets
 * shipped for this) - which photo is "the Incident Commander" vs. "a field ranger" changes
 * per scenario, since the filename is just an internal asset id, never shown as text.
 *
 * Report timestamps are the one thing computed rather than fixed - they're offsets
 * back from "now", so the Reports grid's Elapsed column always reads like a mission
 * in progress no matter when the demo is run.
 */
@Injectable({ providedIn: 'root' })
export class SampleDataService {

  private id = 'Sample Data Service'

  /** Marks the loaded mission as demo data, in the UI and in any export of it. */
  public static readonly SAMPLE_EVENT_NAME = 'Missing Person Exercise'
  public static readonly SAMPLE_EVENT_NOTES = 'Investigate report of several lost individuals'

  /**
   * Raised live 2026-08-30: the mission ID a real agency would actually assign - a
   * year-month-type code, e.g. "2026-08-Search" - rather than a fixed string. Computed at
   * load time (not a static constant) so it always reflects the month the demo is actually
   * run, not the month this file was last edited.
   */
  private static sampleMissionId(): string {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    return `${yyyy}-${mm}-Search`
  }

  constructor(
    private missionService: MissionService,
    private rangerService: RangerService,
    private radioLogService: RadioLogService,
    private missionLocationService: MissionLocationService,
    private log: LogService,
  ) { }

  /**
   * True when this looks like a virgin instance worth offering sample data for:
   * no field reports have ever been entered. The ranger roster is deliberately not
   * part of the test - RangerService seeds a hardcoded roster on first run, so it is
   * never empty and would make this always false.
   */
  public isVirginInstance(): boolean {
    return this.radioLogService.getCurrentRadioLog().logEntries.length === 0
  }

  /**
   * Replaces the roster, all field reports, and the Locations list with the chosen sample
   * scenario, and names the mission/event so nobody mistakes demo data for real mission data.
   *
   * Destructive by design - the caller is responsible for confirming with the user.
   * Everything it touches is covered by Back up mission, so a real mission can be
   * saved off first and restored afterwards.
   *
   * Async only because of `near-me`: it makes a best-effort, short-timeout attempt at the
   * device's own GPS position (falling back to the mission's configured default location,
   * exactly like Entry's own field-mode GPS auto-fill) before it can generate any points.
   * The other three scenarios resolve synchronously under the hood but still return a
   * Promise, so every caller has exactly one code path to await rather than a branch.
   */
  public async loadSampleMission(scenario: SampleScenarioId = 'vashon'): Promise<void> {
    const data = await this.buildScenario(scenario)

    // Settings first, then rangers, then reports - the same ordering (and for the same
    // reason) as BackupService.importMission(): replaceAllRadioLog() recalculates
    // bounds and needs current settings already in place.
    this.missionService.updateMission({
      ...this.missionService.settings,
      mission: SampleDataService.sampleMissionId(),
      event: data.event,
      eventNotes: data.eventNotes,
    })
    this.rangerService.replaceAllRangers(data.rangers)
    const radioLog = this.assembleRadioLog(data.rows, data.rangers, data.event)
    this.radioLogService.replaceAllRadioLog(radioLog)
    this.missionLocationService.replaceAllLocations(data.locations)

    this.log.warn(
      `Loaded sample mission "${scenario}": ${data.rangers.length} rangers, `
      + `${radioLog.numReport} field reports, ${data.locations.length} locations. This is DEMO data.`,
      this.id)
  }

  // ---------------------------------------------------------------------------

  private async buildScenario(scenario: SampleScenarioId): Promise<ScenarioData> {
    switch (scenario) {
      case 'grand-canyon': return this.buildGrandCanyonScenario()
      case 'state-fair': return this.buildStateFairScenario()
      case 'near-me': return this.buildNearMeScenario(await this.resolveDeviceLocation())
      case 'vashon':
      default:
        return this.buildVashonScenario()
    }
  }

  /**
   * Best-effort device position for the `near-me` scenario - same mechanics as Entry's own
   * `tryGpsAutoFill()` (field-mode GPS auto-fill): `getCurrentPosition()` with a short
   * timeout, wrapped in a Promise, and a hard fallback to the mission's own configured
   * default location (`defLat`/`defLng`) if geolocation is unsupported, denied, or slow.
   * Never blocks longer than ~6 seconds - a demo-data button press should never hang waiting
   * on a permission prompt nobody answers.
   *
   * No geocoding call of any kind here (raw coordinates only) - the whole scenario must work
   * offline, same as every other scenario.
   */
  private resolveDeviceLocation(): Promise<Center> {
    const fallback: Center = {
      lat: this.missionService.settings.defLat,
      lng: this.missionService.settings.defLng,
    }

    return new Promise<Center>(resolve => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(fallback)
        return
      }

      let settled = false
      const finish = (center: Center) => {
        if (settled) return
        settled = true
        resolve(center)
      }

      const timer = setTimeout(() => {
        this.log.info('near-me scenario: geolocation timed out, using the mission default location.', this.id)
        finish(fallback)
      }, 6000)

      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timer)
          finish({ lat: position.coords.latitude, lng: position.coords.longitude })
        },
        () => {
          clearTimeout(timer)
          this.log.info('near-me scenario: geolocation unavailable/denied, using the mission default location.', this.id)
          finish(fallback)
        },
        { timeout: 5000, maximumAge: 60000 },
      )
    })
  }

  /**
   * Meters-to-degrees offset from a center point, for `near-me`'s fixed relative walking
   * loops. An equirectangular approximation (good to well under 1% error at walking
   * distances) rather than a real geodesic library - there is no library already in this
   * app's dependency tree for this, and one is not worth adding for offsets measured in
   * hundreds of meters. `positive north` = latitude increases; `positive east` = longitude
   * increases.
   */
  private offset(center: Center, northMeters: number, eastMeters: number): Center {
    const metersPerDegLat = 111_320
    const metersPerDegLng = 111_320 * Math.cos(center.lat * Math.PI / 180) || 1e-6
    return {
      lat: center.lat + northMeters / metersPerDegLat,
      lng: center.lng + eastMeters / metersPerDegLng,
    }
  }

  /**
   * Converts scenario rows into real log entries, matching each row's callsign against the
   * roster. Shared by every scenario - unchanged from the single-scenario version of this
   * file. `bounds` is deliberately absent from the return type: RadioLogService.
   * replaceAllRadioLog() recalculates it from the report coordinates, exactly as it does for
   * a real import.
   */
  private assembleRadioLog(rows: Row[], rangers: RangerType[], event: string): Omit<RadioLogType, 'bounds'> {
    const statuses = this.statusNames()
    const now = Date.now()
    const known = new Set(rangers.map(r => r.callsign))
    const logEntries: RadioLogEntryType[] = []

    rows.forEach((row, index) => {
      if (!known.has(row.callsign)) {
        // Guards the roster and the report table against drifting apart: an unmatched
        // callsign would render as an orphan row the grid can't tie back to a ranger.
        this.log.error(`Sample report ${index} references unknown callsign "${row.callsign}" - skipped.`, this.id)
        return
      }
      logEntries.push({
        id: logEntries.length,
        callsign: row.callsign,
        location: { lat: row.lat, lng: row.lng, address: row.address, derivedFromAddress: false },
        date: new Date(now - row.minutesAgo * 60 * 1000),
        status: statuses[row.statusIndex] ?? statuses[0],
        notes: row.notes,
        source: row.source,
        operator: row.operator,
        generates213: row.generates213,
        replyRequested213: row.replyRequested213,
        subject213: row.subject213,
        message213: row.message213,
        recipients213: row.recipients213,
      })
    })

    return {
      version: this.missionService.settings.version,
      date: new Date(),
      event,
      numReport: logEntries.length,
      maxId: logEntries.length,
      filter: '',
      logEntries,
    }
  }

  /**
   * Status *names* as currently configured, so the sample reports color-code correctly
   * in the grid. Users can rename statuses in Settings, and the grid matches on the
   * name string - hardcoding 'Normal' etc. here would silently produce grey rows for
   * anyone who had renamed them.
   */
  private statusNames(): string[] {
    const configured = this.missionService.settings?.radioLogStatuses
    if (!configured?.length) {
      this.log.error(`No field report statuses configured; sample reports will have an empty status.`, this.id)
      return ['']
    }
    return configured.map(s => s.status)
  }

  // ── Scenario 1: Vashon Island (default) ──────────────────────────────────────────────

  /**
   * The original demo, reshaped to the common 12/4-teams/2-objectives pattern (see this
   * class's own doc comment). Command staff trimmed from six to four to make room for a
   * fourth field team while holding the roster at twelve - the two extra field trails
   * previously didn't exist at all; teams now walk two real Vashon-Maury parks (Maury Island
   * Marine Park, Dockton Park) in four separate two-person tracks instead of two loosely
   * three-person clusters.
   */
  private buildVashonScenario(): ScenarioData {
    const CP = { lat: 47.4472, lng: -122.4627, address: '10014 SW Bank Rd, Vashon' }
    const MAURY = { lat: 47.4050, lng: -122.4200, name: 'Maury Island Marine Park' }
    const DOCKTON = { lat: 47.3739, lng: -122.4560, name: 'Dockton Park' }

    const rangers: RangerType[] = [
      { callsign: 'IC-Actual', fullName: 'Hazel "Compass" Winterbourne', phone: '206-555-0100', image: 'ic-actual.jpg', id: 'IC-1', team: 'Command', role: 'Incident Commander', note: 'Overall exercise command' },
      { callsign: '!CmdPost', fullName: 'Exercise Command Post', phone: '206-555-0101', image: 'CmdPost.jpg', id: 'CP-1', team: 'Command', role: 'Command', note: 'Net control for the exercise' },
      { callsign: 'OpsChief', fullName: 'Ollie Fogbank', phone: '206-555-0110', image: 'ops-chief.jpg', id: 'OPS-1', team: 'Command', role: 'Operations Section Chief', note: 'Directs field teams' },
      { callsign: 'PIO1', fullName: 'Ivy Loudhailer', phone: '206-555-0113', image: 'pio.jpg', id: 'PIO-1', team: 'Command', role: 'Public Information Officer', note: 'Fields press and family inquiries' },

      { callsign: 'CERT1', fullName: 'Gus Underbrush', phone: '206-555-0121', image: 'cert1.jpg', id: 'VI-11', team: 'Maury-CERT', role: 'Team Lead', note: 'Marine Park, north loop' },
      { callsign: 'CERT2', fullName: 'Wanda Woodsy', phone: '206-555-0122', image: 'cert2.jpg', id: 'VI-12', team: 'Maury-CERT', role: 'Responder', note: 'Marine Park, south loop' },

      { callsign: 'Recon1', fullName: 'Chip Trailblaze', phone: '206-555-0123', image: 'recon1.jpg', id: 'VI-13', team: 'Recon', role: 'Mobile', note: 'Marine Park, beach access trail' },
      { callsign: 'Recon2', fullName: 'Dana Fernbrook', phone: '206-555-0124', image: 'plan-chief.jpg', id: 'VI-14', team: 'Recon', role: 'Mobile', note: 'Marine Park, bluff overlook spur' },

      { callsign: 'CERT3', fullName: 'Marge Tidepool', phone: '206-555-0131', image: 'cert3.jpg', id: 'VI-21', team: 'Dockton-CERT', role: 'Team Lead', note: 'Dockton Park, north shoreline' },
      { callsign: 'CERT4', fullName: 'Boone Saltmarsh', phone: '206-555-0132', image: 'log-chief.jpg', id: 'VI-22', team: 'Dockton-CERT', role: 'Responder', note: 'Dockton Park, boat launch' },

      { callsign: 'MERT1', fullName: 'Barnaby Fogg', phone: '206-555-0133', image: 'mert1.jpg', id: 'VI-23', team: 'Dockton-Marine', role: 'Marine', note: 'Dockton Park, Quartermaster Harbor patrol' },
      { callsign: 'Medic1', fullName: 'Dr. Sunny Skipper', phone: '206-555-0134', image: 'medic1.jpg', id: 'VI-24', team: 'Dockton-Marine', role: 'Medical', note: 'Dockton Park, first-aid post' },
    ]

    const OPS = 'Ollie Fogbank'

    const rows: Row[] = [
      // ── Command staff check in from the post ──────────────────────────────────
      { callsign: '!CmdPost', minutesAgo: 335, ...CP, statusIndex: 4, notes: 'Command post established, net open on primary.', source: 'Voice', operator: 'Ivy Loudhailer' },
      { callsign: 'IC-Actual', minutesAgo: 333, ...CP, statusIndex: 4, notes: 'Assuming command for the exercise.', source: 'Voice', operator: 'Hazel "Compass" Winterbourne' },
      { callsign: 'OpsChief', minutesAgo: 330, ...CP, statusIndex: 4, notes: 'Ops section staffed, briefing field teams now.', source: 'Voice', operator: OPS },
      { callsign: 'PIO1', minutesAgo: 324, ...CP, statusIndex: 4, notes: 'Media staging area set up at the road entrance.', source: 'Voice', operator: 'Ivy Loudhailer' },

      // ── Team A: CERT1/CERT2 - Maury Island Marine Park, north+south loop ──────
      { callsign: 'CERT1', minutesAgo: 300, lat: MAURY.lat, lng: MAURY.lng, address: `${MAURY.name} - main trailhead, near the last known point`, statusIndex: 4, notes: 'Team of two checking in, starting north loop on foot.', source: 'Voice', operator: OPS },
      { callsign: 'CERT2', minutesAgo: 296, lat: MAURY.lat + 0.0018, lng: MAURY.lng - 0.0022, address: `${MAURY.name} - south loop junction`, statusIndex: 4, notes: 'Checked in, beginning south loop.', source: 'Voice', operator: OPS },
      { callsign: 'CERT1', minutesAgo: 250, lat: MAURY.lat + 0.0035, lng: MAURY.lng + 0.0010, address: `${MAURY.name} - north bluff overlook`, statusIndex: 2, notes: 'Downed branch partially blocking the overlook spur, photographed for assessment.', source: 'Voice', operator: OPS },
      { callsign: 'CERT2', minutesAgo: 210, lat: MAURY.lat + 0.0025, lng: MAURY.lng - 0.0035, address: `${MAURY.name} - south loop, mile 1`, statusIndex: 1, notes: 'Location report: south loop, mile 1, continuing toward the point.', source: 'Voice', operator: OPS },
      { callsign: 'CERT1', minutesAgo: 140, lat: MAURY.lat + 0.0035, lng: MAURY.lng + 0.0010, address: `${MAURY.name} - north bluff overlook`, statusIndex: 5, notes: 'North loop complete, no further hazards found, checking out.', source: 'Voice', operator: OPS },
      { callsign: 'CERT2', minutesAgo: 96, lat: MAURY.lat + 0.0025, lng: MAURY.lng - 0.0035, address: `${MAURY.name} - south loop, mile 1`, statusIndex: 3, notes: 'South loop complete, team requesting food and rest.', source: 'Voice', operator: OPS },

      // ── Team B: Recon1/Recon2 - Maury Island, beach access + bluff spur ───────
      { callsign: 'Recon1', minutesAgo: 288, lat: MAURY.lat - 0.0012, lng: MAURY.lng + 0.0028, address: `${MAURY.name} - beach access trail`, statusIndex: 0, notes: 'Beach access trail passable, tide line clear.', source: 'Voice', operator: OPS },
      { callsign: 'Recon2', minutesAgo: 270, lat: MAURY.lat - 0.0008, lng: MAURY.lng + 0.0020, address: `${MAURY.name} - bluff overlook spur`, statusIndex: 0, notes: 'Approaching the overlook spur from the beach side.', source: 'Voice', operator: OPS },
      {
        callsign: 'Recon1', minutesAgo: 180, lat: MAURY.lat - 0.0020, lng: MAURY.lng + 0.0015, address: `${MAURY.name} - beach access trail, low tide flats`, statusIndex: 6,
        notes: 'URGENT: hiker with a twisted ankle at the low tide flats, cannot self-evacuate.', source: 'Phone', operator: OPS,
        generates213: true, replyRequested213: true, subject213: 'Injured hiker, Marine Park beach trail',
        message213: 'One hiker, ankle injury, unable to walk out. Requesting Medic1 respond to the beach access trail low tide flats. Not life-threatening but needs assistance evacuating before the tide turns.',
        recipients213: ['Incident Commander', 'Ops'],
      },
      { callsign: 'Recon1', minutesAgo: 172, lat: MAURY.lat - 0.0020, lng: MAURY.lng + 0.0015, address: `${MAURY.name} - beach access trail, low tide flats`, statusIndex: 0, notes: 'Staying with the hiker, keeping them warm and off the wet sand until Medic1 arrives.', source: 'Voice', operator: OPS },
      { callsign: 'Recon2', minutesAgo: 150, lat: MAURY.lat - 0.0010, lng: MAURY.lng + 0.0022, address: `${MAURY.name} - beach access trail, midpoint`, statusIndex: 5, notes: 'Bluff spur cleared, rejoining Recon1 at the flats. Checking out.', source: 'Voice', operator: OPS },

      // ── Team C: CERT3/CERT4 - Dockton Park, north shoreline sweep ─────────────
      { callsign: 'CERT3', minutesAgo: 292, lat: DOCKTON.lat, lng: DOCKTON.lng, address: `${DOCKTON.name} - boat launch, staging area`, statusIndex: 4, notes: 'Team checked in at the staging area, beginning shoreline sweep.', source: 'Voice', operator: OPS },
      { callsign: 'CERT4', minutesAgo: 284, lat: DOCKTON.lat + 0.0012, lng: DOCKTON.lng + 0.0010, address: `${DOCKTON.name} - north shoreline, quarter mile`, statusIndex: 0, notes: 'North shoreline clear so far.', source: 'Voice', operator: OPS },
      { callsign: 'CERT3', minutesAgo: 244, lat: DOCKTON.lat + 0.0022, lng: DOCKTON.lng + 0.0018, address: `${DOCKTON.name} - north shoreline trail`, statusIndex: 2, notes: 'Debris field along the north shoreline, photographed for assessment.', source: 'Voice', operator: OPS },
      {
        callsign: 'CERT3', minutesAgo: 160, lat: DOCKTON.lat + 0.0022, lng: DOCKTON.lng + 0.0018, address: `${DOCKTON.name} - north shoreline trail`, statusIndex: 6,
        notes: 'URGENT: possible propane smell near the park maintenance shed, evacuating the picnic area as a precaution.', source: 'Voice', operator: OPS,
        generates213: true, replyRequested213: true, subject213: 'Possible gas leak, Dockton Park maintenance shed',
        message213: 'Team reports a possible propane odor near the maintenance shed on the north shoreline trail. Clearing the picnic shelter as a precaution and holding a 50m perimeter. Requesting Logistics confirm whether county gas utility should be notified.',
        recipients213: ['Incident Commander', 'Logistics'],
      },
      { callsign: 'CERT4', minutesAgo: 152, lat: DOCKTON.lat + 0.0012, lng: DOCKTON.lng + 0.0010, address: `${DOCKTON.name} - north shoreline, quarter mile`, statusIndex: 0, notes: 'Holding the shoreline trail perimeter while the shed issue is checked.', source: 'Voice', operator: OPS },
      { callsign: 'CERT3', minutesAgo: 60, lat: DOCKTON.lat + 0.0022, lng: DOCKTON.lng + 0.0018, address: `${DOCKTON.name} - north shoreline trail`, statusIndex: 5, notes: 'Shoreline sweep complete, propane smell traced to a stored camp stove, resolved. Checking out.', source: 'Voice', operator: OPS },

      // ── Team D: MERT1/Medic1 - Dockton Park, marina + one water track + first aid ──
      // Live report, 2026-08-30: every OTHER report in this scenario sits on land (trail,
      // dock, or shoreline) - a boat-team marker plotted mid-harbor first read as a data
      // error, not a boat, when it was the only water-based point in the set. This is the
      // ONE deliberate water track (MERT1's four Quartermaster Harbor waypoints) - one of
      // several team tracks on the water is the ask, not zero and not all of them.
      { callsign: 'MERT1', minutesAgo: 276, lat: DOCKTON.lat + 0.0008, lng: DOCKTON.lng - 0.0015, address: `${DOCKTON.name} - marina dock`, statusIndex: 4, notes: 'Launched from the marina, transiting Quartermaster Harbor at idle speed.', source: 'Packet', operator: OPS },
      { callsign: 'Medic1', minutesAgo: 268, lat: DOCKTON.lat - 0.0010, lng: DOCKTON.lng + 0.0012, address: `${DOCKTON.name} - picnic shelter`, statusIndex: 4, notes: 'First-aid post set up at the picnic shelter, staged and ready.', source: 'Voice', operator: OPS },
      { callsign: 'MERT1', minutesAgo: 260, lat: DOCKTON.lat - 0.0015, lng: DOCKTON.lng - 0.0025, address: 'Quartermaster Harbor, north entrance', statusIndex: 0, notes: 'Position report, no vessels in distress observed.', source: 'Packet', operator: OPS },
      { callsign: 'MERT1', minutesAgo: 230, lat: DOCKTON.lat - 0.0035, lng: DOCKTON.lng - 0.0040, address: 'Quartermaster Harbor, mid-channel', statusIndex: 0, notes: 'Continuing south down the channel, harbor clear so far.', source: 'Packet', operator: OPS },
      { callsign: 'MERT1', minutesAgo: 200, lat: DOCKTON.lat - 0.0055, lng: DOCKTON.lng - 0.0030, address: 'Quartermaster Harbor, south end near the point', statusIndex: 0, notes: 'Rounding the point, visual sweep of the shoreline.', source: 'Packet', operator: OPS },
      { callsign: 'MERT1', minutesAgo: 170, lat: DOCKTON.lat - 0.0030, lng: DOCKTON.lng - 0.0060, address: 'Quartermaster Harbor, west shore', statusIndex: 0, notes: 'Heading back up-channel toward the dock.', source: 'Packet', operator: OPS },
      { callsign: 'Medic1', minutesAgo: 100, lat: DOCKTON.lat - 0.0010, lng: DOCKTON.lng + 0.0012, address: `${DOCKTON.name} - picnic shelter`, statusIndex: 0, notes: 'No patients yet, relocating closer to the shoreline trail as a precaution.', source: 'Voice', operator: OPS },
      { callsign: 'MERT1', minutesAgo: 92, lat: DOCKTON.lat + 0.0008, lng: DOCKTON.lng - 0.0015, address: `${DOCKTON.name} - marina dock`, statusIndex: 5, notes: 'Marine sweep complete, back at the dock, checking out.', source: 'Packet', operator: OPS },
      { callsign: 'Medic1', minutesAgo: 70, lat: DOCKTON.lat - 0.0010, lng: DOCKTON.lng + 0.0012, address: `${DOCKTON.name} - picnic shelter`, statusIndex: 5, notes: 'First-aid post stood down, no injuries requiring treatment. Checking out.', source: 'Voice', operator: OPS },

      // ── Wrap-up ────────────────────────────────────────────────────────────────
      { callsign: 'IC-Actual', minutesAgo: 30, ...CP, statusIndex: 0, notes: 'Both parks swept, no outstanding hazards. Standing down field teams.', source: 'Voice', operator: 'Hazel "Compass" Winterbourne' },
      { callsign: '!CmdPost', minutesAgo: 12, ...CP, statusIndex: 5, notes: 'Exercise complete, closing net.', source: 'Voice', operator: 'Ivy Loudhailer' },
    ]

    const locations: MissionLocationType[] = [
      {
        name: 'Last Known Point - Maury Trailhead', type: 'Last Known Point',
        lat: MAURY.lat, lng: MAURY.lng, address: `${MAURY.name} - main trailhead`,
        note: 'Missing hiker last seen here before the search began.',
      },
      {
        name: 'Dockton Park Staging Area', type: 'Staging Area',
        lat: DOCKTON.lat, lng: DOCKTON.lng, address: `${DOCKTON.name} - boat launch`,
        note: 'Marshalling point for CERT and marine teams.',
      },
    ]

    return {
      event: SampleDataService.SAMPLE_EVENT_NAME,
      eventNotes: SampleDataService.SAMPLE_EVENT_NOTES,
      rangers, rows, locations,
    }
  }

  // ── Scenario 2: Grand Canyon, South Rim ──────────────────────────────────────────────

  /**
   * A missing-hiker search around the Bright Angel Trailhead / Rim Trail, Grand Canyon
   * Village, South Rim. Coordinates are anchored on the trailhead itself (36.0578, -112.1434
   * - checked against the maintainer's own reference point) and stay within roughly 2-3km of
   * it, walking distance apart, never more than a few hundred meters below the rim - real
   * points along the developed rim corridor, not the open canyon.
   *
   * Elevation-aware notes throughout (heat, water) - the one below-rim team's whole reason
   * for existing is that the trail drops fast enough for temperature and hydration to become
   * the actual story, not just scenery.
   *
   * Coordinate confidence note (see this feature's own PR/report): the trailhead itself is
   * trusted; Yavapai Point, Trailview Overlook, Lookout Studio, and the backcountry office
   * are placed from general landmark knowledge, not a surveyed source - all comfortably
   * within the 2-3km guardrail even allowing for some error.
   */
  private buildGrandCanyonScenario(): ScenarioData {
    const CP = { lat: 36.0555, lng: -112.1459, address: 'Grand Canyon Village - Backcountry Information Center (approx.)' }
    const TRAILHEAD = { lat: 36.0578, lng: -112.1434, address: 'Bright Angel Trailhead, Grand Canyon Village' }

    const rangers: RangerType[] = [
      { callsign: 'IC-Actual', fullName: 'Dusty "Mesa" Ridgewalker', phone: '928-555-0100', image: 'ic-actual.jpg', id: 'IC-1', team: 'Command', role: 'Incident Commander', note: 'Overall exercise command' },
      { callsign: '!CmdPost', fullName: 'Exercise Command Post', phone: '928-555-0101', image: 'CmdPost.jpg', id: 'CP-1', team: 'Command', role: 'Command', note: 'Net control for the exercise' },
      { callsign: 'OpsChief', fullName: 'Rusty Sagebrush', phone: '928-555-0110', image: 'ops-chief.jpg', id: 'OPS-1', team: 'Command', role: 'Operations Section Chief', note: 'Directs field teams' },
      { callsign: 'PIO1', fullName: 'Sunny Vermillion', phone: '928-555-0113', image: 'pio.jpg', id: 'PIO-1', team: 'Command', role: 'Public Information Officer', note: 'Coordinates with NPS and press' },

      { callsign: 'Rim1', fullName: 'Wren Cliffside', phone: '928-555-0121', image: 'cert1.jpg', id: 'GC-11', team: 'Rim-West', role: 'Team Lead', note: 'Rim Trail, west toward Trailview Overlook' },
      { callsign: 'Rim2', fullName: 'Talus Windham', phone: '928-555-0122', image: 'cert2.jpg', id: 'GC-12', team: 'Rim-West', role: 'Responder', note: 'Rim Trail, west toward Trailview Overlook' },

      { callsign: 'Rim3', fullName: 'Mesa Longstride', phone: '928-555-0123', image: 'recon1.jpg', id: 'GC-13', team: 'Rim-East', role: 'Team Lead', note: 'Rim Trail, east toward Yavapai Point' },
      { callsign: 'Rim4', fullName: 'Piper Overlook', phone: '928-555-0124', image: 'plan-chief.jpg', id: 'GC-14', team: 'Rim-East', role: 'Responder', note: 'Rim Trail, east toward Yavapai Point' },

      { callsign: 'Below1', fullName: 'Canyon Ash Deepgorge', phone: '928-555-0131', image: 'log-chief.jpg', id: 'GC-21', team: 'Below-Rim', role: 'Team Lead', note: 'Bright Angel Trail, first switchbacks below the rim' },
      { callsign: 'Below2', fullName: 'Juniper Redrock', phone: '928-555-0132', image: 'cert3.jpg', id: 'GC-22', team: 'Below-Rim', role: 'Responder', note: 'Bright Angel Trail, first switchbacks below the rim' },

      { callsign: 'Medic1', fullName: 'Butte Ironwood', phone: '928-555-0133', image: 'mert1.jpg', id: 'GC-23', team: 'Medical', role: 'Team Lead', note: 'Village sweep and heat-response support' },
      { callsign: 'Medic2', fullName: 'Dr. Sage Coyote', phone: '928-555-0134', image: 'medic1.jpg', id: 'GC-24', team: 'Medical', role: 'Medical', note: 'Village sweep and heat-response support' },
    ]

    const OPS = 'Rusty Sagebrush'

    const rows: Row[] = [
      // ── Command staff ──────────────────────────────────────────────────────────
      { callsign: '!CmdPost', minutesAgo: 335, ...CP, statusIndex: 4, notes: 'Command post established, net open on primary.', source: 'Voice', operator: 'Sunny Vermillion' },
      { callsign: 'IC-Actual', minutesAgo: 333, ...CP, statusIndex: 4, notes: 'Assuming command for the exercise.', source: 'Voice', operator: 'Dusty "Mesa" Ridgewalker' },
      { callsign: 'OpsChief', minutesAgo: 330, ...CP, statusIndex: 4, notes: 'Ops section staffed, briefing field teams now.', source: 'Voice', operator: OPS },
      { callsign: 'PIO1', minutesAgo: 324, ...CP, statusIndex: 4, notes: 'Coordinating with the NPS backcountry office, staging media away from the trailhead.', source: 'Voice', operator: 'Sunny Vermillion' },

      // ── Team A: Rim1/Rim2 - Rim Trail west toward Trailview Overlook ──────────
      { callsign: 'Rim1', minutesAgo: 300, ...TRAILHEAD, statusIndex: 4, notes: 'Team checking in near the last known point, starting west along the Rim Trail.', source: 'Voice', operator: OPS },
      { callsign: 'Rim2', minutesAgo: 296, lat: 36.0571, lng: -112.1449, address: 'Rim Trail near Lookout Studio', statusIndex: 4, notes: 'Checked in at Lookout Studio, continuing west.', source: 'Voice', operator: OPS },
      { callsign: 'Rim1', minutesAgo: 250, lat: 36.0577, lng: -112.1493, address: 'Rim Trail at Trailview Overlook (~1km west)', statusIndex: 1, notes: 'Location report: Trailview Overlook, no sign of the hiker, temperature climbing fast.', source: 'Voice', operator: OPS },
      { callsign: 'Rim2', minutesAgo: 210, lat: 36.0577, lng: -112.1493, address: 'Rim Trail at Trailview Overlook', statusIndex: 0, notes: 'Rim Trail clear so far, heavy visitor traffic, checking side viewpoints.', source: 'Voice', operator: OPS },
      { callsign: 'Rim1', minutesAgo: 140, lat: 36.0573, lng: -112.1470, address: 'Rim Trail, west segment', statusIndex: 5, notes: 'West rim segment complete, checking out.', source: 'Voice', operator: OPS },
      { callsign: 'Rim2', minutesAgo: 96, lat: 36.0573, lng: -112.1470, address: 'Rim Trail, west segment', statusIndex: 3, notes: 'Requesting a water resupply and a shaded rest break, it is very hot out here.', source: 'Voice', operator: OPS },

      // ── Team B: Rim3/Rim4 - Rim Trail east toward Yavapai Point ───────────────
      { callsign: 'Rim3', minutesAgo: 292, ...TRAILHEAD, statusIndex: 0, notes: 'Checking in at the trailhead, heading east along the Rim Trail toward the village center.', source: 'Voice', operator: OPS },
      { callsign: 'Rim4', minutesAgo: 270, lat: 36.0590, lng: -112.1370, address: 'Rim Trail near Verkamp\'s Visitor Center', statusIndex: 0, notes: 'Passing Verkamp\'s, Rim Trail crowded but clear.', source: 'Voice', operator: OPS },
      {
        callsign: 'Rim3', minutesAgo: 180, lat: 36.0616, lng: -112.1177, address: 'Rim Trail near Yavapai Point (~2.3km east)', statusIndex: 6,
        notes: 'URGENT: a bystander reports seeing a hiker matching the description near Yavapai Point about twenty minutes ago, heading east.', source: 'Phone', operator: OPS,
        generates213: true, replyRequested213: true, subject213: 'Possible sighting near Yavapai Point',
        message213: 'A bystander at Yavapai Point reports seeing someone matching the missing hiker\'s description heading east along the Rim Trail roughly twenty minutes before this report. Continuing east to follow up; requesting any other teams in the area converge.',
        recipients213: ['Incident Commander', 'Ops'],
      },
      { callsign: 'Rim3', minutesAgo: 172, lat: 36.0616, lng: -112.1177, address: 'Rim Trail near Yavapai Point', statusIndex: 0, notes: 'Continuing east past Yavapai Point, following up on the reported sighting.', source: 'Voice', operator: OPS },
      { callsign: 'Rim4', minutesAgo: 150, lat: 36.0605, lng: -112.1280, address: 'Rim Trail near the Yavapai Geology Museum', statusIndex: 5, notes: 'No further sign of the hiker past the geology museum, turning back. Checking out.', source: 'Voice', operator: OPS },

      // ── Team C: Below1/Below2 - Bright Angel Trail, first switchbacks below rim ──
      { callsign: 'Below2', minutesAgo: 288, ...TRAILHEAD, statusIndex: 4, notes: 'Team checking in at the trailhead, starting down Bright Angel Trail.', source: 'Voice', operator: OPS },
      { callsign: 'Below1', minutesAgo: 260, lat: 36.0572, lng: -112.1428, address: 'Bright Angel Trail, first switchback below the rim', statusIndex: 1, notes: 'Location report: first switchback below the rim, noticeably warmer already.', source: 'Voice', operator: OPS },
      { callsign: 'Below2', minutesAgo: 244, lat: 36.0565, lng: -112.1424, address: 'Bright Angel Trail, near the tunnel (~200m below rim)', statusIndex: 2, notes: 'Water cache marker found wedged in the rocks below the tunnel, photographed for assessment.', source: 'Voice', operator: OPS },
      {
        callsign: 'Below2', minutesAgo: 160, lat: 36.0565, lng: -112.1424, address: 'Bright Angel Trail, near the tunnel', statusIndex: 6,
        notes: 'URGENT: one hiker showing signs of heat exhaustion just below the tunnel, conscious but unsteady.', source: 'Voice', operator: OPS,
        generates213: true, replyRequested213: true, subject213: 'Possible heat exhaustion below Bright Angel Trailhead',
        message213: 'One hiker showing signs of heat exhaustion just below the first tunnel on Bright Angel Trail. Conscious and responsive; requesting a ranger medic and extra water carried down as soon as possible.',
        recipients213: ['Incident Commander', 'Ops'],
      },
      { callsign: 'Below1', minutesAgo: 152, lat: 36.0568, lng: -112.1429, address: 'Bright Angel Trail, near the tunnel', statusIndex: 0, notes: 'Shading the hiker and administering water while waiting on the medic team.', source: 'Voice', operator: OPS },
      { callsign: 'Below2', minutesAgo: 60, lat: 36.0568, lng: -112.1429, address: 'Bright Angel Trail, near the tunnel', statusIndex: 5, notes: 'Hiker stabilized and walked back up under their own power. Team checking out.', source: 'Voice', operator: OPS },

      // ── Team D: Medic1/Medic2 - village sweep, responds to the below-rim call ──
      { callsign: 'Medic1', minutesAgo: 280, ...CP, statusIndex: 4, notes: 'Medical team checked in, staged at the backcountry office with water and supplies.', source: 'Voice', operator: OPS },
      { callsign: 'Medic2', minutesAgo: 272, lat: 36.0567, lng: -112.1427, address: 'Grand Canyon Village, near El Tovar', statusIndex: 0, notes: 'Sweeping the village core for the missing hiker, no sign yet.', source: 'Voice', operator: OPS },
      { callsign: 'Medic1', minutesAgo: 155, lat: 36.0568, lng: -112.1429, address: 'Bright Angel Trail, near the tunnel', statusIndex: 4, notes: 'Responding down to the below-rim heat exhaustion call with extra water.', source: 'Voice', operator: OPS },
      { callsign: 'Medic1', minutesAgo: 140, lat: 36.0568, lng: -112.1429, address: 'Bright Angel Trail, near the tunnel', statusIndex: 0, notes: 'On scene, hiker alert and improving, continuing to monitor.', source: 'Voice', operator: OPS },
      { callsign: 'Medic2', minutesAgo: 120, lat: 36.0571, lng: -112.1436, address: 'Grand Canyon Village, near Kolb Studio', statusIndex: 5, notes: 'Village sweep complete, no further leads, returning to the backcountry office.', source: 'Voice', operator: OPS },
      { callsign: 'Medic1', minutesAgo: 90, lat: 36.0568, lng: -112.1429, address: 'Bright Angel Trail, near the tunnel', statusIndex: 5, notes: 'Patient walked out under their own power, medical response complete. Checking out.', source: 'Voice', operator: OPS },

      // ── Wrap-up ────────────────────────────────────────────────────────────────
      { callsign: 'IC-Actual', minutesAgo: 30, ...CP, statusIndex: 0, notes: 'Rim and below-rim segments swept, no outstanding hazards. Standing down field teams.', source: 'Voice', operator: 'Dusty "Mesa" Ridgewalker' },
      { callsign: '!CmdPost', minutesAgo: 12, ...CP, statusIndex: 5, notes: 'Exercise complete, closing net.', source: 'Voice', operator: 'Sunny Vermillion' },
    ]

    const locations: MissionLocationType[] = [
      {
        name: 'Last Known Point - Bright Angel Trailhead', type: 'Last Known Point',
        ...TRAILHEAD, note: 'Missing hiker last seen starting down Bright Angel Trail.',
      },
      {
        name: 'Search Staging Area - Backcountry Info Center', type: 'Staging Area',
        ...CP, note: 'Marshalling point for search teams and the NPS backcountry liaison.',
      },
    ]

    return {
      event: SampleDataService.SAMPLE_EVENT_NAME,
      eventNotes: 'Missing hiker last seen near the Bright Angel Trailhead',
      rangers, rows, locations,
    }
  }

  // ── Scenario 3: State fair (Washington State Fair, Puyallup, WA) ────────────────────

  /**
   * A lost child, heat illness, and a crowd-flow incident across a state fairgrounds.
   * Uses the Washington State Fair in Puyallup, WA specifically - the project itself is
   * WA-based, and there's no reason to invent an out-of-state fair when a real, in-state one
   * fits the same story. Coordinates are approximate (a fairgrounds is not something this
   * file can survey to the meter) but land within the fairgrounds' own footprint - gate,
   * grandstand, midway, livestock barns, first aid - a several-hundred-meter cluster, exactly
   * the walking distances CERT/first-aid teams on foot would actually cover.
   */
  private buildStateFairScenario(): ScenarioData {
    const CP = { lat: 47.1870, lng: -122.2935, address: 'Washington State Fair - Fair Operations trailer, Puyallup, WA (approx.)' }
    const MAIN_GATE = { lat: 47.1876, lng: -122.2937, address: 'Washington State Fair - main gate (approx.)' }
    const GRANDSTAND = { lat: 47.1858, lng: -122.2915, address: 'Washington State Fair - grandstand (approx.)' }
    const MIDWAY = { lat: 47.1866, lng: -122.2952, address: 'Washington State Fair - midway (approx.)' }
    const LIVESTOCK = { lat: 47.1880, lng: -122.2920, address: 'Washington State Fair - livestock barns (approx.)' }
    const FIRST_AID = { lat: 47.1865, lng: -122.2930, address: 'Washington State Fair - first-aid station (approx.)' }

    const rangers: RangerType[] = [
      { callsign: 'IC-Actual', fullName: 'Fern Marigold', phone: '253-555-0100', image: 'ic-actual.jpg', id: 'IC-1', team: 'Command', role: 'Incident Commander', note: 'Overall exercise command' },
      { callsign: '!CmdPost', fullName: 'Exercise Command Post', phone: '253-555-0101', image: 'CmdPost.jpg', id: 'CP-1', team: 'Command', role: 'Command', note: 'Net control for the exercise' },
      { callsign: 'OpsChief', fullName: 'Hank Cobblestone', phone: '253-555-0110', image: 'ops-chief.jpg', id: 'OPS-1', team: 'Command', role: 'Operations Section Chief', note: 'Directs field teams' },
      { callsign: 'PIO1', fullName: 'Dahlia Brightbanner', phone: '253-555-0113', image: 'pio.jpg', id: 'PIO-1', team: 'Command', role: 'Public Information Officer', note: 'Coordinates with fair management and press' },

      { callsign: 'Gate1', fullName: 'Milo Carousel', phone: '253-555-0121', image: 'cert1.jpg', id: 'SF-11', team: 'Gate-CERT', role: 'Team Lead', note: 'Main gate, crowd flow' },
      { callsign: 'Gate2', fullName: 'Nora Bunting', phone: '253-555-0122', image: 'cert2.jpg', id: 'SF-12', team: 'Gate-CERT', role: 'Responder', note: 'Main gate, crowd flow' },

      { callsign: 'Search1', fullName: 'Wes Thistledown', phone: '253-555-0123', image: 'recon1.jpg', id: 'SF-13', team: 'Search-CERT', role: 'Team Lead', note: 'Grounds sweep for the lost child' },
      { callsign: 'Search2', fullName: 'Pearl Hayloft', phone: '253-555-0124', image: 'plan-chief.jpg', id: 'SF-14', team: 'Search-CERT', role: 'Responder', note: 'Grounds sweep for the lost child' },

      { callsign: 'Barn1', fullName: 'Otis Grainfield', phone: '253-555-0131', image: 'log-chief.jpg', id: 'SF-21', team: 'Barn-CERT', role: 'Team Lead', note: 'Livestock barns and perimeter' },
      { callsign: 'Barn2', fullName: 'Ruby Cornsilk', phone: '253-555-0132', image: 'cert3.jpg', id: 'SF-22', team: 'Barn-CERT', role: 'Responder', note: 'Livestock barns and perimeter' },

      { callsign: 'Medic1', fullName: 'Hollis Sawdust', phone: '253-555-0133', image: 'mert1.jpg', id: 'SF-23', team: 'Medical', role: 'Team Lead', note: 'First-aid station and heat-illness response' },
      { callsign: 'Medic2', fullName: 'Dr. Junebug Vance', phone: '253-555-0134', image: 'medic1.jpg', id: 'SF-24', team: 'Medical', role: 'Medical', note: 'First-aid station and heat-illness response' },
    ]

    const OPS = 'Hank Cobblestone'

    const rows: Row[] = [
      // ── Command staff ──────────────────────────────────────────────────────────
      { callsign: '!CmdPost', minutesAgo: 335, ...CP, statusIndex: 4, notes: 'Command post established, net open on primary.', source: 'Voice', operator: 'Dahlia Brightbanner' },
      { callsign: 'IC-Actual', minutesAgo: 333, ...CP, statusIndex: 4, notes: 'Assuming command for the exercise.', source: 'Voice', operator: 'Fern Marigold' },
      { callsign: 'OpsChief', minutesAgo: 330, ...CP, statusIndex: 4, notes: 'Ops section staffed, briefing field teams now.', source: 'Voice', operator: OPS },
      { callsign: 'PIO1', minutesAgo: 324, ...CP, statusIndex: 4, notes: 'Coordinating with fair management, staging media away from the midway.', source: 'Voice', operator: 'Dahlia Brightbanner' },

      // ── Team A: Gate1/Gate2 - main gate crowd flow ────────────────────────────
      { callsign: 'Gate1', minutesAgo: 300, ...MAIN_GATE, statusIndex: 4, notes: 'Team checking in at the main gate, monitoring entry flow.', source: 'Voice', operator: OPS },
      { callsign: 'Gate2', minutesAgo: 270, lat: MAIN_GATE.lat - 0.0003, lng: MAIN_GATE.lng + 0.0004, address: 'Washington State Fair - main gate queue (approx.)', statusIndex: 1, notes: 'Location report: main gate queue backing up onto the sidewalk.', source: 'Voice', operator: OPS },
      {
        callsign: 'Gate1', minutesAgo: 200, ...MAIN_GATE, statusIndex: 6,
        notes: 'URGENT: crowd bottleneck forming at the main gate exit, requesting additional CERT support to redirect flow.', source: 'Phone', operator: OPS,
        generates213: true, replyRequested213: true, subject213: 'Crowd-flow bottleneck, main gate',
        message213: 'A crowd bottleneck has formed at the main gate exit lane, foot traffic backing up onto the street sidewalk. Requesting one additional CERT team and barricades to open a second exit lane.',
        recipients213: ['Incident Commander', 'Ops'],
      },
      { callsign: 'Gate2', minutesAgo: 190, ...MAIN_GATE, statusIndex: 0, notes: 'Additional signage and a second exit lane opened, flow easing.', source: 'Voice', operator: OPS },
      { callsign: 'Gate2', minutesAgo: 110, ...MAIN_GATE, statusIndex: 3, notes: 'Requesting a short break and water after directing traffic all afternoon.', source: 'Voice', operator: OPS },
      { callsign: 'Gate1', minutesAgo: 96, ...MAIN_GATE, statusIndex: 5, notes: 'Gate flow back to normal, checking out.', source: 'Voice', operator: OPS },

      // ── Team B: Search1/Search2 - lost child ──────────────────────────────────
      { callsign: 'Search1', minutesAgo: 292, ...MIDWAY, statusIndex: 4, notes: 'Team checking in near the last known point, beginning search for the missing child.', source: 'Voice', operator: OPS },
      { callsign: 'Search2', minutesAgo: 260, ...LIVESTOCK, statusIndex: 0, notes: 'Checked the livestock barns, no sign of the child, continuing the sweep.', source: 'Voice', operator: OPS },
      { callsign: 'Search1', minutesAgo: 210, ...GRANDSTAND, statusIndex: 0, notes: 'Checking the grandstand seating area, no sign of the child yet.', source: 'Voice', operator: OPS },
      { callsign: 'Search1', minutesAgo: 150, ...MIDWAY, statusIndex: 5, notes: 'Child located safe with fair staff near the midway, reuniting with parent. Search complete, checking out.', source: 'Voice', operator: OPS },

      // ── Team C: Barn1/Barn2 - livestock barns and perimeter ───────────────────
      { callsign: 'Barn2', minutesAgo: 288, ...LIVESTOCK, statusIndex: 4, notes: 'Team checking in at the livestock barns, beginning perimeter sweep.', source: 'Voice', operator: OPS },
      { callsign: 'Barn1', minutesAgo: 250, lat: LIVESTOCK.lat + 0.0006, lng: LIVESTOCK.lng - 0.0006, address: 'Washington State Fair - livestock barns, parking side (approx.)', statusIndex: 0, notes: 'Barn perimeter clear, checking the nearby parking areas.', source: 'Voice', operator: OPS },
      { callsign: 'Barn2', minutesAgo: 180, ...LIVESTOCK, statusIndex: 2, notes: 'Loose animal pen gate found unlatched, secured and photographed for the barn manager.', source: 'Voice', operator: OPS },
      { callsign: 'Barn1', minutesAgo: 96, ...LIVESTOCK, statusIndex: 5, notes: 'Perimeter sweep complete, no further issues. Checking out.', source: 'Voice', operator: OPS },

      // ── Team D: Medic1/Medic2 - first aid and heat illness ────────────────────
      { callsign: 'Medic1', minutesAgo: 280, ...FIRST_AID, statusIndex: 4, notes: 'Medical team checked in, first-aid station staffed.', source: 'Voice', operator: OPS },
      { callsign: 'Medic2', minutesAgo: 220, ...GRANDSTAND, statusIndex: 0, notes: 'Monitoring the grandstand crowd for heat-related complaints, hot and sunny today.', source: 'Voice', operator: OPS },
      {
        callsign: 'Medic2', minutesAgo: 170, ...GRANDSTAND, statusIndex: 6,
        notes: 'URGENT: attendee showing signs of heat illness near the grandstand, requesting additional first-aid support and water.', source: 'Phone', operator: OPS,
        generates213: true, replyRequested213: true, subject213: 'Possible heat illness, grandstand',
        message213: 'One attendee showing signs of heat illness in the grandstand seating area - dizzy, flushed, and short of breath. Requesting the medical team respond with water and cooling supplies.',
        recipients213: ['Incident Commander', 'Logistics'],
      },
      { callsign: 'Medic1', minutesAgo: 160, ...GRANDSTAND, statusIndex: 4, notes: 'Responding to the grandstand with water and cooling supplies.', source: 'Voice', operator: OPS },
      { callsign: 'Medic1', minutesAgo: 140, ...GRANDSTAND, statusIndex: 0, notes: 'Patient cooling down and improving, continuing to monitor.', source: 'Voice', operator: OPS },
      { callsign: 'Medic2', minutesAgo: 100, ...FIRST_AID, statusIndex: 5, notes: 'Patient released to family, feeling much better. First-aid station standing down. Checking out.', source: 'Voice', operator: OPS },

      // ── Wrap-up ────────────────────────────────────────────────────────────────
      { callsign: 'IC-Actual', minutesAgo: 30, ...CP, statusIndex: 0, notes: 'Child recovered and crowd flow restored at the main gate. Standing down field teams.', source: 'Voice', operator: 'Fern Marigold' },
      { callsign: '!CmdPost', minutesAgo: 12, ...CP, statusIndex: 5, notes: 'Exercise complete, closing net.', source: 'Voice', operator: 'Dahlia Brightbanner' },
    ]

    const locations: MissionLocationType[] = [
      {
        name: 'Last Known Point - Midway', type: 'Last Known Point',
        ...MIDWAY, note: 'Child last seen by a parent near the midway games.',
      },
      {
        name: 'Fair Command Staging Area', type: 'Staging Area',
        ...CP, note: 'Marshalling point for CERT and first-aid teams.',
      },
    ]

    return {
      event: SampleDataService.SAMPLE_EVENT_NAME,
      eventNotes: 'Lost child reported near the midway; heat illness and crowd-flow support ongoing',
      rangers, rows, locations,
    }
  }

  // ── Scenario 4: Near me ───────────────────────────────────────────────────────────────

  /**
   * Generated around `center` - the device's own GPS position when available
   * (resolveDeviceLocation()), or the mission's configured default location otherwise.
   * Nothing here can know what's actually at that point, so every waypoint is a fixed,
   * generic offset ("north trail segment," 100-800m out) rather than a named real place, and
   * every address string says so is left generic on purpose. No geocoding call of any kind -
   * this scenario, like the other three, must work fully offline.
   */
  private buildNearMeScenario(center: Center): ScenarioData {
    const CP = { lat: center.lat, lng: center.lng, address: 'Command post (device start location)' }

    const rangers: RangerType[] = [
      { callsign: 'IC-Actual', fullName: 'Dune Basecamp', phone: '555-0100', image: 'ic-actual.jpg', id: 'IC-1', team: 'Command', role: 'Incident Commander', note: 'Overall exercise command' },
      { callsign: '!CmdPost', fullName: 'Exercise Command Post', phone: '555-0101', image: 'CmdPost.jpg', id: 'CP-1', team: 'Command', role: 'Command', note: 'Net control for the exercise' },
      { callsign: 'OpsChief', fullName: 'Cole Fieldstone', phone: '555-0110', image: 'ops-chief.jpg', id: 'OPS-1', team: 'Command', role: 'Operations Section Chief', note: 'Directs field teams' },
      { callsign: 'PIO1', fullName: 'Ivy Waypoint', phone: '555-0113', image: 'pio.jpg', id: 'PIO-1', team: 'Command', role: 'Public Information Officer', note: 'Fields press and family inquiries' },

      { callsign: 'North1', fullName: 'Finn Northgate', phone: '555-0121', image: 'cert1.jpg', id: 'NM-11', team: 'North', role: 'Team Lead', note: 'North trail segment' },
      { callsign: 'North2', fullName: 'Ash Ridgeline', phone: '555-0122', image: 'cert2.jpg', id: 'NM-12', team: 'North', role: 'Responder', note: 'North trail segment' },

      { callsign: 'East1', fullName: 'Dale Eastbrook', phone: '555-0123', image: 'recon1.jpg', id: 'NM-13', team: 'East', role: 'Team Lead', note: 'East trail segment' },
      { callsign: 'East2', fullName: 'Mika Farview', phone: '555-0124', image: 'plan-chief.jpg', id: 'NM-14', team: 'East', role: 'Responder', note: 'East trail segment' },

      { callsign: 'South1', fullName: 'Bea Southgate', phone: '555-0131', image: 'log-chief.jpg', id: 'NM-21', team: 'South', role: 'Team Lead', note: 'South trail segment' },
      { callsign: 'South2', fullName: 'Otto Ravine', phone: '555-0132', image: 'cert3.jpg', id: 'NM-22', team: 'South', role: 'Responder', note: 'South trail segment' },

      { callsign: 'West1', fullName: 'Robin Westfield', phone: '555-0133', image: 'mert1.jpg', id: 'NM-23', team: 'West', role: 'Team Lead', note: 'West trail segment' },
      { callsign: 'West2', fullName: 'Dr. Sable Westgate', phone: '555-0134', image: 'medic1.jpg', id: 'NM-24', team: 'West', role: 'Medical', note: 'West trail segment' },
    ]

    const OPS = 'Cole Fieldstone'
    const GENERIC = ' (approximate offset from the start location - may land on water or a building)'

    const rows: Row[] = [
      // ── Command staff, fixed at the start location ────────────────────────────
      { callsign: '!CmdPost', minutesAgo: 335, ...CP, statusIndex: 4, notes: 'Command post established, net open on primary.', source: 'Voice', operator: 'Ivy Waypoint' },
      { callsign: 'IC-Actual', minutesAgo: 333, ...CP, statusIndex: 4, notes: 'Assuming command for the exercise.', source: 'Voice', operator: 'Dune Basecamp' },
      { callsign: 'OpsChief', minutesAgo: 330, ...CP, statusIndex: 4, notes: 'Ops section staffed, briefing field teams now.', source: 'Voice', operator: OPS },
      { callsign: 'PIO1', minutesAgo: 324, ...CP, statusIndex: 4, notes: 'Media staging area set up nearby.', source: 'Voice', operator: 'Ivy Waypoint' },

      // ── Team North: North1/North2 ──────────────────────────────────────────────
      { callsign: 'North1', minutesAgo: 300, ...this.offset(center, 100, 20), address: 'North trail segment, start' + GENERIC, statusIndex: 4, notes: 'Team checking in, starting the north trail segment on foot.', source: 'Voice', operator: OPS },
      { callsign: 'North2', minutesAgo: 250, ...this.offset(center, 300, 40), address: 'North trail segment, midpoint' + GENERIC, statusIndex: 1, notes: 'Location report: north trail segment, about a quarter mile out.', source: 'Voice', operator: OPS },
      { callsign: 'North1', minutesAgo: 180, ...this.offset(center, 500, 10), address: 'North trail segment, turnaround' + GENERIC, statusIndex: 0, notes: 'North trail segment clear so far, continuing toward the turnaround point.', source: 'Voice', operator: OPS },
      { callsign: 'North2', minutesAgo: 120, ...this.offset(center, 500, 10), address: 'North trail segment, turnaround' + GENERIC, statusIndex: 3, notes: 'Requesting a short rest and water before heading back.', source: 'Voice', operator: OPS },
      { callsign: 'North1', minutesAgo: 70, ...this.offset(center, 150, 20), address: 'North trail segment, near start' + GENERIC, statusIndex: 5, notes: 'North trail segment swept, no findings. Checking out.', source: 'Voice', operator: OPS },

      // ── Team East: East1/East2 ─────────────────────────────────────────────────
      { callsign: 'East1', minutesAgo: 292, ...this.offset(center, 20, 150), address: 'East trail segment, start' + GENERIC, statusIndex: 4, notes: 'Team checking in, starting the east trail segment.', source: 'Voice', operator: OPS },
      { callsign: 'East2', minutesAgo: 240, ...this.offset(center, 30, 400), address: 'East trail segment, midpoint' + GENERIC, statusIndex: 0, notes: 'East segment clear so far, sparse brush, easy going.', source: 'Voice', operator: OPS },
      {
        callsign: 'East1', minutesAgo: 180, ...this.offset(center, 20, 650), address: 'East trail segment, far end' + GENERIC, statusIndex: 6,
        notes: 'URGENT: one team member has turned an ankle on uneven ground, unable to continue on foot.', source: 'Phone', operator: OPS,
        generates213: true, replyRequested213: true, subject213: 'Injured team member, east trail segment',
        message213: 'One team member has turned an ankle on uneven ground roughly 650 meters east of the start location and cannot walk out unassisted. Not life-threatening; requesting instructions on evacuation support.',
        recipients213: ['Incident Commander', 'Ops'],
      },
      { callsign: 'East2', minutesAgo: 170, ...this.offset(center, 20, 650), address: 'East trail segment, far end' + GENERIC, statusIndex: 0, notes: 'Staying with the injured teammate, splinting the ankle and awaiting instructions.', source: 'Voice', operator: OPS },
      { callsign: 'East1', minutesAgo: 96, ...this.offset(center, 20, 650), address: 'East trail segment, far end' + GENERIC, statusIndex: 5, notes: 'Assisted teammate walked back out slowly under their own power. East segment checking out.', source: 'Voice', operator: OPS },

      // ── Team South: South1/South2 ─────────────────────────────────────────────
      { callsign: 'South1', minutesAgo: 288, ...this.offset(center, -150, -10), address: 'South trail segment, start' + GENERIC, statusIndex: 4, notes: 'Team checking in, starting the south trail segment.', source: 'Voice', operator: OPS },
      { callsign: 'South2', minutesAgo: 230, ...this.offset(center, -400, -20), address: 'South trail segment, midpoint' + GENERIC, statusIndex: 1, notes: 'Location report: south trail segment, about a quarter mile out.', source: 'Voice', operator: OPS },
      { callsign: 'South1', minutesAgo: 170, ...this.offset(center, -600, -30), address: 'South trail segment, far end' + GENERIC, statusIndex: 2, notes: 'A hazard was spotted on the south segment, photographed for assessment.', source: 'Voice', operator: OPS },
      { callsign: 'South2', minutesAgo: 96, ...this.offset(center, -300, -15), address: 'South trail segment, midpoint' + GENERIC, statusIndex: 5, notes: 'South trail segment swept, hazard noted for follow-up. Checking out.', source: 'Voice', operator: OPS },

      // ── Team West: West1/West2 ─────────────────────────────────────────────────
      { callsign: 'West1', minutesAgo: 284, ...this.offset(center, 10, -150), address: 'West trail segment, start' + GENERIC, statusIndex: 4, notes: 'Team checking in, starting the west trail segment.', source: 'Voice', operator: OPS },
      { callsign: 'West2', minutesAgo: 220, ...this.offset(center, 20, -400), address: 'West trail segment, midpoint' + GENERIC, statusIndex: 0, notes: 'West segment clear so far, checking in periodically.', source: 'Voice', operator: OPS },
      {
        callsign: 'West1', minutesAgo: 160, ...this.offset(center, 20, -700), address: 'West trail segment, far end' + GENERIC, statusIndex: 6,
        notes: 'URGENT: the estimated position ahead looks like it lands on a private structure or fenceline, not open trail. Holding position.', source: 'Voice', operator: OPS,
        generates213: true, replyRequested213: true, subject213: 'Unexpected structure on west trail segment',
        message213: 'The west trail segment\'s estimated position (about 700 meters from the start location) appears to be near a private structure or fenceline rather than open trail. Team has paused and is not entering private property; requesting guidance on whether to reroute.',
        recipients213: ['Incident Commander', 'Ops'],
      },
      { callsign: 'West2', minutesAgo: 150, ...this.offset(center, 20, -700), address: 'West trail segment, far end' + GENERIC, statusIndex: 0, notes: 'Holding position with West1, not entering the structure area, awaiting instructions.', source: 'Voice', operator: OPS },
      { callsign: 'West1', minutesAgo: 96, ...this.offset(center, 10, -300), address: 'West trail segment, midpoint' + GENERIC, statusIndex: 3, notes: 'Falling back to rest and wait for guidance before continuing.', source: 'Voice', operator: OPS },
      { callsign: 'West2', minutesAgo: 70, ...this.offset(center, 15, -350), address: 'West trail segment, midpoint' + GENERIC, statusIndex: 5, notes: 'West segment holding complete, no further movement authorized this shift. Checking out.', source: 'Voice', operator: OPS },

      // ── Wrap-up ────────────────────────────────────────────────────────────────
      { callsign: 'IC-Actual', minutesAgo: 30, ...CP, statusIndex: 0, notes: 'All segments swept, no outstanding hazards. Standing down field teams.', source: 'Voice', operator: 'Dune Basecamp' },
      { callsign: '!CmdPost', minutesAgo: 12, ...CP, statusIndex: 5, notes: 'Exercise complete, closing net.', source: 'Voice', operator: 'Ivy Waypoint' },
    ]

    const locations: MissionLocationType[] = [
      {
        name: 'Last Known Point (near start)', type: 'Last Known Point',
        ...this.offset(center, 50, 50), address: 'Approx. 70m from the start location' + GENERIC,
        note: 'Generic placeholder objective - reposition once real terrain is known.',
      },
      {
        name: 'Staging Area (near start)', type: 'Staging Area',
        ...this.offset(center, -30, 60), address: 'Approx. 65m from the start location' + GENERIC,
        note: 'Generic placeholder objective - reposition once real terrain is known.',
      },
    ]

    return {
      event: SampleDataService.SAMPLE_EVENT_NAME,
      eventNotes: 'Investigate report of a lost individual near this location',
      rangers, rows, locations,
    }
  }
}
