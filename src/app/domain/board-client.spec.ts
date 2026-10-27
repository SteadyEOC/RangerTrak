import {
  attachmentFields, boardStep, ics213Fields, BoardAttachment, BoardEvent, BoardState, describeAgent, readClaimReply,
  readKeyedReply, replacedMessage, trimThumbs, WRONG_PASSWORD_MESSAGE,
} from './board-client'
import type { AttachmentRef } from './attachments'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function ref(sha256: string, extra: Partial<AttachmentRef> = {}): AttachmentRef {
  return { sha256, name: `${sha256.slice(0, 2)}.jpg`, type: 'image/jpeg', size: 10, addedAt: '2026-10-16T10:00:00Z', addedBy: 'K7ABC', ...extra }
}

/** Plays events through the machine the way the service does, following each `next`. */
function run(start: BoardState, events: BoardEvent[]) {
  let state = start
  const nexts: (string | undefined)[] = []
  for (const e of events) {
    const step = boardStep(state, e)
    state = step.state
    nexts.push(step.next)
  }
  return { state, nexts }
}

describe('board-client state machine (D-61)', () => {
  it('a first claim goes off -> claiming -> publishing, then sends the full snapshot', () => {
    const out = run('off', [{ type: 'start', hasKey: false, wasReplaced: false }, { type: 'claimed' }])
    expect(out.nexts).toEqual(['claim', 'publish'])
    expect(out.state).toBe('publishing')
  })

  it('a device holding a key checks it first, and keeps publishing when it still works', () => {
    const out = run('off', [{ type: 'start', hasKey: true, wasReplaced: false }, { type: 'keyGood' }])
    expect(out.nexts).toEqual(['check', 'publish'])
    expect(out.state).toBe('publishing')
  })

  it('409 unclaimed (a restart) re-claims automatically and publishes again', () => {
    const out = run('publishing', [{ type: 'unclaimed' }, { type: 'claimed' }])
    expect(out.nexts).toEqual(['reclaim', 'publish'])
    expect(out.state).toBe('publishing')
  })

  it('a stored key the restarted server does not know is re-claimed too', () => {
    const out = run('off', [{ type: 'start', hasKey: true, wasReplaced: false }, { type: 'keyUnknown' }, { type: 'claimed' }])
    expect(out.nexts).toEqual(['check', 'reclaim', 'publish'])
    expect(out.state).toBe('publishing')
  })

  it('a re-claim answered 409 claimed means somebody else holds the Board: replaced', () => {
    const out = run('publishing', [{ type: 'unclaimed' }, { type: 'heldByOther' }])
    expect(out.state).toBe('replaced')
    expect(out.nexts[1]).toBeUndefined()
  })

  it('403 replaced stops publishing', () => {
    expect(run('publishing', [{ type: 'replaced' }]).state).toBe('replaced')
  })

  it('Take over claims without reclaim and returns to publishing', () => {
    const out = run('replaced', [{ type: 'takeOver' }, { type: 'claimed' }])
    expect(out.nexts).toEqual(['claim', 'publish'])
    expect(out.state).toBe('publishing')
  })

  it('a device that was replaced stays replaced on restart, and never claims by itself', () => {
    const out = run('off', [{ type: 'start', hasKey: false, wasReplaced: true }])
    expect(out.state).toBe('replaced')
    expect(out.nexts).toEqual([undefined])
  })

  it('Take over only works from replaced', () => {
    expect(boardStep('publishing', { type: 'takeOver' })).toEqual({ state: 'publishing' })
    expect(boardStep('off', { type: 'takeOver' })).toEqual({ state: 'off' })
  })

  it('a refused claim is an error, and turning publishing off always ends in off', () => {
    expect(run('off', [{ type: 'start', hasKey: false, wasReplaced: false }, { type: 'refused' }]).state).toBe('error')
    for (const s of ['claiming', 'publishing', 'replaced', 'error'] as BoardState[]) {
      expect(boardStep(s, { type: 'stop' }).state).toBe('off')
    }
  })

  it('a refused Take over (wrong password) goes back to replaced, not to an error', () => {
    const out = run('replaced', [{ type: 'takeOver' }, { type: 'refused', takeOver: true }])
    expect(out.state).toBe('replaced')
    expect(boardStep('replaced', { type: 'takeOver' }).next).toBe('claim')
  })

  it('a second 409 while already re-claiming does not start a second re-claim', () => {
    const first = boardStep('publishing', { type: 'unclaimed' })
    const second = boardStep(first.state, { type: 'unclaimed' })
    expect(second).toEqual({ state: 'claiming' })
  })

  it('late replies after publishing was switched off change nothing', () => {
    for (const e of [{ type: 'claimed' }, { type: 'unclaimed' }, { type: 'replaced' }, { type: 'heldByOther' }, { type: 'refused' }] as BoardEvent[]) {
      expect(boardStep('off', e).state).toBe('off')
    }
  })
})

