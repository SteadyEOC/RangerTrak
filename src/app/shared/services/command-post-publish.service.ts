import { Subscription } from 'rxjs'

import { formatMsgNoFull, formatMsgNoShort } from '../../domain/msg-no'
import { Injectable, OnDestroy, inject, signal } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'

import {
  attachmentFields, BoardAction, BoardAttachment, BoardIcs213, ics213Fields, BoardEvent, BoardHolder, BoardState, boardStep, describeAgent,
  readClaimReply, readKeyedReply, replacedMessage, trimThumbs,
} from '../../domain/board-client'
import { normaliseBoardAddress } from '../../domain/board-address'
import { BoardRetry } from '../../domain/board-retry'
import { boardCause } from '../../domain/board-causes'
import { QUICK_FAIL_MS, diagnoseBoard } from '../../domain/board-diagnosis'
import type { BoardDiagnosis, HelloResult, LocalNetworkPermission } from '../../domain/board-diagnosis'
import { liveRefs } from '../../domain/attachments'
import { AttachmentStoreService } from './attachment-store.service'
import { DevicePrefsService } from './device-prefs.service'
import { LogService } from './log.service'
import { MissionJournalService } from './mission-journal.service'
import { MissionService } from './mission.service'
import { OperatorNameService } from './operator-name.service'
import { RadioLogService } from './radio-log.service'
import { MissionType } from './mission.interface'
import { RadioLogType } from './radio-log-entry.interface'

/**
 * E-87 Stage 1 (2026-08-31) - the PWA-side half of "Command Post Server: serving the mission
 * to nearby devices" (`E-87 Command Post Server.md` in the private docs). Opt-in: when a
 * mission turns on `commandPostEnabled` and names a `commandPostServerUrl`, this POSTs a
 * redacted snapshot of the radio log there every time it changes, so `tools/command-post-
 * server.js`'s `/view` page has something current to show teams reading over the CP's WiFi.
 *
 * Design constraints straight from the scoping doc's §2.2/§2.3:
 * - **The PWA is authoritative and pushes; the server is a dumb read-only mirror.** No sync,
 *   no conflict resolution, no identity - one writer, many readers, matching the read-only
 *   need the 2026-08-15 exercise actually validated.
 * - **Degrades safely.** The command post server is a separate OS process on a separate
 *   origin that may not be running at all - a failed POST is caught and logged at `warn`,
 *   never `error` (a CP server not running is the NORMAL state for most missions, not a
 *   bug - same "don't log a false alarm for an expected state" lesson this app's own
 *   2026-08-31 log-noise audit already applied elsewhere, e.g. entry.component.ts's
 *   callsignCtrlChanged fix). The standalone PWA is byte-for-byte unaffected either way.
 * - **The roster never goes over the wire.** §4 point 1's own recommendation, followed
 *   directly here rather than left as an open question: `buildPayload()` sends reports and
 *   mission info only - never `RangerService.rangers`. A report's own `callsign` (already
 *   denormalized onto every `RadioLogEntryType` - "the primary evidence of who reported",
 *   see that field's own comment) is what identifies who's on the map; full names, phone
 *   numbers and photos stay on the scribe's device, never published onto what may be an open
 *   hotspot with unknown devices in range (ADR D-35).
 *
 * ADR D-61 (2026-10-16) replaced the Stage 1 "no join code" stance. The first publish CLAIMS the
 * Board (with the password, if the mission has one) and the server issues this device a hidden
 * publish key, sent as X-Board-Key on every publish. A takeover by another device cuts the key off
 * (403), and this device then STOPS and says so (`replaced`); only a person pressing Take over
 * claims it back. A server restart (409) is answered by a re-claim marked `reclaim`, which can
 * only ever claim an EMPTY Board. The state machine and the reading of replies are in
 * `domain/board-client.ts`; this class is the fetches, the timer and the signals. Neither the
 * password nor the key is ever logged: state changes only.
 */

/** What actually gets published - deliberately NOT `MissionExport` (see this file's own
 *  header comment on why the roster is excluded, and `E-87 Command Post Server.md` §4.1 on
 *  why this needs to be its own shape rather than a flag on the existing export). */
