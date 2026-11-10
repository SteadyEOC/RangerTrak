import {
  bumpHighWater,
  findMsgNoClashes,
  formatMsgNoContextLine,
  formatMsgNoFull,
  formatMsgNoShort,
  MSG_NO_CSV_COLUMNS,
  MsgNo,
  msgNoClashSentence,
  msgNoCsvFields,
  msgNoHighWaterKey,
  nextFreeStation,
  nextHandledMark,
  nextMsgNo,
  numberEntries,
  stationsByUse,
} from './msg-no'

const ctx = { mission: '26-0142', opPeriod: 'OP 1', station: 'A' }
const no = (seq: number, over: Partial<MsgNo> = {}): MsgNo => ({ ...ctx, seq, ...over })

describe('nextMsgNo', () => {
  it('counts 1, 2, 3 within an op period', () => {
    const entries: {
      msgNo?: MsgNo
    }[] = []
    let hw: Record<string, number> = {}
    for (const want of [1, 2, 3]) {
      const n = nextMsgNo(entries, hw, ctx)
      expect(n.seq).toBe(want)
      entries.push({ msgNo: n })
      hw = bumpHighWater(hw, n)
    }
  })

  it('restarts at 1 in a new op period', () => {
    const entries = [{ msgNo: no(1) }, { msgNo: no(2) }]
    expect(nextMsgNo(entries, {}, { ...ctx, opPeriod: 'OP 2' }).seq).toBe(1)
  })

  it('does not reuse the number of a deleted last entry', () => {
    const hw = bumpHighWater({}, no(2))
    expect(nextMsgNo([{ msgNo: no(1) }], hw, ctx).seq).toBe(3)
  })

  it('counts two stations separately', () => {
    const entries = [
      { msgNo: no(1) },
      { msgNo: no(2) },
      { msgNo: no(1, { station: 'B' }) },
    ]
    expect(nextMsgNo(entries, {}, ctx).seq).toBe(3)
    expect(nextMsgNo(entries, {}, { ...ctx, station: 'B' }).seq).toBe(2)
  })

  it('uses the entries when they are ahead of the high-water mark', () => {
    expect(
      nextMsgNo([{ msgNo: no(9) }], { [msgNoHighWaterKey('OP 1', 'A')]: 2 }, ctx).seq
    ).toBe(10)
  })

  it('never lowers a high-water mark', () => {
    const hw = bumpHighWater({ [msgNoHighWaterKey('OP 1', 'A')]: 5 }, no(3))
    expect(hw[msgNoHighWaterKey('OP 1', 'A')]).toBe(5)
  })
})

describe('formatting', () => {
  it('writes the short form with three digits', () => {
    expect(formatMsgNoShort(no(7))).toBe('A007')
    expect(formatMsgNoShort(no(1000))).toBe('A1000')
    expect(formatMsgNoShort(undefined)).toBe('')
  })

  it('writes the full form', () => {
    expect(formatMsgNoFull(no(7, { opPeriod: 'OP 2' }))).toBe('26-0142 / OP 2 / A007')
  })

  it('drops a blank mission or op period with its separator', () => {
    expect(formatMsgNoFull(no(7, { mission: '' }))).toBe('OP 1 / A007')
    expect(formatMsgNoFull(no(7, { opPeriod: ' ' }))).toBe('26-0142 / A007')
    expect(formatMsgNoFull(no(7, { mission: '', opPeriod: '' }))).toBe('A007')
  })

  it('writes the context line without blank parts', () => {
    expect(formatMsgNoContextLine('26-0142', 'OP 2')).toBe(
      'Mission 26-0142 · Op period OP 2'
    )
    expect(formatMsgNoContextLine('', 'OP 2')).toBe('Op period OP 2')
    expect(formatMsgNoContextLine('', '')).toBe('')
  })
})

