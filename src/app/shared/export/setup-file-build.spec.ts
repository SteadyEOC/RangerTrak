import type { MissionType } from '../services/mission.interface'
import type { MissionLocationType } from '../services/mission-location.interface'
import { UnknownRanger } from '../services/ranger.interface'

import { extractMissionZip } from './mission-zip'
import { buildRangerViewSetupFile, buildSetupManifest, rangerViewSetupSettings } from './setup-file-build'

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
