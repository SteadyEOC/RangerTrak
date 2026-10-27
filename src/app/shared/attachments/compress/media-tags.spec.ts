import { LOCATION_KEY, smallerCopyTags } from './media-tags'

/** John 2026-10-27: a video or recording's smaller copy keeps its own location and device tags. */
describe('smallerCopyTags', () => {

  it('turns an Android ©xyz location into the keyed location', () => {
    const out = smallerCopyTags({ raw: { '©xyz': '+47.4400-122.4600/', '©mak': 'Pixel', mdat: new Uint8Array([1]) } })
    expect(out.raw).toEqual({ [LOCATION_KEY]: '+47.4400-122.4600/', 'com.apple.quicktime.make': 'Pixel' })
  })

  it('keeps an iPhone\'s keyed tags, which win over a user-data atom', () => {
    const out = smallerCopyTags({ raw: { [LOCATION_KEY]: '+47.1-122.1+010.000/', '©xyz': '+0+0/', 'com.apple.quicktime.model': 'iPhone' } })
    expect(out.raw![LOCATION_KEY]).toBe('+47.1-122.1+010.000/')
    expect(out.raw!['com.apple.quicktime.model']).toBe('iPhone')
  })

  it('passes the ordinary fields through and records the capture date', () => {
    const date = new Date(Date.UTC(2026, 9, 27, 9, 30))
    const out = smallerCopyTags({ title: 'Clip', date })
    expect(out.title).toBe('Clip')
    expect(out.date).toBe(date)
    expect(out.raw!['com.apple.quicktime.creationdate']).toBe(date.toISOString())
  })

  it('adds nothing when there is nothing to keep', () => {
    expect(smallerCopyTags({})).toEqual({})
  })
})
