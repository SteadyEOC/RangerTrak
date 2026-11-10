import { RangerType } from '../shared/services/ranger.interface'
import { mergeRangers } from './ranger-migration'
import {
  applyMapping,
  ColumnTarget,
  EXITED_STATUSES,
  exitedStatusLabel,
  guessMapping,
  headerSetKey,
  normalizeHeader,
  parseImportMappings,
  recallMapping,
  rememberMapping,
  rosterToRows,
  rowsToCsv,
} from './roster-sheet'

/** roster-example.csv (made-up Fernhollow people), inline. */
const EXAMPLE: string[][] = [
  ['Ranger ID', 'Call Sign', 'Full Name', 'Phone', 'Team', 'Role', 'Notes'],
  [
    'DM-0001',
    'WZ0HAZ',
    'Hazel Winterbourne',
    '555-0101',
    'Fernhollow EOC',
    'EOC manager',
    'ICS-300',
  ],
  [
    'DM-0002',
    'KZ0OF',
    'Ollie Fogbank',
    '555-0102',
    'Fernhollow Radio Club',
    'Net control',
    'General class. Was WZ0OLF before a vanity call',
  ],
  [
    'DM-0004',
    '',
    'Gus Underbrush',
    '555-0104',
    'Fernhollow CERT',
    'North loop',
    'Not a ham: no call sign',
  ],
  [
    'DM-0005',
    '',
    'Wanda Woodsy',
    '555-0105',
    'Fernhollow CERT',
    '',
    'Temporary worker (TEW)',
  ],
  [
    'DM-0006',
    'WZ0CHP',
    'Chip Trailblaze',
    '555-0106',
    'Fernhollow Radio Club',
    'Mobile relay',
    'Technician class',
  ],
  [
    'DM-0009',
    '',
    'Sunny Skipper',
    '',
    'Fernhollow MRC',
    'First-aid post',
    'EMT. No phone on file',
  ],
  [
    'DM-0016',
    'WZ0IVY',
    'Ivy Loudhailer',
    '555-0103',
    'Fernhollow EOC',
    'Public information',
    '',
  ],
  [
    '',
    'WZ0DAN',
    'Dana Fernbrook',
    '555-0111',
    'Fernhollow Radio Club',
    '',
    'No ID yet: call sign only, until check-in',
  ],
]

function map(headers: string[], idLabel?: string): ColumnTarget[] {
  return guessMapping(headers, idLabel).targets
}

