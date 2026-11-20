import type { RangerType } from './model/ranger.interface'

/**
 * The Print card's roster contact sheet (E-187 Layers phase D, ADR D-58): one row per person,
 * grouped by team. Pure (ADR D-57); the page only draws what this returns.
 *
 * The sheet carries names and phone numbers, so the card says so (CLAUDE.md rule 5). No photos.
 */
export type RosterPrintRow = {
  callsign: string
  name: string
  role: string
  phone: string
  id: string
}

export type RosterPrintGroup = {
  /** The team as written, or '' for people with none. */
  team: string
  /** What the sheet's team heading says. */
  label: string
  rows: RosterPrintRow[]
}

/** The heading for people who have no team. */
export const NO_TEAM_LABEL = '(no team)'

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Call signs in natural order (K7VMI-2 before K7VMI-10); a missing call sign sorts after every real one. */
function compareRows(a: RosterPrintRow, b: RosterPrintRow): number {
  if (!a.callsign !== !b.callsign) {
    return a.callsign ? -1 : 1
  }
  return collator.compare(a.callsign, b.callsign)
    || collator.compare(a.name, b.name)
    || collator.compare(a.id, b.id)
}

/**
 * Groups the rangers by team (teams A to Z, people with no team last) and sorts each team by
 * call sign. Team names that differ only in case or spacing are one team, shown as first written.
 * A team with nobody in it cannot appear: groups are made from the people.
 */
export function buildRosterPrint(rangers: readonly RangerType[]): RosterPrintGroup[] {
  const groups = new Map<string, RosterPrintGroup>()
  for (const r of rangers) {
    const team = (r.team ?? '').trim()
    const key = team.toLowerCase()
    let group = groups.get(key)
    if (!group) {
      group = { team, label: team || NO_TEAM_LABEL, rows: [] }
      groups.set(key, group)
    }
    group.rows.push({
      callsign: (r.callsign ?? '').trim(),
      name: (r.fullName ?? '').trim(),
      role: (r.role ?? '').trim(),
      phone: (r.phone ?? '').trim(),
      id: (r.id ?? '').trim(),
    })
  }
  const out = [...groups.values()]
  out.forEach(g => g.rows.sort(compareRows))
  return out.sort((a, b) => {
    if (!a.team !== !b.team) {
      return a.team ? -1 : 1
    }
    return collator.compare(a.team, b.team)
  })
}
