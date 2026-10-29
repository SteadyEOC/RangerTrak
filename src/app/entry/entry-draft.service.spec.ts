import { EntryDraftService, draftHasContent, type EntryDraft } from './entry-draft.service'

const blank = (): EntryDraft => ({
  callsign: '', to: '', status: 'Normal', notes: '', date: new Date(), source: 'Voice',
  generates213: false, replyRequested213: false, message213: '', recipients213: '', subject213: '',
  selectedRecipients213: [], pendingFiles: [],
})

describe('EntryDraftService (E-261)', () => {
  it('hands a saved draft over once', () => {
    const svc = new EntryDraftService()
    const d = { ...blank(), notes: 'At the trailhead' }
    svc.save(d)
    expect(svc.take()).toBe(d)
    expect(svc.take()).toBeNull()
  })

  it('saving null drops an earlier draft', () => {
    const svc = new EntryDraftService()
    svc.save({ ...blank(), callsign: 'K7ABC' })
    svc.save(null)
    expect(svc.take()).toBeNull()
  })

  it('a form with only defaults has nothing worth keeping', () => {
    expect(draftHasContent(blank())).toBeFalse()
    expect(draftHasContent({ ...blank(), notes: '   ' })).toBeFalse()
  })

  it('who, what, a 213 field or an attachment is worth keeping', () => {
    expect(draftHasContent({ ...blank(), callsign: 'K7ABC' })).toBeTrue()
    expect(draftHasContent({ ...blank(), notes: 'Need water' })).toBeTrue()
    expect(draftHasContent({ ...blank(), subject213: 'Supplies' })).toBeTrue()
    expect(draftHasContent({ ...blank(), selectedRecipients213: ['Logistics'] })).toBeTrue()
    expect(draftHasContent({ ...blank(), pendingFiles: [{} as never] })).toBeTrue()
  })
})
