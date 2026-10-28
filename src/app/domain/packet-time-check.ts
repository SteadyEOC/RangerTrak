/**
 * Report Packet time check (2026-10-28, John): a field phone's packet carries no mission name,
 * so the merge can't ask "is this the same mission?". It asks "do these reports belong to this
 * mission's time?" instead, which needs nobody to type anything and still catches the likely
 * mistake: last month's packet, still on a ranger's phone.
 *
 * The window opens at the earlier of the current op period's start and the oldest report this
 * device already holds (there is no op-period history, so a mission in its third op period
 * still accepts reports from its first). It closes at now plus a few minutes, for phone clocks
 * that run a little fast. Warn, never block (D-46).
 */

/** A phone clock this far ahead of the command post's is still "now". */
export const FUTURE_SLACK_MS = 10 * 60 * 1000

export type PacketTimeCheck = {
  /** Reports dated before the window opened. */
  before: number
  /** Reports dated after now (plus the slack). */
  future: number
  /** When the window opened; null when there was nothing to open it. */
  windowStart: Date | null
}

export function checkPacketTimes(params: {
  incoming: ReadonlyArray<{ date: Date | string }>
  existing: ReadonlyArray<{ date: Date | string }>
  opPeriodStart: Date | string | null | undefined
  now: number
}): PacketTimeCheck {
  const ms = (d: Date | string | null | undefined) => d == null ? NaN : new Date(d).getTime()

  const starts = [ms(params.opPeriodStart), ...params.existing.map(e => ms(e.date))].filter(Number.isFinite)
  const start = starts.length ? Math.min(...starts) : NaN
  const latest = params.now + FUTURE_SLACK_MS

  let before = 0
  let future = 0
  for (const e of params.incoming) {
    const t = ms(e.date)
    // An unreadable date is the merge's to reject (it says so); not counted twice here.
    if (!Number.isFinite(t)) continue
    if (Number.isFinite(start) && t < start) before++
    else if (t > latest) future++
  }
  return { before, future, windowStart: Number.isFinite(start) ? new Date(start) : null }
}

/** The confirm() text, or null when every report falls inside the window. */
export function packetTimeWarning(check: PacketTimeCheck, total: number, formatDate: (d: Date) => string): string | null {
  if (!check.before && !check.future) return null
  const reports = (n: number) => `${n} report${n === 1 ? '' : 's'}`
  const lines: string[] = []
  if (check.before && check.windowStart) {
    lines.push(`${reports(check.before)} in this packet ${check.before === 1 ? 'is' : 'are'} dated before this mission started (${formatDate(check.windowStart)}). It may be an old packet from an earlier mission.`)
  }
  if (check.future) {
    lines.push(`${reports(check.future)} in this packet ${check.future === 1 ? 'is' : 'are'} dated in the future. The sending phone's clock may be wrong.`)
  }
  lines.push(`Import all ${reports(total)} anyway?`)
  return lines.join('\n\n')
}
