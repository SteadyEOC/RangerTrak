import {
  EXERCISE_CONTROLLER,
  formatScenarioTime,
  isScenarioEntry,
  localFromScenarioInstant,
  readScenarioClock,
  sameScenarioClock,
  scenarioInstantFromLocal,
  scenarioLabelAt,
  scenarioOffsetExplanation,
  scenarioTimeAt,
} from './scenario'

describe('scenario (E-196, D-66)', () => {
  describe('isScenarioEntry', () => {
    it('is true only for a merged entry from the exercise controller', () => {
      expect(isScenarioEntry({ sourceUid: 'x:1', operator: EXERCISE_CONTROLLER })).toBe(
        true
      )
    })
    it('is false when typed here (no sourceUid)', () => {
      expect(isScenarioEntry({ operator: EXERCISE_CONTROLLER })).toBe(false)
      expect(isScenarioEntry({ sourceUid: '', operator: EXERCISE_CONTROLLER })).toBe(
        false
      )
    })
    it('is false for a merged entry from someone else', () => {
      expect(isScenarioEntry({ sourceUid: 'x:1', operator: 'Pat' })).toBe(false)
      expect(isScenarioEntry({ sourceUid: 'x:1' })).toBe(false)
    })
  })

  describe('scenario time', () => {
    const clock = {
      realAt: '2026-10-21T09:12:00.000Z',
      scenarioAt: '2018-01-14T14:12:00.000Z',
    }
    it('is real time plus the offset', () => {
      const real = Date.parse(clock.realAt)
      expect(scenarioTimeAt(clock, real)).toBe(Date.parse(clock.scenarioAt))
      expect(scenarioTimeAt(clock, real + 90 * 60000)).toBe(
        Date.parse('2018-01-14T15:42:00.000Z')
      )
      expect(scenarioTimeAt(clock, real - 60000)).toBe(
        Date.parse('2018-01-14T14:11:00.000Z')
      )
    })
    it('formats as date and time, in UTC, zero padded', () => {
      expect(formatScenarioTime(Date.parse('2018-01-14T14:12:00Z'))).toBe(
        'Scenario 14 Jan 14:12'
      )
      expect(formatScenarioTime(Date.parse('2018-03-02T05:07:00Z'))).toBe(
        'Scenario 2 Mar 05:07'
      )
      expect(formatScenarioTime(NaN)).toBe('')
    })
    it('labels a clock at a real moment, or nothing', () => {
      expect(scenarioLabelAt(clock, Date.parse(clock.realAt) + 60000)).toBe(
        'Scenario 14 Jan 14:13'
      )
      expect(scenarioLabelAt(undefined, 0)).toBe('')
    })
    it('explains the offset', () => {
      const real = new Date(2026, 9, 21, 9, 12).getTime()
      const c = {
        realAt: new Date(real).toISOString(),
        scenarioAt: '2018-01-14T14:12:00.000Z',
      }
      expect(scenarioOffsetExplanation(c, real)).toBe(
        'Real 09:12 = scenario 14 Jan 14:12. Entry times stay real.'
      )
    })
    it('round-trips a picked local date and time', () => {
      const picked = new Date(2018, 0, 14, 14, 12)
      const iso = scenarioInstantFromLocal(picked)
      expect(iso).toBe('2018-01-14T14:12:00.000Z')
      expect(localFromScenarioInstant(iso).getTime()).toBe(picked.getTime())
    })
  })

  describe('readScenarioClock', () => {
    const good = {
      realAt: '2026-10-21T09:12:00.000Z',
      scenarioAt: '2018-01-14T14:12:00.000Z',
    }
    it('accepts two parseable dates', () => expect(readScenarioClock(good)).toEqual(good))
    it('drops unknown keys', () =>
      expect(readScenarioClock({ ...good, junk: 1 })).toEqual(good))
    it('rejects anything else', () => {
      for (const bad of [
        undefined,
        null,
        5,
        'x',
        [],
        {},
        { realAt: good.realAt },
        { ...good, scenarioAt: 'nope' },
        { ...good, realAt: 12 },
        { realAt: 'bad', scenarioAt: 'worse' },
      ]) {
        expect(readScenarioClock(bad)).toBeUndefined()
      }
    })
  })

  describe('sameScenarioClock', () => {
    const a = {
      realAt: '2026-10-21T09:12:00.000Z',
      scenarioAt: '2018-01-14T14:12:00.000Z',
    }
    it('treats the same offset at a different real moment as the same', () => {
      const b = {
        realAt: '2026-10-21T10:12:00.000Z',
        scenarioAt: '2018-01-14T15:12:00.000Z',
      }
      expect(sameScenarioClock(a, b)).toBe(true)
    })
    it('sees a different offset, and a missing clock', () => {
      expect(sameScenarioClock(a, { ...a, scenarioAt: '2018-01-14T15:12:00.000Z' })).toBe(
        false
      )
      expect(sameScenarioClock(a, undefined)).toBe(false)
      expect(sameScenarioClock(undefined, undefined)).toBe(true)
    })
  })
})
