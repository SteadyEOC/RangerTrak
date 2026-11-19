import { CallsignDirectoryService } from './callsign-directory.service'

// Real IndexedDB (the unit tests run in Chromium). Made-up rows only. The service always cleans up after itself.
const HEADER = 'callsign;first_name;surname;address_line;city;prov_cd;postal_code;'
const noop = () => undefined

describe('CallsignDirectoryService', () => {
  let service: CallsignDirectoryService

  beforeEach(async () => {
    service = new CallsignDirectoryService()
    await service.remove()
    // A fresh instance has not read the (now empty) meta yet.
    service = new CallsignDirectoryService()
  })
  afterEach(async () => { await service.remove() })

  it('has no list at first: lookup says undefined', async () => {
    expect(await service.meta()).toBeNull()
    expect(await service.lookup('VE7AAA')).toBeUndefined()
  })

  it('imports, looks up ignoring suffix and SSID, and removes', async () => {
    const file = new File([[HEADER, 'VE7AAA;PAT;EXAMPLE;1 X;VICTORIA;BC;V8Z1A1;', 'VA7BBB;SAM;SAMPLE;2 X;TORONTO;ON;M5V2T6;'].join('\n')], 'amateur_delim.txt')
    const meta = await service.importFile(file, '', noop)
    expect(meta.count).toBe(2)
    expect(meta.source).toBe('ised')
    expect(await service.lookup('ve7aaa-7')).toEqual({ name: 'Pat Example', city: 'Victoria', region: 'BC' })
    expect(await service.lookup('VE7AAA/P')).not.toBeNull()
    expect(await service.lookup('VE7ZZZ')).toBeNull()
    await service.remove()
    expect(await service.lookup('VE7AAA')).toBeUndefined()
  })

  it('a failed import leaves the old list alone', async () => {
    await service.importFile(new File([[HEADER, 'VE7AAA;PAT;EXAMPLE;1 X;VICTORIA;BC;V8Z1A1;'].join('\n')], 'old.txt'), '', noop)
    await expect(service.importFile(new File(['not;a;list\n1;2;3\n'], 'bad.txt'), '', noop)).rejects.toThrow()
    expect((await service.lookup('VE7AAA'))?.name).toBe('Pat Example')
    // A region that matches nothing is a failure too, not an empty list.
    await expect(service.importFile(new File([[HEADER, 'VA7BBB;SAM;SAMPLE;2 X;TORONTO;ON;M5V2T6;'].join('\n')], 'new.txt'), 'BC', noop)).rejects.toThrow(/No call signs matched/)
    expect((await service.lookup('VE7AAA'))?.name).toBe('Pat Example')
  })

  it('a new import replaces the old list completely', async () => {
    await service.importFile(new File([[HEADER, 'VE7AAA;PAT;EXAMPLE;1 X;VICTORIA;BC;V8Z1A1;'].join('\n')], 'old.txt'), '', noop)
    await service.importFile(new File([[HEADER, 'VA7BBB;SAM;SAMPLE;2 X;TORONTO;ON;M5V2T6;'].join('\n')], 'new.txt'), '', noop)
    expect(await service.lookup('VE7AAA')).toBeNull()
    expect((await service.lookup('VA7BBB'))?.city).toBe('Toronto')
  })
})
