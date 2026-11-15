# Exercise console (E-196, phase 0)

A free, offline controller's console for running a training exercise with RangerTrak. You open a
**scenario package**, set the class's options, and the console runs the clock, shows cue cards for
you to read out, pauses at decision points, drives an overhead display, and writes **catch-up
files** that the app imports. Afterwards it checks the class's exported log against the script.

It lives outside the app: plain HTML, CSS and JS, Node built-ins only, no accounts, no keys, no AI,
no network. **Scenarios are always free to play.**

## What phase 0 is, and is not

Phase 0 changes nothing in the app (`src/` is untouched). The boundary is **files**: the console
writes Report Packet files, a person imports them in the app, and the class's own log comes back
the same way. There is **no network push into the app**; a training-only live feed, alert bars and
RangerView context panel are a roadmap entry (E-197), not built.

## Start it

**Hosted:** open <https://rangertrak.org/exercise/>. Nothing to install, no account, no keys. The build
copies the browser files here (`console.*`, `room.*`, `lib/*.js`, `samples/`) to `/exercise/`
(`angular.json`), and the Worker redirects `/exercise/` to `/exercise/console.html`. The app's service
worker caches them lazily (`ngsw-config.json`, group `exercise`): open the app once in that browser, then
the console once while online, and it runs offline after that. The console fetches the room display and
the sample on load so they are cached too.

**Local**, for your own scenario work or with no Internet at all:

```powershell
node tools/exercise/serve.js          # then open http://127.0.0.1:8095/console.html
```

Browsers will not load ES modules from a `file://` page, so the console needs a static server. This
one is a few lines of Node, read only, listening on 127.0.0.1 only. Any other static server
pointed at `tools/exercise/` works. Stop it with Ctrl+C.

## Run a class, step by step

1. **Open a scenario.** *Load the Montecito sample*, or *Open scenario folder*. Read the about text
   and the **content note**. Fix any errors the console lists (they name the row id).
