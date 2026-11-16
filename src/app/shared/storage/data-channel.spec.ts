import { DATA_CHANNEL, announceWrite, listenForWrites } from './data-channel'
import { recordStore } from './record-store'

/** E-313: the main window announces key names only; a pop-out hears them. */
describe('data channel (E-313)', () => {
  const heard: unknown[] = []
  let spy: BroadcastChannel
  const settle = () => new Promise(resolve => setTimeout(resolve, 60))

  beforeEach(async () => {
    heard.length = 0
    localStorage.clear()
    await recordStore.resetForTests()
    spy = new BroadcastChannel(DATA_CHANNEL)
    spy.onmessage = e => heard.push(e.data)
  })

  afterEach(async () => {
    spy.close()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('a flushed write announces its key, and only its key', async () => {
    recordStore.setItem('radioLog', JSON.stringify({ secret: 'N0CALL 555-0100' }))
    await recordStore.flush()
    await settle()
    expect(heard).toEqual([{ key: 'radioLog' }])
    expect(JSON.stringify(heard)).not.toContain('N0CALL')
  })

  it('a removal announces its key too, and a window with writes off announces nothing', async () => {
    recordStore.setItem('rangers', '{}')
    await recordStore.flush()
    recordStore.removeItem('rangers')
    await recordStore.flush()
    await settle()
    expect(heard).toEqual([{ key: 'rangers' }, { key: 'rangers' }])

    heard.length = 0
    recordStore.useReadOnly()
    recordStore.setItem('rangers', '{"x":1}')
    await recordStore.flush()
    await settle()
    expect(heard).toEqual([])
  })

  it('listenForWrites hands each key to its callback until stopped', async () => {
    const keys: string[] = []
    const stop = listenForWrites(k => keys.push(k))
    announceWrite('locations')
    await settle()
    stop()
    announceWrite('rangers')
    await settle()
    expect(keys).toEqual(['locations'])
  })
})