describe('roster-sheet (E-187, ADR D-58)', () => {
  describe('normalizeHeader', () => {
    it('lower-cases and strips punctuation, spaces and a BOM', () => {
      expect(normalizeHeader('REW #')).toBe('rew')
      expect(normalizeHeader('ID (REW)')).toBe('idrew')
      expect(normalizeHeader('﻿Call Sign')).toBe('callsign')
    })
  })

  describe('guessMapping', () => {
    it('maps every id alias, including the mission label', () => {
      for (const h of [
        'Ranger ID',
        'ID',
        'REW',
        'REW#',
        'REW ID',
        'ID (REW)',
        'DSW',
        'DSW#',
        'Member #',
        'Member ID',
        'Badge',
        'Credential',
      ]) {
        expect(map([h]), h).toEqual(['id'])
      }
      expect(map(['Volunteer No.'])).toEqual(['ignore'])
      expect(map(['Volunteer No.'], 'Volunteer No.')).toEqual(['id'])
    })

    it('maps the call sign, name, phone, team, role and note aliases', () => {
      for (const h of ['Call Sign', 'Callsign', 'Call', 'Ham Call', 'Amateur Call'])
        expect(map([h])).toEqual(['callsign'])
      for (const h of ['Full Name', 'Name', 'Licensee'])
        expect(map([h])).toEqual(['fullName'])
      for (const h of ['Phone', 'Cell', 'Cell Phone', 'Mobile'])
        expect(map([h])).toEqual(['phone'])
      expect(map(['Home Phone'])).toEqual(['homePhone'])
      for (const h of [
        'Team',
        'Group',
        'Organization',
        'Organization Name',
        'Affiliation',
        'Agency',
      ])
        expect(map([h])).toEqual(['team'])
      for (const h of ['Role', 'Position', 'Assignment'])
        expect(map([h])).toEqual(['role'])
      for (const h of ['Notes', 'Note', 'Comments', 'Qualifications'])
        expect(map([h])).toEqual(['note'])
      expect(map(['uid'])).toEqual(['uid'])
      for (const h of ['First Name', 'First', 'Given'])
        expect(map([h])).toEqual(['firstName'])
      for (const h of ['Last Name', 'Last', 'Surname'])
        expect(map([h])).toEqual(['lastName'])
    })

    it('ignores Last Contact, Image and Photo on the way in, and counts them as understood', () => {
      const g = guessMapping(['Last Contact', 'Image', 'Photo'])
      expect(g.targets).toEqual(['ignore', 'ignore', 'ignore'])
      expect(g.unrecognised).toEqual([])
    })

    it('never maps Status or Exit Date, but reports the Status column', () => {
      const g = guessMapping(['Name', 'Status', 'Exit Date'])
      expect(g.targets).toEqual(['fullName', 'ignore', 'ignore'])
      expect(g.statusColumn).toBe(1)
      expect(guessMapping(['Name']).statusColumn).toBeNull()
    })

    it('marks address and e-mail columns as not stored', () => {
      const g = guessMapping([
        'Name',
        'Street Address',
        'City',
        'State',
        'Zip',
        'E-mail',
        'Email Address',
      ])
      expect(g.targets).toEqual([
        'fullName',
        'ignoreNotStored',
        'ignoreNotStored',
        'ignoreNotStored',
        'ignoreNotStored',
        'ignoreNotStored',
        'ignoreNotStored',
      ])
    })

    it('lets the first of duplicate headers win and ignores the rest', () => {
      expect(map(['Phone', 'Phone', 'Cell'])).toEqual(['phone', 'ignore', 'ignore'])
    })

    it('prefers the plain "First Name" over "First Name (REW)"', () => {
      expect(map(['First Name (REW)', 'First Name', 'Last Name'])).toEqual([
        'ignore',
        'firstName',
        'lastName',
      ])
    })

    it('keeps every note column', () => {
      expect(map(['Notes', 'Qualifications'])).toEqual(['note', 'note'])
    })

    it('reports columns it did not recognise', () => {
      expect(guessMapping(['Name', 'Shoe size']).unrecognised).toEqual([1])
    })
  })

  describe('applyMapping', () => {
    it('imports the example with no manual mapping and mints a uid per row', () => {
      const { rangers, skipped, warnings } = applyMapping(
        EXAMPLE,
        guessMapping(EXAMPLE[0])
      )
      expect(rangers.length).toBe(8)
      expect(skipped).toBe(0)
      expect(warnings).toEqual([])
      expect(rangers[0]).toEqual(
        expect.objectContaining({
          id: 'DM-0001',
          callsign: 'WZ0HAZ',
          fullName: 'Hazel Winterbourne',
          phone: '555-0101',
          team: 'Fernhollow EOC',
        })
      )
      expect(rangers.every((r) => !!r.uid)).toBe(true)
      expect(rangers[7].id).toBe('')
    })

    it('drops fully blank rows quietly and a row with no identity with a warning', () => {
      const h = ['Ranger ID', 'Call Sign', 'Full Name']
      const rows = [
        h,
        ['', '', ''],
        ['  ', '', ''],
        ['DM-1', '', 'A'],
        ['', '', ''],
        ['', 'K1', 'B'],
      ]
      const r = applyMapping(rows, guessMapping(h))
      expect(r.rangers.length).toBe(2)
      expect(r.warnings).toEqual([])
      expect(r.skipped).toBe(0)

      const bad = applyMapping(
        [
          ['ID', 'Phone'],
          ['', '555-0000'],
        ],
        guessMapping(['ID', 'Phone'])
      )
      expect(bad.rangers).toEqual([])
      expect(bad.skipped).toBe(1)
      expect(bad.warnings[0]).toContain('Row 2')
    })

    it('combines first and last name only when there is no full-name column', () => {
      const h = ['First Name', 'Last Name', 'Call Sign']
      expect(
        applyMapping([h, ['Ann', 'Lee', 'K1']], guessMapping(h)).rangers[0].fullName
      ).toBe('Ann Lee')
      const h2 = ['Full Name', 'First Name', 'Last Name']
      expect(
        applyMapping([h2, ['Ann B. Lee', 'Ann', 'Lee']], guessMapping(h2)).rangers[0]
          .fullName
      ).toBe('Ann B. Lee')
    })

    it('uses the home phone only when there is no phone column, and joins note columns', () => {
      const h = ['Name', 'Home Phone', 'Notes', 'Qualifications']
      const r = applyMapping([h, ['Ann', '555-1', 'n1', 'q1']], guessMapping(h))
        .rangers[0]
      expect(r.phone).toBe('555-1')
      expect(r.note).toBe('n1; q1')
      const h2 = ['Name', 'Cell', 'Home Phone']
      expect(
        applyMapping([h2, ['Ann', '555-2', '555-3']], guessMapping(h2)).rangers[0].phone
      ).toBe('555-2')
    })

    it('skips Exited rows when asked, and only then', () => {
      const h = ['Name', 'Call Sign', 'Status', 'Exit Date']
      const rows = [h, ['Ann', 'K1', 'Active', ''], ['Bob', 'K2', 'Exited', '2024-01-01']]
      const g = guessMapping(h)
      expect(
        applyMapping(rows, g, { skipExited: true }).rangers.map((r) => r.callsign)
      ).toEqual(['K1'])
      expect(applyMapping(rows, g, { skipExited: true }).skipped).toBe(1)
      expect(applyMapping(rows, g, {}).rangers.length).toBe(2)
    })

    it('never takes address or e-mail values into a ranger', () => {
      const h = ['Name', 'Street Address', 'Email']
      const r = applyMapping([h, ['Ann', '1 Fern Rd', 'a@x.org']], guessMapping(h))
        .rangers[0]
      expect(JSON.stringify(r)).not.toContain('Fern Rd')
      expect(JSON.stringify(r)).not.toContain('a@x.org')
    })

    it('keeps a uid the file carries', () => {
      const h = ['Name', 'uid']
      expect(applyMapping([h, ['Ann', 'u-123']], guessMapping(h)).rangers[0].uid).toBe(
        'u-123'
      )
    })
  })

  describe('headerSetKey and remembered mappings', () => {
    it('is stable across case and punctuation, and skips blank headings', () => {
      expect(headerSetKey(['Call Sign', '', 'REW #'])).toBe(
        headerSetKey(['call-sign', 'rew'])
      )
    })

    it('remembers, recalls, caps at 20 oldest-out, and reads bad JSON as empty', () => {
      let m = parseImportMappings(null)
      expect(m).toEqual({})
      expect(parseImportMappings('{not json')).toEqual({})
      expect(parseImportMappings('[1,2]')).toEqual({})
      expect(parseImportMappings('{"a":["nonsense"]}')).toEqual({})
      m = rememberMapping(m, headerSetKey(['Name', 'Cell']), ['fullName', 'phone'])
      expect(recallMapping(m, ['NAME', 'cell'])).toEqual(['fullName', 'phone'])
      expect(recallMapping(m, ['Name', 'Cell', 'Extra'])).toBeNull()
      for (let i = 0; i < 25; i++) m = rememberMapping(m, `k${i}`, ['ignore'])
      expect(Object.keys(m).length).toBe(20)
      expect(m['k0']).toBeUndefined()
      expect(m['k24']).toBeDefined()
    })
  })

  describe('rosterToRows / rowsToCsv', () => {
    it('round-trips: the export maps with zero manual changes and merges as all unchanged', () => {
      const imported = applyMapping(EXAMPLE, guessMapping(EXAMPLE[0])).rangers
      const rows = rosterToRows(imported, 'ID')
      const g = guessMapping(rows[0], 'ID')
      expect(g.unrecognised).toEqual([])
      expect(g.targets).toEqual([
        'id',
        'callsign',
        'fullName',
        'phone',
        'team',
        'role',
        'note',
        'uid',
      ])

      const again = applyMapping(rows, g).rangers
      const merge = mergeRangers(imported, again)
      expect(merge.added).toEqual([])
      expect(merge.overwritten).toEqual([])
      expect(merge.unchanged.length).toBe(imported.length)
    })

    it('uses the mission label as the id heading and quotes CSV cells properly', () => {
      const rangers: RangerType[] = [
        {
          uid: 'u1',
          id: 'REW-0001',
          callsign: 'K1',
          fullName: 'Lee, Ann "AJ"',
          phone: '555',
          image: '',
          team: '',
          role: '',
          note: 'a\nb',
        },
      ]
      const rows = rosterToRows(rangers, 'REW #')
      expect(rows[0][0]).toBe('REW #')
      const csv = rowsToCsv(rows)
      expect(csv).toContain('"Lee, Ann ""AJ"""')
      expect(csv.endsWith('\r\n')).toBe(true)
    })

    it('Export changes adds a leading change column; removed rows carry just the uid', () => {
      const a: RangerType = {
        uid: 'u1',
        id: 'X-1',
        callsign: 'K1',
        fullName: 'A',
        phone: '',
        image: '',
        team: '',
        role: '',
        note: '',
      }
      const b: RangerType = { ...a, uid: 'u2', callsign: 'K2' }
      const rows = rosterToRows([], 'ID', {
        changes: { added: [a], edited: [b], removed: ['u3'] },
      })
      expect(rows[0][0]).toBe('change')
      expect(rows.slice(1).map((r) => r[0])).toEqual(['added', 'edited', 'removed'])
      expect(rows[3].slice(1, 8).every((c) => c === '')).toBe(true)
      expect(rows[3][rows[0].length - 1]).toBe('u3')
      expect(guessMapping(rows[0]).unrecognised).toEqual([])
    })
  })
})