describe('board-client replies', () => {
  it('reads a claim', () => {
    expect(readClaimReply(200, { key: 'k1' })).toEqual({ kind: 'ok', key: 'k1' })
  })

  it('reads 409 claimed with and without the holder', () => {
    const by = { mission: 'M', opPeriod: '2', scribe: 'N7XYZ', agent: 'Chrome on Windows' }
    expect(readClaimReply(409, { error: 'claimed', by, at: '2026-10-16T14:02:00Z' }))
      .toEqual({ kind: 'heldByOther', holder: { by, at: '2026-10-16T14:02:00Z' } })
    expect(readClaimReply(409, { error: 'claimed' })).toEqual({ kind: 'heldByOther', holder: {} })
  })

  it('says what to do about a wrong password and about the rate limit', () => {
    expect(readClaimReply(403, { error: 'claimed', needPassword: true })).toEqual({ kind: 'refused', message: WRONG_PASSWORD_MESSAGE })
    const wait = readClaimReply(429, { retryAfter: 42 })
    expect(wait.kind === 'refused' && wait.message).toContain('42 seconds')
  })

  it('reads a keyed reply', () => {
    expect(readKeyedReply(204, undefined)).toEqual({ kind: 'ok' })
    expect(readKeyedReply(200, { state: 'ok' })).toEqual({ kind: 'ok' })
    expect(readKeyedReply(409, { state: 'unclaimed' })).toEqual({ kind: 'unclaimed' })
    expect(readKeyedReply(403, { state: 'replaced' })).toEqual({ kind: 'replaced', holder: {} })
    expect(readKeyedReply(500, null)).toEqual({ kind: 'other', status: 500 })
  })

  it('words the replaced notice, with the holder when the server sent one', () => {
    expect(replacedMessage(undefined)).toBe('Another device publishes to this Board now.')
    const text = replacedMessage({ by: { mission: 'M', opPeriod: '2', scribe: 'N7XYZ', agent: 'Firefox on Linux' } })
    expect(text).toContain('N7XYZ, Firefox on Linux')
  })
})

