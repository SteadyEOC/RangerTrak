import { PDFDocument } from 'pdf-lib'

import { fillIcs213Pdf, ICS213_FIELDS } from './ics213-pdf'

/**
 * These fill the REAL bundled template (`assets/forms/ics-213.pdf`), fetched exactly as a
 * caller would in the browser - not a hand-built stand-in PDF - so a field-name typo or a
 * template swap that silently changed the form's own AcroForm names shows up here, not only
 * once someone opens a printed 213 and finds it blank.
 */
describe('fillIcs213Pdf', () => {
  let templateBytes: Uint8Array

  beforeAll(async () => {
    const res = await fetch('/assets/forms/ics-213.pdf')
    templateBytes = new Uint8Array(await res.arrayBuffer())
  })

  // E-168: an exercise's 213 is stamped EXERCISE; an ordinary one must stay byte-for-byte as before.
  it('stamps EXERCISE only when asked (E-168)', async () => {
    const fields = { '4 Subject': 'Road collapse' }
    const plain = await fillIcs213Pdf(templateBytes, fields)
    const stampedOff = await fillIcs213Pdf(templateBytes, fields, true, false)
    const stamped = await fillIcs213Pdf(templateBytes, fields, true, true)

    expect(stampedOff.length).toBe(plain.length)
    // Helvetica-Bold is embedded and a box + text are drawn, so the stamped file is larger.
    expect(stamped.length).toBeGreaterThan(plain.length)
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(1)
  })

  it('fetched the real template, not an empty/missing response', () => {
    expect(templateBytes.length).toBeGreaterThan(1000)
  })

  it('writes every value to its named field and leaves the rest blank', async () => {
    const filled = await fillIcs213Pdf(templateBytes, {
      '2 To Name and Position': 'K7VMI, Net Control',
      '3 From Name and Position': 'ACS1, Radio Team Alpha',
      '4 Subject': 'Road collapse, SW 116th St',
      '7 Message': 'Partial road collapse, one lane only. Advise reroute.',
    }, /* flatten */ false)

    const reloaded = await PDFDocument.load(filled)
    const form = reloaded.getForm()

    expect(form.getTextField('2 To Name and Position').getText()).toBe('K7VMI, Net Control')
    expect(form.getTextField('3 From Name and Position').getText()).toBe('ACS1, Radio Team Alpha')
    expect(form.getTextField('4 Subject').getText()).toBe('Road collapse, SW 116th St')
    expect(form.getTextField('7 Message').getText())
      .toBe('Partial road collapse, one lane only. Advise reroute.')

    // Not passed in - must stay untouched, not filled with '' vs left genuinely unset either
    // way is fine, but it must not have picked up a stray value from another field.
    expect(form.getTextField('1 Incident Name Optional').getText() || '').toBe('')
    expect(form.getTextField('5 Date').getText() || '').toBe('')
  })

  it('never writes the reply/signature block - that is the recipient\'s to fill by hand', () => {
    // Deliberately not in the exported field list at all, so passing one is a compile error,
    // not a silent no-op - this asserts the type-level guard actually matches the real form.
    const guarded = ['9 Reply', '10 Replied by Name', 'Signature_19', 'Signature_20']
    expect(ICS213_FIELDS.some(f => guarded.includes(f))).toBeFalse()
  })

  it('flattening burns the values in and removes the form - result still a valid, loadable PDF', async () => {
    const filled = await fillIcs213Pdf(templateBytes, { '4 Subject': 'Flatten check' })

    const reloaded = await PDFDocument.load(filled)
    expect(reloaded.getForm().getFields().length)
      .withContext('flatten() should leave no live form fields behind')
      .toBe(0)
  })

  it('round-trips text containing newlines, matching a multi-line radio-dictated message', async () => {
    const message = 'Line one of the message.\nLine two, continued.'
    const filled = await fillIcs213Pdf(templateBytes, { '7 Message': message }, false)

    const reloaded = await PDFDocument.load(filled)
    expect(reloaded.getForm().getTextField('7 Message').getText()).toBe(message)
  })

  it('drops the template\'s sample/instructions page - only the filled form is printed', async () => {
    expect((await PDFDocument.load(templateBytes)).getPageCount())
      .withContext('the bundled template is expected to be 2 pages; this test is meaningless otherwise')
      .toBe(2)

    const filled = await fillIcs213Pdf(templateBytes, { '4 Subject': 'Page trim check' })

    const reloaded = await PDFDocument.load(filled)
    expect(reloaded.getPageCount()).toBe(1)
  })
})
