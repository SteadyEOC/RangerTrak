import { noteIsLong, popupNotesBlock, POPUP_NOTE_CHARS } from './entry-popup-notes'

describe('popupNotesBlock (Q14.4: Notes in the Map popup)', () => {
  it('returns null for missing or blank notes', () => {
    expect(popupNotesBlock(undefined)).toBeNull()
    expect(popupNotesBlock('   \n ')).toBeNull()
  })

  it('shows a short note in full, with no More button', () => {
    const block = popupNotesBlock('Tree down on Bank Rd')!
    expect(block.textContent).toBe('Tree down on Bank Rd')
    expect(block.querySelector('button')).toBeNull()
  })

  it('treats notes as text, never markup', () => {
    const block = popupNotesBlock('<img src=x onerror=alert(1)> lot flooded')!
    expect(block.querySelector('img')).toBeNull()
    expect(block.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('clamps a long note and expands it with More, folds it with Less', () => {
    let resized = 0
    const block = popupNotesBlock('x'.repeat(POPUP_NOTE_CHARS + 1), () => resized++)!
    const text = block.querySelector<HTMLElement>('.rt-popup-notes__text')!
    const more = block.querySelector<HTMLButtonElement>('button')!
    expect(more.textContent).toBe('More')
    expect(text.style.overflow).toBe('hidden')

    more.click()
    expect(more.textContent).toBe('Less')
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(text.style.overflow).toBe('auto')

    more.click()
    expect(more.textContent).toBe('More')
    expect(text.style.overflow).toBe('hidden')
    expect(resized).toBe(2)
  })

  it('counts many short lines as long', () => {
    expect(noteIsLong('a\nb\nc')).toBe(false)
    expect(noteIsLong('a\nb\nc\nd')).toBe(true)
  })
})
