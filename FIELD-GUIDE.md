# RangerTrak Field Guide

For the people who actually use RangerTrak during a mission — Emergency Coordinators, net
control operators, and anyone staffing a command post. No technical background assumed.

*Developers: see [ARCHITECTURE.md](ARCHITECTURE.md) instead. This document deliberately
avoids implementation detail.*

---

## What RangerTrak does

RangerTrak records **who is where, when, and in what condition** during a mission, and
plots it on a map. It runs entirely in your browser on your own device. There is no
server, no account, and no login — nothing you type is sent anywhere. It is free and open
source, so you can copy it, change it, and keep running it for as long as you like.

| Page | What it's for |
| --- | --- |
| **Home** | Enter a field report: who called in, where they are, their status, and any notes. This is where you spend the mission. |
| **Reports** | Every report so far, in a sortable, filterable table. Select rows here to focus the maps on just those reports. |
| **Rangers** | Your roster — call signs, names, contact details, teams. |
| **Map (Leaflet)** | Full-page map using standard online road maps. Best detail, anywhere in the world, but needs Internet. |
| **Map (MapLibre+PMTiles)** | Full-page map using map data built into the app. Works with no Internet at all: a low-detail world map everywhere, plus real street-level detail in the Vashon Island demo area (or wherever you load your own map file — see step 6 below). |
| **Settings** | Mission name, operating period, expected check-in interval, default location, status labels and colours, backup and restore. |
| **Log** | A running record of what the app did, including warnings and crashes. Export it when reporting a problem. |

### Who it's for

RangerTrak is built for teams reachable only by **voice radio** — CERT, ACS/ARES, SAR, and
wildland-fire operations — where field members carry no networked device. Three roles:

1. **Scribe / net control (command post).** Sets up the mission and operating period once,
   maintains the roster, then spends the incident on the Home screen transcribing reports
   radioed in: who, where, when, status, notes. **This is the primary user** — the app is
   designed around their speed and accuracy.
2. **Field ranger / team.** Never touches the app. They are a voice on the radio.
   RangerTrak's job is to make their spoken location fast and unambiguous to write down.
3. **Analyst / Incident Commander.** Uses the Reports table and maps during the incident to
   see coverage and status, and exports afterwards for the after-action record.

### Spotting a team that has gone quiet

Set **Mission → Operational period → Expected check-in interval** to how often your
teams are supposed to report — 30 minutes by default.

Once a team passes that interval, their elapsed time starts to colour: green just after they
are due, then amber, then red at three times the interval. With the default 30 minutes, red
means 90 minutes of silence. The same colours appear in three places, so you see it wherever
you happen to be looking:

- on the **map**, as a number of minutes beside the team's latest position,
- on the **Rangers** page, in the Last contact column,
- on the **Radio Log**, in the Elapsed column.

A ranger who has never reported at all shows as **not checked in** in red, regardless of the
interval.

Set the interval to **0** if your mission has no fixed check-in cycle. Elapsed times then stay
plain text with no colouring, rather than the app inventing a cadence nobody agreed to.

Two things this does not do: it will not beep, flash or otherwise interrupt you, and the times
update when a screen redraws — a new report arriving, or switching pages — rather than counting
down second by second. It is there to be read, not to raise an alarm.

### No accounts, no API keys, ever

**No API key is ever required for RangerTrak's core function.** There is nothing to sign
up for, nothing to pay for, and no key to obtain before you can work:

| What you're doing | Needs a key or account? |
| --- | --- |
| Coordinate entry (decimal, DMS, DDM, MGRS, UTM, Maidenhead) | No — calculated on your device |
| Plus Codes | No — calculated on your device, works offline |
| Both map displays | No |
| Address lookup | No (but does need Internet) |
| Reports, roster, export and import | No |

Anything that ever *does* need a key will be optional, will say so honestly when it isn't
available, and will never block you from entering and mapping reports.

> If your team adds an optional key-based feature later, sort it out **during mission
> preparation, never during a callout.** Discovering you need to go register for something
> while people are on the radio is exactly the situation this rule exists to prevent.

### Why Plus Codes

Both Plus Codes and What3Words turn a location into something short enough to say over a
radio. The difference is what happens when the Internet doesn't.

A **Plus Code is calculated** — your device derives it from the coordinates itself,
instantly, with no network, no account, and no API key, under an open standard anyone can
implement. A **What3Words address must be looked up** from their servers on every single
conversion.