describe('findMsgNoClashes', () => {
  it('reports the same number on a different uid', () => {
    const local = [{ uid: 'u1', msgNo: no(7) }]
    const incoming = [
      { uid: 'u2', msgNo: no(7) },
      { uid: 'u3', msgNo: no(8) },
    ]
    expect(findMsgNoClashes(local, incoming)).toEqual([
      { msgNo: '26-0142 / OP 1 / A007', uids: ['u1', 'u2'] },
    ])
  })

  it('does not report the same entry', () => {
    expect(
      findMsgNoClashes([{ uid: 'u1', msgNo: no(7) }], [{ uid: 'u1', msgNo: no(7) }])
    ).toEqual([])
  })
})

describe('nextHandledMark', () => {
  it('cycles blank, handled, passed, action, blank', () => {
    expect(nextHandledMark(undefined)).toBe('handled')
    expect(nextHandledMark('handled')).toBe('passed')
    expect(nextHandledMark('passed')).toBe('action')
    expect(nextHandledMark('action')).toBeUndefined()
  })
})

describe('msgNoCsvFields', () => {
  it('has the six columns the export adds', () => {
    expect([...MSG_NO_CSV_COLUMNS]).toEqual([
      'msg_mission',
      'msg_op_period',
      'msg_station',
      'msg_seq',
      'msg_no',
      'handled',
    ])
  })

  it('fills them from the number and the mark', () => {
    expect(msgNoCsvFields({ msgNo: no(7), handled: { mark: 'passed' } })).toEqual({
      msg_mission: '26-0142',
      msg_op_period: 'OP 1',
      msg_station: 'A',
      msg_seq: 7,
      msg_no: '26-0142 / OP 1 / A007',
      handled: 'Passed on',
    })
  })

  it('leaves them blank for an entry with neither', () => {
    expect(Object.values(msgNoCsvFields({}))).toEqual(['', '', '', '', '', ''])
  })
})

describe('msgNoClashSentence', () => {
  it('names one clash in plain words', () => {
    expect(msgNoClashSentence([{ msgNo: '26-0142 / OP 1 / A007' }])).toBe(
      'Two messages are both numbered A007. Check that each device logs as its own station letter.'
    )
  })

  it('names several, and says nothing for none', () => {
    expect(msgNoClashSentence([{ msgNo: 'A007' }, { msgNo: 'OP 1 / A008' }])).toBe(
      'Some messages share a number (A007, A008). Check that each device logs as its own station letter.'
    )
    expect(msgNoClashSentence([])).toBe('')
  })
})

describe('hand-over station letters', () => {
  it('lists the letters in a file, most used first', () => {
    const e = (station: string) => ({ msgNo: no(1, { station }) })
    expect(stationsByUse([e('B'), e('A'), e('B'), {}])).toEqual(['B', 'A'])
  })

  it('offers the next letter not seen', () => {
    expect(nextFreeStation(['A'])).toBe('B')
    expect(nextFreeStation(['A', 'B', 'D'])).toBe('E')
    expect(nextFreeStation([])).toBe('A')
    expect(nextFreeStation(['Z', 'A'])).toBe('B')
  })
})

describe('numberEntries', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 23, h))

  it('numbers in time order, per op period, and keeps the original order', () => {
    const entries = [
      { id: 0, date: at(12) },
      { id: 1, date: at(9) },
      { id: 2, date: at(11), msgNo: no(5) },
      { id: 3, date: at(10) },
    ]
    const r = numberEntries(entries, {
      mission: '26-0142',
      station: 'A',
      opPeriodOf: (e) => (e.date < at(10) ? 'OP 0' : 'OP 1'),
    })
    expect(r.entries.map((e) => e.id)).toEqual([0, 1, 2, 3])
    expect(r.entries.map((e) => formatMsgNoShort(e.msgNo))).toEqual([
      'A007',
      'A001',
      'A005',
      'A006',
    ])
    expect(r.highWater[msgNoHighWaterKey('OP 1', 'A')]).toBe(7)
    expect(r.highWater[msgNoHighWaterKey('OP 0', 'A')]).toBe(1)
  })
})