export type CommandPostReport = {
  id: number
  // E-220 / D-68: the message number, short ('A007') and full ('26-0142 / OP 2 / A007'). Blank for an entry with none.
  msgNo?: string
  msgNoFull?: string
  callsign: string
  // E-165: tactical call and the To station, as recorded on the entry. Names and FCC call signs
  // only - the roster links (rangerUid/toRangerUid) stay on the device, like the roster itself.
  tacticalCall: string
  toTactical: string
  toCallsign: string
  date: string
  status: string
  source: string
  notes: string
  location: { lat: number; lng: number; address: string } | null
  // D-60 item 6: one or the other, never both, and neither when the entry has no live attachment.
  // Off sends a count; on sends the references, with a thumbnail where there is one.
  attachmentCount?: number
  attachments?: BoardAttachment[]
  // E-228 phase 1: only on an entry that generates an ICS-213; the Board lists these on its own tab.
  ics213?: BoardIcs213
}

export type CommandPostMission = {
  publishedAt: string
  mission: string
  event: string
  opPeriod: string
  opPeriodStart: string
  opPeriodEnd: string
  reports: CommandPostReport[]
}

const POLL_MS = 5000
/** E-216: how long Test connection waits for the Board's /api/hello before calling it a timeout. */
const HELLO_TIMEOUT_MS = 8000

@Injectable({ providedIn: 'root' })
export class CommandPostPublishService implements OnDestroy {

  private id = 'Command Post Publish Service'
  private settings: MissionType | undefined

  private missionSubscription!: Subscription
  private radioLogSubscription!: Subscription

  private stateSignal = signal<BoardState>('off')
  /** For the Mission card. */
  readonly state = this.stateSignal.asReadonly()
  private holderSignal = signal<BoardHolder | undefined>(undefined)
  /** Who holds the Board now, when `state` is `replaced` and the server said. */
  readonly holder = this.holderSignal.asReadonly()
  private messageSignal = signal('')
  /** Why the last claim failed, in words for the operator. Empty when there is nothing to say. */
  readonly message = this.messageSignal.asReadonly()

  private unreachableSignal = signal<'quick' | 'slow' | undefined>(undefined)
  /** E-216: set while the last request to the Board failed at the network. `quick` points at the certificate. */
  readonly unreachable = this.unreachableSignal.asReadonly()
  private diagnosisSignal = signal<BoardDiagnosis | undefined>(undefined)
  /** E-216: the latest answer to "why can't I reach the Board?" (Test connection, or the automatic check after a failure). */
  readonly diagnosis = this.diagnosisSignal.asReadonly()
  private testingSignal = signal(false)
  /** True while Test connection is waiting for the Board. */
  readonly testing = this.testingSignal.asReadonly()
  private retry = new BoardRetry(() => this.retryNow())
  private listening = false

  /** The server and settings this run of publishing started from, to notice a change. */
  private active?: { base: string, password: string, show: boolean }
  private firstSettings = true
  private takingOver = false
  private key = ''
  private pollTimer?: ReturnType<typeof setInterval>
  private publishing = false
  private publishAgain = false
  /** fingerprint -> data URL of the stored thumbnail, read once. */
  private thumbCache = new Map<string, string>()
  /** Originals being uploaded or waiting to be: a fingerprint is never queued twice. */
  private uploadQueue: string[] = []
  private uploading = false
  private journal = inject(MissionJournalService)

