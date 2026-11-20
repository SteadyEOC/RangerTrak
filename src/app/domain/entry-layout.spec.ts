import { describe, expect, it } from 'vitest'
import {
  ENTRY_LAYOUTS, entryFromTo, basicEntryTime, entryLayoutOf, missionStationCall, netEntryParties, netMessage, netPartiesLine,
  sendingAsOptions,
} from './entry-layout'

describe('entry-layout', () => {
  it('lists the four layouts in order', () => {
    expect(ENTRY_LAYOUTS.map(l => l.id)).toEqual(['basic', 'net', 'field', 'full'])
  })
  it('reads a missing or unknown layout as full', () => {
    expect(entryLayoutOf({})).toBe('full')
    expect(entryLayoutOf(undefined)).toBe('full')
    expect(entryLayoutOf({ entryLayout: 'net' })).toBe('net')
    expect(entryLayoutOf({ entryLayout: 'bogus' as never })).toBe('full')
  })
  it('puts the caller in From on In and swaps on Out', () => {
    expect(netEntryParties(' W7ABC ', 'in', 'EOC')).toEqual({ from: 'W7ABC', to: 'EOC' })
    expect(netEntryParties('W7ABC', 'out', 'EOC')).toEqual({ from: 'EOC', to: 'W7ABC' })
  })
  it('shows the parties line with dashes for blanks', () => {
    expect(netPartiesLine({ from: 'W7ABC', to: 'EOC' })).toBe('From W7ABC → To EOC')
    expect(netPartiesLine({ from: '', to: 'EOC' })).toBe('From - → To EOC')
  })
  it('saves a blank message as Check-in', () => {
    expect(netMessage('  ')).toBe('Check-in')
    expect(netMessage(' Water at 3 ')).toBe('Water at 3')
  })
  it('builds the Sending as options without blanks or repeats', () => {
    expect(sendingAsOptions('W7EOC', 'w7eoc', ['Net Control', ' ', 'Logistics'])).toEqual(['W7EOC', 'Net Control', 'Logistics'])
    expect(sendingAsOptions('', 'KD7XYZ', [])).toEqual(['KD7XYZ'])
  })
  it('takes the first station call of the mission', () => {
    expect(missionStationCall({ eocCalls: ['', ' W7EOC ', 'W7B'] })).toBe('W7EOC')
    expect(missionStationCall({ eocCalls: [] })).toBe('')
    expect(missionStationCall(null)).toBe('')
    expect(missionStationCall({ winlinkCall: ' ve7vro ', eocCalls: ['W7EOC'] })).toBe('VE7VRO')
    expect(missionStationCall({ winlinkCall: '  ', eocCalls: ['W7EOC'] })).toBe('W7EOC')
  })
  it('reads the basic Time box, falling back to now', () => {
    const now = new Date(2026, 10, 19, 14, 5, 33)
    expect(basicEntryTime('', now).getTime()).toBe(now.getTime())
    expect(basicEntryTime('0930', now)).toEqual(new Date(2026, 10, 19, 9, 30, 0, 0))
    expect(basicEntryTime('9:30', now)).toEqual(new Date(2026, 10, 19, 9, 30, 0, 0))
    expect(basicEntryTime('25:99', now).getTime()).toBe(now.getTime())
  })
  it('shows From and To as separate values, tactical first', () => {
    expect(entryFromTo({ tacticalCall: 'Net Control', callsign: 'W7A', toCallsign: 'W7B' })).toEqual({ from: 'Net Control', to: 'W7B' })
    expect(entryFromTo({ callsign: 'W7A' })).toEqual({ from: 'W7A', to: '' })
  })
})
