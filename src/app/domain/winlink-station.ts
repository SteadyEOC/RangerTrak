/** E-307: one saved radio address: a name to pick it by, and the address (CALLSIGN, tactical or SMTP:user@host). */
export type WinlinkAddress = { label: string, address: string }

/** Keeps the entries that have an address; a blank label shows the address. */
export function parseWinlinkAddresses(v: unknown): WinlinkAddress[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((x): WinlinkAddress[] => {
    const address = typeof x?.address === 'string' ? x.address.trim() : ''
    if (!address) return []
    const label = typeof x?.label === 'string' && x.label.trim() ? x.label.trim() : address
    return [{ label, address }]
  })
}

/**
 * E-307 (Q80): the call sign and saved radio addresses Send by radio uses. A mission's own value wins when
 * it is set; otherwise this device's. Pure: the caller passes both in.
 */
export function resolveWinlinkStation(
  mission: { winlinkCall?: string, winlinkAddresses?: readonly WinlinkAddress[] } | undefined,
  device: { call: string, addresses: readonly WinlinkAddress[] },
): { call: string, addresses: WinlinkAddress[] } {
  const missionCall = (mission?.winlinkCall ?? '').trim().toUpperCase()
  const missionAddresses = mission?.winlinkAddresses ?? []
  return {
    call: missionCall || device.call,
    addresses: [...(missionAddresses.length ? missionAddresses : device.addresses)],
  }
}