  constructor(
    private missionService: MissionService,
    private radioLogService: RadioLogService,
    private log: LogService,
    private prefs: DevicePrefsService,
    private operator: OperatorNameService,
    private snackBar: MatSnackBar,
    private attachmentStore: AttachmentStoreService,
  ) {
    // Cached, not read fresh per publish: the radio-log subscription (below) is what
    // actually drives each publish attempt, and it needs to know the CURRENT settings at
    // that moment without waiting on a second async source.
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => { this.settings = newMission; this.onSettings(newMission) },
      error: (e) => this.log.error(`Mission subscription error: ${e}`, this.id),
    })

    this.radioLogSubscription = this.radioLogService.getRadioLogObserver().subscribe({
      next: (radioLog) => this.onRadioLog(radioLog),
      error: (e) => this.log.error(`Radio log subscription error: ${e}`, this.id),
    })

  }

  /** The window got focus or the page came back to the front: poll at once, and retry a failure now. */
  private onWake = (): void => {
    if (document.hidden) return
    const state = this.stateSignal()
    if (state === 'publishing') {
      if (this.unreachableSignal()) this.retry.now()
      else void this.poll()
    } else if (state === 'error' && this.unreachableSignal()) {
      this.retry.now()
    }
  }

  private listen(on: boolean): void {
    if (on === this.listening) return
    this.listening = on
    const act = on ? 'addEventListener' : 'removeEventListener'
    window[act]('focus', this.onWake)
    document[act]('visibilitychange', this.onWake)
  }

  /** The retry timer fired: try again, in the same ways a log change would. Never a takeover. */
  private retryNow(): void {
    const base = this.active?.base
    if (!base) return
    const state = this.stateSignal()
    if (state === 'publishing') void this.publish()
    else if (state === 'error') this.start(base, false) // a plain claim, never a takeover
  }

  ngOnDestroy(): void {
    this.retry.stop()
    this.listen(false)
    this.stopPolling()
    this.missionSubscription?.unsubscribe()
    this.radioLogSubscription?.unsubscribe()
  }

  /** The Mission card's Take over button: a claim without `reclaim`, with the password. */
  takeOver(): void {
    this.takingOver = true
    this.messageSignal.set('')
    this.dispatch({ type: 'takeOver' })
  }

  // ---- settings ----

  private baseOf(settings: MissionType | undefined): string {
    if (!settings?.commandPostEnabled) return ''
    return normaliseBoardAddress(settings.commandPostServerUrl).url ?? '' // an http:// address never publishes
  }

  private onSettings(settings: MissionType): void {
    const base = this.baseOf(settings)
    const password = settings.boardPassword ?? ''
    const was = this.active
    if (!base) {
      if (this.stateSignal() !== 'off') this.dispatch({ type: 'stop' })
      this.active = undefined
      this.retry.stop()
      this.unreachableSignal.set(undefined)
      this.listen(false)
      return
    }
    const show = !!settings.boardShowAttachments
    this.active = { base, password, show }
    this.listen(true)
    // The app's first look at the settings is a start-up, which keeps a `replaced` it remembers.
    // Any later switch-on is a person choosing to publish, which is a normal claim.
    const startUp = this.firstSettings
    this.firstSettings = false

    if (this.stateSignal() === 'off' || (was && was.base !== base)) {
      // Switched on, or pointed at another server: a fresh start there.
      if (this.stateSignal() !== 'off') this.dispatch({ type: 'stop' })
      this.start(base, startUp)
    } else if (this.stateSignal() === 'error' && was && (was.password !== password)) {
      this.start(base, false) // the password was the problem, and it changed
    } else if (this.stateSignal() === 'publishing' && was && was.password !== password) {
      void this.sendPassword(password)
    }
    // A change to the attachments switch rides the next publish; send one now.
    if (this.stateSignal() === 'publishing' && was && was.show !== show) void this.publish()
  }

  private start(base: string, startUp: boolean): void {
    const pref = this.prefs.getBoardPublisher()
    const hasKey = !!pref.key && pref.base === base
    this.key = hasKey ? pref.key! : ''
    this.messageSignal.set('')
    this.dispatch({ type: 'start', hasKey, wasReplaced: startUp && !!pref.replaced && !hasKey })
  }

  // ---- the state machine, with the fetches ----

  private dispatch(event: BoardEvent): void {
    const before = this.stateSignal()
    const step = boardStep(before, event)
    if (step.state === before && !step.next) return
    this.stateSignal.set(step.state)
    if (step.state !== before) this.onStateChanged(before, step.state)
    if (step.next) void this.perform(step.next)
  }

  private onStateChanged(before: BoardState, now: BoardState): void {
    // E-222: turning publishing on or off sends (or stops sending) mission data; other steps are only the handshake.
    if (now === 'publishing' || now === 'off') this.journal.record('board-publishing-changed', `Board publishing: ${before} -> ${now}.`)
    else this.log.info(`Board publishing: ${before} -> ${now}.`, this.id)
    if (now === 'publishing') this.startPolling()
    else this.stopPolling()
    if (now === 'off' || now === 'replaced') { this.retry.stop(); this.unreachableSignal.set(undefined); this.diagnosisSignal.set(undefined) }
    if (now === 'replaced') {
      // Stop for good until a person says otherwise: forget the key, and remember that we were replaced.
      this.key = ''
      this.prefs.setBoardPublisher({ replaced: true })
      if (before !== 'off') {
        this.snackBar.open(replacedMessage(this.holderSignal()), 'OK', { duration: 15000, verticalPosition: 'top' })
      }
    } else {
      this.holderSignal.set(undefined)
    }
    if (now === 'off') this.messageSignal.set('')
  }

  private async perform(action: BoardAction): Promise<void> {
    if (action === 'publish') { await this.publish(); return }
    if (action === 'check') { await this.check(); return }
    await this.claim(action === 'reclaim')
  }

  private async claim(reclaim: boolean): Promise<void> {
    const settings = this.settings
    const base = this.baseOf(settings)
    if (!settings || !base) return
    try {
      const reply = await this.call(base, 'POST', '/api/claim', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: settings.boardPassword ?? '',
          by: this.by(settings),
          ...(reclaim ? { reclaim: true } : {}),
        }),
      })
      if (this.stateSignal() !== 'claiming') return // switched off, or moved on, while this was in flight
      const read = readClaimReply(reply.status, reply.body)
      if (read.kind === 'ok') {
        this.key = read.key
        this.prefs.setBoardPublisher({ base, key: read.key })
        this.takingOver = false
        this.dispatch({ type: 'claimed' })
      } else if (read.kind === 'heldByOther') {
        this.holderSignal.set(read.holder)
        this.dispatch({ type: 'heldByOther' })
      } else {
        this.messageSignal.set(read.message)
        this.log.warn(`Board claim refused (HTTP ${reply.status}).`, this.id)
        this.refuse()
      }
    } catch (e) {
      this.claimFailed(base, e)
    }
  }

  /** At start with a stored key: does it still work? Also what a poll does, but before publishing. */
  private async check(): Promise<void> {
    const base = this.baseOf(this.settings)
    if (!base) return
    try {
      const reply = await this.call(base, 'GET', '/api/requests', { key: this.key })
      if (this.stateSignal() !== 'claiming') return
      const read = readKeyedReply(reply.status, reply.body)
      if (read.kind === 'ok') this.dispatch({ type: 'keyGood' })
      else if (read.kind === 'unclaimed') this.dispatch({ type: 'keyUnknown' })
      else if (read.kind === 'replaced') { this.holderSignal.set(read.holder); this.dispatch({ type: 'replaced' }) }
      else { this.messageSignal.set(`The Board answered with an error (HTTP ${read.status}).`); this.refuse() }
    } catch (e) {
      this.claimFailed(base, e)
    }
  }

  private claimFailed(base: string, e: unknown): void {
    // Expected, not an error: the Board is a separate process a mission may not have running yet.
    this.log.warn(`The Board was not reachable; is the server running at ${base}? (${e})`, this.id)
    this.refuse()
  }

  private refuse(): void {
    const takeOver = this.takingOver
    this.takingOver = false
    this.dispatch({ type: 'refused', takeOver })
  }

  /** Answers a 409 or 403 to a keyed call. `usedKey` is the key the call carried: a stale reply is ignored. */
  private onKeyedRefusal(read: ReturnType<typeof readKeyedReply>, usedKey: string): void {
    if (usedKey !== this.key) return // sent before the key changed (a re-claim): the answer is old news
    if (read.kind === 'unclaimed') this.dispatch({ type: 'unclaimed' })
    else if (read.kind === 'replaced') { this.holderSignal.set(read.holder); this.dispatch({ type: 'replaced' }) }
  }

  // ---- publishing ----

  private onRadioLog(_radioLog: RadioLogType): void {
    const state = this.stateSignal()
    if (state === 'publishing') void this.publish()
    else if (state === 'error' && this.active && !document.hidden) this.start(this.active.base, false) // try the claim again
  }

  /** One full snapshot. Calls that arrive while one is in flight are folded into a single follow-up. */
  private async publish(): Promise<void> {
    if (this.stateSignal() !== 'publishing') return
    if (this.publishing) { this.publishAgain = true; return }
    const settings = this.settings
    const base = this.baseOf(settings)
    if (!settings || !base) return
    this.publishing = true
    const usedKey = this.key
    try {
      const payload = await this.buildPayload(settings, this.radioLogService.getCurrentRadioLog())
      const reply = await this.call(base, 'POST', '/api/mission', {
        headers: { 'Content-Type': 'application/json' }, key: usedKey, body: JSON.stringify(payload),
      })
      const read = readKeyedReply(reply.status, reply.body)
      if (read.kind === 'ok') return
      if (read.kind === 'other') this.log.warn(`Command Post publish rejected (HTTP ${read.status}).`, this.id)
      else this.onKeyedRefusal(read, usedKey)
    } catch (e) {
      // Expected/normal, not an error: the CP server is a separate process a mission may
      // simply not have running yet (or ever). See this file's own header comment.
      this.log.warn(`Publishing to the Command Post failed; is the server running at ${base}? (${e})`, this.id)
    } finally {
      this.publishing = false
      if (this.publishAgain) { this.publishAgain = false; void this.publish() }
    }
  }

  private async sendPassword(password: string): Promise<void> {
    const base = this.baseOf(this.settings)
    const usedKey = this.key
    if (!base) return
    try {
      const reply = await this.call(base, 'POST', '/api/password', {
        headers: { 'Content-Type': 'application/json' }, key: usedKey, body: JSON.stringify({ password }),
      })
      const read = readKeyedReply(reply.status, reply.body)
      if (read.kind === 'ok') this.journal.record('board-password-changed', 'Changed the Board password.')
      else if (read.kind !== 'other') this.onKeyedRefusal(read, usedKey)
    } catch (e) {
      this.log.warn(`Board password not sent (${e})`, this.id)
    }
  }

  // ---- polling: restart detector and request queue ----

  private startPolling(): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => { if (!document.hidden) void this.poll() }, POLL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  private async poll(): Promise<void> {
    const base = this.baseOf(this.settings)
    const usedKey = this.key
    if (!base || this.stateSignal() !== 'publishing') return
    try {
      const reply = await this.call(base, 'GET', '/api/requests', { key: usedKey })
      const read = readKeyedReply(reply.status, reply.body)
      if (read.kind === 'ok') {
        const asked = (reply.body as { requests?: unknown } | null)?.requests
        if (Array.isArray(asked)) this.queueUploads(asked, usedKey)
        return
      }
      if (read.kind !== 'other') this.onKeyedRefusal(read, usedKey)
    } catch {
      // Same as a failed publish: the server may simply be down for a moment. Nothing to say.
    }
  }

  // ---- attachments: the originals a viewer asked for (D-60 item 6) ----

  private queueUploads(asked: unknown[], usedKey: string): void {
    if (!this.settings?.boardShowAttachments) return // the server holds no fingerprint to ask for; ignore anything else
    for (const sha of asked) {
      if (typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha) && !this.uploadQueue.includes(sha)) this.uploadQueue.push(sha)
    }
    void this.drainUploads(usedKey)
  }

  /** One at a time. A file this device does not hold (a reference from another device) is skipped quietly. */
  private async drainUploads(usedKey: string): Promise<void> {
    if (this.uploading) return
    this.uploading = true
    try {
      while (this.uploadQueue.length && this.stateSignal() === 'publishing') {
        const sha = this.uploadQueue[0]
        try {
          await this.upload(sha, usedKey)
        } catch (e) {
          this.log.warn(`Board attachment not sent (${e})`, this.id)
        }
        this.uploadQueue.shift()
      }
    } finally {
      this.uploading = false
      if (this.stateSignal() !== 'publishing') this.uploadQueue = []
    }
  }

  private async upload(sha: string, usedKey: string): Promise<void> {
    const base = this.baseOf(this.settings)
    if (!base || !(await this.attachmentStore.has(sha))) return
    const bytes = await (await this.attachmentStore.getOriginal(sha)).arrayBuffer()
    const reply = await this.call(base, 'POST', `/api/attachments/${sha}`, {
      headers: { 'Content-Type': 'application/octet-stream' }, key: usedKey, body: bytes,
    })
    const read = readKeyedReply(reply.status, reply.body)
    if (read.kind === 'ok') this.journal.record('board-attachment-sent', 'Sent 1 attachment to the Board.')
    else if (read.kind === 'other') this.log.warn(`Board attachment refused (HTTP ${read.status}).`, this.id)
    else this.onKeyedRefusal(read, usedKey)
  }

  /** The stored 240 px thumbnail as a data URL, read once per fingerprint. Images only; '' when none. */
  private async thumbOf(sha: string, type: string): Promise<string> {
    if (!type.startsWith('image/')) return ''
    const known = this.thumbCache.get(sha)
    if (known !== undefined) return known
    let url = ''
    try {
      const blob = await this.attachmentStore.getThumb(sha)
      if (blob) url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
    } catch { /* no thumbnail: the row shows the file's name instead */ }
    this.thumbCache.set(sha, url)
    return url
  }

  // ---- the wire ----

  /** One request. `key` is sent as X-Board-Key. Resolves with the status and parsed JSON (or null). */
  private async call(
    base: string, method: 'GET' | 'POST', path: string,
    o: { headers?: Record<string, string>, key?: string, body?: BodyInit } = {},
  ): Promise<{ status: number, body: unknown }> {
    const started = Date.now()
    let res: Response
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { ...o.headers, ...(o.key ? { 'X-Board-Key': o.key } : {}) },
        ...(o.body !== undefined ? { body: o.body } : {}),
      })
    } catch (e) {
      this.noteUnreachable(Date.now() - started)
      throw e
    }
    this.noteReached()
    let body: unknown = null
    try { body = await res.json() } catch { /* 204, or not JSON */ }
    return { status: res.status, body }
  }

  /**
   * A request failed at the network (not an HTTP status). Say what is most likely at once (the fast/slow guess),
   * try again later, and - once per failure streak - ask the Board `GET /api/hello` to name the cause properly.
   */
  private noteUnreachable(elapsedMs: number): void {
    const firstOfStreak = !this.unreachableSignal()
    const cause = elapsedMs < QUICK_FAIL_MS ? 'certificate-not-accepted' : 'different-network'
    this.unreachableSignal.set(cause === 'certificate-not-accepted' ? 'quick' : 'slow')
    this.messageSignal.set(boardCause(cause).message)
    if (this.active) this.retry.failed()
    if (firstOfStreak) void this.diagnoseStreak()
  }

  /** The automatic Test connection after a failure: its answer replaces the guess, unless the Board turns out reachable. */
  private async diagnoseStreak(): Promise<void> {
    const base = this.active?.base
    if (!base) return
    const d = await this.runTest(base)
    if (d.ok || !this.unreachableSignal()) return
    this.unreachableSignal.set(d.cause === 'certificate-not-accepted' ? 'quick' : 'slow')
    this.messageSignal.set(d.message)
  }

  /** Any HTTP answer at all means the Board was reached. */
  private noteReached(): void {
    if (!this.unreachableSignal()) return
    this.unreachableSignal.set(undefined)
    this.messageSignal.set('')
    this.diagnosisSignal.set(undefined)
    this.retry.succeeded()
  }

  // ---- Test connection (E-216 slice 2) ----

  /**
   * The Mission card's Test connection button: asks the Board `GET {address}/api/hello` and names the most likely
   * cause (domain/board-diagnosis.ts). Works with publishing off, from whatever address the scribe has typed.
   * A browser cannot see why a request failed, so the answer is a best guess, worded that way.
   */
  async testConnection(address?: string): Promise<BoardDiagnosis> {
    const typed = normaliseBoardAddress(address ?? this.settings?.commandPostServerUrl)
    if (!typed.url) {
      const d: BoardDiagnosis = {
        ok: false, message: typed.error ?? 'Type the address the Board printed, then test it.', detail: '',
      }
      this.diagnosisSignal.set(d)
      return d
    }
    return this.runTest(typed.url)
  }

  private async runTest(base: string): Promise<BoardDiagnosis> {
    this.testingSignal.set(true)
    try {
      const localNetwork = await this.localNetworkPermission()
      const hello = await this.askHello(base)
      const d = diagnoseBoard({ online: navigator.onLine, localNetwork, hello })
      this.diagnosisSignal.set(d)
      this.log.info(`Board test: ${d.ok ? 'connected' : d.cause}.`, this.id)
      return d
    } finally {
      this.testingSignal.set(false)
    }
  }

  /** `GET /api/hello`. Never throws: every outcome is a HelloResult. */
  private async askHello(base: string): Promise<HelloResult> {
    const started = Date.now()
    try {
      const res = await fetch(`${base}/api/hello`, { signal: AbortSignal.timeout(HELLO_TIMEOUT_MS) })
      let body: { app?: unknown, name?: unknown } | null = null
      try { body = await res.json() } catch { /* not JSON: not a Board */ }
      return body && body.app === 'rangertrak-board'
        ? { kind: 'ok', name: typeof body.name === 'string' ? body.name : '' }
        : { kind: 'not-board' }
    } catch (e) {
      const name = (e as { name?: string })?.name
      if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout' }
      return { kind: 'failed', elapsedMs: Date.now() - started }
    }
  }

  /**
   * Chrome's local network permission for this site. The name is still settling between browsers, so each is tried
   * in turn (an unknown name throws); the first answer wins, else 'unknown'.
   */
  private async localNetworkPermission(): Promise<LocalNetworkPermission> {
    for (const name of ['local-network-access', 'local-network']) {
      try {
        const status = await navigator.permissions.query({ name: name as PermissionName })
        if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') return status.state
      } catch { /* this browser does not know that name */ }
    }
    return 'unknown'
  }

  private by(settings: MissionType) {
    const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[], platform?: string } }
    return {
      mission: settings.mission,
      opPeriod: settings.opPeriod,
      scribe: this.operator.name().trim(),
      agent: describeAgent(navigator.userAgent, nav.userAgentData?.brands, nav.userAgentData?.platform),
    }
  }

  private async buildPayload(settings: MissionType, radioLog: RadioLogType): Promise<CommandPostMission> {
    const show = !!settings.boardShowAttachments
    if (show) {
      for (const r of radioLog.logEntries) for (const a of liveRefs(r)) await this.thumbOf(a.sha256, a.type)
    }
    const thumbs = new Map([...this.thumbCache].filter(([, url]) => url))
    const payload: CommandPostMission = {
      publishedAt: new Date().toISOString(),
      mission: settings.mission,
      event: settings.event,
      opPeriod: settings.opPeriod,
      opPeriodStart: new Date(settings.opPeriodStart).toISOString(),
      opPeriodEnd: new Date(settings.opPeriodEnd).toISOString(),
      reports: radioLog.logEntries.map((r): CommandPostReport => ({
        id: r.id,
        msgNo: formatMsgNoShort(r.msgNo),
        msgNoFull: formatMsgNoFull(r.msgNo),
        callsign: r.callsign,
        tacticalCall: r.tacticalCall ?? '',
        toTactical: r.toTactical ?? '',
        toCallsign: r.toCallsign ?? '',
        date: new Date(r.date).toISOString(),
        status: r.status,
        source: r.source ?? '',
        notes: r.notes,
        location: (r.location?.lat && r.location?.lng)
          ? { lat: r.location.lat, lng: r.location.lng, address: r.location.address ?? '' }
          : null,
        ...attachmentFields(r, show, thumbs),
        ...ics213Fields(r),
      })),
    }
    if (show) {
      // Oldest reports first, so the newest keep their thumbnails when the lot is too big.
      const dropped = trimThumbs([...payload.reports].sort((a, b) => a.date.localeCompare(b.date)))
      if (dropped) this.log.info(`Board snapshot: dropped ${dropped} thumbnail(s) to stay under the size limit.`, this.id)
    }
    return payload
  }
}
