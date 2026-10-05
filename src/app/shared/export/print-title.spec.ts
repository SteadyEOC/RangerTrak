import { armPrintTitle, printStamp, printTitle } from './print-title'

describe('print-title (E-172)', () => {
  const when = new Date(2026, 9, 2, 11, 9, 30)

  it('stamps local date and 24-hour time with no colon', () => {
    expect(printStamp(when)).toBe('2026-10-02 1109')
    expect(printStamp(new Date(2026, 0, 5, 0, 7))).toBe('2026-01-05 0007')
  })

  it('leads with the event name, else the incident number, else RangerTrak', () => {
    expect(printTitle('Map', { event: 'Missing Person Exercise', mission: 'X-1' }, when)).toBe('Missing Person Exercise - Map - 2026-10-02 1109')
    expect(printTitle('ICS-309', { event: ' ', mission: 'X-1' }, when)).toBe('X-1 - ICS-309 - 2026-10-02 1109')
    expect(printTitle('Roster', undefined, when)).toBe('RangerTrak - Roster - 2026-10-02 1109')
  })

  it('removes characters a Windows file name cannot hold', () => {
    expect(printTitle('Map', { event: 'Drill: A/B "C"' }, when)).not.toMatch(/[\/:*?"<>|]/)
  })

  it('sets the title on beforeprint and restores it on afterprint', () => {
    const original = document.title
    armPrintTitle('Map', { event: 'Drill' })
    window.dispatchEvent(new Event('beforeprint'))
    expect(document.title).toMatch(/^Drill - Map - \d{4}-\d{2}-\d{2} \d{4}$/)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.title).toBe(original)
    window.dispatchEvent(new Event('beforeprint')) // disarmed after the print: a later Ctrl+P is left alone
    expect(document.title).toBe(original)
  })
})
