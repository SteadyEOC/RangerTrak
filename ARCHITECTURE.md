# RangerTrak Architecture

This document describes the high-level architecture of the RangerTrak application. It is
written for developers and assumes familiarity with Angular, bundling, and the codebase.

*Operators and Emergency Coordinators want [FIELD-GUIDE.md](FIELD-GUIDE.md) instead —
features, and how to prepare a device so the app works when the network doesn't.*

## Mapping engines

> **ADR D-56, accepted 2026-10-05 (John):** Leaflet is the primary engine and MapLibre the
> secondary one. New map features are Leaflet-only unless stated otherwise. MapLibre bugs are
> fixed within reason, when the fix is not hard. Whether to keep, freeze or retire MapLibre is
> not decided until after 1.0. The Entry mini-map is Leaflet-only, at least until 1.0.

RangerTrak ships **two independent map engines**. This is deliberate, not a migration
half-finished: they have genuinely different offline behaviour, and which one is the right
default for the Entry page is settled until 1.0 (see below).

Both engines live under the same `/map` route today (`MapPageComponent`, unified since
E-64) with a toggle between them — the table below used to show them as separate
`/mapLeaflet`/`/map` routes, which stopped being true at that point.

|                      | Leaflet (`LmapComponent`)                                     | MapLibre + PMTiles (`MapLibreComponent`)                              |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Mini-map component   | `MiniMapLeafletComponent`                                       | `MiniMapComponent`                                                      |
| Basemap source       | OpenStreetMap/OpenTopoMap tile servers, over the network        | `src/assets/maps/world-z5-<build>.pmtiles`, bundled in the app, plus a loaded demo's `demo-<scenario>-<build>.pmtiles`, or a scribe-loaded custom `.pmtiles` file |
| Works offline        | Only for areas already viewed or explicitly saved               | **Yes, everywhere** — but only the bundled/loaded archive's own zoom range renders real detail; see the caching caveat below |
| Coverage             | Anywhere in the world                                           | Low-detail (z0–5) worldwide background always; street-level detail in a demo's area while that demo is loaded (E-124, 2026-09-26), or wherever a scribe loads their own `.pmtiles` file |
| Bundle cost          | ~150 kB                                                         | ~950 kB (lazy chunk, loaded with `/map`)                                |
| Clustering           | `leaflet.markercluster`                                         | Native GeoJSON clustering                                               |
| Offline tile caching | `leaflet.offline` — "Save this area for offline use" control (OpenTopoMap only; OSM's own policy forbids bulk saving) | Not needed for the bundled/background layer; a scribe-loaded custom file (`CustomPmtilesService`, Map page's "Load a custom .pmtiles file…") replaces coverage outright instead |

### Which engine powers the Entry page mini-map

> **Decided until 1.0 (ADR D-56, 2026-10-05): Leaflet.** The trade-off below is kept so it can
> be reopened after 1.0 without being rediscovered.

The Entry form has **one** mini-map slot. It currently uses `MiniMapLeafletComponent`
(Leaflet). `MiniMapComponent` (MapLibre) is built and working but not wired into
Entry's template — swapping them is a small change.

The trade-off is **offline capability, not speed**:

- The **MapLibre** mini-map works fully offline from the bundled PMTiles archive, from a
  cold start, with no network and no prior visit to that area — worldwide, at least at
  low (background) detail; see the coverage row above.
- The **Leaflet** mini-map needs OSM tiles from the network. It caches what it has already
  shown (via `leaflet.offline`), so it degrades to blank tiles for any area the operator
  has not previously viewed online.

For an emergency-operations tool — where the realistic failure mode is *the network is
down and the operator is entering a report* — that argues for MapLibre on the Entry page,
which is the one screen an operator uses continuously during a mission.

Load time is **not** a reason to prefer either one. MapLibre is roughly six times larger
than Leaflet, so switching would make the page heavier, not lighter — but since the
mini-map is wrapped in `@defer (on idle)` (see `entry.component.html`), neither engine is
in the initial download, and neither blocks the form from painting.

The cost of switching is street-level detail: the bundled files only have that for the demo
areas, and only while that demo is loaded (plus a low-res world background everywhere), so an
operator working anywhere real would get a background-only map where Leaflet would have shown real
streets given a network — unless a scribe-loaded custom `.pmtiles` file already covers that
area (Map page's "Load a custom .pmtiles file…"). Widening the BUNDLED default further is
tracked as the planned in-app region-download manager (Phase 2 of the offline map coverage
scoping doc).

**Leaflet until 1.0** (D-56). Revisit after 1.0, with this trade-off and the region-download
work in hand.

### Why both engines exist

Google Maps was dropped outright: it requires a paid API key and has no offline story.

Leaflet and MapLibre+PMTiles then deliberately ship **side by side** rather than one
replacing the other. They are not a migration in progress. Each has a real advantage the
other cannot match — Leaflet has worldwide coverage and better cartography but depends on
the network; MapLibre+PMTiles works from a cold start with no connection but only where an
extract has been bundled. Keeping both until real field use shows which serves this
audience better is the point, and Leaflet was given a genuine offline story (`leaflet.offline`,
wired up for real) specifically so the comparison is fair.

### Planned: downloadable map regions

The bundled default is a low-res world background (`world-z5-<build>.pmtiles`) plus one small
street-detail file per demo scenario, fetched only while that demo is loaded and the
Alternative map is open (E-124, 2026-09-26; built by `tools/build-demo-maps.sh`). Broader detailed coverage means
letting users download regions for their own area, and the approach is already settled
from prior art rather than open for invention:

- **Store tiles in OPFS (Origin Private File System), not the Cache API.** The Cache API
  has a hard ~50 MB per-partition cap, which disqualifies it for map data outright — an
  easy trap given the app already uses service-worker caching. OPFS reads a large
  `.pmtiles` file near-instantly without IndexedDB's memory overhead.
- **Target 10–100 MB per downloadable region**; whole-country archives are the wrong unit.
- **Zoom range is the dominant size lever** — z0–18 at country scale is 10–50× larger than
  z6–16. **z8–17 is the practical ground-operations range.**
- **Browser storage is evictable.** `navigator.storage.persist()` is already requested and
  its state surfaced in Settings; that mitigation stays essential here.
- **⚠️ Style resources are a separate problem.** Offline PMTiles plugins typically do *not*
  cache sprites and fonts — the service worker must handle those, or the map renders
  offline with missing icons and labels. Easy to miss until a field test fails.
- **Acquire regions before deployment, over good connectivity.** Large downloads failing
  over cellular is a more common failure than running out of storage.
- **Model the UI on OsmAnd's region-download flow** (zoom out, tap a region, see its size,
  download; separate Local / Downloads / Updates views) rather than designing it fresh.

## Geocoding

Address lookup is a **pluggable provider** (`GEOCODING_PROVIDER`), resolved once at boot in
`app.config.ts`:

- **Nominatim (OpenStreetMap) is the default** and needs no API key, keeping the app usable
  with zero setup. Its usage policy constrains the design: low volume, no per-keystroke
  autocomplete (hence the debounce on the address field), and visible attribution.
- **Google is used only if the user supplies their own key** in Settings, stored in that
  user's `localStorage` — never in the repo or the bundle.

