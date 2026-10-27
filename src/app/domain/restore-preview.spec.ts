import { compareForRestore, formatLocalMinute, isNewerVersion, newestEntryTime, parseVersion } from './restore-preview'
import type { RestoreSide } from './restore-preview'

const side = (over: Partial<RestoreSide> = {}): RestoreSide => ({
  mission: 'Fernhollow Drill', exportedAt: '', appVersion: '', entries: [], rangers: 0, places: 0, aarNotes: 0, activityLines: 0, photos: 0, ...over,
})

describe('restore preview (E-198)', () => {
  describe('versions', () => {
    it('reads the numbers and ignores the tag', () => {
      expect(parseVersion('0.99.56-alpha')).toEqual([0, 99, 56])
      expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
      expect(parseVersion('nonsense')).toBeNull()
    })

    it('knows a newer release when it sees one', () => {
      expect(isNewerVersion('0.99.57-alpha', '0.99.56-alpha')).toBeTrue()
      expect(isNewerVersion('0.100.0', '0.99.56-alpha')).toBeTrue()
      expect(isNewerVersion('1.0.0', '0.99.56')).toBeTrue()
      expect(isNewerVersion('0.99.56-alpha', '0.99.56-alpha')).toBeFalse()
      expect(isNewerVersion('0.99.55-alpha', '0.99.56-alpha')).toBeFalse()
      expect(isNewerVersion('', '0.99.56-alpha')).toBeFalse()
      // E-238: the pre-release tag is ordered too.
      expect(isNewerVersion('1.0.0-beta.5', '1.0.0-beta.3')).toBeTrue()
      expect(isNewerVersion('1.0.0-beta.3', '1.0.0-beta.5')).toBeFalse()
      expect(isNewerVersion('1.0.0-beta.10', '1.0.0-beta.2')).toBeTrue()
      expect(isNewerVersion('1.0.0-beta.1', '1.0.0-alpha.9')).toBeTrue()
      expect(isNewerVersion('1.0.0-beta.1', '0.99.96-alpha')).toBeTrue()
      expect(isNewerVersion('1.0.0', '1.0.0-beta.9')).toBeTrue()
      expect(isNewerVersion('1.0.0-beta.9', '1.0.0')).toBeFalse()
      expect(isNewerVersion('1.0.0-beta.2', '1.0.0-beta.2')).toBeFalse()
      expect(isNewerVersion('1.0.0-beta.2', '1.0.0-beta')).toBeTrue()
    })
  })

  describe('newest entry', () => {
    it('finds the latest time among dates, strings and bad values', () => {
      const newest = newestEntryTime([{ date: new Date('2026-10-17T10:00:00Z') }, { date: '2026-10-17T12:30:00Z' }, { date: 'garbage' }, {}])
      expect(newest).toBe(Date.parse('2026-10-17T12:30:00Z'))
      expect(newestEntryTime([])).toBeNull()
      expect(formatLocalMinute(null)).toBe('')
    })
  })

  describe('compareForRestore', () => {
    const device = side({
      entries: [{ uid: 'e1', date: '2026-10-17T10:00:00Z' }, { uid: 'e2', date: '2026-10-17T11:00:00Z' }, { uid: 'e3', date: '2026-10-17T12:00:00Z' }],
      rangers: 12, places: 4, aarNotes: 2, activityLines: 3, photos: 5,
    })
    const file = side({
      mission: 'Last Week', exportedAt: '2026-10-10T09:00:00Z', appVersion: '0.99.50-alpha',
      entries: [{ uid: 'e1', date: '2026-10-10T08:00:00Z' }, { uid: 'z9', date: '2026-10-10T08:30:00Z' }],
      rangers: 10, places: 3, aarNotes: 0, activityLines: 0, photos: 4,
    })

    it('counts the entries on the device that the file lacks, by uid', () => {
      const p = compareForRestore(device, file, '0.99.56-alpha')
      expect(p.notInFile).toBe(2)
      expect(p.notInFileLine).toBe('2 entries on this device are not in the file and will be replaced.')
    })

    it('uses the singular for one', () => {
      const p = compareForRestore(side({ entries: [{ uid: 'a' }, { uid: 'b' }] }), side({ entries: [{ uid: 'a' }] }), '0.99.56-alpha')
      expect(p.notInFileLine).toBe('1 entry on this device is not in the file and will be replaced.')
    })

    it('says so when every entry is also in the file', () => {
      const p = compareForRestore(side({ entries: [{ uid: 'a' }] }), side({ entries: [{ uid: 'a' }, { uid: 'b' }] }), '0.99.56-alpha')
      expect(p.notInFile).toBe(0)
      expect(p.notInFileLine).toBe('Every entry on this device is also in the file.')
    })

    it('lists both columns', () => {
      const rows = Object.fromEntries(compareForRestore(device, file, '0.99.56-alpha').rows.map(r => [r.label, r]))
      expect(rows['Mission']).toEqual({ label: 'Mission', device: 'Fernhollow Drill', file: 'Last Week' })
      expect(rows['Radio log entries']).toEqual({ label: 'Radio log entries', device: '3', file: '2' })
      expect(rows['Rangers (roster)'].device).toBe('12')
      expect(rows['Rangers (roster)'].file).toBe('10')
      expect(rows['Places']).toEqual({ label: 'Places', device: '4', file: '3' })
      expect(rows['After action notes']).toEqual({ label: 'After action notes', device: '2', file: '0' })
      expect(rows['ICS-214 log lines']).toEqual({ label: 'ICS-214 log lines', device: '3', file: '0' })
      expect(rows['Ranger photos']).toEqual({ label: 'Ranger photos', device: '5', file: '4' })
      expect(rows['Made by RangerTrak'].file).toBe('0.99.50-alpha')
      expect(rows['Newest entry'].device).toBe(formatLocalMinute(Date.parse('2026-10-17T12:00:00Z')))
      expect(rows['Newest entry'].file).toBe(formatLocalMinute(Date.parse('2026-10-10T08:30:00Z')))
    })

    it('says an older backup with no photos leaves the photos here alone', () => {
      const p = compareForRestore(device, side({ photos: null }), '0.99.56-alpha')
      expect(p.rows.find(r => r.label === 'Ranger photos')!.file).toContain('not in this file')
    })

    it('warns, without blocking, when the file is from a newer RangerTrak', () => {
      const p = compareForRestore(device, side({ appVersion: '0.99.57-alpha' }), '0.99.56-alpha')
      expect(p.newerVersionWarning).toContain('newer RangerTrak (0.99.57-alpha)')
      expect(p.rows.find(r => r.label === 'Made by RangerTrak')!.file).toBe('made by a newer RangerTrak (0.99.57-alpha)')
      expect(compareForRestore(device, file, '0.99.56-alpha').newerVersionWarning).toBe('')
    })
  })
})
