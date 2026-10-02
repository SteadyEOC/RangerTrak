import type { UsageState } from '../../domain/usage-state'

/**
 * E-168 (2026-10-01, John): the one confirmation every "this replaces the whole mission"
 * action goes through (Load a demo, Reset mission to defaults). Outside a live mission it is
 * the same single confirm() as before. While the app thinks the mission is live, it is
 * deliberately harder: the operator first gets the chance to go back up the mission, then has
 * to type the mission name (or REPLACE). Not hidden - capability, not policy - just not one
 * mis-tap away.
 *
 * Returns true when the caller should go ahead.
 */
export function confirmReplaceMission(opts: {
  state: UsageState,
  missionName: string,
  /** The normal confirm text, used outside a live mission. */
  message: string,
}): boolean {
  if (opts.state !== 'live') return confirm(opts.message)

  if (confirm(`This mission looks like it is in use right now.\n\n`
    + `Do you want to back it up first?\n\n`
    + `OK = stop here, then use "Back up mission" on the Mission page.\n`
    + `Cancel = carry on without a backup.`)) {
    return false
  }
  const word = opts.missionName.trim() || 'REPLACE'
  const typed = prompt(`${opts.message}\n\nTo go ahead, type  ${word}  below.`)
  return typed !== null && typed.trim().toLowerCase() === word.toLowerCase()
}
