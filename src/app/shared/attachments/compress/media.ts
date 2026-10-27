import {
  ADTS, BlobSource, BufferTarget, Conversion, FLAC, Input, MATROSKA, MP3, MP4, Mp4OutputFormat, OGG, Output, QTFF,
  Quality, WAVE, WEBM,
} from 'mediabunny'

import { soundChoices } from './can-compress'
import type { SoundChoice } from './can-compress'
import {
  AUDIO_ONLY_BITRATE, CompressCancelledError, VIDEO_AUDIO_BITRATE, VIDEO_BITRATE, VIDEO_MAX_EDGE,
} from './compress-types'
import type { CompressOptions, CompressResult } from './compress-types'
import { smallerCopyTags } from './media-tags'

/** Containers a phone or recorder is likely to hand over. Listing them keeps unused demuxers out of the chunk. */
const FORMATS = [MP4, QTFF, MATROSKA, WEBM, MP3, WAVE, OGG, ADTS, FLAC]

/** Why a track was left out that would silently change the file's content (a missing sound track, say). */
const FATAL = ['unknown_source_codec', 'undecodable_source_codec', 'no_encodable_target_codec', 'cannot_copy']

/** An encoder that reports itself supported but makes no progress for this long is given up on. */
const STALL_MS = 15_000

class StalledError extends Error { }

/**
 * Video or audio into an MP4 through Mediabunny, which drives the browser's WebCodecs encoders
 * (lazy-loaded; nothing here is in the main bundle). Video: H.264, longest side at most 1280 px,
 * about 2.5 Mbps, with its sound at about 96 kbps. Audio-only: mono at about 64 kbps, as `.m4a`.
 * AAC where the browser has it (at 96 kbps if that is its lowest step), else Opus. If an AAC
 * encoder claims support but stalls (seen on a desktop Chrome), the next sound choice is tried.
 * Null when the file cannot be read, a track cannot be carried over (the sound is never dropped
 * quietly), or the conversion fails.
 */
export async function compressMedia(file: Blob, options: CompressOptions = {}): Promise<CompressResult | null> {
  const probe = new Input({ formats: FORMATS, source: new BlobSource(file) })
  let hasVideo: boolean
  try {
    hasVideo = !!(await probe.getPrimaryVideoTrack())
  } finally {
    probe.dispose()
  }
  const choices = await soundChoices(hasVideo ? VIDEO_AUDIO_BITRATE : AUDIO_ONLY_BITRATE, hasVideo ? 2 : 1)
  for (const sound of choices) {
    try {
      return await convert(file, sound, options)
    } catch (e) {
      if (!(e instanceof StalledError)) throw e
    }
  }
  return null
}

async function convert(file: Blob, sound: SoundChoice, options: CompressOptions): Promise<CompressResult | null> {
  const input = new Input({ formats: FORMATS, source: new BlobSource(file) })
  try {
    const video = await input.getPrimaryVideoTrack()
    const longest = video ? Math.max(video.displayWidth, video.displayHeight) : 0
    const shrink = longest > VIDEO_MAX_EDGE
    const landscape = !!video && video.displayWidth >= video.displayHeight
    const target = new BufferTarget()
    // Keyed ('mdta') tags, so the phone's location and camera keys survive (`smallerCopyTags`).
    const output = new Output({ format: new Mp4OutputFormat({ metadataFormat: 'mdta' }), target })

    // A stalled encoder (or a file the demuxer never finishes reading) may never answer cancel(), so
    // the stall is raced against the work rather than waited for.
    let conversion: Conversion | undefined
    let stalled = false
    let giveUp: (e: Error) => void = () => { }
    const stall = new Promise<never>((_, reject) => { giveUp = reject })
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => { stalled = true; conversion?.cancel().catch(() => { }); giveUp(new StalledError()) }, STALL_MS)
    }
    const onAbort = () => void conversion?.cancel().catch(() => { })
    options.signal?.addEventListener('abort', onAbort)
    arm()
    try {
      conversion = await Promise.race([Conversion.init({
        input,
        output,
        video: video
          ? {
            codec: 'avc',
            quality: new Quality({ bitrate: VIDEO_BITRATE }),
            ...(shrink ? (landscape ? { width: VIDEO_MAX_EDGE } : { height: VIDEO_MAX_EDGE }) : {}),
          }
          : { discard: true },
        audio: {
          codec: sound.codec,
          quality: new Quality({ bitrate: sound.bitrate }),
          ...(video ? {} : { numberOfChannels: 1 }),
        },
        tags: smallerCopyTags,
        showWarnings: false,
      }), stall])
      if (!conversion.isValid) return null
      if (conversion.discardedTracks.some(d => FATAL.includes(d.reason) && (d.track.isVideoTrack() || d.track.isAudioTrack()))) {
        return null
      }
      if (options.signal?.aborted) throw new CompressCancelledError()
      conversion.onProgress = p => { arm(); options.onProgress?.(Math.min(1, Math.max(0, p))) }
      await Promise.race([conversion.execute(), stall])
    } catch (e: any) {
      if (stalled) throw new StalledError()
      if (options.signal?.aborted || e?.name === 'ConversionCanceledError') throw new CompressCancelledError()
      throw e
    } finally {
      clearTimeout(watchdog)
      options.signal?.removeEventListener('abort', onAbort)
    }
    if (!target.buffer) return null
    return video
      ? { blob: new Blob([target.buffer], { type: 'video/mp4' }), type: 'video/mp4', ext: 'mp4' }
      : { blob: new Blob([target.buffer], { type: 'audio/mp4' }), type: 'audio/mp4', ext: 'm4a' }
  } finally {
    input.dispose()
  }
}