**Geocoding is online-only by nature, and the UI must degrade honestly** — the providers
return an explicit "Address lookup requires Internet" result rather than appearing to fail
silently. Plus Codes and lat/long conversion are computed locally and keep working offline.

That gives the project its offline rule, which is worth stating plainly because it drives
several decisions: **coordinates always, addresses when connected.**

A permanent principle follows from this: **no API key is ever required for core function.**
Any key-requiring capability must be optional, must degrade honestly, and must never block
entering and mapping radio log entries. The current architecture satisfies this on every core
path — coordinates, Plus Codes, both map engines, Nominatim, and export/import are all
keyless.

## Theming: skins, tokens, and what must not vary

Five colour **skins** (`command` — the default — plus `ridgeline`, `nightwatch`, `sagebrush`,
`signal`) are switchable at runtime, in light or dark, and there are two layers to it that
meet at `:root`:

- **`--mat-sys-*`** — emitted by `mat.theme()` in `styles.scss`, called once per skin, each
  scoped to a `:root[data-skin="…"]` selector. This themes Material's own components.
- **`--rt-*`** — 47 tokens in `styles/_tokens.scss`, read by 34 component stylesheets. This
  themes everything Material does not. Values use CSS `light-dark()` rather than a
  `prefers-color-scheme` block, so a single declaration covers both schemes and neither is
  ever undefined.

`SkinService` sets `data-skin` on `<html>`, and **`assets/theme-init.js` sets it again before
Angular boots**, reading `skinChoice`/`themeMode` from `localStorage`. That file exists
because the CSP is `script-src 'self'` with no `'unsafe-inline'` — an inline `<script>` in
`index.html` would be blocked, and without it the app paints the default skin and then flips.

### The rule that is easiest to get wrong

Some tokens vary per skin and some deliberately do not, and putting a value in the wrong
group is a real bug rather than a style preference:

| Group | Varies per skin? | Why |
| --- | --- | --- |
| `--rt-ground/surface/ink/line/chrome` | **Yes** | They *are* the skin. |
| `--rt-accent` | **Yes** | The accent is the operator's chosen palette, and is contrast-checked for text. |
| `--rt-signal` | **No** | The brand orange in RangerTrak's mark. It has to match the favicon, the PWA tile and rangertrak.com, none of which can follow a runtime attribute. |
| `--rt-elapsed-1..7`, `--rt-readiness-*`, `--rt-status-*`, `--rt-notice-*` | **No** | Red means the same thing under every skin. A team that has gone quiet must not read differently because someone picked a different palette. |

`--rt-signal` is **not** an accent. It is 2.99:1 on white and fails as text — use
`--rt-accent` for anything interactive.

### Shared maths belongs beside its tokens, not in a component

The overdue check-in ramp is the worked example. Its band arithmetic now lives in
`domain/overdue.ts` and its colours in `_tokens.scss`, because all three consumers — the
Leaflet map label, the Rangers grid and the Radio Log — need the same answer. It previously
lived *inside* `mapLeaflet.component.ts` with its colours in that component's SCSS, which is
precisely why the two grids showed the same elapsed time as plain text with no warning: the
logic was unreachable from anywhere else.

### Two traps that have already cost time

- **A global class can lose to Leaflet on specificity.** Leaflet builds tooltip DOM itself,
  outside Angular's view encapsulation, so component-scoped rules never match it and a bare
  global `.rt-elapsed--N` ties with Leaflet's own `.leaflet-tooltip` background rule —
  winning or losing by stylesheet load order. `mapLeaflet.component.scss` keeps local
  selectors paired with `.leaflet-tooltip` for exactly this, and reads the shared tokens for
  the values.
- **Never use `var()` inside an SVG that ships as a file.** Renderers that only partly
  understand CSS (librsvg, some PDF and email pipelines) apply the declaration, fail to
  resolve the variable, and drop the attribute rather than falling back — the artwork
  silently disappears. `assets/icons/*.svg` therefore carry plain presentation attributes,
  with a `<style>` block only for motion. Verified against librsvg, where a `var()` fill made
  the mark's waves vanish entirely.

### Brand assets are generated, not hand-edited

`assets/icons/rangertrak-mark.svg` (plus `-animated` and `-tile`) are the masters. Every
raster beside them — `favicon.ico`, `apple-touch-icon.png`, `icon-*.png` — is produced from
those and should be regenerated rather than edited. `favicon.svg` is a deliberately separate,
simplified drawing rather than the mark scaled down: at 16px the full mark's three waves merge
into a smudge and the pin ring closes up.

## Encryption: exports, and now storage too

**Phase 1 shipped in 0.94.0: a mission backup can be encrypted on its way out.** The roster is
the sensitive part (legal names, personal phone numbers, photos, and call signs that resolve
to public licence records), and radio log entries can contain PII about missing persons.

**Phase 2a (E-122) moved where "at rest" lives.** The roster, radio log entries and Places (the storage key and
file-format name stay `locations`) -
`RangerService`, `RadioLogService`, `MissionLocationService` - live in IndexedDB
(`shared/storage/record-store.ts`, database `rangertrak-records`) behind `RecordStore`, a
synchronous in-memory cache over an async IndexedDB store, instead of directly in
`localStorage`. Mission settings (`appSettings`) and every UI-preference key stay on
`localStorage` - they hold no roster PII. That move was storage only, not encryption; it paid
for the async write path Phase 2b below needed.

**Phase 2b (opt-in, shipped): the roster and radio log entries can now be encrypted at rest, on
this device.** Mission → Data safety → **Device encryption** turns it on with a passphrase.
Turned on, `RecordStore` encrypts `rangers`/`radioLog`/`radioLog-BAD` (AES-GCM-256, a fresh IV
per write) right before each IndexedDB write and decrypts right after each read - the
in-memory `Map` every service reads/writes stays plaintext throughout, so no service changed.
Ranger photos (`ranger-photo.service.ts`, a separate database) are encrypted under the same
session key. `locations` and every `localStorage`-only key stay in the clear, unaffected -
see "Design sketch" and "The hard parts" below for why, and `shared/storage/
record-encryption.ts` for the actual primitives (a plaintext marker record with a PBKDF2 salt/
iteration count and an AES-GCM-encrypted verifier; the derived key is a non-extractable
`CryptoKey` held in memory only, for the session).

Turning it on or off, and the plain-DOM passphrase form `main.ts` shows before Angular boots
when the device is locked, are covered in the Help/FIELD-GUIDE copy for operators - this
section stays about the design.

### What shipped (Phase 1)

`shared/crypto/encrypted-file.ts` wraps any JSON payload in a self-describing envelope:
PBKDF2-SHA256 (OWASP's current iteration floor, **stored in the envelope** so it can rise
later without stranding old files), a fresh random salt and IV per file, and AES-GCM-256.

- **Opt-in, per export.** Mission → Back up mission offers a passphrase. **Leaving it blank
  writes the same plain file as before** — that is the default, and plain backups keep
  importing with no passphrase prompt at all.
- **Typed twice when set.** A typo is not discovered until the day someone needs the
  backup, by which point it is unrecoverable.
- **Detected structurally on import**, not by file extension, so a backup renamed in
  transit still opens. The `.rtenc.json` suffix is for humans reading a folder listing.
- **A small plaintext `hint`** (export date, app version) rides outside the ciphertext so a
  locked file is still identifiable.
