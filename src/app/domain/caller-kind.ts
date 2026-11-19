/**
 * E-324: what kind of caller is this call sign? A pure helper for the colour chip on Entry and the tag in the
 * Radio Log. It only informs; nothing here blocks a save (D-46 capability, not policy). Colour is never the only
 * signal: every kind comes with a text `tag`.
 */
export type CallerKind = 'eoc' | 'operator' | 'tactical' | 'directory' | 'unknown' | 'blank'

export type CallerContext = {
  /** mission.eocCalls, compared upper-cased. */
  eocCalls: readonly string[]
  roster: ReadonlyArray<{ callsign: string; id?: string; team: string }>
  tacticalCalls: readonly { name: string }[]
  /** undefined = no call sign list loaded on this device; null = loaded, call not in it. */
  directoryHit?: { name: string; city: string; region: string } | null
}

export type CallerResult = {
  kind: CallerKind
  tag: string
  /** Extra text for the chip: the directory name and place. */
  detail?: string
  /** The directory name alone, for "Add to roster". */
  name?: string
}

/** The shape of an amateur call sign, after suffixes are stripped. */
const AMATEUR_CALL = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,3}[A-Z]$/

/**
 * Upper-case, trim, drop a trailing `-N` SSID and `/P`-style suffixes. With a prefix form such as `VE7/W1AW`
 * the longest part is kept, which is the call itself.
 */
export function normalizeCall(call: string): string {
  let s = (call ?? '').trim().toUpperCase()
  if (s.includes('/')) {
    s = s.split('/').reduce((best, part) => part.length > best.length ? part : best, '')
  }
  return s.replace(/-\d{1,2}$/, '').trim()
}

export function looksLikeAmateurCall(call: string): boolean {
  return AMATEUR_CALL.test(normalizeCall(call))
}

export function callerKind(call: string, ctx: CallerContext): CallerResult {
  const raw = (call ?? '').trim()
  if (!raw) return { kind: 'blank', tag: '' }
  const norm = normalizeCall(raw)
  const upper = raw.toUpperCase()
  const same = (v: string | undefined) => {
    const t = (v ?? '').trim().toUpperCase()
    return !!t && (t === upper || t === norm || normalizeCall(t) === norm)
  }
  // A Ranger ID such as SF-21 ends like an SSID, so it only ever matches as typed.
  const sameId = (v: string | undefined) => !!(v ?? '').trim() && (v ?? '').trim().toUpperCase() === upper

  if (ctx.eocCalls.some(same)) return { kind: 'eoc', tag: 'EOC' }

  const person = ctx.roster.find(r => same(r.callsign) || sameId(r.id))
  if (person) return { kind: 'operator', tag: person.team?.trim() || 'Roster' }

  if (ctx.tacticalCalls.some(t => t.name.trim().toUpperCase() === upper)) return { kind: 'tactical', tag: 'Tactical' }

  const hit = ctx.directoryHit
  if (hit) {
    const place = [hit.city, hit.region].filter(Boolean).join(', ')
    return { kind: 'directory', tag: 'Not on roster', detail: [hit.name, place].filter(Boolean).join(', '), name: hit.name }
  }
  if (hit === null && AMATEUR_CALL.test(norm)) return { kind: 'unknown', tag: 'Not in call sign list' }
  return { kind: 'unknown', tag: 'Unknown' }
}
