import { hasOtherOpPeriod, isCurrentOpPeriod } from './op-period'

const e = (opPeriod: string) => ({ msgNo: { opPeriod } })

describe('op-period (E-234)', () => {
  it('matches the label', () => {
    expect(isCurrentOpPeriod(e('OP 3'), 'OP 3')).toBeTrue()
    expect(isCurrentOpPeriod(e('OP 2'), 'OP 3')).toBeFalse()
  })
  it('trims and ignores case', () => {
    expect(isCurrentOpPeriod(e(' op 3 '), 'OP 3')).toBeTrue()
  })
  it('a blank current label marks nothing', () => {
    expect(isCurrentOpPeriod(e(''), '')).toBeFalse()
    expect(isCurrentOpPeriod(e('OP 3'), '  ')).toBeFalse()
    expect(isCurrentOpPeriod(e('OP 3'), undefined)).toBeFalse()
  })
  it('an entry with no number is not current', () => {
    expect(isCurrentOpPeriod({}, 'OP 3')).toBeFalse()
    expect(isCurrentOpPeriod(undefined, 'OP 3')).toBeFalse()
  })
  it('hasOtherOpPeriod needs a label and a different-period entry', () => {
    expect(hasOtherOpPeriod([e('OP 3'), e('OP 3')], 'OP 3')).toBeFalse()
    expect(hasOtherOpPeriod([e('OP 3'), e('OP 2')], 'OP 3')).toBeTrue()
    expect(hasOtherOpPeriod([e('OP 2')], '')).toBeFalse()
    expect(hasOtherOpPeriod([], 'OP 3')).toBeFalse()
  })
})