- **AES-GCM is authenticated**: a tampered or truncated file fails to decrypt rather than
  producing plausible garbage the import path would then try to apply.

The commented-out `crypto-js` fragments in `utility.ts`, `settings.service.ts` and
`ranger.service.ts` are the remains of an earlier attempt and are superseded by this.

### Threat model — decide this first

There is **no server**, so "server breach" is not the threat. What encryption at rest
actually defends against here is narrow, and worth being honest about:

- ✅ **Lost or stolen device** — the realistic case, and the one that justifies the work.
- ✅ **A shared command-post laptop** where another user has access to the browser profile.
- ✅ **Exported files** distributed further than intended.
- ❌ **Not** an attacker who has the app open and unlocked — the key is in memory by
  definition.
- ❌ **Not** malicious code running in the page. Encryption at rest is not a substitute for
  the XSS fix already made on the Log page.

### Design sketch

- **Use the Web Crypto API (`crypto.subtle`), not `crypto-js`.** Done in Phase 1. It is native, audited, and
  already used elsewhere in this codebase for SHA-256. `crypto-js` is currently a
  dependency with **zero live call sites** — every use is commented out. It should be
  removed rather than left implying a capability that does not exist.
- **AES-GCM (256-bit)** for the data; **PBKDF2** with a high iteration count to derive the
  key from an operator passphrase; a random salt per store and a random IV per record,
  stored alongside the ciphertext.
- **The key lives in memory for the session only**, never persisted. Unlocking re-derives
  it from the passphrase.

### The hard parts, in order of cost

1. **`localStorage` is synchronous; Web Crypto is not.** ✅ Paid for by Phase 2a. Every
   service still writes synchronously inside `updateLocalStorageAndPublish()` /
   `updateRadioLogAndPublish()` - but that call now goes through `RecordStore`
   (`shared/storage/record-store.ts`), whose in-memory `Map` is synchronous to the caller
   while the actual IndexedDB write happens on its own async queue behind it. Phase 2b's
   `crypto.subtle.encrypt()` call belongs on that same async side (`RecordStore`'s write
   queue, right before the IndexedDB `put()`) - no service's write path needs to change
   again to make room for it.
2. **A forgotten passphrase destroys the mission record, permanently.** With no server
   there is no escrow and no reset. For a life-safety tool that failure mode may be worse
   than the exposure it prevents, so it must be designed for deliberately: keep encryption
   **opt-in per device**, and require any fresh backup - plain or passphrase-protected,
   either counts - before enabling it, so there is always a way back.
3. **Unlock friction must never land during a callout.** Same rule as the API-key
   principle: surface setup during mission preparedness, not when someone is on the radio
   waiting. A locked app that a scribe cannot open mid-incident is a worse outcome than an
   unencrypted one.
4. **Encrypt selectively.** The roster carries the concentrated risk; settings carry almost
   none. Encrypting the roster (and optionally reports) rather than everything reduces the
   blast radius of a lost passphrase and keeps the app usable if only part is locked.

### Suggested staging

- **Phase 1 — encrypted exports. ✅ Shipped 0.94.0 for the mission backup**, which is the
  file carrying the concentrated risk: it bundles the whole roster *and* the reports, and it
  is the one explicitly designed to move between devices. The roster and log CSV exports are
  **not** covered yet — encrypting those turns a spreadsheet-openable file into an opaque
  blob, which is a different UX question, and the backup already contains that data.
- **Phase 2a — ✅ moved the roster, radio log entries and locations off `localStorage` onto
  IndexedDB** (`RecordStore`, see above) - unencrypted still, but the storage refactor
  encryption needed was now done.
- **Phase 2b — ✅ opt-in encryption at rest**, tied to the IndexedDB migration so the async
  change was paid for once. See above.
- **Phase 3 — per-mission keys**, if agencies ask for separation between missions.

## Business rules: src/app/domain/

2026-10-01: the pure rules the app decides things by (first one: `deriveUsageState` and its
thresholds, E-168; second: `roster-changes.ts`, the import baseline and the changes-since-import diff) live in `src/app/domain/`, one plain TypeScript file per rule set, each with a
table-driven spec. The rule for this folder: **no Angular, Leaflet, DOM or storage imports** -
only data in, answer out - so a rule can be tested without a browser and is never decided in two
places. Services gather the inputs and call the rule. Since 2026-10-05 (ADR D-57, accepted that day; commit
`442b3ba`) ESLint enforces the import rule: the `domain/` boundary rule and its companion
(components reach storage only through services) are errors and gate CI, proven red with probe
files, in `eslint.config.mjs`. The recommended rule sets still only warn.

2026-10-12: the rules that were already pure moved in, one commit each, tests unchanged:
`overdue.ts` (check-in bands), `station-label.ts` (how a station prints), `map-print-layout.ts`
(print sheet geometry), `coordinate.ts` (MGRS/UTM/Maidenhead formats and parsing), the stored-data
migrations (`mission-`, `radio-log-`, `ranger-`, `mission-location-`, `aar-note-migration.ts`) and
the two helpers they need (`json-dates.ts`, `status-color.ts`). The `shared/services` barrel
still re-exports the last two. New rules start here; older ones move when they are touched.

2026-10-15 (E-190, map half): `map-entry-filter.ts` decides what the Leaflet map draws: `selectMapEntries` (all, latest per ranger, needs attention; entries with no ranger key are each kept), `isStatusFlagged`/`flaggedStatuses` (the optional `flagOnMap` on a radio log status, derived from the colour key when absent, so no migration) and `mapFilterChips` (the chip wording on the map and in the print title block). The choices are deliberately not stored, so there is no persisted-state row.

2026-10-27 (naming): the map's saved points are called Places in every screen. Identifiers, the `locations` storage key and the backup/setup file formats keep the old name, and the setup-file reader still accepts it.

2026-10-27 (E-228 phase 1): the Board snapshot carries an optional `ics213` object on a published report (`ics213Fields` in `domain/board-client.ts`: `to`, `subject`, `message`, `replyRequested`, `approvedBy`, `printedAt?`), and `src/command-post-view/index.html` shows the radio log and the ICS-213 messages as two tabs.

2026-10-27 (E-221): `domain/clear-choices.ts` holds the rules for the "What to clear" checkbox dialog (`shared/clear-dialog`). It appears on a demo load, Start a real mission and Delete radio log entries; the services take the set of chosen ids.

2026-10-15 (E-189): `mission-summary.ts` is `summarizeMission`, the numbers behind the Mission summary page (`/summary`, lazy, no menu item): totals, a zero-filled messages-per-bucket series (smallest of 1/2/3/6/12/24 hours giving at most 48 bars), counts by status, team (by `rangerUid`, else call sign), station, operator and source, the needs-attention list (reusing `flaggedStatuses`), and AAR notes grouped by area. It takes `now` as an argument and reads only; the page, the printout and the CSV (`shared/export/mission-summary-csv.ts`) are all computed live and nothing is stored, so there is no persisted-state row. The two charts are inline SVG drawn by the page template (no chart library).

