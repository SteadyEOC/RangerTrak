/**
 * E-168 (2026-10-01, John): "stay out of the way in a real incident." A plain module-level flag
 * that UsageStateService keeps current (true while the usage state is 'live'), for the few
 * interruptions that are plain functions with no injector - the first-print tip, for one. Code
 * with an injector reads UsageStateService.quiet() directly instead.
 */
let quiet = false

export function setQuiet(value: boolean): void {
  quiet = value
}

export function isQuiet(): boolean {
  return quiet
}
