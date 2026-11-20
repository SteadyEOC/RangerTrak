import type { AarNoteType } from './model/aar-note.interface'
import { noteTime } from './aar-note-migration'
import { SUGGEST_FOR_214 } from './mission-journal'
import type { JournalEntry } from './mission-journal'

/**
 * E-04 / ADR D-63: the ICS-214 activity log, as pure rules - which lines go on the form, how a
 * line becomes rows of the form, how rows are split across pages, and the stored header. No
 * Angular, DOM, pdf-lib or storage here (D-57), so the specs run every case without a browser;
 * `shared/export/ics214-pdf.ts` only places the result on FEMA's form.
 */

/** Sheet 1 of FEMA's ICS-214 holds 24 activity rows; each continuation sheet holds 36. */
export const ICS214_FIRST_PAGE_ROWS = 24
export const ICS214_CONTINUATION_ROWS = 36
/** Resources Assigned rows on the form. */
export const ICS214_MAX_RESOURCES = 8
/** D-63 item 4: what the ICS position becomes when the scribe leaves it blank. */
export const DEFAULT_ICS_POSITION = 'Radio Operator'

// ---- The stored header (RecordStore key `activityLogHeader`) ----

export type ActivityLogResource = { name: string, icsPosition: string, homeAgency: string }

export type ActivityLogHeader = {
  name: string,
  icsPosition: string,
  homeAgency: string,
  resources: ActivityLogResource[],
}

export const EMPTY_ACTIVITY_LOG_HEADER: ActivityLogHeader = { name: '', icsPosition: '', homeAgency: '', resources: [] }

const str = (v: unknown): string => typeof v === 'string' ? v.trim() : ''

/**
 * Repairs whatever storage or a backup holds into the header shape: strings throughout, at most
 * 8 resource rows, rows with nothing in them dropped. Pure; running it over its own output
 * changes nothing. Anything that is not an object gives the empty header.
 */
export function normalizeActivityLogHeader(raw: unknown): ActivityLogHeader {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ACTIVITY_LOG_HEADER, resources: [] }
  const h = raw as Partial<Record<keyof ActivityLogHeader, unknown>>
  const resources = (Array.isArray(h.resources) ? h.resources : [])
    .map((r): ActivityLogResource => {
      const o = (r && typeof r === 'object' ? r : {}) as Partial<Record<keyof ActivityLogResource, unknown>>
      return { name: str(o.name), icsPosition: str(o.icsPosition), homeAgency: str(o.homeAgency) }
    })
    .filter(r => r.name || r.icsPosition || r.homeAgency)
    .slice(0, ICS214_MAX_RESOURCES)
  return { name: str(h.name), icsPosition: str(h.icsPosition), homeAgency: str(h.homeAgency), resources }
}

// ---- Which lines go on the form ----

export type ActivityLogMission = { opPeriodStart?: Date | string | null, opPeriodEnd?: Date | string | null }

const ms = (d: Date | string | null | undefined): number => d == null ? NaN : new Date(d).getTime()

/** The mission has a real operational period: a start after the epoch placeholder, ending after it starts. */
export function hasOpPeriod(mission: ActivityLogMission): boolean {
  const s = ms(mission.opPeriodStart)
  const e = ms(mission.opPeriodEnd)
  return Number.isFinite(s) && Number.isFinite(e) && s > 0 && e > s
}

/** Activity lines only, oldest first by their own time (`at ?? createdAt`), ties in capture order. */
export function activityLines(notes: readonly AarNoteType[]): AarNoteType[] {
  return notes
    .map((n, i) => ({ n, i, t: ms(noteTime(n)) }))
    .filter(x => x.n.kind === 'activity')
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .map(x => x.n)
}

/**
 * D-63 item 6: the lines for the form. With `onlyOpPeriod` and a real operational period, only
 * lines timed inside it (both ends included); otherwise every line. Sorted by time.
 */
export function selectActivityLines(
  notes: readonly AarNoteType[], mission: ActivityLogMission, onlyOpPeriod: boolean,
): AarNoteType[] {
  const lines = activityLines(notes)
  if (!onlyOpPeriod || !hasOpPeriod(mission)) return lines
  const s = ms(mission.opPeriodStart)
  const e = ms(mission.opPeriodEnd)
  return lines.filter(n => {
    const t = ms(noteTime(n))
    return Number.isFinite(t) && t >= s && t <= e
  })
}

/**
 * E-222 / D-67 item 8: journal entries the scribe may tick to become 214 lines. Mission and data actions
 * (SUGGEST_FOR_214) whose time falls in the same window selectActivityLines() uses, minus any that already
 * have a line with the same time and text, so a suggestion never doubles one. Oldest first.
 */