2026-10-15 (E-187 Layers, ADR D-58, phase A): `roster-sheet.ts` is the spreadsheet side of the
roster: guessing which column is which from its heading (`guessMapping`), turning rows into
rangers (`applyMapping`), the remembered-mapping bookkeeping, and the roster back out as rows
(`rosterToRows`, `rowsToCsv`). It takes and returns plain `string[][]`; reading the file is
`shared/import/sheet-reader.ts`, which loads SheetJS with `await import('xlsx')` so it stays out of
the initial bundle (CSV encoding and delimiter sniffing live there too). The merge itself is still
`mergeRangers()` in `ranger-migration.ts`, now with the blank-cell rule (an empty incoming field
keeps the value on the device) and a preview shape (`changedFields`, `unchanged`); the import
preview runs it without saving. The "Import, export & print" panel is `shared/io-panel/`, a
page-agnostic shell that the Rangers page fills with cards (the Map page does the same, below); its colour is the
`--rt-io` token pair, applied by `.rt-io-card` / `.rt-io-zone` in `styles/_patterns.scss`.

2026-10-15 (E-187 Layers, ADR D-58, phase B): `places-file.ts` is the places side, written the same
way: `guessPlaceMapping` / `applyPlaceMapping` for sheets (including Google My Maps' CSV, whose `WKT`
column is `POINT (lng lat)`), `parseGeoJsonPlaces`, `parseKmlPlaces` (the XML parser is passed in, so
the file stays DOM-free; the category is the nearest enclosing `Folder`, which is how My Maps writes
its layers), `planPlacesImport` (spell categories as the mission does, merge, report new categories;
a new place with no category goes to "Other", not the first category, because the range rings centre
on a Command Post), `placesToRows` and `selectPlaces` (by category, then by view). The merge is
`mergeLocations()` in `mission-location-migration.ts`, now with the same blank-cell rule and
`changes` / `unchanged` as `mergeRangers()`; coordinates equal to 5 decimals count as unchanged, so
the app's own export re-imports as all Unchanged. The UI is `map/places-io/` (the two cards inside
`shared/io-panel/`, mounted at the bottom of the Map page) and `map/places-import-dialog/` (mapping
step, then preview; modelled on the Rangers dialog, with no Replace). "Only places in the current map
view" reads `MapEngineService.viewBounds`, a signal the Leaflet component keeps current and clears
when it goes away (offered on Leaflet only, D-56). A KMZ is unzipped with `fflate` in the component.

2026-10-16 (E-187 Layers, ADR D-58, phase C): the device remembers the layers it holds. `domain/layers.ts`
is every rule, pure: `recordLayerImport`, `leftThisLayer` (in the previous version, not in this one, and not
held by another layer of the same kind), `removalFor` (what "Remove this layer" takes out, shared records
kept), `pruneLayers`, `recordableLayerName` (a `layer.kind === 'handover'` file is never a layer, D-59) and
`suggestLayerName` (file name without extension or trailing date). `LayerService` stores the list in the
RecordStore key `layers` (encrypted with the roster, in the mission backup as an optional `layers` field; an
older backup restores with the list pruned to what was restored). Records carry no layer field: a layer
record lists uids, so `RangerType` and `MissionLocationType` are unchanged and a hand-added record is in no
layer. Layer identity is the trimmed, case-insensitive name plus the kind. `mergeLocations()` now matches
`uid` first, then exact name, and returns `touchedUids`; a uid match whose name differs counts `name` as a
changed field. The UI is the `Layer name` field and the "no longer in" radio (default No) in both import
dialogs, and `shared/io-panel/layers-card` (Rangers: people, Map: places). It is all lazy-route code; the
only eager change is the two key names and a dynamic `import()` of `LayerService` in `BackupService`. Not
done: the Setup file card on Mission (formerly the `/prep` page) does not record layers (its preview is a summary, not the per-person one that asks who left), and edits made
on the device after an import are not tracked, so Remove this layer says so.

Setup files are manifest **v3**: an optional `layer` block (`name`, `asOf`, `source?`, `contains`,
`sensitivity`: `pii` whenever rangers are in the file, else `none`), written by the Setup file card (a blank name
writes no block) and by the Map's Export places. Readers accept v1, v2 and v3 and never reject on the
version number, so an older build opens a v3 file and ignores `layer`. An import that finds a name
shows it in its preview and summary.

2026-10-15 (E-188 scribe hand-over, ADR D-59): every radio log entry has a permanent `uid` (a UUID,
`RadioLogEntryType.uid`, minted by `domain/uid.ts`, which `newRangerUid()` also uses). `addRadioLogEntry()`
stamps it; `migrateRadioLog()` backfills it, which is why the radio log schema went 1 -> 2, so an older
backup also backfills on restore. The display `id` is still per device and renumbered by a merge; the
`uid` is the identity. `domain/entry-merge.ts` is `mergeEntries()`, the pure merge (and the per-entry
validation, moved out of `RadioLogService`): it applies a `uidRemap` to `rangerUid`/`toRangerUid`, matches
an incoming entry on `uid` (an entry without one falls back to the E-114 `sourceUid` key, so older Report
Packets dedupe as before) and, on a `uid` match, lets the later `revisedAt` win (updated in place, display
`id` kept; never revised counts as oldest). `mergeRangers()` now also returns `uidRemap` (incoming uid ->
the uid the row ended up with), because a matched walk-up keeps the receiving device's uid and the
sender's entries would otherwise attach to nobody. `RadioLogService.mergeIncomingEntries()` (Report Packet)
and `mergeHandoverEntries()` both call `mergeEntries()`; only the Report Packet path passes a reporter
credential (in a hand-over the operator is the scribe, D-44). The file is a Setup file with an optional
`entries` category, an advisory `context` (mission, event, op period; settings are not carried) and
`layer.kind: "handover"` (`shared/export/handover-file.ts`). A passphrase wraps the zip's bytes in the
same `rangertrak-encrypted-v1` envelope the backup uses (`encryptBytes` / `decryptBytes` beside
`encryptJson` in `shared/crypto/encrypted-file.ts`); a reader tells envelope from zip by content. The UI
is the Hand over card on Radio Log and `radio-log/handover-dialog/` (passphrase, preview, confirm), which
reuses the roster import dialog's stylesheet.

2026-10-16 (E-187 phase D, ADR D-58): the **Print** cards and the end of `/prep`. Rangers' Print roster
and the Map's Print places are print-only blocks in their own pages (class `rt-sheet`, hidden on screen;
`styles.scss` shows the one whose body class, `rt-print-roster` or `rt-print-places`, is set around
`window.print()`, as the ICS-309 does; a `print()` that returns at once defers the cleanup to
`afterprint`, as Print map does). The rows come from `domain/roster-print.ts` (people by team, call-sign
order) and `domain/places-print.ts` (places by category in the mission's order, coordinates through
`formatLatLng`); both are pure and specced. The places sheet carries the live Leaflet map, small, not an
image (tile canvases are cross-origin): `LeafletPrintController.preparePlacesPrint()` sizes the map to its
printed box (`rt-print-places-prep`, screen only), takes off the other places, the radio log entries and
the ranger paths, fits the printed places, waits for the tiles and returns an undo. Its media-change
handler skips Print map's layout (panels, rings, fanning, ticks) while `rt-print-places` is on, so the two
prints cannot collide; Print map's landscape `@page` is its own and is not added. The Map page reaches it
through `MapEngineService.placesPrinter` (null under MapLibre, which prints the list alone, D-56), and the
readout's coordinate format moved there too (`coordFormat`, session only) so the sheet can use it. `/prep`
is a redirect to `/mission#setup-file`: the Setup file card (`mission/sections/setup-file/`) sits in the Data
safety card, exports settings, rangers (with photos) and places, and imports one file at a time with a
what-it-would-do preview (settings replace wholesale, the roster and places merge). The multi-file queue
was dropped. Everything is in lazy routes; the initial bundle did not grow.

