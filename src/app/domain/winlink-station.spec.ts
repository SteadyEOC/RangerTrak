import { describe, expect, it } from 'vitest'

import { resolveWinlinkStation } from './winlink-station'

describe('resolveWinlinkStation (E-307, Q80)', () => {
  const device = { call: 'K7ABC', addresses: [{ label: 'EOC', address: 'W7EOC' }] }

  it('uses the device values when the mission sets none', () => {
    expect(resolveWinlinkStation(undefined, device)).toEqual(device)
    expect(resolveWinlinkStation({}, device)).toEqual(device)
    expect(resolveWinlinkStation({ winlinkCall: '  ', winlinkAddresses: [] }, device)).toEqual(device)
  })

  it("lets the mission's own call sign and addresses win when set, each on its own", () => {
    const r = resolveWinlinkStation({ winlinkCall: 'w7xyz' }, device)
    expect(r).toEqual({ call: 'W7XYZ', addresses: device.addresses })
    const r2 = resolveWinlinkStation({ winlinkAddresses: [{ label: 'Net', address: 'NET1' }] }, device)
    expect(r2).toEqual({ call: 'K7ABC', addresses: [{ label: 'Net', address: 'NET1' }] })
  })
})
