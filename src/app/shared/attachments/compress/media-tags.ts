import type { MetadataTags } from 'mediabunny'

/** The key Apple, Google Photos and ExifTool read a video's location from, as an ISO 6709 string. */
export const LOCATION_KEY = 'com.apple.quicktime.location.ISO6709'

/** QuickTime user-data atoms (Android and older cameras) and the keyed names they become. */
const UDTA_TO_KEY: Record<string, string> = {
  '©xyz': LOCATION_KEY,
  '©mak': 'com.apple.quicktime.make',
  '©mod': 'com.apple.quicktime.model',
  '©swr': 'com.apple.quicktime.software',
}

/**
 * The tags for a video or recording's smaller copy (John 2026-10-27: keep the metadata wherever it
 * technically can be). Mediabunny reads a phone's location, but left to itself it drops raw tags
 * between .mov and .mp4, and writes `©xyz` where no viewer looks for it. So the copy is written in
 * the keyed ('mdta') form, and every text tag a phone keys by reverse-DNS name (`com.apple.*`,
 * `com.android.*`) is carried, with the old user-data atoms renamed to their keyed equivalents.
 * The ordinary fields (title, date and so on) pass through as they are.
 */
export function smallerCopyTags(input: MetadataTags): MetadataTags {
  const { raw, ...rest } = input
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    const text = asText(value)
    if (text === undefined) continue
    // A keyed name read from the file wins over one renamed from a user-data atom, whichever comes first.
    if (key.includes('.')) out[key] = text
    else if (UDTA_TO_KEY[key] && !(UDTA_TO_KEY[key] in out)) out[UDTA_TO_KEY[key]] = text
  }
  if (rest.date && !out['com.apple.quicktime.creationdate']) out['com.apple.quicktime.creationdate'] = rest.date.toISOString()
  return Object.keys(out).length ? { ...rest, raw: out } : rest
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined
  return undefined
}
