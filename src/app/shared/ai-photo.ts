/**
 * The demo roster's portraits are AI-generated faces (made by the maintainer with
 * thispersondoesnotexist.org - commit 016dace). John asked, 2026-09-26, that this be visible
 * wherever they appear, so nobody takes a demo face for a real person.
 *
 * An explicit list, not "every image a sample scenario uses": CmdPost.jpg is also a demo image
 * but is not an AI face (it dates from 2022). The image files themselves are untouched - the
 * app marks them - and a photo stored on the device by a user never gets the label.
 */
export const AI_GENERATED_PHOTO_FILES: ReadonlySet<string> = new Set([
  'cert1.jpg', 'cert2.jpg', 'cert3.jpg', 'ic-actual.jpg', 'log-chief.jpg', 'medic1.jpg',
  'mert1.jpg', 'ops-chief.jpg', 'pio.jpg', 'plan-chief.jpg', 'recon1.jpg',
])

export const AI_PHOTO_LABEL = 'AI-generated photo, not a real person'

/** True when the photo actually shown is one of the bundled AI faces - never when a
 *  photo stored on this device is shown instead. */
export function isAiGeneratedPhoto(image: string | undefined, usingDevicePhoto = false): boolean {
  return !usingDevicePhoto && !!image && AI_GENERATED_PHOTO_FILES.has(image)
}

/** Wraps an `<img>` HTML string with the small corner "AI" badge when `ai` is true.
 *  Styles: `.rt-ai-photo` / `.rt-ai-badge` in styles/_patterns.scss (global, because these
 *  strings land in AG Grid cells and innerHTML, out of reach of component styles). */
export function withAiBadge(imgHtml: string, ai: boolean): string {
  return ai
    ? `<span class="rt-ai-photo">${imgHtml}<span class="rt-ai-badge" role="img" aria-label="${AI_PHOTO_LABEL}" title="${AI_PHOTO_LABEL}">AI</span></span>`
    : imgHtml
}
