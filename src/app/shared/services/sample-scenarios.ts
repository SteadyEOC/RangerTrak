/**
 * A named demonstration mission a user can pick, so "load the sample mission" isn't limited
 * to one place. DEFAULT_SAMPLE_SCENARIO below is what every picker (Entry, Mission > Danger
 * zone, Rangers) starts on. See SAMPLE_SCENARIOS below for the label/hint shown in each.
 */
export type SampleScenarioId = 'vashon' | 'grand-canyon' | 'state-fair' | 'montecito' | 'oso' | 'near-me'

/**
 * 2026-09-25 (maintainer): Grand Canyon replaces Vashon as the default - a place a national
 * and international audience already knows, where Vashon Island means little outside the
 * Puget Sound. Vashon stays in the list (it is still the original, most-tested scenario).
 * One constant so the three pickers and loadSampleMission()'s own default cannot drift.
 */
export const DEFAULT_SAMPLE_SCENARIO: SampleScenarioId = 'grand-canyon'

export type SampleScenarioOption = {
  id: SampleScenarioId
  label: string
  hint: string
  /** E-213 (AAR 2026-10-19, John 10-20): a demo modeled on a real event links to the best
   *  public overview of what really happened, linked from the demo's name on the demo card. */
  detailsUrl?: string
}

/**
 * F29-?? (2026-09-14, maintainer's own ask): "other areas as an alternative: Grand Canyon,
 * state fair, and one tied to their own coordinates." Every entry point that used to offer a
 * single "Load sample mission" action now offers this list instead, defaulting to
 * DEFAULT_SAMPLE_SCENARIO. Listed default-first.
 *
 * Kept here (not a component) so every picker - Entry, Mission > Danger zone, Rangers - reads
 * the exact same three sentences rather than three hand-copied descriptions drifting apart.
 */
export const SAMPLE_SCENARIOS: ReadonlyArray<SampleScenarioOption> = [
  {
    id: 'grand-canyon',
    label: 'Grand Canyon, South Rim (default)',
    hint: 'An overdue hiker on the Bright Angel Trail, searched down the trail and along the rim.',
  },
  {
    id: 'vashon',
    label: 'Vashon Island, WA',
    hint: 'The original demo: a missing-hiker search across two real Vashon-Maury parks.',
  },
  {
    id: 'state-fair',
    label: 'State fair (Doswell, VA)',
    hint: 'A lost child, heat illness and a crowd-flow incident at the State Fair of Virginia.',
  },
  {
    id: 'montecito',
    label: 'Montecito debris flows, CA (large)',
    // E-195 section 7.1: the approved about line, word for word.
    hint: 'Modeled on the January 9, 2018 debris flows in Montecito, California. The people, teams and '
      + 'messages are invented; the scale, phases and problems follow the public record. About 400 radio '
      + 'log entries, 30 teams and 100 roster rows: a busy mission, not a tidy sample.',
    detailsUrl: 'https://en.wikipedia.org/wiki/2018_Southern_California_mudflows',
  },
  {
    id: 'oso',
    label: 'Oso landslide, WA (large)',
    // E-195 section 7.1, same pattern as Montecito: the approved about line, word for word.
    hint: 'Modeled on the March 22, 2014 SR 530 landslide near Oso, Washington. The people, teams and '
      + 'messages are invented; the scale, phases and problems follow the public record. About 510 radio '
      + 'log entries (51 of them ICS-213 messages), 40 teams and 128 roster rows, with a command post on '
      + 'each side of the slide: a busy mission, not a tidy sample.',
    detailsUrl: 'https://en.wikipedia.org/wiki/2014_Oso_landslide',
  },
  {
    id: 'near-me',
    label: 'Near me',
    hint: 'Generated around this device\'s current location (or the mission default if location '
      + 'isn\'t available). Points are rough walking-distance offsets and may land on water or '
      + 'a building - there\'s no way to know what\'s really there without a real map.',
  },
]
