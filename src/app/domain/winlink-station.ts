import type { WinlinkAddress } from '../shared/services/device-prefs.service'

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
