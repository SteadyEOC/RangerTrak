import type { MissionType } from '../services/mission.interface'
import type { MissionLocationType } from '../services/mission-location.interface'
import { UnknownRanger } from '../services/ranger.interface'

import { buildCallsignFile } from '../../domain/callsign-setup'
import { buildMissionZipBytes, extractMissionZip } from './mission-zip'
import { buildRangerViewSetupFile, buildSetupManifest, rangerViewSetupSettings, settingsForImport } from './setup-file-build'

describe('setup file build (E-287)', () => {
  const settings = {
    mission: 'Fern Hollow', event: 'Search', opPeriod: '3',
    googleGeocodingApiKey: 'AGENCY-KEY', boardPassword: 'viewers-pw',
    commandPostEnabled: true, commandPostServerUrl: 'https://rangerview.local:8080', boardOfferSetup: true,
  } as unknown as MissionType
  const places = [{ name: 'Command Post', type: 'Command Post', lat: 47.4, lng: -122.4 }] as MissionLocationType[]
  const when = '2026-11-18T10:00:00.000Z'

  it('the RangerView file has settings and places, and no rangers, no photos, no entries', async () => {
    const file = await buildRangerViewSetupFile({ settings, locations: places, appVersion: '0.95.5', exportedAt: when })
    const read = extractMissionZip(file.bytes) // the same reader the phone's Setup file import uses
    expect(read.manifest.settings?.mission).toBe('Fern Hollow')
    expect(read.manifest.settings?.opPeriod).toBe('3')
    expect(read.manifest.locations).toEqual(places)
    expect('rangers' in read.manifest).toBe(false)
    expect('entries' in read.manifest).toBe(false)
    expect(read.photos).toEqual([])
    expect(read.attachments).toEqual([])
    expect(file.name).toBe('Fern_Hollow-setup.zip')
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the agency key, the RangerView password and publishing out of the file', async () => {
    const file = await buildRangerViewSetupFile({ settings, locations: [], appVersion: '0.95.5', exportedAt: when })
    const s = extractMissionZip(file.bytes).manifest.settings!
    expect(s.googleGeocodingApiKey).toBe('')
    expect(s.boardPassword).toBe('')
    expect(s.commandPostEnabled).toBe(false)
    expect(s.commandPostServerUrl).toBe('')
    expect(s.boardOfferSetup).toBe(false)
    expect(rangerViewSetupSettings(settings).mission).toBe('Fern Hollow')
  })

  it('the card manifest still carries rangers when asked, and never the password', () => {
    const m = buildSetupManifest({
      settings, rangers: [{ ...UnknownRanger, callsign: 'K7ABC' }], locations: places,
      layerName: ' Shelters ', suggestedView: 'simple', appVersion: '0.95.5', exportedAt: when,
    })
    expect(m.rangers?.length).toBe(1)
    expect(m.settings?.boardPassword).toBe('')
    expect(m.suggestedView).toBe('simple')
    expect(m.layer?.name).toBe('Shelters')
    expect(m.layer?.sensitivity).toBe('pii')
  })

  it('omits what was not passed', () => {
    const m = buildSetupManifest({ locations: places, suggestedView: '', appVersion: '1', exportedAt: when })
    expect('settings' in m).toBe(false)
    expect('rangers' in m).toBe(false)
    expect('layer' in m).toBe(false)
    expect('suggestedView' in m).toBe(false)
  })
})

describe('settingsForImport (Q118)', () => {
  const mission = (over: Partial<MissionType>) => ({ mission: 'm', googleGeocodingApiKey: '', boardPassword: '', ...over }) as unknown as MissionType

  it("keeps this device's Google key and RangerView password when the file leaves them blank", () => {
    const out = settingsForImport(mission({ mission: 'from file' }), mission({ googleGeocodingApiKey: 'DEVICE-KEY', boardPassword: 'pw' }))
    expect(out.mission).toBe('from file')
    expect(out.googleGeocodingApiKey).toBe('DEVICE-KEY')
    expect(out.boardPassword).toBe('pw')
  })

  it("takes the file's key when it has one", () => {
    const out = settingsForImport(mission({ googleGeocodingApiKey: 'FILE-KEY' }), mission({ googleGeocodingApiKey: 'DEVICE-KEY' }))
    expect(out.googleGeocodingApiKey).toBe('FILE-KEY')
  })

  it('leaves both blank on a device that has none, and does not change the incoming object', () => {
    const incoming = mission({})
    const out = settingsForImport(incoming, undefined)
    expect(out.googleGeocodingApiKey).toBe('')
    expect(out).not.toBe(incoming)
  })

  it('E-328: a Setup file carries the call sign list as its own entry, and one without it has none', async () => {
    const when = '2026-11-18T10:00:00.000Z'
    const manifest = buildSetupManifest({ settings: { mission: 'Fern Hollow' } as unknown as MissionType, appVersion: '0.95.5', exportedAt: when })
    const list = buildCallsignFile({ source: 'fcc', importedAt: when, fileName: 'l_amat.zip', region: 'WA', count: 1 },
      [{ call: 'W7ABC', name: 'Pat Example', city: 'Vashon', region: 'WA' }])
    const withList = extractMissionZip(await buildMissionZipBytes(manifest, [], [], list))
    expect((withList.callsigns as { rows: unknown[] }).rows).toEqual([{ call: 'W7ABC', name: 'Pat Example', city: 'Vashon', region: 'WA' }])
    expect('callsigns' in extractMissionZip(await buildMissionZipBytes(manifest, []))).toBe(false)
    expect(JSON.stringify(withList.manifest)).not.toContain('W7ABC')
  })
})