/** testing/roster-county-export-example.csv (made-up Fernhollow people), inline. */
const COUNTY: string[][] = [
  [
    'Status',
    'Last Name',
    'First Name',
    'Member #',
    'Program',
    'Call',
    'Cell',
    'Email',
    'Home Address',
    'Last Training',
  ],
  [
    'Active',
    'Winterbourne',
    'Hazel',
    'DM-0001',
    'EOC',
    'WZ0HAZ',
    '(555) 010-0101',
    'hazel.w@example.org',
    '12 Mossgate Ln',
    '2026-03-14',
  ],
  [
    'Active',
    'Fogbank',
    'Ollie',
    'DM-0002',
    'Radio Club',
    'KZ0OF',
    '555.010.0102',
    'ollie@example.org',
    '4 Lantern Hill Rd',
    '2025-11-02',
  ],
  [
    'Active',
    'Underbrush',
    'Gus',
    'DM-0004',
    'CERT',
    '',
    '555-010-0104',
    '',
    '88 Cedar Hollow Way',
    '2026-05-20',
  ],
  [
    'Active',
    'Woodsy',
    'Wanda',
    'DM-0005',
    'CERT',
    '',
    '555-010-0105',
    'wanda.woodsy@example.org',
    '',
    '2026-05-20',
  ],
  [
    'Exited',
    'Pinecrest',
    'Carl',
    'DM-0006',
    'CERT',
    '',
    '555-010-0106',
    'carl.p@example.org',
    '9 Ridgeback Ct',
    '2023-09-09',
  ],
  [
    'Active',
    'Skipper',
    'Sunny',
    'DM-0009',
    'MRC',
    'WZ0CHP',
    '',
    'sunny@example.org',
    '31 Driftwood Ave',
    '2026-01-11',
  ],
  ['Active', 'Ivybridge', 'Ivy', '', 'CERT', 'WZ0IVY', '555-010-0111', '', '', ''],
  [
    'Active',
    'Dandelion',
    'Dan',
    'DM-0012',
    'Radio Club',
    'WZ0DAN',
    '555-010-0112',
    'dan.d@example.org',
    '7 Fernhollow Sq',
    '2025-08-30',
  ],
  [
    'Active',
    'Thistlewood',
    'Tess',
    'DM-0014',
    'CERT',
    'WZ0TES',
    '555-010-0114',
    'tess@example.org',
    '15 Bramble Rd',
    '2026-04-04',
  ],
]

