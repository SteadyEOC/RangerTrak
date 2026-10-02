# RangerTrak Field Guide

For the people who actually use RangerTrak during a mission — Emergency Coordinators, net
control operators, and anyone staffing a command post. No technical background assumed.

*Developers: see [ARCHITECTURE.md](ARCHITECTURE.md) instead. This document deliberately
avoids implementation detail.*

---

## What RangerTrak does

RangerTrak records **who is where, when, and in what condition** during a mission, and
plots it on a map. It runs entirely in your browser on your own device. There is no
server, no account, and no login — your mission stays on this device. When online, the
app fetches map images and looks up addresses for report locations. See
[RangerTrak's privacy policy](https://rangertrak.com/privacy.html) for the full picture.
It is free and open source, so you can copy it, change it, and keep running it for as
long as you like.

| Page | What it's for |
| --- | --- |
| **Entry** | Enter a radio log entry (also called a field report): who called in, where they are, their status, and any notes. This is where you spend the mission. |
| **Radio Log** | Every report so far, in a sortable, filterable table. Select rows here to focus the maps on just those reports. |
| **Rangers** | Your roster — call signs, names, contact details, teams. |
| **Map** | Leaflet by default, using standard online road maps — best detail, anywhere in the world, but needs Internet. The Leaflet layers box (top right of the map) also offers a satellite base map with optional roads and place names on top, marked hiking trails and terrain relief (all need Internet; their providers don't allow saving them for offline use), USGS aerial photos and USGS shaded relief (US only, and they can be saved for offline use, at roughly twice OpenTopoMap's size), plus a USNG / MGRS grid and range rings around the command post (both work with no Internet); **Zoom to offline tiles** shows the areas you have saved. On the Leaflet map each ranger's route trail runs thin and faint (older) to thick and bright (newest), and the newest leg slowly flows toward the latest position. An on-page switch tries the Alternative engine (MapLibre) instead: map data built into the app, works with no Internet at all — a low-detail world map everywhere, plus real street-level detail in each demo area while that demo is loaded, and wherever you load your own map file (see step 6 below). **Print map** produces a one-page landscape map sheet: a title line (mission, operational period, time printed), the map filling most of the page with a north arrow, scale bar, map credit and latitude/longitude marks around the edge, a legend of the markers, teams and places beside the map, and a "Prepared by" line. Every report prints as its own marker, so a PDF can be zoomed. The button takes a few seconds to load a more detailed map for paper: online it fetches it, offline it uses your saved area (which includes two closer zoom levels, so print at about the zoom you saved at); use it rather than the browser's own Print command. Every Print button opens the browser's own print dialog: pick your printer there once (it often starts on "Save as PDF") and the browser remembers it. |
| **Mission** | Mission name, operating period, expected check-in interval, default location, tactical call signs, status labels and colours, backup and restore. |
| **Log** | A running record of what the app did, including warnings and crashes. Export it when reporting a problem. |

### Who it's for

RangerTrak is built for teams reachable only by **voice radio** — CERT, ACS/ARES, SAR, and
wildland-fire operations — where field members carry no networked device. Three roles:

1. **Scribe / net control (command post).** Sets up the mission and operating period once,
   maintains the roster, then spends the incident on the Entry screen transcribing reports
   radioed in: who, where, when, status, notes. **This is the primary user** — the app is
   designed around their speed and accuracy.
2. **Field ranger / team.** Never touches the app. They are a voice on the radio.
   RangerTrak's job is to make their spoken location fast and unambiguous to write down.
3. **Analyst / Incident Commander.** Uses the Radio Log table and maps during the incident to
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

On an iPhone or iPad, do this *before* setting up a mission. An installed (Home Screen)
app keeps its own storage, separate from Safari's — a mission started in a Safari tab
will not appear once you install. If you already started in Safari, use **Back up
mission** there, then **Restore mission** in the installed app.

**2. Ask the browser to protect your data.**
On the **Mission** page, find the **Data safety** card and check the storage status. If it
offers to request persistent storage, accept. Without this, a browser short on disk space
may quietly discard your mission data. RangerTrak asks automatically, but browsers are more
willing to say yes once the app is installed — so do this *after* step 1.

Especially on iPhone and iPad, every browser (Chrome included) runs on Safari's engine,
which does not reliably honor this request and can clear a site's data after about a week
unused. Safari on a Mac does the same. There, installing (step 1) and **Back up mission**
are the real protection.

**3. Load your roster.**
On the **Rangers** page, enter your people or import them. Adding, importing and deleting
save themselves, and so do edits typed into the grid — there is no Save button to remember.

**4. Set up the mission.**
On the **Mission** page, fill in the mission and event names, the operating period start
and end, and the default coordinates for your area. The default location is where maps and
new reports start from, so getting it right saves work all mission. There is no Save button:
the page saves your changes by itself about a second after you stop typing, and a small note at
the top says **Saved**.

If your net uses **tactical call signs** (names for positions and teams, such as "Gate 3" or
"Vashon EOC"), list them in the Mission page's **Tactical call signs** card, and optionally pick
who is operating each one. Change the operator at shift change; earlier entries keep the call
sign they were logged with.

**5. Check your statuses.**
Still in **Mission**, review the radio log entry statuses and their colours. These drive the
colour coding on the Radio Log table. Rename them to match your agency's terminology now,
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
> real street-level detail outside the demo areas, you can cut a small map file for
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
On **Mission**, press **Back up mission**. This writes a single file containing your
settings, roster, and any reports. Keep it somewhere safe — a USB stick, another device.
If the browser data is ever lost, **Restore mission** restores everything.

> ⚠️ That export file contains personal information about your people — names, home
> addresses, phone numbers, and call signs — and it is **not encrypted**, even if you have
> turned on device encryption (that protects the browser copy, not this file). Treat it like
> any other confidential roster.

**8. Try it for real.**
Turn off Wi-Fi and mobile data, then open RangerTrak and enter a test report. Five minutes
of this now is worth more than any checklist. Delete the test report afterwards.

---

## During the mission (the entry phase)

Setup is infrequent and considered; entry is repetitive and time-critical — the same person
may do both, but they're different modes of working. See the in-app Help page for more on
the distinction.

**Entering a report.** On the **Entry** page, pick the ranger (the **Ranger ID** field: type their ID, call sign or name), set the location, choose a
status, add notes, and submit. Reports save to the device immediately.

The same box also offers the mission's tactical calls. Pick one and the operator's call sign is
filled in for you (left blank if they have none). The optional **To station** box
records which station the message went to, with the same choices; leave it blank if it does not
matter. It is separate from **ICS-213 addressed to**, further down.

**Setting a location.** You can enter coordinates directly, or type an address and let
RangerTrak look it up. The small "Current Location" map right on the Entry page is the
fastest way — click anywhere on it and that position is set immediately, no typing or
pasting needed (it's also copied to your clipboard, in case you want it elsewhere too).
The **Map** page doesn't set the location this way, in either engine; clicking it copies
the coordinate under your cursor so you can paste it into Entry yourself.

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

Every format is always available from Entry's own switcher, so an unexpected radio
call in a format your mission doesn't usually use is never a problem. **Mission → Location
defaults** only picks which format Entry opens on by default for this mission - a convenience
for a team that mostly works in one format, not a restriction on what you can enter. Don't
see a coordinate system your team actually uses (e.g. PLSS Township/Range/Section, or
another country's national grid)? Open an issue on
[GitHub](https://github.com/SteadyEOC/RangerTrak/issues) — genuine field use is exactly
what decides what gets added next.

> Address lookup needs Internet. Without it, you'll see a message saying so. Coordinates
> always work offline — so if the network is down, work in coordinates.

**Watching the picture develop.** The **Map** page plots every report, with either map. Where reports cluster
together, they are grouped into a numbered circle; zoom in to separate them. Click a marker
for detail.

**Focusing on a subset.** Select rows on the **Radio Log** page, then switch to the **Map**
page — you can show just the selected reports instead of everything. Useful for a single team or a
single incident.

**Handing over.** Press **Back up mission** on **Mission** and give the file to the
incoming operator, who restores it on their device.

**Reports from rangers' own phones.** A device is set up as either the **full app** (the
command post) or **field mode** (a ranger's own phone: Entry and Help only, chosen once on a
new device - from the welcome panel on a phone or tablet, or **Mission** > **Advanced** >
**Field phone** on a laptop, and undone with **Turn off field mode** in Help - the AAR (after-action review) notes page has no menu item on
either device, but is still reached from the AAR note button, see below). RangerTrak never sends a
report over the network by itself. Every report saves on the phone straight away. **Send my
reports** bundles them into one file and opens the phone's share sheet, and the ranger picks
the route: email or a messaging app over cell data or WiFi, or AirDrop / Quick Share to a
station device nearby. At the command post, **Load Report Packet** on the Radio Log page
merges it, skipping reports it already has. With no data path, read the report over the radio
as always. Do the same for anything urgent, because the phone gets no receipt. Install the
app on each phone from rangertrak.org **before** heading out. **RangerTrak Board** is not a
third mode. It is an option on the command post's app that shows a read-only copy of the log
to anyone on the station's WiFi; phones cannot send reports through it.

**Noting things for the debrief.** When you notice something to fix or improve later, such as
a relay point out of range or a form field that slows you down, press **AAR note** at the
top of any page. Type a line, choose whether it is about the incident or about RangerTrak, and
save. You stay on the page you were on. After the mission, the **AAR notes** page lists the
notes. Add an area, a recommendation and an owner to each, then print the incident notes as
an improvement-plan table or export them all as a spreadsheet. Notes are in the mission
backup, and device encryption covers them. An AAR note is private to this device until you
choose to send it: **Feedback** (Help) is the separate, public path to RangerTrak's
developers, and only takes a note marked *RangerTrak*, through **Review and send**, after you
check it.

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

1. **Mission** → *Danger zone* → **Reset mission to defaults**, then re-enter what you want.
2. **Rangers** → *Danger zone* → **Delete all rangers**. The roster stays empty until you
   import one or add rangers — edits save automatically as you make them.
3. **Radio Log** → *Danger zone* → **Delete radio log entries and messages**.

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
| Roster, Radio Log table, Mission, Log | ✅ Works |
| Exporting and importing missions | ✅ Works |
| Coordinate entry and conversion | ✅ Works |
| **Map — Leaflet (the default engine)** | ⚠️ Only the areas you saved in advance |
| **Map — Backup switch (MapLibre + PMTiles)** | ✅ Works everywhere at low detail; street-level detail *only where you loaded a map file, or in a loaded demo's area* |
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
tie back to publicly searchable licence records. It is stored unencrypted on the device,
unless you turn on **device encryption** (Mission → Data safety → Device encryption), which
also covers radio log entries and ranger photos and needs a passphrase you choose — see below.
**The same applies to log exports regardless** — the log is a raw diagnostic record and can
quote report details and addresses verbatim, and is never encrypted.

### Encrypting the roster and reports on this device

Mission → Data safety has a **Device encryption** toggle. Turned on, it encrypts the roster,
radio log entries, after-action notes and ranger photos stored in this browser with a passphrase you choose — so a
lost or stolen device, or someone else's hands on a shared command-post laptop, doesn't hand
over the roster in the clear. It does **not** protect the app while it is open and unlocked,
the same as any lock screen wouldn't.

- **Requires a recent backup first** — one finished in the last 10 minutes, plain or
  passphrase-protected, either counts. That guarantees a way back if the passphrase is ever
  mistyped or forgotten.
- **The passphrase is typed twice, with no hint stored anywhere.** Forget it, and that data
  is gone for good — there is no reset and no recovery, the same property that keeps a
  passphrase-protected backup safe.
- **You will be asked for it again** on your next visit and after every app update — reloading
  clears it from memory.
- **Locations and mission settings stay in the clear either way** — they carry little to no
  personal data, and keeping them plain means the map still works if you are ever locked out
  before restoring from a backup.
- If you ever cannot remember the passphrase, the lock screen offers **"Forgot it: erase this
  device's mission data"** — it deletes the roster, reports and photos on this device (not any
  backup file elsewhere) and lets you restore from a backup afterward.

### Putting a passphrase on a mission backup

**Mission → Back up mission** now offers a passphrase. This is the file most worth
protecting: it contains the whole roster *and* every report, and it is the one meant to
travel — onto a USB stick, into an email, across to another laptop.

- **Leave the passphrase blank** and you get the same plain file as before. That is still
  the default, and older backups keep opening normally.
- **Type one** and the file is encrypted. You will be asked to type it a second time,
  because a mistyped passphrase is not discovered until the day you need the backup.
- Encrypted backups are saved as `.rtenc.json` so you can spot them in a folder. Restoring
  one asks for the passphrase.

> ⚠️ **A forgotten passphrase cannot be recovered.** There is no server, no reset, and
> nobody to ask — that is the same property that keeps your data off the Internet. If the
> passphrase is lost, so is that backup. Keep one unencrypted copy somewhere physically
> secure, or store the passphrase the way your agency stores other credentials.

This protects a file that has left your device — a lost laptop, a misplaced stick, an email
forwarded further than intended. It does **not** protect the data sitting in the browser on
an unlocked device — that's what **device encryption** (above) is for, and it too stops
mattering the moment the device is open and unlocked.

Given a callsign, the FCC's own public licensee lookup already shows more than this roster
does — legal name and mailing address for any licensed amateur radio operator. This app does
not meaningfully add to that public exposure, with one exception: photographs, which are not
part of any public record.

> **Shipped so far:** the passphrase above, for **Mission → Back up mission** only (the
> section right above this one). **Still plain, no passphrase option yet:** Rangers'
> **Export roster**, and the Radio Log/Rangers spreadsheet exports — if the roster needs to
> leave the device and Back up mission's own scope (settings + roster + reports) is more
> than you want to hand over, a mission backup with a passphrase is the protected option
> today; those narrower exports are not. **Still planned:** encryption for the data sitting
> on the device itself, not just what leaves it.

The practical protection for anything not yet encrypted is device security — lock the
device, and treat exported files the way you would a printed roster. Share only with
people who need it for the mission, and delete exports when the mission is over. Follow
your agency's policy on handling participant information.

---

## Trying it out, and known rough edges

**Want to see it populated?** On a brand-new device, the Entry page's welcome panel offers
**Load Demo Data**. Otherwise, on **Mission** → *Danger zone*, pick a **Demo scenario** and
press **Load sample mission**. This fills the app with a demonstration roster and about thirty
reports in the demo area you pick (Grand Canyon by default) — useful for training, demonstrating to others, or just
seeing what a busy mission looks like.

> This **replaces** your current roster and reports. Export first if you have anything you
> need.

**Rough edges to be aware of:**

- **The Alternative map's built-in street detail covers the demo areas only**, and only
  while that demo is loaded. Everywhere else you get a low-detail world map with your report
  markers on it — correct positions, no streets — unless you load your own map file for that
  area (see "For coordinators: make your own offline map file" above). The map says so when
  you zoom in where it has no detail.
- **Report selection resets** when you reload the page or move between pages.

If something looks wrong, check the **Log** page — it records what the app did and any
errors, which is the most useful thing to include when reporting a problem.
