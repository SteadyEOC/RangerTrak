import {
  findLayer,
  LayerImport,
  LayerRecord,
  leftThisLayer,
  liveCount,
  parseLayers,
  pruneLayers,
  recordableLayerName,
  recordLayerImport,
  removalFor,
  serializeLayers,
  suggestLayerName,
  withoutLayer,
} from './layers'

/** E-187 phase C (ADR D-58 points 6 and 7): the device remembers which layers it holds. */
describe('layers', () => {
  const imp = (
    name: string,
    uids: string[],
    extra: Partial<LayerImport> = {}
  ): LayerImport => ({
    name,
    kind: 'people',
    asOf: '2026-10-15',
    fileName: `${name}.xlsx`,
    importedAt: '2026-10-15T10:00:00Z',
    uids,
    ...extra,
  })

  it('records an import as one layer record', () => {
    const layers = recordLayerImport([], imp('Fernhollow CERT', ['a', 'b', 'c']))
    expect(layers.length).toBe(1)
    expect(layers[0]).toEqual(
      expect.objectContaining({
        name: 'Fernhollow CERT',
        kind: 'people',
        uids: ['a', 'b', 'c'],
      })
    )
  })

  it('identifies a layer by trimmed, case-insensitive name plus kind', () => {
    let layers = recordLayerImport([], imp('Fernhollow CERT', ['a']))
    layers = recordLayerImport(layers, imp('  fernhollow cert ', ['a', 'b']))
    expect(layers.length).toBe(1)
    expect(layers[0].name).toBe('Fernhollow CERT')
    expect(layers[0].uids).toEqual(['a', 'b'])
    // Same name, other kind: a second record (a people+places Setup file makes two).
    layers = recordLayerImport(layers, imp('Fernhollow CERT', ['p1'], { kind: 'places' }))
    expect(layers.length).toBe(2)
    expect(findLayer(layers, 'FERNHOLLOW cert', 'places')?.uids).toEqual(['p1'])
  })

  it('re-import with 2 gone offers those 2', () => {
    const layers = recordLayerImport([], imp('Fernhollow CERT', ['a', 'b', 'c', 'd']))
    expect(leftThisLayer(layers, 'Fernhollow CERT', 'people', ['a', 'b'])).toEqual([
      'c',
      'd',
    ])
  })

  it('offers nothing for a layer the device has not seen', () => {
    expect(leftThisLayer([], 'New', 'people', ['a'])).toEqual([])
  })

  it('does not offer a record another layer also holds', () => {
    let layers = recordLayerImport([], imp('Fernhollow CERT', ['a', 'b', 'c', 'd']))
    layers = recordLayerImport(layers, imp('ACS', ['d']))
    expect(leftThisLayer(layers, 'Fernhollow CERT', 'people', ['a', 'b'])).toEqual(['c'])
  })

  it('a layer of the other kind never holds a record elsewhere', () => {
    let layers = recordLayerImport([], imp('Fernhollow', ['x', 'y']))
    layers = recordLayerImport(layers, imp('Fernhollow', ['x'], { kind: 'places' }))
    expect(leftThisLayer(layers, 'Fernhollow', 'people', ['y'])).toEqual(['x'])
  })

  it('removing a layer keeps records shared with another layer', () => {
    let layers = recordLayerImport([], imp('Fernhollow CERT', ['a', 'b', 'c']))
    layers = recordLayerImport(layers, imp('ACS', ['c', 'z']))
    const removal = removalFor(layers, 'fernhollow cert', 'people')
    expect(removal.remove).toEqual(['a', 'b'])
    expect(removal.keptShared).toEqual(['c'])
    expect(withoutLayer(layers, 'Fernhollow CERT', 'people').map((l) => l.name)).toEqual([
      'ACS',
    ])
  })

  it('a record added by hand is in no layer, so no removal names it', () => {
    const layers = recordLayerImport([], imp('Fernhollow CERT', ['a']))
    const removal = removalFor(layers, 'Fernhollow CERT', 'people')
    expect(removal.remove).not.toContain('by-hand')
    expect(removalFor(layers, 'Unknown', 'people')).toEqual({
      remove: [],
      keptShared: [],
    })
  })

  it('a hand-over is not recorded; a blank name is not recorded', () => {
    expect(recordableLayerName({ name: 'Ops 5', kind: 'handover' })).toBe('')
    expect(recordableLayerName({ name: '  ' })).toBe('')
    expect(recordableLayerName(undefined)).toBe('')
    expect(recordableLayerName({ name: ' Fernhollow CERT ' })).toBe('Fernhollow CERT')
  })

  it('prunes uids that left the device and counts the live ones', () => {
    const layers = recordLayerImport([], imp('Fernhollow CERT', ['a', 'b', 'c']))
    const live = new Set(['a', 'c'])
    expect(liveCount(layers[0], live)).toBe(2)
    expect(pruneLayers(layers, 'people', live)[0].uids).toEqual(['a', 'c'])
    expect(pruneLayers(layers, 'places', live)[0].uids).toEqual(['a', 'b', 'c'])
  })

  it('round-trips through storage and shrugs off junk', () => {
    const layers = recordLayerImport([], imp('Fernhollow CERT', ['a']))
    expect(parseLayers(serializeLayers(layers))).toEqual(layers)
    expect(parseLayers('not json')).toEqual([])
    expect(parseLayers(null)).toEqual([])
    const junk: unknown = {
      layers: [
        null,
        { name: 'x', kind: 'bad' },
        { name: '', kind: 'people' },
        { name: 'ok', kind: 'places', uids: ['u', 3] },
      ],
    }
    const parsed = parseLayers(junk) as LayerRecord[]
    expect(parsed.length).toBe(1)
    expect(parsed[0].uids).toEqual(['u'])
  })

  describe('suggestLayerName', () => {
    it('drops the extension and a trailing date', () => {
      expect(suggestLayerName('Fernhollow CERT 2026-10-15.xlsx')).toBe('Fernhollow CERT')
      expect(suggestLayerName('Fernhollow_CERT_2026_10_15.csv')).toBe('Fernhollow CERT')
      expect(suggestLayerName('ACS roster-20261015.xlsx')).toBe('ACS roster')
      expect(suggestLayerName('C:\\docs\\Team D.csv')).toBe('Team D')
      expect(suggestLayerName('shelters 15Oct2026.csv')).toBe('shelters')
    })
    it('can come out blank', () => {
      expect(suggestLayerName('2026-10-15.csv')).toBe('')
    })
  })
})