In a command post with no connectivity — the exact situation RangerTrak was built for —
one of these keeps working and the other doesn't. RangerTrak supports both, but it defaults
to the one that can't be taken away.

---

## The three ways RangerTrak starts

How well RangerTrak works without Internet depends entirely on what you did **before** you
lost it. Three cases, worth knowing by name:

### 🔥 Hot start — fully prepared

You set the app up in advance while connected. Everything is already on the device: the
app itself, your roster, your mission settings, and map coverage for your area.

**Works with no Internet whatsoever.** This is what you want for a real mission.

### 🌤 Warm start — app used before, on this device

You have opened RangerTrak on this device before while connected, but did not do full
preparation. The app itself will load offline, and any map area you previously looked at
will still be there. Areas you never viewed will be blank.

**Mostly works offline**, with gaps you will discover at the worst moment.

### ❄️ Cold start — first time on this device

You are opening RangerTrak on this device for the first time. Without Internet, nothing
loads at all — the app has to be fetched at least once.

**Requires Internet to get going.** See [Cold start](#cold-start-no-preparation-no-internet)
below for what to do if you're caught this way.

---

## Before the mission: getting to a hot start (the setup phase)

Do this while you still have Internet and mains power. It takes a few minutes and is the
difference between a working tool and a blank screen.

**1. Install RangerTrak as an app.**
Look for the **Install** button in the top-right of the header. Installing gives you a
proper icon, a window without browser clutter, and makes the device far more likely to
keep your data.

**2. Ask the browser to protect your data.**
Go to **Settings** and check the storage status. If it offers to request persistent
storage, accept. Without this, a browser short on disk space may quietly discard your
mission data. RangerTrak asks automatically, but browsers are more willing to say yes once
the app is installed — so do this *after* step 1.

**3. Load your roster.**
On the **Rangers** page, enter your people or import them, then use **Save Rangers**.
Roster edits are *not* saved automatically — you must press the button.

**4. Set up the mission.**
On the **Settings** page, fill in the mission and event names, the operating period start
and end, and the default coordinates for your area. The default location is where maps and
new reports start from, so getting it right saves work all mission.

**5. Check your statuses.**
Still in **Settings**, review the field report statuses and their colours. These drive the
colour coding on the Reports table. Rename them to match your agency's terminology now,
not mid-mission.

**6. Prime the maps — the step people forget.**

Both engines live on the one **Map** page now, switched with the toggle above the map.

- With the default **Leaflet** map showing, switch its base layer to **OpenTopoMap**
  (the contour map), navigate to your operating area at the zoom level you expect to use,
  and press **💾 Save this area for offline use**. This stores those tiles — the level you
  saved at, plus a couple of levels deeper — on the device. Only the areas and zoom levels
  you actually save will be available later. (Saving is only offered on OpenTopoMap;
  OpenStreetMap's own rules don't allow bulk offline downloads from its servers.)
- Flip the switch to try the **Alternative map (MapLibre + PMTiles)** at least once. A
  low-detail world map is built in and works everywhere with no setup; visiting this map
  once while connected is what makes its own offline copy available later with no Internet.

> ### For coordinators: make your own offline map file
>
> The Alternative map's built-in world view is low detail. If your operating area needs
> real street-level detail beyond the Vashon Island demo, you can cut a small map file for
> it yourself ahead of time, using a free tool — no account, no payment:
>
> 1. Download the free `pmtiles` command-line tool for your computer (Windows, Mac, or
>    Linux) from its project page: `github.com/protomaps/go-pmtiles/releases`
> 2. Pick the area you need as a bounding box — four numbers: west, south, east, north.
>    RangerTrak's own map shows coordinates as you click around, or use a free site like
>    `bboxfinder.com`.
> 3. Run one command to cut that area out of a current worldwide map file, refreshed daily
>    and free to use for this:
>
>    ```sh
>    pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles my-area.pmtiles --bbox=WEST,SOUTH,EAST,NORTH --maxzoom=14
>    ```
>
>    Use a date from the last week, and your own bounding box. A typical county comes out
>    to 10–100 MB and takes a few seconds. Try `--maxzoom=15` instead for a smaller, denser
>    area if you want the sharpest possible detail.
> 4. Get the resulting file onto the phone or tablet that will run RangerTrak — AirDrop, a
>    cable, a cloud drive, whatever moves a file onto that device — then in RangerTrak go
>    to the Map page, switch to the Alternative map, and press **Load a custom .pmtiles
>    file…**.
> 5. **On an iPhone or iPad, add RangerTrak to the Home Screen before loading the file.**
>    Otherwise, iOS can quietly delete an app's stored data after about a week of the app
>    not being opened — a real risk if you prepare a device days ahead of a mission.
>
> Map data from this tool carries the same OpenStreetMap attribution the app already shows.

**7. Take a backup.**
On **Settings**, press **Back up mission**. This writes a single file containing your
settings, roster, and any reports. Keep it somewhere safe — a USB stick, another device.
If the browser data is ever lost, **Restore mission** restores everything.

> ⚠️ That export file contains personal information about your people — names, home
> addresses, phone numbers, and call signs — and it is **not encrypted**. Treat it like any
> other confidential roster.

**8. Try it for real.**
Turn off Wi-Fi and mobile data, then open RangerTrak and enter a test report. Five minutes
of this now is worth more than any checklist. Delete the test report afterwards.

---

## During the mission (the entry phase)

Setup is infrequent and considered; entry is repetitive and time-critical — the same person
may do both, but they're different modes of working. See the in-app Help page for more on
the distinction.

**Entering a report.** On the **Home** page, pick the call sign, set the location, choose a
status, add notes, and submit. Reports save to the device immediately.

**Setting a location.** You can enter coordinates directly, or type an address and let
RangerTrak look it up. The small "Current Location" map right on the Home page is the
fastest way — click anywhere on it and that position is set immediately, no typing or
pasting needed (it's also copied to your clipboard, in case you want it elsewhere too).
The full Map and Alternative Map pages don't set the location this way; clicking them copies
the coordinates under your cursor so you can paste them into Home yourself.

RangerTrak accepts a position in whichever format it was called in over the radio. A
small switcher above the coordinate fields picks which one is active - type into that one,
and every other format updates automatically underneath it, read-only, so you can always
see the same position however else it's expressed:

- **Decimal Degrees, Degrees/Decimal Minutes, or Degrees-Minutes-Seconds** — the usual
  latitude/longitude formats.
- **MGRS** (the grid system US SAR, wildland fire, and the National Guard use, printed
  on every USGS topo quad) and **UTM** — each entered as its own set of boxes (grid
  zone, easting, northing, and so on), matching how they're actually read aloud in
  digit groups over the air.
- **Maidenhead grid locators** (used by ham radio operators) — typed into the same box
  as a street address, Plus Code, or What3Words address; RangerTrak recognizes the
  shape and converts it automatically.

> All of these assume a modern GPS position (WGS84). A coordinate read off an **older
> paper topo map** may use an older reference (NAD27) instead, which can be off by
> 100–200m in the western US — worth knowing if a position looks slightly wrong
> compared to what you see on the map.

Every format is always available from Home's own switcher, so an unexpected radio
call in a format your mission doesn't usually use is never a problem. **Settings → Location
Defaults** only picks which format Home opens on by default for this mission - a convenience
for a team that mostly works in one format, not a restriction on what you can enter. Don't
see a coordinate system your team actually uses (e.g. PLSS Township/Range/Section, or
another country's national grid)? Open an issue on
[GitHub](https://github.com/SteadyEOC/RangerTrak/issues) — genuine field use is exactly
what decides what gets added next.

> Address lookup needs Internet. Without it, you'll see a message saying so. Coordinates
> always work offline — so if the network is down, work in coordinates.

**Watching the picture develop.** Both map pages plot every report. Where reports cluster
together, they are grouped into a numbered circle; zoom in to separate them. Click a marker
for detail.

**Focusing on a subset.** Select rows on the **Reports** page, then switch to a map — you
can show just the selected reports instead of everything. Useful for a single team or a
single incident.

**Handing over.** Press **Back up mission** on **Settings** and give the file to the
incoming operator, who restores it on their device.

---

## What's on each screen

For what each screen does and how to use it, see the in-app **Help** page — it ships with
the app, always matches the version you're running, and works with no Internet. This guide
covers what Help can't: getting a device ready before you no longer have a connection to
fall back on.

<!-- SCREENSHOT SLOT: Settings page, 0.43.x or later. Replaces the Nov-2022 capture, which
     showed the removed Google Maps page and the MIT licence. -->

<!-- SCREENSHOT SLOT: Map page's "Save this area for offline use" control, 0.43.x or later. -->

---

## Starting over: clearing all data

To reset a device to a clean state — after an exercise, or before handing it to another
group:

> ⚠️ **Export first.** This is irreversible, and there is no undo.

1. **Settings** → *Advanced Options* → **Reset Settings**, then re-enter what you want.
2. **Rangers** → *Advanced* → **Delete Rangers**. Note that a default roster is loaded
   automatically in its place; edit or replace it as needed, then **Save Rangers**.
3. **Reports** → *Advanced* → **Delete ALL Field Reports from local storage**.

Switching to a different browser or a different device also gives you a completely fresh
environment — RangerTrak's data is per-browser, so Firefox knows nothing about what you did
in Chrome. That is a convenient way to experiment without disturbing a real mission.

---

## Cold start: no preparation, no Internet

If RangerTrak has never been opened on this device and you have no connection, it cannot
load. There is no way around this — the app has to arrive from somewhere once.

Your options, best first:

1. **Find any connection, however brief.** A phone hotspot for even a minute is enough to
   load the app. Then immediately follow the setup steps above.
2. **Use a device that already has it.** Any device with a warm or hot start is more
   valuable right now than a faster device without one.
3. **Restore from a backup file.** If someone has a backed-up mission file, open
   RangerTrak on a device that *can* load it and use **Restore mission**.

Once you are running, **capture data first and tidy later**. Coordinates and call signs
work offline; address lookup does not. A report with coordinates and a call sign is
complete enough — addresses can be filled in afterwards.

---

## What needs Internet, and what doesn't

| Feature | Without Internet |
| --- | --- |
| Entering and saving reports | ✅ Works |
| Roster, Reports table, Settings, Log | ✅ Works |
| Exporting and importing missions | ✅ Works |
| Coordinate entry and conversion | ✅ Works |
| **Map — Leaflet (the default engine)** | ⚠️ Only the areas you saved in advance |
| **Map — Backup switch (MapLibre + PMTiles)** | ✅ Works everywhere at low detail; street-level detail *only where you loaded a map file, or the Vashon Island demo area* |
| Address lookup (typing an address to get coordinates) | ❌ Needs Internet |
| Reverse lookup (coordinates to a street address) | ❌ Needs Internet |

---

## Getting a newer version

RangerTrak keeps working from the copy already on your device, so a new release does not
reach you until the app fetches it. When it has, a banner appears at the **top of the
screen, no matter which page you're on or how far you've scrolled**, telling you a new
version is ready with a **Reload now** button; accept when you are between reports, not
mid-report. The footer also names the running version and shows when it last checked.
Nothing reloads on its own.

If you suspect you are running an old copy, reload the page while holding **Ctrl+Shift**
(**Cmd+Shift** on a Mac).

---

## Your data, and who can see it

Everything lives **on your device only**, in your browser's storage. Nothing is uploaded.

That cuts both ways:

- **Nobody else can see your mission data** — no server, no account, no third party.
- **Nobody else can recover it either.** Clearing browser data, using a different browser,
  or using a different device means starting empty. **Export regularly.**

The roster is the sensitive part: names, personal phone numbers, photos, and call signs that
tie back to publicly searchable licence records. It is stored unencrypted, and exports are
plain files. **The same applies to log exports** — the log is a raw diagnostic record and
can quote report details and addresses verbatim.

Given a callsign, the FCC's own public licensee lookup already shows more than this roster
does — legal name and mailing address for any licensed amateur radio operator. This app does
not meaningfully add to that public exposure, with one exception: photographs, which are not
part of any public record.

> **Planned:** optional passphrase encryption, first for exported files and later for the
> data held on the device. Until then, the practical protection is device security — lock
> the device, and treat exported files the way you would a printed roster. Share only with people who need it for the
mission, and delete exports when the mission is over. Follow your agency's policy on
handling participant information.

---

## Trying it out, and known rough edges

**Want to see it populated?** On **Settings**, under *Advanced Options*, press
**Load Sample Mission**. This fills the app with a demonstration roster and about thirty
reports across Vashon Island — useful for training, demonstrating to others, or just
seeing what a busy mission looks like.

> This **replaces** your current roster and reports. Export first if you have anything you
> need.

**Rough edges to be aware of:**

- **Roster edits are not saved automatically.** Press **Save Rangers** on the Rangers page,
  or your changes are lost on reload.
- **The Alternative map's built-in detail covers Vashon Island only.** Everywhere else you
  get a low-detail world map with your report markers on it — correct positions, no
  streets — unless you load your own map file for that area (see "For coordinators: make
  your own offline map file" above). Broader built-in coverage is planned.
- **Report selection resets** when you reload the page or move between pages.

If something looks wrong, check the **Log** page — it records what the app did and any
errors, which is the most useful thing to include when reporting a problem.