describe('roster-sheet: exited statuses', () => {
  it('names every status it skips, in one label', () => {
    expect(exitedStatusLabel()).toBe(
      'Exited, Inactive, Retired, Resigned, Terminated, Former, Removed or Left'
    )
    for (const s of EXITED_STATUSES) expect(exitedStatusLabel()).toContain(s)
  })

  it('skips each listed status (and "Exit") but not an active one', () => {
    const skip = (status: string) =>
      applyMapping(
        [
          ['Status', 'Call Sign'],
          [status, 'K1'],
        ],
        guessMapping(['Status', 'Call Sign']),
        { skipExited: true }
      ).skipped
    for (const s of [...EXITED_STATUSES, 'Exit', 'inactive']) expect(skip(s), s).toBe(1)
    expect(skip('Active')).toBe(0)
  })
})

describe('roster-sheet: a county-style export', () => {
  it('maps Member #, names, Program (as team), Call and Cell; keeps address and e-mail out', () => {
    const m = guessMapping(COUNTY[0])
    expect(m.targets).toEqual([
      'ignore',
      'lastName',
      'firstName',
      'id',
      'team',
      'callsign',
      'phone',
      'ignoreNotStored',
      'ignoreNotStored',
      'ignore',
    ])
    expect(m.statusColumn).toBe(0)
  })

  it('adds 8 rangers and skips the Exited one', () => {
    const { rangers, skipped } = applyMapping(COUNTY, guessMapping(COUNTY[0]), {
      skipExited: true,
    })
    expect(rangers.length).toBe(8)
    expect(skipped).toBe(1)
    expect(rangers.some((r) => r.fullName.includes('Pinecrest'))).toBe(false)
    expect(rangers[0].fullName).toBe('Hazel Winterbourne')
    expect(rangers[0].team).toBe('EOC')
  })

  it('reads Program, Unit, Section, Division and Squad as the team', () => {
    for (const h of [
      'Program',
      'Unit',
      'Section',
      'Division',
      'Squad',
      'Group',
      'Affiliation',
      'Agency',
    ]) {
      expect(map([h]), h).toEqual(['team'])
    }
  })
})
