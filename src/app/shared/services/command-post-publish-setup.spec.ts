import { vi } from 'vitest'

import { CommandPostPublishService } from './command-post-publish.service'

/**
 * E-287: the Setup file upload. The service is built without its constructor (its collaborators are not the point),
 * with just the fields the upload touches, and fetch is mocked.
 */
describe('CommandPostPublishService Setup file (E-287)', () => {
  const sha = 'a'.repeat(64)
  const bytes = new Uint8Array([1, 2, 3])
  const on = { commandPostEnabled: true, commandPostServerUrl: 'https://rangerview.local:8080', boardOfferSetup: true }
  type Internals = {
    settings: unknown, setupFile: unknown, setupUploading: boolean, journal: unknown, log: unknown, id: string,
    noteReached: () => void, noteUnreachable: () => void, uploadSetup: (sha: string, key: string) => Promise<void>,
  }
  let svc: Internals
  let fetchMock: ReturnType<typeof vi.fn>
  let journal: { record: ReturnType<typeof vi.fn> }
  let log: { warn: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    journal = { record: vi.fn() }
    log = { warn: vi.fn() }
    svc = Object.create(CommandPostPublishService.prototype) as Internals
    svc.settings = on
    svc.setupFile = { key: 'k', bytes, sha256: sha, name: 'x-setup.zip' }
    svc.setupUploading = false
    svc.journal = journal
    svc.log = log
    svc.id = 'test'
    svc.noteReached = () => undefined
    svc.noteUnreachable = () => undefined
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('POSTs the zip to /api/setup/<sha> with the key, and notes it in the journal', async () => {
    await svc.uploadSetup(sha, 'the-key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`/api/setup/${sha}`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Board-Key']).toBe('the-key')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/zip')
    expect(init.body).toBe(bytes)
    expect(journal.record).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the fingerprint is not the one held, or the offer is off', async () => {
    await svc.uploadSetup('b'.repeat(64), 'k')
    svc.settings = { ...on, boardOfferSetup: false }
    await svc.uploadSetup(sha, 'k')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logs a refusal and does not journal it', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'no roster' }), { status: 422 }))
    await svc.uploadSetup(sha, 'k')
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(journal.record).not.toHaveBeenCalled()
    expect(svc.setupUploading).toBe(false)
  })

  it('does not throw when RangerView cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(svc.uploadSetup(sha, 'k')).resolves.toBeUndefined()
    expect(svc.setupUploading).toBe(false)
  })
})