describe('describeAgent', () => {
  it('uses the client hints when there are any', () => {
    expect(describeAgent('', [{ brand: 'Not A;Brand' }, { brand: 'Chromium' }, { brand: 'Google Chrome' }], 'Windows')).toBe('Chrome on Windows')
    expect(describeAgent('', [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }], 'macOS')).toBe('Edge on macOS')
  })

  it('falls back to the user agent string', () => {
    expect(describeAgent('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox on Linux')
    expect(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1')).toBe('Safari on iOS')
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120 Safari/537 Edg/120')).toBe('Edge on Windows')
    expect(describeAgent('')).toBe('Unknown browser')
  })
})

describe('Board snapshot attachments (D-60 item 6)', () => {
  const thumbs = new Map([[SHA_A, 'data:image/jpeg;base64,AAAA']])

  it('switch off: a count of live references and no array', () => {
    const removed = ref(SHA_B, { removed: { at: '2026-10-16T11:00:00Z', by: 'K7ABC' } })
    const out = attachmentFields({ attachments: [ref(SHA_A), removed] }, false, thumbs)
    expect(out).toEqual({ attachmentCount: 1 })
    expect('attachments' in out).toBe(false)
  })

  it('switch on: live references with a thumbnail where there is one', () => {
    const out = attachmentFields({ attachments: [ref(SHA_A), ref(SHA_B)] }, true, thumbs) as { attachments: BoardAttachment[] }
    expect(out.attachments.map(a => a.sha256)).toEqual([SHA_A, SHA_B])
    expect(out.attachments[0].thumb).toBe('data:image/jpeg;base64,AAAA')
    expect('thumb' in out.attachments[1]).toBe(false)
  })

  it('a smaller copy carries its label; an original carries none; a replaced original is not sent', () => {
    const copy = ref(SHA_B, { compressed: { fromSha256: SHA_A, fromSize: 4_404_019, fromType: 'image/png', at: '2026-10-17T10:00:00Z', by: 'K7ABC', where: 'sender' } })
    const out = attachmentFields({ attachments: [ref(SHA_A), copy] }, true, thumbs) as { attachments: BoardAttachment[] }
    expect('smallerCopy' in out.attachments[0]).toBe(false)
    expect(out.attachments[1].smallerCopy).toBe("Smaller copy, made on K7ABC's phone from 4.2 MB")
    const replaced = ref(SHA_A, { replaced: { at: '2026-10-17T11:00:00Z', by: 'N7XYZ', bySha256: SHA_B } })
    const after = attachmentFields({ attachments: [replaced, { ...copy, compressed: { ...copy.compressed!, where: 'receiver', by: 'N7XYZ' } }] }, true, thumbs) as { attachments: BoardAttachment[] }
    expect(after.attachments.map(a => a.sha256)).toEqual([SHA_B])
    expect(after.attachments[0].smallerCopy).toBe('Smaller copy made by N7XYZ from 4.2 MB; original replaced')
  })

  it('no live attachments adds nothing', () => {
    expect(attachmentFields({}, true, thumbs)).toEqual({})
    expect(attachmentFields({ attachments: [] }, false, thumbs)).toEqual({})
  })

  it('over budget, the oldest report loses its thumbnails first', () => {
    const mk = (sha: string): BoardAttachment => ({ sha256: sha, name: 'x', type: 'image/jpeg', size: 1, thumb: 'x'.repeat(100) })
    const reports = [{ attachments: [mk(SHA_A)] }, { attachments: [mk(SHA_B)] }, { attachments: [mk('c'.repeat(64))] }]
    const dropped = trimThumbs(reports, 250)
    expect(dropped).toBe(1)
    expect(reports[0].attachments[0].thumb).toBeUndefined()
    expect(reports[1].attachments[0].thumb).toBeDefined()
    expect(reports[2].attachments[0].thumb).toBeDefined()
  })

  it('within budget, nothing is dropped', () => {
    const reports = [{ attachments: [{ sha256: SHA_A, name: 'x', type: 'image/jpeg', size: 1, thumb: 'x'.repeat(100) }] }]
    expect(trimThumbs(reports, 1000)).toBe(0)
    expect(reports[0].attachments[0].thumb).toBeDefined()
  })

  it('a budget of zero drops every thumbnail', () => {
    const reports = [{ attachments: [{ sha256: SHA_A, name: 'x', type: 'image/jpeg', size: 1, thumb: 'xx' }, { sha256: SHA_B, name: 'y', type: 'image/jpeg', size: 1, thumb: 'yy' }] }]
    expect(trimThumbs(reports, 0)).toBe(2)
  })
})

describe('Board snapshot ICS-213 messages (E-228 phase 1)', () => {
  it('sends nothing for an entry that is not a 213', () => {
    expect(ics213Fields({ subject213: 'left over', generates213: false })).toEqual({})
    expect(ics213Fields({})).toEqual({})
  })

  it("sends the form's fields, the operator as Approved by, and when it was first printed", () => {
    const out = ics213Fields({
      generates213: true, recipients213: ['Incident Commander', ' ', 'Ops'], subject213: 'Water',
      message213: 'Need 20 gal at Hermit', replyRequested213: true, operator: 'K7ABC',
      printedAt: new Date('2026-10-27T16:05:00Z'),
    })
    expect(out).toEqual({ ics213: {
      to: ['Incident Commander', 'Ops'], subject: 'Water', message: 'Need 20 gal at Hermit',
      replyRequested: true, approvedBy: 'K7ABC', printedAt: '2026-10-27T16:05:00.000Z',
    } })
  })

  it('fills blanks rather than leaving fields out, and drops an unreadable print time', () => {
    expect(ics213Fields({ generates213: true, printedAt: 'not a date' })).toEqual({ ics213: {
      to: [], subject: '', message: '', replyRequested: false, approvedBy: '',
    } })
  })
})
