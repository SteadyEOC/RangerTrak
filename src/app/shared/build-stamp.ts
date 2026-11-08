/**
 * Which deploy this is, between tagged releases (John, 2026-10-28). Releases are tagged about
 * weekly while main deploys on every push, so the version alone can't say which build a
 * device has. The deploy workflow overwrites this file with the commit date and short hash
 * just before `ng build`; a local build keeps the empty string and shows nothing extra.
 * Display only: backups, settings and migrations keep the plain package.json version.
 */
export const BUILD_STAMP = ''

/** " (build 2026-10-28 c3edefa)" after the version, or '' for a local build. */
export const buildSuffix = (): string => (BUILD_STAMP ? ` (build ${BUILD_STAMP})` : '')

/**
 * E-280 (John, 2026-11-04): "RangerTrak 1.0.0-beta.2 (build 2026-11-07 429fe85)", printed small on
 * every printout - map sheet, ICS-309, ICS-213, ICS-214, SitRep, roster, places, After Action - so a
 * sheet says which build made it. Just "RangerTrak" when the version is not known.
 */
export const printVersionLine = (version?: string | null): string =>
  version ? `RangerTrak ${version}${buildSuffix()}` : 'RangerTrak'
