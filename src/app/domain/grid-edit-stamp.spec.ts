import { describe, expect, it } from 'vitest'
import { stampRevisedIfChanged } from './grid-edit-stamp'

describe('stampRevisedIfChanged (E-282)', () => {
  const now = new Date('2026-11-11T10:00:00Z')

  it('stamps revisedAt when the value really changed', () => {
    const e: { revisedAt?: Date } = {}
    expect(stampRevisedIfChanged(e, 'old', 'new', now)).toBe(true)
    expect(e.revisedAt).toBe(now)
  })

  it('does not stamp when the value is the same, compared as strings', () => {
    const e: { revisedAt?: Date } = {}
    expect(stampRevisedIfChanged(e, 3, '3', now)).toBe(false)
    expect(stampRevisedIfChanged(e, null, '', now)).toBe(false)
    expect(e.revisedAt).toBeUndefined()
  })

  it('tolerates a missing row', () => {
    expect(stampRevisedIfChanged(undefined, 'a', 'b')).toBe(false)
  })
})
