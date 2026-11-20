/**
 * E-337 (John 2026-11-19; Q128 option (a)): the team a radio log entry belongs to.
 *
 * The team is RECORDED AT SAVE TIME, like `tacticalCall` and `operator`: when a ranger moves from Team 2 to
 * Team 3 mid-mission, their earlier entries still say Team 2, which is what the log really said at the time and
 * what an after-action review needs. Entries saved before E-337 have no `team`, so they fall back to the
 * ranger's team on the roster now.
 *
 * Framework-free (D-57).
 */
type RosterLike = ReadonlyArray<{ uid?: string; team: string }>

/** The team to stamp on a new entry: the From ranger's roster team, or undefined (left off the entry). */
export function teamAtSave(rangerUid: string | undefined, roster: RosterLike): string | undefined {
  if (!rangerUid) return undefined
  const team = roster.find(r => r.uid === rangerUid)?.team?.trim()
  return team || undefined
}

/** The team an entry shows: the one recorded when it was logged, else the ranger's roster team now. */
export function entryTeam(entry: { team?: string; rangerUid?: string }, roster: RosterLike): string {
  const recorded = entry.team?.trim()
  if (recorded) return recorded
  return teamAtSave(entry.rangerUid, roster) ?? ''
}

/** True when the team shown comes from the roster now rather than from the entry itself. */
export function teamIsFromRoster(entry: { team?: string; rangerUid?: string }, roster: RosterLike): boolean {
  return !entry.team?.trim() && !!teamAtSave(entry.rangerUid, roster)
}
