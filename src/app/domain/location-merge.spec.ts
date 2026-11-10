import { MissionLocationType } from '../shared/services/mission-location.interface'
import { mergeLocations } from './location-merge'

/**
 * E-109 Setup files v2 (2026-08-31). mergeLocations() is the additive counterpart to
 * replaceAllLocations() - a Setup file that only carries SOME locations must not discard the
 * rest of the list already on the device. Mirrors ranger-migration.spec.ts's mergeRangers()
 * coverage deliberately - same shape, same cases - minus the ambiguous-match case, which does
 * not apply here: a location has only one match key (`name`), not two.
 */
describe('location-merge', () => {
  function location(
    name: string,
    extra: Partial<MissionLocationType> = {}
  ): MissionLocationType {
    return { name, type: 'Command Post', lat: 47.4, lng: -122.4, ...extra }
  }

  describe('mergeLocations', () => {
    it('appends a location whose name matches nothing already on the device', () => {
      const existing = [location('Command Post', { uid: 'u-cp' })]
      const incoming = [location('Staging Area')]

      const result = mergeLocations(existing, incoming)

      expect(result.locations.length).toBe(2)
      expect(result.locations[0]).toEqual(existing[0])
      expect(result.locations[1].name).toBe('Staging Area')
      expect(result.added).toEqual(['Staging Area'])
      expect(result.overwritten).toEqual([])
    })

    it('overwrites a matching name in place, keeping the EXISTING uid and the array order', () => {
      const existing = [
        location('Command Post', { uid: 'u-cp', lat: 1, lng: 1 }),
        location('Staging Area', { uid: 'u-sa' }),
      ]
      const incoming = [location('Command Post', { lat: 2, lng: 2 })]

      const result = mergeLocations(existing, incoming)

      expect(result.locations.length).toBe(2)
      // Order preserved - the overwritten row stays at index 0.
      expect(result.locations[0].name).toBe('Command Post')
      expect(result.locations[0].lat).toBe(2)
      expect(result.locations[0].uid, 'existing uid kept').toBe('u-cp')
      expect(result.locations[1].name).toBe('Staging Area')
      expect(result.overwritten).toEqual(['Command Post'])
      expect(result.added).toEqual([])
    })

    it('matches EXACT trimmed name only, not case-insensitively', () => {
      // Open judgment call 2: "command post" and "Command Post" are different locations, not
      // the same one typed differently - a real risk either way, exact-trim is the default.
      const existing = [location('Command Post', { uid: 'u-cp' })]
      const incoming = [location('command post')]

      const result = mergeLocations(existing, incoming)

      expect(result.locations.length).toBe(2)
      expect(result.added).toEqual(['command post'])
      expect(result.overwritten).toEqual([])
    })

    it('handles a mixed batch: some added, some overwritten, in one call', () => {
      const existing = [
        location('Command Post', { uid: 'u-cp' }),
        location('Staging Area', { uid: 'u-sa' }),
      ]
      const incoming = [
        location('Command Post', { note: 'moved' }), // overwrite
        location('Aid Station'), // add
      ]

      const result = mergeLocations(existing, incoming)

      expect(result.locations.length).toBe(3)
      expect(result.added).toEqual(['Aid Station'])
      expect(result.overwritten).toEqual(['Command Post'])
    })

    it('does not mutate either input array', () => {
      const existing = [location('Command Post', { uid: 'u-cp' })]
      const incoming = [location('Command Post', { note: 'moved' })]
      const existingSnapshot = JSON.stringify(existing)
      const incomingSnapshot = JSON.stringify(incoming)

      mergeLocations(existing, incoming)

      expect(JSON.stringify(existing)).toBe(existingSnapshot)
      expect(JSON.stringify(incoming)).toBe(incomingSnapshot)
    })

    it('handles an empty incoming list (nothing to merge) without throwing', () => {
      const existing = [location('Command Post', { uid: 'u-cp' })]
      const result = mergeLocations(existing, [])

      expect(result.locations).toEqual(existing)
      expect(result.added).toEqual([])
      expect(result.overwritten).toEqual([])
    })

    // E-187 phase C (ADR D-58 point 6): uid first, then exact name.
    it('matches on uid first: a place renamed in a later layer is updated in place, not added', () => {
      const existing = [
        location('Shelter A', { uid: 'u-1', address: '1 Main St' }),
        location('Fire Stn 1', { uid: 'u-2' }),
      ]
      const incoming = [location('Shelter Alpha', { uid: 'u-1' })]

      const result = mergeLocations(existing, incoming)

      expect(result.locations.length).toBe(2)
      expect(result.locations[0].name).toBe('Shelter Alpha')
      expect(result.locations[0].uid).toBe('u-1')
      expect(result.locations[0].address).toBe('1 Main St') // blank incoming never erases
      expect(result.added).toEqual([])
      expect(result.changes).toEqual([{ name: 'Shelter Alpha', changedFields: ['name'] }])
    })

    it('falls back to the exact name when the uid matches nothing', () => {
      const existing = [location('Shelter A', { uid: 'u-1' })]
      const result = mergeLocations(existing, [location('Shelter A', { uid: 'u-other' })])
      expect(result.locations.length).toBe(1)
      expect(result.locations[0].uid).toBe('u-1')
      expect(result.unchanged).toEqual(['Shelter A'])
    })

    it('reports the uids it wrote or confirmed, added rows included', () => {
      const existing = [location('A', { uid: 'u-a' }), location('B', { uid: 'u-b' })]
      const result = mergeLocations(existing, [
        location('A', { uid: 'u-a' }),
        location('C', { uid: 'u-c' }),
      ])
      expect(result.touchedUids.sort()).toEqual(['u-a', 'u-c'])
    })
  })
})
