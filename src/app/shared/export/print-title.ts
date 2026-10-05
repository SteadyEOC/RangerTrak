/**
 * 2026-10-05, John: E-172 item 6 - every printout gets a document title with the mission and
 * the print time. The browser's print header says whatever `document.title` is (otherwise
 * "RangerTrak - Track Your Rangers"), and Chrome also uses it as the default "Save as PDF"
 * file name, so every saved PDF used to be called the same. For example:
 *
 *   Missing Person Exercise - Map - 2026-10-02 1109
 *
 * The title is set on the browser's `beforeprint` event (so the time is when the print really
 * ran) and put back on `afterprint`. It has no `:` or `/`, because it becomes a Windows file name.
 * One helper for every printout - map, ICS-213, ICS-309, roster, After Action - so they cannot drift.
 */
export type PrintKind = 'Map' | 'ICS-213' | 'ICS-309' | 'Roster' | 'After Action'

/** The part of the mission settings the title needs (MissionType satisfies it). */
export type PrintTitleMission = { event?: string, mission?: string } | null | undefined

const pad = (n: number) => String(n).padStart(2, '0')

/** Local date and 24-hour time, `2026-10-02 1109` - sorts in a folder and has no `:`. */
export function printStamp(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** `<event name, else incident no., else RangerTrak> - <kind> - <stamp>`, safe as a file name. */
export function printTitle(kind: PrintKind, mission: PrintTitleMission, now = new Date()): string {
  const name = mission?.event?.trim() || mission?.mission?.trim() || 'RangerTrak'
  return `${name} - ${kind} - ${printStamp(now)}`.replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ')
}

/**
 * Titles the next print. `listenOn` is the window whose `beforeprint`/`afterprint` events mark
 * that print (an ICS-213 prints from a hidden iframe, so that is the iframe's window); the title
 * that changes is always this page's. Returns a function that puts everything back, for callers
 * whose `print()` returns without the events having fired - a stale listener must never
 * rename some later Ctrl+P.
 */
export function armPrintTitle(kind: PrintKind, mission: PrintTitleMission, listenOn: Window = window): () => void {
  let original: string | null = null
  const before = () => {
    if (original === null) {
      original = document.title
    }
    document.title = printTitle(kind, mission)
  }
  const restore = () => {
    if (original !== null) {
      document.title = original
      original = null
    }
  }
  const disarm = () => {
    listenOn.removeEventListener('beforeprint', before)
    listenOn.removeEventListener('afterprint', after)
    restore()
  }
  const after = () => disarm()
  listenOn.addEventListener('beforeprint', before)
  listenOn.addEventListener('afterprint', after)
  return disarm
}
