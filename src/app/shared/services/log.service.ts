import { Observable, ReplaySubject, throwError } from 'rxjs'

import { Injectable, Optional, signal, SkipSelf, Signal } from '@angular/core'

import { LogHeadings, LogLevel, LogLevelNames, LogType } from './log.interface'

// Additional ideas: https://www.codemag.com/Article/1711021/Logging-in-Angular-Applications

/**
 * In-app event log: the data behind the Log page, and the raw material for a trouble
 * report.
 *
 * Why this exists at all, given `console` already does logging: `console.*` writes to
 * devtools and **nowhere the page can read back** - there is no API to retrieve console
 * history. A scribe running RangerTrak on a field tablet has no devtools, so an in-app log
 * requires capturing entries ourselves. What this adds over `console` is (a) visibility
 * inside the app, (b) structured records that can be filtered and exported, and (c)
 * something a user can actually attach to a trouble report. Only Warn and Error entries are
 * mirrored to the console (2026-10-16, John: the Info/Verbose/Excessive chatter buried real
 * problems in devtools); everything captured is still on the Log page.
 */
@Injectable({ providedIn: 'root' })
export class LogService {

  /**
   * Entries are held in a bounded ring buffer. Previously the array grew without limit for
   * the life of the session, which on a multi-day incident with excessive logging enabled
   * is a slow memory leak in a tool that must not fall over mid-mission. Oldest entries are
   * discarded first; the console retains everything if more history is needed.
   */
  private static readonly MAX_ENTRIES = 5000

  private buffer: LogType[] = []

  /**
   * Source of truth for consumers. `equal: () => false` makes every `.set()` notify even
   * though the array reference never changes - deliberate, because copying a 5,000-element
   * array on every log call would make logging O(n) per entry and O(n²) over a session,
   * which is the cost this rewrite exists to remove. Consumers must treat the array as
   * read-only.
   */
  private logSignal = signal<LogType[]>([], { equal: () => false })

  /** Thin adapter for the Observable consumers that predate the signal, matching the
   *  pattern used by the other services (see mission.service.ts for why ReplaySubject
   *  rather than toObservable). */
  private logReplay$ = new ReplaySubject<LogType[]>(1)

  /** Read-only view for zoneless components - reading this in a template keeps the view
   *  updating without a manual subscription. */
  public readonly entries: Signal<LogType[]> = this.logSignal.asReadonly()

  /**
   * Entries below this level are dropped at the source - neither stored nor written to the
   * console. Defaults to capturing everything, preserving existing behavior; raise it to
   * quiet a noisy session without editing call sites.
   */
  public minCaptureLevel: LogLevel = LogLevel.Excessive

  private defaultSource = 'Unknown'
  static nextId = 1

  constructor(
    @Optional() @SkipSelf() existingService: LogService,
  ) {
    if (existingService) {
      /**
       * see https://angular.io/guide/singleton-services
       * Use @Optional() @SkipSelf() in singleton constructors to ensure
       * future modules don't provide extra copies of this singleton service
       * per pg 84 of Angular Cookbook: do NOT add services to *.module.ts!
       */
      throwError(() => {
        console.error(`This singleton service has already been provided in the application. Avoid providing it again in child modules.`)
        new Error(`This singleton service has already been provided in the application. Avoid providing it again in child modules.`)
      })
    }

    this.log_('Log Service is being constructed', 'LogService', LogLevel.Verbose)
  }

  // compare to functionality of https://developer.mozilla.org/en-US/docs/Web/API/console
  // Chrome console formatting: https://developer.chrome.com/docs/devtools/console/format-style/
  log(msg: string, source: string = this.defaultSource, level: LogLevel = LogLevel.Info) {
    this.log_(msg, source, level)
  }

  private log_(msg: string, source: string, level: LogLevel) {
    if (level < this.minCaptureLevel) {
      return
    }

    const entry: LogType = { id: LogService.nextId++, date: new Date(), msg, level, source }
    const line = `${entry.id}: ${source}: ${msg}`

    switch (level) {
      case LogLevel.Warn:
        console.warn(line)
        break
      case LogLevel.Error:
        console.error(line)
        break
      case LogLevel.Excessive:
      case LogLevel.Verbose:
      case LogLevel.Info:
        // In-app log only - see the class comment.
        break
      default:
        console.error(`Unknown level = ${level}!`)
        console.error(line)
        break
    }

    this.buffer.push(entry)
    if (this.buffer.length > LogService.MAX_ENTRIES) {
      this.buffer.splice(0, this.buffer.length - LogService.MAX_ENTRIES)
    }

    this.logSignal.set(this.buffer)
    this.logReplay$.next(this.buffer)
  }

  excessive(msg: string, source: string = this.defaultSource) {
    this.log_(msg, source, LogLevel.Excessive)
  }

  verbose(msg: string, source: string = this.defaultSource) {
    this.log_(msg, source, LogLevel.Verbose)
  }

  info(msg: string, source: string = this.defaultSource) {
    this.log_(msg, source, LogLevel.Info)
  }

  warn(msg: string, source: string = this.defaultSource) {
    this.log_(msg, source, LogLevel.Warn)
  }

  error(msg: string, source: string = this.defaultSource) {
    this.log_(msg, source, LogLevel.Error)
  }

  /** Expose the Observable, not the subject itself (which could be abused). */
  getLogObserver(): Observable<LogType[]> {
    return this.logReplay$.asObservable()
  }

  /** Synchronous read, e.g. for export. Treat the result as read-only. */
  getEntries(): readonly LogType[] {
    return this.buffer
  }

  clear() {
    this.buffer = []
    this.logSignal.set(this.buffer)
    this.logReplay$.next(this.buffer)
    this.info('Log cleared by user.', 'LogService')
  }

  /**
   * Serializes the log as CSV. Pure and separate from the download so it can be tested.
   *
   * There is one export, not a full and a "redacted" pair (retired 2026-10-16, John): the
   * log is kept free of content instead. Log events, never payloads - no entry or settings
   * objects, no typed or geocoded addresses, no keys or passphrases. Call signs, file names,
   * counts, uids and coordinates are fine.
   */
  toCsv(): string {
    const rows = [
      LogHeadings.join(','),
      ...this.buffer.map(e => [
        e.id,
        e.date.toISOString(),
        LogLevelNames[e.level] ?? e.level,
        e.source,
        e.msg,
      ].map(field => this.csvEscape(field)).join(','))
    ]
    return rows.join('\r\n')
  }

  /**
   * Log messages routinely contain commas, quotes, and embedded JSON with both, plus
   * newlines - so every field is quoted and internal quotes doubled, per RFC 4180.
   * Without this the CSV silently misaligns into the wrong columns.
   */
  private csvEscape(field: unknown): string {
    return `"${String(field).replace(/"/g, '""')}"`
  }
}