## Data stored on the device

Every persisted key, as of 2026-10-01 (E-168a). This is the input to the rc.1 storage freeze
(ADR D-55): any change here restarts that clock. "Backup" means the mission backup file
(`BackupService`); "Encrypted" means encrypted at rest when the operator has turned on a
passphrase (otherwise nothing here is encrypted). When IndexedDB is unavailable (private mode),
the `rangertrak-records` keys fall back to `localStorage` under the same names for that session.

Since 2026-10-13 `npm run check:storage` (`tools/check-storage-inventory.js`, run in CI) holds
this table to the source: every storage key, IndexedDB database and Cache Storage name the code
uses must appear here in backticks, a key the check cannot resolve to a string fails, and a row
whose key has left the source fails. Add the row in the same commit as the key.

| # | Store | Key | Owner | Backup | Encrypted | Migration |
|---|-------|-----|-------|--------|-----------|-----------|
| 1 | localStorage | `appSettings` | `mission.service.ts` | yes (`settings`; the geocoding key only in passphrase-protected backups) | no | `mission-migration.ts`, schema 5, plus backfill on every load |
| 2 | localStorage | `appSettings-BAD` | `mission.service.ts` | no | no | none; quarantine copy of unreadable settings |
| 3 | localStorage | `rangertrak-demo-scenario` | `shared/mapping/demo-map.ts` | no | no | JSON record since E-168a; the old bare scenario id still reads |
| 4 | localStorage | `fieldMode` | `field-mode.service.ts` | no | no | none |
| 5 | localStorage | `skinChoice` | `skin.service.ts` | no | no | none |
| 6 | localStorage | `themeMode` | `theme.service.ts` | no | no | none |
| 7 | localStorage | `entryWelcomeDismissed` | `welcome-panel.service.ts` | no | no | none |
| 8 | localStorage | `printTipShown` | `shared/export/print-tip.ts` | no | no | none |
| 9 | localStorage | `ics213DownloadFallbackExplained` | `shared/export/ics213-print.ts` | no | no | none |
| 10 | localStorage | `updateLastChecked` | `update.service.ts` | no | no | none |
| 11 | localStorage | `lastCoordinateFormat` | `device-prefs.service.ts` | no | no | none |
| 12 | localStorage | `rangertrak.rangers.privacyNoticeDismissed` | `device-prefs.service.ts` | no | no | none |
| 13 | IndexedDB `rangertrak-records` / `kv` | `rangers` | `ranger.service.ts` | yes | yes | `ranger-migration.ts`, schema 1 |
| 13a | IndexedDB `rangertrak-records` / `kv` | `rangersImported` (2026-10-05, import baseline: ranger uid -> field hash, no PII copied) | `ranger.service.ts` (`importBaselineKey`; pure logic in `domain/roster-changes.ts`) | no (deliberately: Restore mission does not write it, or it would hide the edits being looked for) | yes (with the roster) | none; new key. Written by roster import/merge, Setup files and the sample-mission loader; read by Rangers > Import, export & print > Export changes |
| 13b | IndexedDB `rangertrak-records` / `kv` | `layers` (2026-10-16, E-187 phase C: the layers the device holds, one record each: name, kind, as-of, file, imported-at and the uids it brought in) | `shared/services/layer.service.ts` (pure rules in `domain/layers.ts`) | yes (optional `layers` field; an older backup restores without it and the list is pruned to what was restored) | yes (with the roster: the uids tie to PII) | none; new key, schema 1. Written by Import a list on Rangers and Import places on Map when the import is given a layer name; a hand-over (D-59) is never recorded |
| 13c | IndexedDB `rangertrak-records` / `kv` | `importSafetyCopy` (2026-10-18, E-198 phase 1: `{ meta: { takenAt, reason, fileName, appVersion }, payload }`, where `payload` is a whole mission backup of the device taken just before a Restore, Report Packet import or Setup file apply; one level, kept 24 hours, then discarded; holds the whole roster, rule 5) | `shared/services/import-safety.service.ts` (pure rules in `domain/import-safety.ts`) | no (it is a copy of what a backup would hold; Restore and the imports never write it from a file) | yes (with the roster) | none; new key, the payload is the existing backup shape at `MISSION_EXPORT_SCHEMA_VERSION` 1, so no format change. While it exists, its live attachment references count as references for the attachment sweeps (D-60 item 8, amended 2026-10-18). Undo last import (Mission > Data safety) puts it back through `BackupService.importMission()` and deletes it |
| 14 | IndexedDB `rangertrak-records` / `kv` | `radioLog` | `radio-log.service.ts` | yes | yes | `radio-log-migration.ts`, schema 3 (entry `uid`, D-59; entry `msgNo` and the wrapper's `msgNoHighWater`, E-220, ADR D-68: the migration numbers unnumbered entries in time order as station A; entry `handled`, E-218, is optional and needs none) |
| 15 | IndexedDB `rangertrak-records` / `kv` | `radioLog-BAD` | `radio-log.service.ts` | no | yes | none; quarantine copy of an unreadable log |
| 16 | IndexedDB `rangertrak-records` / `kv` | `locations` | `mission-location.service.ts` | yes | no | `mission-location-migration.ts`, schema 1 |
| 17 | IndexedDB `rangertrak-records` / `kv` | `aarNotes` | `aar-note.service.ts` | yes | yes | `aar-note-migration.ts`, schema 2 (E-04 / D-63, 2026-10-20: adds `kind` `aar`/`activity` and the optional edited time `at`; schema 1 reads as all `aar`. ICS-214 activity lines are notes of kind `activity`) |
| 18a | IndexedDB `rangertrak-records` / `kv` | `secrets` (`{ googleGeocodingApiKey, boardPassword }`, 2026-10-01; `boardPassword` added 2026-10-16, D-61) | `mission.service.ts` | yes, as `settings.googleGeocodingApiKey` and `settings.boardPassword`, passphrase-protected backups only (a Setup file carries the geocoding key but never the Board password) | yes | one-time move out of `appSettings` on load; `boardPassword` is a backfilled mission field, no schema bump |
| 18 | IndexedDB `rangertrak-records` / `kv` | `__encryption` | `shared/storage/record-store.ts` | no | no (it is the key marker) | none |
| 19 | IndexedDB `rangertrak-photos` / `photos` | one per ranger (by call sign) | `ranger-photo.service.ts` | yes (`photos`, base64; restoring replaces the device's photos) and in setup files | yes | none |
| 20 | IndexedDB `rangertrak-custom-pmtiles` / `files` | `active` | `custom-pmtiles.service.ts` | no | no | none |
| 21 | IndexedDB `leaflet.offline` / `tileStore` | map tiles | the `leaflet.offline` library | no | no | library's own |
| 22 | Cache Storage `rangertrak-pmtiles-warm` | map file URLs | `shared/mapping/demo-map.ts`, service worker | no | no | pruned by `pruneWarmCache()` |
| 23 | localStorage | `rt-import-mappings` (E-187, 2026-10-15: which spreadsheet column became which roster field, per set of column headings; at most 20, oldest dropped; heading names only, never cell values; phase B: places sheets share the key under a `places:` prefix on the heading set, with their own column words) | `device-prefs.service.ts` (pure logic in `domain/roster-sheet.ts`) | no | no | none; new key, read defensively (bad JSON reads as none) |
| 24 | IndexedDB `rangertrak-attachments` / `originals`, `thumbs` | one per file, keyed by its SHA-256 (E-194, D-60; the bytes exactly as received, or only the smaller copy when the sender chose one - never both - plus a 240 px EXIF-free JPEG thumbnail for images) | `shared/services/attachment-store.service.ts` (pure rules in `domain/attachments.ts`) | the backup JSON carries only the references on each entry; the bytes go in a companion `-attachments.zip`, and in setup files (`attachments/` folder) | yes (same record shape and key as the photos; the keys are plaintext fingerprints) | none; entries gain an optional `attachments` field, no schema bump (`compressed` and `replaced` on a reference are optional too) |
| 25 | localStorage | `rt-board-publisher` (D-61, 2026-10-16: `{ base, key }`, the hidden publish key the Board issued this device at its last claim and the server it belongs to, or `{ replaced: true }` once another device took the Board; replaced by whatever the server returns on each claim) | `device-prefs.service.ts` (used by `command-post-publish.service.ts`; pure rules in `domain/board-client.ts`) | **never** (two devices must never hold one key) | no | none; new key, read defensively (bad JSON reads as none). A secret: never logged |
| 26 | localStorage | `rt-view` and `rt-view-source` (E-207, D-62, 2026-10-19: Simple view or Full view, `simple`/`full`, and who chose it, `default`/`upgrade`/`setup`/`user`, so a Setup file's suggestion never overrides the person; per device, like `fieldMode`) | `view.service.ts` (pure rules in `domain/view.ts`) | **never** (not mission data: a scribe's laptop and a volunteer's phone want different views; not in a hand-over or Report Packet either) | no | none; new keys, read defensively (a missing or unknown value reads as the first-run rule) |
| 27 | IndexedDB `rangertrak-records` / `kv` | `activityLogHeader` (E-04 / D-63, 2026-10-20: the ICS-214 header `{ name, icsPosition, homeAgency, resources[] }`, at most 8 Resources Assigned rows; names people, rule 5) | `shared/services/activity-log-header.service.ts` (pure rules in `domain/activity-log.ts`) | yes (optional `activityLogHeader` field; older versions ignore it; Restore replaces it when present and leaves it when absent) | yes (with the roster) | none; new key, read defensively (bad JSON reads as the empty header). Cleared by Start a real mission. The 214 lines themselves are `aarNotes` (row 17) |
| 28 | localStorage | `aarNoteLastKind` (E-04 / D-63, 2026-10-20: `aar` or `activity`, the kind the AAR/214 capture box opens on; per device, like `rt-view`) | `device-prefs.service.ts` (used by `shared/aar-note/aar-note-dialog.component.ts`) | **never** (a per-device convenience, not mission data) | no | none; new key, read defensively (a missing or unknown value reads as `aar`) |
| 29 | IndexedDB `rangertrak-records` / `kv` | `missionJournal` (E-222, ADR D-67, 2026-10-23: `{ schemaVersion, entries[] }`, at most 5,000, oldest trimmed; each entry `seq`, `at`, `action`, `summary`, `mission`, `mode`, `prev`, `hash`; events never contents) | `shared/services/mission-journal.service.ts` (pure rules and the hash in `domain/mission-journal.ts`) | yes, as an optional `journal` field (a copy for the record; Restore never replaces the device's journal) | yes (with the roster) | `migrateMissionJournal()`, schema 1; new key, read defensively (bad JSON reads as empty). Never cleared by Start a real mission, a demo load or Clear radio log; nothing in the app deletes all device data |
| 30 | localStorage | `rt-msg-station` (E-220, ADR D-68, 2026-10-23: one letter A-Z, the station letter this device's message numbers carry, default `A`) | `device-prefs.service.ts` (used by `radio-log.service.ts`, the Mission > Operational period field, the hand-over dialog and `sample-data.service.ts`) | yes, in the backup's optional `devicePrefs.msgStation` (a restored device carries on as the same station; an older backup leaves the letter alone). **Never** in a Setup file or a hand-over file (a file sent to ten phones must not give them all one letter) | no | none; new key, read defensively (anything but A-Z reads as `A`) |
| 31 | localStorage | `rt-grid-fit` (2026-10-27: the grids this device fits to the screen, `radio-log` and/or `rangers`, comma-separated; absent = each grid starts up to 1.5 screens wide) | `device-prefs.service.ts` (used by `radio-log.component.ts`, `rangers.component.ts`) | no | no | none; new key, unknown names ignored |
| 32 | localStorage | `fieldModeSentUids` (2026-10-28: JSON array of the radio log entry uids this field phone has put in a Report Packet, for the header's "not sent yet" count; cleared with `fieldMode`) | `field-mode.service.ts` | no | no | none; new key, read defensively (unreadable reads as nothing sent) |

**Mission journal (E-222, ADR D-67).** `MissionJournalService` keeps an append-only, per-device record of actions that change, replace, delete or send mission data (load a demo, restore, import, back up, export, print). Each entry stores the SHA-256 of the one before it, computed synchronously so an entry recorded just before a page reload is kept. It is tamper-evident, not tamper-proof: it catches damage and casual edits, and the latest hash printed on the 309, the Summary and the map sheet is the paper anchor. The Log page's Journal tab shows the check and exports a CSV; the ICS-214 export dialog offers chosen entries as lines. The debug log (`LogService`) stays separate: in memory and clearable.

**Message numbers and status marks (E-220, E-218, ADR D-68).** Every radio log entry the scribe's device logs carries `msgNo` (`{ mission, opPeriod, station, seq }`), shown short as `A007` and in full as `26-0142 / OP 2 / A007`. `domain/msg-no.ts` holds the pure rules (`nextMsgNo`, the formats, `findMsgNoClashes`, `numberEntries`). It is stamped once: by `addRadioLogEntry()` at save, or by `mergeEntries()` when an entry without one (a phone's Report Packet, the exercise console's catch-up file) first merges in; an entry that arrives with a number keeps it, and edit, restore and hand-over never restamp. A field phone stamps nothing. The sequence counts per op period and station, from the entries and `RadioLogType.msgNoHighWater` (key `opPeriod + NUL + station`), so a deleted last entry's number is never reused; renaming the op period restarts it. The station letter is a device preference (row 30), not a `SettingsType` field (D-55). A merge that finds the same full number on a different `uid` reports it (`EntryMergeResult.clashes`, shown in the merge summary and on Mission > Operational period) and renumbers nothing; the hand-over dialog offers *Take over station X* or *Log alongside as station Y*. `handled` (`{ mark, at }`, a fixed set of three) is merged by the later `at` and is not journalled (D-67). The printed 309 leads with a mark column and a Msg # column; the 213 PDF carries the full number in its top margin; the radio log CSV has the columns `msg_mission`, `msg_op_period`, `msg_station`, `msg_seq`, `msg_no` and `handled`; the Board snapshot carries `msgNo` and `msgNoFull` per report.

**Board server endpoints and the shared causes (E-216, ADR D-61).** `tools/board/protocol.js` answers these under `/api/`, all with `Access-Control-Allow-Origin: *` (no cookies are involved; the secrets travel in headers the page sets):

| Endpoint | Who | What it returns |
| --- | --- | --- |
| `GET /api/hello` | the scribe's app (Test connection) | `{ app: 'rangertrak-board', name, version }`. No password and no key, and no state is read. It lets the app tell "a RangerTrak Board" from "something else". |
| `GET /api/mission` | viewers | The snapshot plus `board: { by, at, open, name, previous?, scribeSeenAt?, wifi? }`. `scribeSeenAt` (ISO) is when the scribe's device last made a keyed call (the poll every 5 s is the heartbeat); `wifi` is the Wi-Fi name when the server could read it. Each caller's address is counted for the console status line (`viewerCount()`) and is never stored beyond 60 s, returned or logged. |
| `POST /api/claim`, `POST /api/password`, `GET /api/requests`, `POST /api/mission`, `POST /api/request/:sha`, `GET`/`POST /api/attachments/:sha` | unchanged | See D-61 and D-60. |

`GET /hello` (not under `/api/`) is the plain "this device can reach the Board" page. The Board's console also prints a start-up self-check (`tools/board/selfcheck.js`: Wi-Fi name, virtual adapters left out via `tools/board/net.js`, Windows network type, firewall rule, who holds port 443, battery) and one status line every 30 s when it changes (`tools/board/statusline.js`). Nothing in it changes the computer except the Windows fixes, which are offered once, at a keyboard, behind Windows' own permission prompt.

**The Board kit (E-255, 2026-10-28).** `npm run build:board-kit` (`tools/board-kit/build.js`) bundles `tools/board-kit/entry.js`, the server and its npm packages with esbuild into one `rangertrak-board.js`, beside the built app in `app/` (no `assets/maps/`), double-click launchers that check only for Node.js 24, `READ-ME-FIRST.txt`, `LICENSE` and `THIRD-PARTY-NOTICES.txt` (the bundled packages' licences, read from the metafile). The entry sets `RANGERTRAK_BOARD_KIT` to its folder, and the server then serves `app/` and keeps its certificate in `certificate/` there. `release-zip.yml` attaches it to each release as `rangertrak-board-<version>.zip`.

**The web zip and self-hosting (E-254, 2026-10-28).** The same `release-zip.yml` attaches `rangertrak-<version>-web.zip` to each release: the built app without `assets/maps/` (no basemap), `LICENSE`, and `READ-ME-FIRST.html`. Hosting instructions are one page, `tools/self-hosting/index.html`, also served at `/self-hosting/` (the Worker's `run_worker_first` lists it, as it does `/tour/`; without that the SPA fallback served the app shell there). A host must give every unknown path the app, **except** `/assets/`, which must 404. Known gap: the offline basemap warm-up (`offline-basemap.service.ts`) checks only `res.ok`, so a host that answers a missing `.pmtiles` with `index.html` would have HTML cached as a map.

**Field phone reports and time (2026-10-28).** A field phone's Report Packet leaves mission, event and op period blank: the phone never learns them (E-252). In their place, `domain/packet-time-check.ts` warns on merge when reports predate the mission (the op period start, or this device's oldest report) or lie more than 10 minutes in the future. The phone counts what it has sent by uid (`fieldModeSentUids`, row 32). Nothing comes back from the scribe's device, so "sent" means "put in a packet", not "received".

The causes ("why can't I reach the Board?") are written once in `src/app/domain/board-causes.json`: `{ id, seenFrom, message, detail, anchor }`. The app reads them through `domain/board-causes.ts` (`boardCause(id, values)`), the server through `tools/board/causes.js`. The viewer page `src/command-post-view/index.html` is plain static JS and cannot import the file, so it carries the words of `board-lost` and `scribe-quiet`; `tools/board/causes.test.js` fails if they drift. The app's Test connection (`domain/board-diagnosis.ts`, run by `command-post-publish.service.ts`) turns what it finds into one of these causes. `message` is plain words; `detail` is the technical line shown under "Details"; `anchor` is the heading slug on the Help page planned for slice 3.

Notes for the storage freeze:

- The optional Google geocoding API key is no longer in `appSettings` (2026-10-01): it lives in
  the `secrets` record, encrypted when device encryption is on. A plain backup omits it, a
  passphrase-protected one keeps it, and restoring a backup with no key keeps the device's key.
  Setup files still carry it by the 2026-08-31 decision. The Board password (D-61) rides the
  same record and rules, except that a Setup file never carries it either (D-61 item 8).
- The Board publish key (row 25) is device-only on purpose. It is replaced by whatever the Board
  returns on each claim, so a restored backup or a copied Setup file can never put one key on two
  devices.
- Mission mode (`missionMode`, E-168a) is a field inside `appSettings`, not a key of its own, so it
  rides in backups. The demo record (row 3) is device-only on purpose: it records which rows the
  demo loader created, which means nothing on another device.
- The scenario clock (`scenarioClock`, E-196 phase 1, D-66) is likewise a field inside `appSettings`,
  not a key of its own, so it rides in backups: optional, never created by the backfill, no schema
  bump, cleared by leaving Exercise mode and by Start a real mission.
- Rows 2 and 15 are written but nothing reads them back or cleans them up.

## One active tab per browser

Every domain service (`RangerService`, `RadioLogService`, `MissionLocationService`) keeps its
whole state in memory and persists it with one unconditional write on every mutation -
`RecordStore.setItem(key, JSON.stringify(wholeThing))`. That is fine within a single tab, but
two tabs of the same browser each load their own in-memory copy at boot; the second tab to
save always wins, silently discarding whatever the first tab wrote in between. Nothing
coordinated tabs before `shared/storage/tab-lock.ts` (2026-09-28) - no `BroadcastChannel`, no
`storage` event, no Web Lock.

The fix is a `navigator.locks` exclusive lock, requested `{ ifAvailable: true }` at the very
start of `main.ts` - before even the encryption gate above, since a tab that has not won the
lock has nothing to unlock or boot yet. Whichever tab holds it is the only one `RecordStore`
lets write: `setItem()`/`removeItem()` check a `writesEnabled` flag before touching either the
in-memory `Map` or IndexedDB, so nothing a blocked tab still has in memory can ever reach
storage. A tab that loses the startup race shows a full-page plain-DOM notice (same "no
Angular yet" reasoning as the encryption gate) offering to `steal` the lock instead; a tab that
was active and gets stolen from finds out because a `steal` rejects the *previous* holder's own
still-pending `navigator.locks.request()` promise (per the Web Locks API), which is this app's
only signal that it has been stolen from - no polling, no heartbeat. See `tab-lock.ts`'s own
header comment for the full mechanics, `tools/e2e.js`'s `checkOneActiveTab()` for the
two-real-tabs end-to-end proof, and the Help "Your data" tab for the operator-facing framing.

## Service worker and app updates

`UpdateService` (`shared/services/update.service.ts`) owns the update lifecycle and is
started once from `AppComponent.ngOnInit()`. On `VERSION_READY` it raises a persistent
snackbar, and `updateReady()` (a signal) drives `InstallUpdateComponent`
(`shared/install-update/`) — the one component now used for both "install this app" and
"a new version is ready" everywhere they appear: inline instances in the navbar, footer,
and Settings, plus one `[fixed]="true"` instance rendered once in `app.component.html`
that stays `position: sticky` at the top of the viewport regardless of scroll position or
route (E-43 — the navbar's own inline instance is `position: static` and was confirmed to
scroll out of view on any tall page). `SwUpdate.activateUpdate()` followed by
`location.reload()` runs only when the user accepts, from either surface.

The reload is deliberately never automatic. This is a scribe's tool used mid-incident;
replacing the page under an in-progress report would lose the report.

Anything that only `console.warn`s here is a bug, not a placeholder: a silently stale
service worker means an installed copy serves an old build indefinitely, which is exactly
what happened after 0.13.0 shipped.

## Version stamp between releases

Releases are tagged about weekly (`1.0.0-beta.N`); pushes in between carry no version bump. `deploy.yml` writes the deploy's date and short commit into `src/app/shared/build-stamp.ts` before building, and the footer and Help show it as `(build YYYY-MM-DD abc1234)`, so a report from a tester names the exact build. A local build shows no stamp. `domain/restore-preview.ts` orders pre-release tags numerically (`-alpha` < `-beta.3` < `-beta.5` < the release) when it checks whether a backup came from a newer version (E-238).

## Errors and the diagnostic report (E-258, 2026-10-28)

There is no Debug mode setting any more. Developer panels show only in a dev build or with `?debug` (`shared/dev-diagnostics.ts`); `settings.debugMode` is kept in stored settings, unread, so returning users' settings still load. `global-error-handler.ts` turns an uncaught error into a "Something went wrong" prompt with *Report it* and *Don't show again*, at most three times a session (the mute is sessionStorage). The feedback form can attach a diagnostic report, only when the person ticks it, with *Preview* and *Copy diagnostics*. `diagnostics.service.ts` builds it: ordinary log lines go in without their message text, and warning and error text passes through `shared/redact.ts` first (emails, phone numbers and coordinates). Rule 5 applies: nothing from the roster or report text leaves the device unless someone reads it in the preview and sends it.

## Bundle and loading strategy

Only the Entry route is eager; every other route is a `loadComponent` split point
(`src/app/app.routes.ts`). Two consequences worth knowing before adding imports:

- **Do not import heavy libraries from `main.ts`, `app.config.ts`, or anything in the
  Entry page's import graph** — that pulls them into the eager bundle and undoes the
  splitting. AG Grid registration lives in `shared/ag-grid-setup.ts` and xlsx is a dynamic
  import inside `RangerService` for exactly this reason.
- **Prefer specific import paths over the `shared/` barrels in eagerly-loaded code.** A
  barrel import pulls everything the barrel re-exports. `mapping/map-style` (MapLibre) is
  deliberately *not* re-exported from either barrel to keep this from happening by
  accident.
- **Keep map-engine types out of the domain model.** `FieldReportsType.bounds` was a
  Leaflet `LatLngBounds`, which put Leaflet in `FieldReportService` — and therefore in the
  eager bundle. It is a plain `BoundsType` now, converted to an engine's own type at the
  point of use. The same rule is why a plain object beats a class anywhere state is
  round-tripped through `localStorage`: JSON gives back data, never methods.
- **Leaflet must be evaluated before `leaflet.markercluster`.** The plugin reads the
  global `L` at module-evaluation time, so both Leaflet components carry a bare
  `import 'leaflet'` above the plugin import. It sorts first alphabetically, which keeps
  import-sort from reordering it. Removing that line reintroduces
  `ReferenceError: L is not defined`.

`app.config.ts` registers `withPreloading(PreloadAllModules)`, so lazy chunks are still
fetched once the app is stable — deliberate for an offline-first PWA, where everything
should end up precached. The split improves time-to-first-screen, not total bytes over a
whole session.

### First render of a routed page

2026-10-06 (E-171): under zoneless change detection `RouterOutlet` creates the routed page and
only marks it for check, so the page's first update pass (every `@if`, such as the page header,
and every binding) ran a task later, and a frame could paint in between without the header. That
was PageSpeed mobile CLS 0.49, fixed in 0.99.26-alpha to 0.002. `AppComponent.onRouteActivated()`
(`app.component.ts`), bound to `(activate)` on the router outlet, calls `ApplicationRef.tick()` so
the first pass runs in the activating task. Do not remove it without re-running PageSpeed mobile.
Local throttled runs never showed the problem: the race only appears on a fast load.

Solid arrows are eager; dashed arrows from `APP_ROUTES` are lazily loaded chunks.

```mermaid
classDiagram
    direction TB

    namespace Core {
        class AppComponent
        class APP_ROUTES
    }

    namespace EagerRoute {
        class EntryComponent
        class LocationComponent
        class MiniMapLeafletComponent
    }

    namespace LazyRoutes {
        class FieldReportsComponent
        class RangersComponent
        class LmapComponent
        class MapComponent
        class SettingsComponent
        class LogComponent
        class HelpComponent
        class X404Component
    }

    namespace Shared {
        class HeaderComponent
        class AlertsComponent
        class AbstractMap
    }

    namespace Services {
        class FieldReportService
        class RangerService
        class SettingsService
        class LogService
        class ClockService
        class InstallableService
        class BackupService
        class SampleDataService
        class GeocodingProvider
    }

    AppComponent --> APP_ROUTES : Uses
    APP_ROUTES --> EntryComponent : Eager route

    APP_ROUTES ..> FieldReportsComponent : Lazy route
    APP_ROUTES ..> RangersComponent : Lazy route
    APP_ROUTES ..> LmapComponent : Lazy route
    APP_ROUTES ..> MapComponent : Lazy route
    APP_ROUTES ..> SettingsComponent : Lazy route
    APP_ROUTES ..> LogComponent : Lazy route
    APP_ROUTES ..> HelpComponent : Lazy route
    APP_ROUTES ..> X404Component : Lazy route

    EntryComponent --> LocationComponent
    EntryComponent ..> MiniMapLeafletComponent : Deferred (on idle)
    EntryComponent ..> FieldReportService
    EntryComponent ..> RangerService
    EntryComponent ..> SettingsService
    EntryComponent ..> LogService

    LocationComponent ..> GeocodingProvider

    MiniMapLeafletComponent --|> AbstractMap
    LmapComponent --|> AbstractMap

    FieldReportsComponent ..> FieldReportService
    FieldReportsComponent ..> SettingsService

    RangersComponent ..> RangerService
    RangersComponent ..> SettingsService

    LmapComponent ..> FieldReportService
    LmapComponent ..> SettingsService

    MapComponent ..> FieldReportService
    MapComponent ..> SettingsService

    SettingsComponent ..> SettingsService
    SettingsComponent ..> BackupService
    SettingsComponent ..> SampleDataService

    LogComponent ..> LogService
    LogComponent ..> SettingsService

    BackupService ..> SettingsService
    BackupService ..> RangerService
    BackupService ..> FieldReportService

    SampleDataService ..> SettingsService
    SampleDataService ..> RangerService
    SampleDataService ..> FieldReportService

    FieldReportService ..> SettingsService
    FieldReportService ..> RangerService

    HeaderComponent ..> SettingsService
    HeaderComponent ..> ClockService
```

> The diagram omits `MiniMapComponent` (the MapLibre mini-map): it exists and works but is
> not wired into any template yet — see the open decision above.
