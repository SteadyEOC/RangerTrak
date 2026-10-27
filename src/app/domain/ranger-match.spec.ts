import { applyCallsignEdit, callsignEditNotice, matchRanger } from './ranger-match'
import type { RangerType } from '../shared/services/ranger.interface'
import type { RadioLogEntryType } from '../shared/services/radio-log-entry.interface'

const rangers = [
  { uid: 'u-a', callsign: 'K7ABC', fullName: 'Ann Able', id: 'REW-1' },
  { uid: 'u-b', callsign: 'KB7XYZ', fullName: 'Bo Baker', id: 'REW-2' },
  { uid: 'u-c', callsign: '', fullName: 'Cy Carter', id: 'REW-3' },   // unlicensed member
] as RangerType[]

const entryFor = (callsign: string, rangerUid: string, tacticalCall?: string) =>
  ({ id: 7, callsign, rangerUid, tacticalCall } as RadioLogEntryType)

describe('matchRanger', () => {
  it('matches call sign, then name, then ID, ignoring case and spaces', () => {
    expect(matchRanger(rangers, ' kb7xyz ')?.uid).toBe('u-b')
    expect(matchRanger(rangers, 'cy carter')?.uid).toBe('u-c')
    expect(matchRanger(rangers, 'rew-1')?.uid).toBe('u-a')
  })

  it('matches nothing for blank text or a partial call', () => {
    expect(matchRanger(rangers, '  ')).toBeNull()
    expect(matchRanger(rangers, 'K7AB')).toBeNull()
  })
})

describe('applyCallsignEdit (tester report 2026-10-26)', () => {
  it('moves the report to the ranger the new call names', () => {
    const e = entryFor('K7ABC', 'u-a')
    const edit = applyCallsignEdit(e, 'kb7xyz', rangers)
    expect(edit.changed).toBeTrue()
    expect(e.rangerUid).toBe('u-b')
    expect(e.callsign).toBe('KB7XYZ')   // as written on the roster
    expect(edit.ranger?.uid).toBe('u-b')
  })

  it('keeps an unmatched call as typed, with an empty uid', () => {
    const e = entryFor('K7ABC', 'u-a')
    const edit = applyCallsignEdit(e, ' W1NEW ', rangers)
    expect(edit.changed).toBeTrue()
    expect(e.callsign).toBe('W1NEW')
    expect(e.rangerUid).toBe('')
    expect(edit.ranger).toBeNull()
  })

  it('links an unlicensed member by name and records their blank call sign', () => {
    const e = entryFor('K7ABC', 'u-a')
    applyCallsignEdit(e, 'Cy Carter', rangers)
    expect(e.rangerUid).toBe('u-c')
    expect(e.callsign).toBe('')
  })

  it('links a report that had no uid once its call is corrected to a roster call', () => {
    const e = entryFor('K7ABD', '')
    expect(applyCallsignEdit(e, 'K7ABC', rangers).changed).toBeTrue()
    expect(e.rangerUid).toBe('u-a')
  })

  it('reports no change when the same call is re-entered', () => {
    const e = entryFor('K7ABC', 'u-a')
    expect(applyCallsignEdit(e, 'k7abc', rangers).changed).toBeFalse()
    expect(e.callsign).toBe('K7ABC')
  })

  it('leaves the recorded tactical call alone', () => {
    const e = entryFor('K7ABC', 'u-a', 'Vashon EOC')
    applyCallsignEdit(e, 'KB7XYZ', rangers)
    expect(e.tacticalCall).toBe('Vashon EOC')
  })
})

describe('callsignEditNotice (John 10-26)', () => {
  it('says nothing when the new call is on the roster and there is no tactical call', () => {
    const e = entryFor('K7ABC', 'u-a')
    expect(callsignEditNotice(applyCallsignEdit(e, 'KB7XYZ', rangers), e.tacticalCall)).toBeNull()
  })

  it('warns that an unmatched call leaves the report unlinked', () => {
    const e = entryFor('K7ABC', 'u-a')
    expect(callsignEditNotice(applyCallsignEdit(e, 'W1NEW', rangers), e.tacticalCall))
      .toBe("W1NEW isn't on the roster, so this report isn't linked to a ranger.")
  })

  it('says the tactical call stays, alongside the roster warning', () => {
    const e = entryFor('K7ABC', 'u-a', 'Vashon EOC')
    expect(callsignEditNotice(applyCallsignEdit(e, 'W1NEW', rangers), e.tacticalCall))
      .toBe("W1NEW isn't on the roster, so this report isn't linked to a ranger. Its tactical call Vashon EOC stays as recorded.")
  })

  it('says nothing for an edit that changed nothing', () => {
    const e = entryFor('K7ABC', 'u-a', 'Vashon EOC')
    expect(callsignEditNotice(applyCallsignEdit(e, 'k7abc', rangers), e.tacticalCall)).toBeNull()
  })
})
