import { areaMapRef, currentAreaMap, resetAreaMapCacheForTests, sha256Hex } from './board-area-map'
import { clearActiveDemoScenario } from '../mapping/demo-map'

describe('board area map (E-293 phase B)', () => {
  beforeEach(() => { resetAreaMapCacheForTests(); clearActiveDemoScenario() })

  it('fingerprints bytes as lower-case SHA-256 hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('sends a custom map when one is loaded, fingerprinted once', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])])
    const a = await currentAreaMap({ name: 'area.pmtiles', blob })
    expect(a?.bytes).toBe(4)
    expect(a?.name).toBe('area.pmtiles')
    expect(a?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(a?.bbox).toBeNull() // not a real PMTiles file: no bounds, still sent
    expect(await currentAreaMap({ name: 'area.pmtiles', blob })).toBe(a)
    expect(areaMapRef(a!)).toEqual({ sha256: a!.sha256, bytes: 4, name: 'area.pmtiles', bbox: null })
  })

  it('sends nothing with no custom map and no demo loaded', async () => {
    expect(await currentAreaMap(null)).toBeNull()
  })
})
