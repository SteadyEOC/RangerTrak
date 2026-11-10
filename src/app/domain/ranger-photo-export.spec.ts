import {
  extensionForMime,
  photoEntryName,
  photoStem,
  photoStemsFor,
  stemForRanger,
} from './ranger-photo-export'

describe('ranger photo export', () => {
  const has =
    (...stems: string[]) =>
    (s: string) =>
      stems.includes(s)

  it('normalises stems', () => {
    expect(photoStem('  k7abc ')).toBe('K7ABC')
    expect(photoStem(undefined)).toBe('')
  })

  it('prefers the id over the call sign', () => {
    expect(stemForRanger({ id: 'vi-1', callsign: 'k7abc' }, has('VI-1', 'K7ABC'))).toBe(
      'VI-1'
    )
  })

  it('falls back to the call sign when the id has no photo', () => {
    expect(stemForRanger({ id: 'vi-1', callsign: 'k7abc' }, has('K7ABC'))).toBe('K7ABC')
  })

  it('returns null when neither key has a photo or both are blank', () => {
    expect(stemForRanger({ id: 'vi-1', callsign: 'k7abc' }, has())).toBeNull()
    expect(stemForRanger({ id: '', callsign: '' }, has(''))).toBeNull()
  })

  it('lists each photo once, in roster order, skipping rangers without one', () => {
    const rangers = [
      { id: 'A', callsign: 'X1' },
      { id: 'B', callsign: 'X2' },
      { id: 'C', callsign: 'X1' },
      { id: 'D', callsign: 'X4' },
    ]
    expect(photoStemsFor(rangers, has('A', 'X2', 'X1'))).toEqual(['A', 'X2', 'X1'])
    expect(photoStemsFor([], has('A'))).toEqual([])
  })

  it('picks an extension from the MIME type, defaulting to jpg', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime('image/png')).toBe('png')
    expect(extensionForMime('IMAGE/WEBP')).toBe('webp')
    expect(extensionForMime('image/gif')).toBe('gif')
    expect(extensionForMime('application/octet-stream')).toBe('jpg')
    expect(extensionForMime('')).toBe('jpg')
    expect(extensionForMime(undefined)).toBe('jpg')
  })

  it('names the entry <STEM>.<ext>', () => {
    expect(photoEntryName('K7ABC', 'image/png')).toBe('K7ABC.png')
  })
})