2. **Set the class's options** (all optional):
   - start and stop (scenario times), pace (1x, 2x, 5x, 10x, 60x);
   - background traffic 25, 50 or 100 percent (thinning is by row id, so the same rows are kept every
     time; injects, decision points, tests and casualty rows are never dropped);
   - which teams the trainees **play**: their own messages become cue cards ("Net Control should
     send: ..."), everything else is simulated;
   - rows to switch off, and local injects you add ("the repeater fails at 14:00");
   - **casualty realism**: *softened* (the default; fatalities become critical injuries), *as
     recorded*, or *row by row*. When fatalities are on, the console reminds you to hold a stress
     debrief. No names, causes or photos of remains appear in any version;
   - whether "What really happened" may be shown at decision points.
   Press *Apply settings and go to Run*.
3. **Start the app side.** In RangerTrak, make a new mission and turn on **Exercise mode** so every
   entry carries the EXERCISE stamp. Do not use the exercise on a mission with real traffic.
4. **Bring the log up to the starting moment.** Press *Write catch-up file to now*. The browser
   saves `rangertrak-report-packet-EXERCISE-<title>-catch-up-to-OPn-<date>.txt`. In the app, import
   it with the app's Report Packet import. Every background row up to that scenario time
   appears in the log, dated so that the chosen scenario moment is **now**.
5. **Play.** Press Play. At each inject's time a **cue card** appears: who, to whom, on which channel,
   the exact words, the place, and (after you click) the expected action or teaching note. Say it
   over the radio, or hand a printed message card across. The players log it themselves; typing it
   is the training. A **planted test** is marked on your card only.
6. **Decision points** pause the clock on their own. Read out the discussion text, let the class
   talk, then (if allowed) click *What really happened*. *Close and play on* resumes.
7. **Pause, jump, advance.** Pause to talk (the real clock runs on, which is harmless between
   cues). *Jump* goes to a scenario time or the start of an op period. *Advance to next OP*
   jumps to the next op period **and** writes the catch-up file for everything in between; the
   scribe imports it and play continues.
8. **Room display.** *Open room display* opens a second window; drag it to the projector (press F
   for full screen). Media rows appear in sequence with caption, source, licence and scenario time,
   with a clock and an op-period strip at the bottom. **B blanks the screen.** A link-only item
   with no network, or one that is a web page, shows as a caption card. Put your own local copies in
   the package's `media/` folder (open the folder, not the loose files).
9. **Print.** *Print controller packet* prints the effective MSEL, cue cards and ICS-213-style
   message cards for the injects. Print CSS only; every page says EXERCISE.
10. **Debrief.** After the class, export the log from the app as a Report Packet and load it in
    the *Debrief* tab. The console lists each inject as logged, late or missed, with the time
    difference, and **searches the log for the bait** planted by each PII test (names, dates,
    phone numbers taken from the row), reporting each hit with its entry time. Other planted tests
    (wrong grid, rumor, duplicate report, media call, self-deploying volunteer) become a checklist
    for the evaluator. Download the result as Markdown, or print it.

Time differences need a time pair: *scenario time X was real time Y*. The console fills it in
from the last catch-up file or Play press, and you can overtype it. At a pace above 1x the
differences are in real minutes, so read them with that in mind.

## What the catch-up file contains

A **Report Packet**, the same file the app's own export makes: plain JSON saved as `.txt`
(`schemaVersion` 1, `notice`, `exportedAt`, `appVersion`, `mission`, `event`, `opPeriod`, `operator`,
`scenarioClock`, `entries`). Each entry is a radio log entry with `uid`, `id`, `callsign` and `tacticalCall` (the
sending station), `toTactical`, `location` (the place's coordinates and label), `date`, `status`,
`notes`, `source` (Voice, or Phone for phone calls), `operator` and `loggedAt`.

Everything says EXERCISE: the file name, the packet's `mission` and `event`, the `notice`, and the
start of every entry's note (`[EXERCISE] ...`). Entry ids are stable per row, so importing two
overlapping catch-up files never doubles an entry. A row with no place is pinned at the middle of
the scenario's places with the address "EXERCISE (no place given)".

`scenarioClock` is `{ realAt, scenarioAt }`: at the real moment the file was made, the scenario stood
at that time (the scenario side is the scenario's own wall clock, written like a UTC time). In
Exercise mode the app offers to show that scenario time beside the real clock (ADR D-66). It is
optional: an older app ignores it, and a file without it imports as before. In Exercise mode the app
also skips the "different mission name" question for these files, and marks the entries as scenario
traffic because their `operator` is `EXERCISE controller`. That name is fixed in two places that must
match: `EXERCISE_OPERATOR` in `lib/packet.js` and `EXERCISE_CONTROLLER` in the app's
`src/app/domain/scenario.ts`; `operator-constant.test.js` goes red if one changes without the other.

E-168 treats entries dated in the last 12 hours as live, so catch-up entries will look live
on purpose. That is why step 3 asks for Exercise mode.

### Places

The catch-up file carries **entries only**. Places would need a Setup file; its format is the
app's zip and mission configuration, which this tool cannot check without app code, so it does not
guess. The scenario's places are listed in the **printed controller packet** instead. Load them in
the app by hand or from the region you already use.

## Stress injector

Made-up traffic at speed, to test operators and the app (no ADR needed; this is test tooling):

```powershell
node tools/exercise/stress.js --rate=2000 --hours=3 --out=C:\temp\stress
node tools/exercise/stress.js --rate=2000 --hours=3 --split=30 --scenario=tools/exercise/samples/montecito --out=C:\temp\stress
```

`--split=MIN` writes one file per interval; `--seed` repeats a run; `--scenario` draws teams and
places from a package (otherwise made-up Fernhollow-style ones). The files are Report Packets for
the app's normal import. The *Stress injector* tab does the same for smaller runs.

## Tests

```powershell
node --test tools/exercise/*.test.js
```

Do not use `npm test`; it is watch mode and does not exit. One test (`app-accepts.test.js`) bundles
the app's own `parseReportPacket()` and `mergeEntries()` with esbuild (already in the repo) and
merges the files this tool writes through them. It is skipped if esbuild or the sources are absent.
`ui-wiring.test.js` checks that every element the console looks up exists in its HTML; no
browser is launched.

## Files

| Path | What |
|---|---|
| `console.html`, `console.js`, `console.css` | The controller console |
| `room.html`, `room.js` | The room display (a second window, driven by a BroadcastChannel) |
| `serve.js` | Tiny local static server |
| `stress.js` | Stress injector command line |
| `lib/` | The tested logic: `csv`, `time`, `package`, `settings`, `clock`, `packet`, `stress`, `debrief` |
| `PACKAGE.md` | The scenario package format |
| `samples/montecito/` | The made-up Montecito sample (E-195) |

Nothing from `rangertrak-regional-data` belongs here. Packages hold only invented people.
