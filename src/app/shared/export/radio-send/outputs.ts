/**
 * E-307: turns a RadioPayload into the bytes and text each route needs, using the emcomm-forms writers.
 * The library is passed in (the dialog loads it with a dynamic import), so this file never pulls it into
 * the eager bundle and a spec can hand in the real module.
 */
import type * as EmcommForms from 'emcomm-forms'
import type { RadioPayload } from './mapping'

export type Forms = typeof EmcommForms

export interface RadioOutputs {
  /** What Copy text and the preview show, and what goes in the message body. */
  text: string
  /** Size of the text in bytes, i.e. what a radio link carries. */
  bytes: number
  /** True when characters had to be changed to plain letters to fit. */
  folded: boolean
}

export const SLOW_HF_BYTES_PER_SECOND = 300

/** "about 12 seconds" / "about 3 minutes"; a rough guide, never a promise. */
export function transferEstimate(bytes: number): string {
  const s = Math.max(1, Math.round(bytes / SLOW_HF_BYTES_PER_SECOND))
  return s < 90 ? `about ${s} second${s === 1 ? '' : 's'}` : `about ${Math.round(s / 60)} minutes`
}

/** The plain text, in ASCII (it pastes into any radio program), with whether anything was folded. */
export function buildText(forms: Forms, p: RadioPayload): RadioOutputs {
  const r = forms.writePlainText({ title: p.title, fields: p.fields, body: p.body }, { charset: 'us-ascii' })
  return { text: r.text, bytes: r.bytes.length, folded: r.folded }
}

/** The Winlink message body text in Latin-1, for the Pat outbox file. */
export function buildB2fBody(forms: Forms, p: RadioPayload): { text: string, folded: boolean } {
  const r = forms.writePlainText({ title: p.title, fields: p.fields, body: p.body }, { charset: 'iso-8859-1' })
  return { text: r.text, folded: r.folded }
}

export interface B2fInput {
  call: string
  to: readonly string[]
  cc: readonly string[]
  subject: string
  at: Date
}

/** A Pat outbox message: `<MID>.b2f` name and bytes. */
export function buildB2f(forms: Forms, p: RadioPayload, i: B2fInput): { name: string, bytes: Uint8Array } {
  const mid = forms.generateMid((n: number) => crypto.getRandomValues(new Uint8Array(n)))
  const bytes = forms.writeB2f({
    mid, date: i.at, from: i.call, mbo: i.call, to: i.to, cc: i.cc,
    subject: forms.asciiFold(i.subject), body: buildB2fBody(forms, p).text,
  })
  return { name: `${mid}.b2f`, bytes }
}

/** The Save Data text for the form's Load Data button (UTF-8, no BOM; give it a .txt name). */
export function buildSaveData(forms: Forms, p: RadioPayload): { text: string, bytes: Uint8Array } | null {
  if (!p.saveData) return null
  const text = forms.writeSaveData(p.saveData.formId, p.saveData.values)
  return { text, bytes: forms.encodeUtf8(text) }
}

/** The FLMSG file: text (LF) and the extension FLMSG uses for it. */
export function buildFlmsg(forms: Forms, p: RadioPayload, call: string, at: Date, version?: string): { text: string, ext: string } {
  const text = forms.writeFlmsg({
    form: p.flmsg.form, fields: p.flmsg.fields, ...(p.flmsg.rows ? { rows: p.flmsg.rows } : {}),
    ...(call ? { sentBy: { call, date: at } } : {}), ...(version ? { version } : {}),
  })
  return { text, ext: forms.flmsgExtension(p.flmsg.form) }
}
