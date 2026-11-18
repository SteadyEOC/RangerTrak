import { describe, expect, it } from 'vitest'
import { duplicateNotes, duplicateStationsPhrase, duplicateSummarySentence, findPossibleDuplicates } from './possible-duplicates'
import type { MsgNo } from './msg-no'

const no = (station: string, seq: number): MsgNo => ({ mission: 'M', opPeriod: 'OP 1', station, seq })
const at = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00`)
const e = (station: string, seq: number, hhmm: string, callsign = 'K7ABC', tacticalCall?: string) =>
  ({ msgNo: no(station, seq), date: at(hhmm), callsign, tacticalCall })

describe('findPossibleDuplicates (E-306)', () => {
  it('pairs the same call under different stations within five minutes', () => {
    const b = e('B', 4, '14:30'), c = e('C', 12, '14:32')
    const pairs = findPossibleDuplicates([c, b])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].a).toBe(b)
    expect(pairs[0].b).toBe(c)
  })
  it('matches call signs ignoring case and spaces', () => {
    expect(findPossibleDuplicates([e('B', 1, '14:30', ' k7abc '), e('C', 1, '14:31', 'K7ABC')])).toHaveLength(1)
  })
  it('matches on tactical call when the call signs differ', () => {
    expect(findPossibleDuplicates([e('B', 1, '14:30', 'K7AAA', 'Team 1'), e('C', 1, '14:31', 'K7BBB', 'team 1')])).toHaveLength(1)
  })
  it('does not pair blank calls', () => {
    expect(findPossibleDuplicates([e('B', 1, '14:30', ''), e('C', 1, '14:31', '  ')])).toHaveLength(0)
  })
  it('ignores the same station letter', () => {
    expect(findPossibleDuplicates([e('B', 1, '14:30'), e('B', 2, '14:31')])).toHaveLength(0)
  })
  it('ignores entries more than five minutes apart, keeps exactly five', () => {
    expect(findPossibleDuplicates([e('B', 1, '14:30'), e('C', 1, '14:36')])).toHaveLength(0)
    expect(findPossibleDuplicates([e('B', 1, '14:30'), e('C', 1, '14:35')])).toHaveLength(1)
  })
  it('ignores unnumbered entries and different calls', () => {
    expect(findPossibleDuplicates([{ date: at('14:30'), callsign: 'K7ABC' }, e('C', 1, '14:31')])).toHaveLength(0)
    expect(findPossibleDuplicates([e('B', 1, '14:30', 'K7AAA'), e('C', 1, '14:31', 'K7BBB')])).toHaveLength(0)
  })
  it('does not change its input', () => {
    const list = [e('C', 1, '14:31'), e('B', 1, '14:30')]
    findPossibleDuplicates(list)
    expect(list[0].msgNo!.station).toBe('C')
  })
})

describe('duplicate wording (E-306)', () => {
  const pairs = findPossibleDuplicates([e('B', 4, '14:30'), e('C', 12, '14:32')])
  it('names the other number and time on each side', () => {
    const notes = duplicateNotes(pairs)
    expect(notes.get(pairs[0].a)![0].msgNo).toBe('C012')
    expect(notes.get(pairs[0].b)![0].msgNo).toBe('B004')
  })
  it('lists the stations', () => {
    expect(duplicateStationsPhrase(pairs)).toBe('B and C')
    const three = findPossibleDuplicates([e('A', 1, '14:30'), e('B', 1, '14:31'), e('C', 1, '14:32')])
    expect(duplicateStationsPhrase(three)).toBe('A, B and C')
  })
  it('makes the summary sentence', () => {
    expect(duplicateSummarySentence(pairs)).toBe('1 possible duplicate (heard at B and C)')
    expect(duplicateSummarySentence([])).toBe('')
  })
})
