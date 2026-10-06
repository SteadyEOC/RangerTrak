# Roster build tooling

**CONFIDENTIAL data, generic scripts.** The scripts here hold no personal data, but everything
they read and write does: real volunteer names, phone numbers and photographs. That data lives
in a region folder such as `us/wa/king/vashon/`, outside every git repo, and never goes in one —
see the Architectural Decision Record, **D-35**: rosters and photos are *operator data*, not
application assets.

Every script takes the **region folder** as an argument, relative to the current folder or to
the top of `rangertrak-regional-data` (or set `REGION=`). The region's `region.json` gives its
name, its ZIPs and where its volunteer table is; everything else follows the layout below.
`<name>` is the region's name from `region.json` (for Vashon, `Vashon`).

```
<region>/
  region.json
  sources/volunteers/   the volunteer table (path set in region.json)
  sources/photos/       every photo, any filenames, duplicates fine
  rangers/              ranger-ids.csv, <name>-roster.json, the bundle, photo-callsign-map.csv
```

## The one file you want

**`<region>/rangers/<name>-roster-and-photos.zip`** → put this on the thumb drive.

On the command-post browser:

1. **Rangers** page → *Import roster (JSON)* → pick `roster.json` from the zip
2. **Rangers** page → *Import photos* → select everything in `photos/`

Both stay on that device. Nothing is uploaded; the photos never leave the browser.

## What each thing is

Scripts (here):

| | |
| --- | --- |
| `1-make-roster.js` | volunteer CSV + `ranger-ids.csv` → `<name>-roster.json` |
| `2-make-drive-bundle.js` | roster + photos → the folder **and** the zip. Zips with `../ham-roster/vendor/fflate.cjs` |
| `make-photo-worksheet.js` | optional: hand-map photos that the REW join misses |
| `region.js` | finds the region folder and reads `region.json` |

Data (in `<region>/rangers/`):

| | |
| --- | --- |
| `<name>-roster-and-photos.zip` | **the deliverable** — roster + photos, ready for a drive |
| `<name>-roster-and-photos/` | the same thing unzipped; regenerated every build |
| `<name>-roster.json` | roster **only**, no photos. Import this if you just want people. |
| `ranger-ids.csv` | **the crosswalk: one row per person tying every identifier together.** Edit by hand (Excel is fine). See below |
| `photo-callsign-map.csv` | the photo worksheet |

## Rebuilding

From the top of `rangertrak-regional-data`:

```
node tools/roster-build/1-make-roster.js us/wa/king/vashon        # after the volunteer table changes
node tools/roster-build/2-make-drive-bundle.js us/wa/king/vashon  # after the roster or the photos change
```

Step 2 writes the zip itself. Run step 1 first if the roster is stale.

**Keeping call signs current** (do this when the FCC file is refreshed, or someone mentions a
new call):

The FCC file covers the whole US, so it is kept once, in `us/_national/fcc/`, not per region.
The ZIPs are the region's (`region.json`); the output goes in the region's `work/`.

```
node tools/ham-roster/ham-roster.js download --out us/_national/fcc/uls-<date>
node tools/ham-roster/ham-roster.js build --fcc us/_national/fcc/uls-<date>/l_amat.zip --zips 98070,98013 --club us/wa/king/vashon/rangers/Vashon-roster.json --out us/wa/king/vashon/work/ham-roster-<date>
```

Review `club-merge.csv` (call-changed, name-proposal, call-name-differs), edit `ranger-ids.csv`
for what's confirmed, then rerun steps 1 and 2.

## The crosswalk: `ranger-ids.csv`

One row per person. Rows are matched to the volunteer table on **REW id + name**, because
one REW id can be legitimately shared (e.g. two members of one household; both are kept).

| column | what | who sets it |
|---|---|---|
| `uid` | RangerTrak's hidden key (ADR D-42). Goes into every roster file, so every device agrees who is who | Minted by step 1 the first time it sees a person. **Never edit or reuse** |
| `id` | REW/TEW credential | the volunteer table |
| `name` | as in the volunteer table; part of the match key, so fix spelling in both | the volunteer table |
| `callsign` | current ham call; blank = not a ham (the roster then uses the REW id) | you, after checking (ham-roster) |
| `other_calls` | previous calls the FCC links to the same person | ham-roster |
| `frn` | FCC Registration Number: the stable key across call-sign changes | ham-roster |
| `photo` | a photo filename under `<region>/sources/photos/` for this person; blank = automatic by VI code | you |
| `merged_into` | uid of the row this person really is, if they hold two credentials (e.g. issued VI-0002, later VI-0003). The row is kept for lookup, left out of the roster, and its id is noted on the kept person | you |
| `checked`, `source`, `note` | when and how the row was last confirmed | you |

You can add columns, for example a club member number or an IMT id. Step 1 keeps any extra
columns. A new person in the volunteer table gets a row and a fresh uid automatically, marked
`new - review`. Rows for people who leave the table are kept, not deleted. **Editing in Excel:**
FRNs lose their leading zeros, and step 1 restores them. Save as "CSV UTF-8".

## How photos find people

By **credential number**, not by name. Photo filenames carry codes such as `VI-0004` (any
letters-then-digits prefix your credentials use) and each roster entry carries its `id`, so the
join is exact. For Vashon, 30 of 87 distinct photographs land with no guessing. Inside the bundle each photo is renamed to its **callsign**, which is what the app
matches on and also strips the person's name out of the filename.

The other ~57 photographs have no VI code in the filename and can only be attributed by
someone who recognises the face. That is what `make-photo-worksheet.js` is for: it writes
`photo-callsign-map.csv` with one row per distinct image (deduplicated by content hash, so
the same face under three filenames is one row), pre-filled where it can be. Fill in
`CORRECTED_CALLSIGN`, blank a row to skip it, then rebuild.

**A wrong photo is worse than no photo.** The photo confirms who a report is about; a
missing one shows a silhouette and announces itself, a wrong one quietly misleads. So
automatic matches are proposals, never the final word.

## Why the roster is not the FCC file

For Vashon, `sources/fcc/Rangers.3Feb22.json` (beside the original FCC pulls) is every amateur licensee in ZIP 98070/98013. Measured against the
volunteer table: **219 of its 286 entries (77%) are not volunteers**, and it misses the 122
volunteers who are not licensed hams. It is the wrong source for a mission — see **D-36**.

`callsign` is ham callsign where the person has one, REW number otherwise. `rew` always
carries the credential number.
