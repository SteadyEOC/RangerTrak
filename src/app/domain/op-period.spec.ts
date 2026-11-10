import { hasOtherOpPeriod, isCurrentOpPeriod } from './op-period'

const e = (opPeriod: string) => ({ msgNo: { opPeriod } })

describe('op-period (E-234)', () => {
  it('matches the label', () => {
    expect(isCurrentOpPeriod(e('OP 3'), 'OP 3')).toBe(true)
    expect(isCurrentOpPeriod(e('OP 2'), 'OP 3')).toBe(false)
  })
  it('trims and ignores case', () => {
    expect(isCurrentOpPeriod(e(' op 3 '), 'OP 3')).toBe(true)
  })
  it('a blank current label marks nothing', () => {
    expect(isCurrentOpPeriod(e(''), '')).toBe(false)
    expect(isCurrentOpPeriod(e('OP 3'), '  ')).toBe(false)
    expect(isCurrentOpPeriod(e('OP 3'), undefined)).toBe(false)
  })
  it('an entry with no number is not current', () => {
    expect(isCurrentOpPeriod({}, 'OP 3')).toBe(false)
    expect(isCurrentOpPeriod(undefined, 'OP 3')).toBe(false)
  })
  it('hasOtherOpPeriod needs a label and a different-period entry', () => {
    expect(hasOtherOpPeriod([e('OP 3'), e('OP 3')], 'OP 3')).toBe(false)
    expect(hasOtherOpPeriod([e('OP 3'), e('OP 2')], 'OP 3')).toBe(true)
    expect(hasOtherOpPeriod([e('OP 2')], '')).toBe(false)
    expect(hasOtherOpPeriod([], 'OP 3')).toBe(false)
  })
})
