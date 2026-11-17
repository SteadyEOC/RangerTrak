import { UndoHistory } from './undo-history'

describe('UndoHistory (E-301)', () => {
  it('steps back and forward through recorded changes', () => {
    const h = new UndoHistory<string>()
    h.reset('')
    h.record('a'); h.record('ab'); h.record('abc')
    expect(h.undo()).toBe('ab')
    expect(h.undo()).toBe('a')
    expect(h.redo()).toBe('ab')
    expect(h.canRedo).toBe(true)
  })

  it('a new change after undo drops the redo steps', () => {
    const h = new UndoHistory<string>()
    h.reset('')
    h.record('a'); h.record('b')
    h.undo()
    h.record('c')
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toBe('a')
  })

  it('ignores a snapshot equal to the current one', () => {
    const h = new UndoHistory<{ x: number }>()
    h.reset({ x: 1 })
    expect(h.record({ x: 1 })).toBe(false)
    expect(h.canUndo).toBe(false)
  })

  it('keeps at most N undo steps', () => {
    const h = new UndoHistory<number>(3)
    h.reset(0)
    for (let i = 1; i <= 10; i++) h.record(i)
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual([9, 8, 7, undefined])
  })

  it('reset starts over', () => {
    const h = new UndoHistory<number>()
    h.reset(0); h.record(1); h.reset(5)
    expect([h.canUndo, h.canRedo, h.undo()]).toEqual([false, false, undefined])
  })
})