export function suggestActivityFromJournal(
  entries: readonly JournalEntry[], notes: readonly AarNoteType[], mission: ActivityLogMission, onlyOpPeriod: boolean,
): JournalEntry[] {
  const window = onlyOpPeriod && hasOpPeriod(mission)
  const s = ms(mission.opPeriodStart)
  const e = ms(mission.opPeriodEnd)
  const have = new Set(activityLines(notes).map(n => `${ms(noteTime(n))}|${n.text}`))
  return entries.filter(j => {
    if (!SUGGEST_FOR_214.has(j.action)) return false
    const t = ms(j.at)
    if (!Number.isFinite(t)) return false
    if (window && !(t >= s && t <= e)) return false
    return !have.has(`${t}|${j.summary}`)
  })
}

// ---- Lines to rows ----

/** One row of the form: a time (blank on a continuation row) and the text for the activity cell. */
export type ActivityRow = { time: string, text: string }

/** `MM/dd HH:mm`, local, 24-hour: short enough for the 93 pt time cell. Empty for a bad date. */
export function formatActivityTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The widest an activity cell's text may run, in points at 10 pt Helvetica (the cell is 443 pt; this leaves its padding). */
export const ACTIVITY_CELL_MAX_WIDTH = 428

const NARROW = "iljIt.,;:'!| "
const MEDIUM = 'fr()[]-/"`'
const WIDE = 'mwMW@%'

/**
 * A deliberately slightly-wide estimate of Helvetica's width at 10 pt, so a wrapped row never
 * overflows its cell (a too-short row only costs a little paper; the spec checks it against the
 * real font). Pure, so wrapping needs no font file.
 */
export function estimateWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    if (NARROW.includes(ch)) w += 3.6
    else if (MEDIUM.includes(ch)) w += 4.2
    else if (WIDE.includes(ch)) w += 9.6
    else if (/[A-Z0-9]/.test(ch)) w += 7.3
    else w += 5.8
  }
  return w
}

const WIN_ANSI_EXTRAS = '‘’“”–—•…€™'

/**
 * Text the form's font (Helvetica, WinAnsi) can print: typographic quotes, dashes and the like
 * are kept; anything else (emoji, other scripts) becomes `?` rather than failing the whole export.
 */
export function toWinAnsi(s: string): string {
  return Array.from(s.replace(/\t/g, ' ')).map(ch => {
    const c = ch.codePointAt(0)!
    if (c === 10 || c === 13) return ch
    if ((c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF)) return ch
    return WIN_ANSI_EXTRAS.includes(ch) ? ch : '?'
  }).join('')
}

/** Wraps one paragraph to the cell width, at spaces where it can and mid-word only for a word wider than a row. */
export function wrapText(text: string, maxWidth = ACTIVITY_CELL_MAX_WIDTH, measure: (s: string) => number = estimateWidth): string[] {
  const out: string[] = []
  let cur = ''
  const push = () => { if (cur) { out.push(cur); cur = '' } }
  for (const word of text.split(/ +/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (measure(next) <= maxWidth) { cur = next; continue }
    push()
    let rest = word
    while (measure(rest) > maxWidth) {
      let n = rest.length
      while (n > 1 && measure(rest.slice(0, n)) > maxWidth) n--
      out.push(rest.slice(0, n))
      rest = rest.slice(n)
    }
    cur = rest
  }
  push()
  return out.length ? out : ['']
}

/**
 * D-63 item 5: lines to rows. A line's first row carries its time; a long line (or a line with
 * line breaks) continues on following rows with a blank time - never truncated.
 */
export function buildActivityRows(lines: readonly AarNoteType[], measure?: (s: string) => number): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (const n of lines) {
    const pieces = toWinAnsi(n.text).split(/\r?\n/).flatMap(p => wrapText(p, ACTIVITY_CELL_MAX_WIDTH, measure))
    const time = formatActivityTime(noteTime(n))
    pieces.forEach((text, i) => rows.push({ time: i === 0 ? time : '', text }))
  }
  return rows
}

/** Splits rows into sheets: 24 on the first, 36 on each continuation. No rows still gives one empty sheet. */
export function chunkActivityRows(rows: readonly ActivityRow[]): ActivityRow[][] {
  const sheets: ActivityRow[][] = [rows.slice(0, ICS214_FIRST_PAGE_ROWS)]
  for (let i = ICS214_FIRST_PAGE_ROWS; i < rows.length; i += ICS214_CONTINUATION_ROWS) {
    sheets.push(rows.slice(i, i + ICS214_CONTINUATION_ROWS))
  }
  return sheets
}
