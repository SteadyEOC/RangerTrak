# RangerTrak Field Guide

For the people who actually use RangerTrak during a mission — Emergency Coordinators, net
control operators, and anyone staffing a command post. No technical background assumed.

*Developers: see [ARCHITECTURE.md](ARCHITECTURE.md) instead. This document deliberately
avoids implementation detail.*

---

## What RangerTrak does

RangerTrak records **who is where, when, and in what condition** during a mission, and
plots it on a map. It runs entirely in your browser on your own device. There is no
server, no account, and no login — your mission stays on this device, and it stays there
through power cuts and restarts (see [Your data](#your-data-where-it-lives-and-who-can-see-it)).
When online, the app fetches map images and looks up addresses for report locations. See
[RangerTrak's privacy policy](https://rangertrak.com/privacy.html) for the full picture.
It is free and open source, so you can copy it, change it, and keep running it for as
long as you like.

| Page | What it's for |
| --- | --- |
| **Entry** | Enter a radio log entry (also called a field report): who called in, where they are, their status, and any notes. This is where you spend the mission. |
| **Radio Log** | Every report so far, in a sortable, filterable table. Select rows here to focus the map on just those reports. |
| **Rangers** | Your roster — call signs, names, contact details, teams. |
| **Map** | Every report on a map, with each ranger's trail, your places, and printing. See [The Map page](#the-map-page). |
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
[Before the mission](#before-the-mission-getting-to-a-hot-start-the-setup-phase) says how
to get there.

### 🌤 Warm start — app used before, on this device

You have opened RangerTrak on this device before while connected, but did not do full
preparation. The app itself will load offline, and any map area you previously looked at
will still be there. Areas you never viewed will be blank.

**Mostly works offline**, with gaps you will discover at the worst moment.

### ❄️ Cold start — first time on this device

You are opening RangerTrak on this device for the first time. Without Internet, nothing
loads at all — the app has to arrive from somewhere once. There is no way around this.

If you are caught this way, your options, best first:

1. **Find any connection, however brief.** A phone hotspot for even a minute is enough to
   load the app. Then follow the setup steps below straight away.
2. **Use a device that already has it.** Any device with a warm or hot start is more
   valuable right now than a faster device without one.
3. **Restore from a backup file.** If someone has a backed-up mission file, open
   RangerTrak on a device that *can* load it and use **Restore mission**.

Once you are running, **capture data first and tidy later**. Coordinates and call signs
work offline; address lookup does not. A report with coordinates and a call sign is
complete enough — addresses can be filled in afterwards.

---

## Before the mission: getting to a hot start (the setup phase)

Do this while you still have Internet and mains power. It takes a few minutes and is the
difference between a working tool and a blank screen.

**1. Install RangerTrak as an app.**
Look for the **Install** button in the top-right of the header. Installing gives you a
proper icon, a window without browser clutter, and makes the device far more likely to
keep your data.

No Install button? It shows only when the browser offers to install, and it is held back
while a mission is under way. Install from the browser instead: in Chrome or Edge, the icon
at the right of the address bar or the browser menu; on Android, the menu's **Add to Home
screen**; on iPhone or iPad, **Share** then **Add to Home Screen**; in Safari on a Mac,
**File** then **Add to Dock**. Firefox on a computer, a private window, and the built-in
browser of an email or chat app can't install: open rangertrak.org in Chrome or Edge, in an
ordinary window. Help → FAQ has the details.

On an iPhone or iPad, do this *before* setting up a mission or loading a map file. An
installed (Home Screen) app keeps its own storage, separate from Safari's — a mission
started in a Safari tab will not appear once you install. If you already started in
Safari, use **Back up mission** there, then **Restore mission** in the installed app.

**2. Ask the browser to protect your data.**
On the **Mission** page, find the **Data safety** card and check the storage status. If it
offers to request persistent storage, accept. RangerTrak asks automatically, but browsers
are more willing to say yes once the app is installed — so do this *after* step 1.
[Your data](#what-keeps-your-data-and-what-loses-it) says why this matters, and why
iPhones and iPads need step 1 and a backup instead.

**3. Load your roster.**
On the **Rangers** page, enter your people or import them from a spreadsheet (**Import, export &
print** → **Import a list…**). Adding, importing and deleting save themselves, and so do edits
typed into the grid — there is no Save button to remember. Starting from an Excel or Google
Sheets list, or building one up from several lists? See [LOADING-YOUR-ROSTER.md](LOADING-YOUR-ROSTER.md).

Team names: one unique name per team; with mutual aid, include the town or department,
e.g. "Burien CERT 2".

Places for the map (shelters, staging areas, a Google My Maps export)? See
[LOADING-PLACES.md](LOADING-PLACES.md). (Older notes may call these *locations*; it is the
same thing.)

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

Give this device its own **station letter** (Mission → **Operational period**) if more than
one device will log on your net. See [Message numbers](#message-numbers).

**5. Check your statuses.**
Still in **Mission**, review the radio log entry statuses and their colours. These drive the
colour coding on the Radio Log table. Rename them to match your agency's terminology now,
not mid-mission.

**6. Prime the maps — the step people forget.**

Both map engines live on the one **Map** page, switched with the toggle above the map.

- With the default **Leaflet** map showing, switch its base layer to **OpenTopoMap**
  (the contour map), navigate to your operating area at the zoom level you expect to use,
  and press **💾 Save this area for offline use**. This stores those tiles — the level you
  saved at, plus a couple of levels deeper — on the device. Only the areas and zoom levels
  you actually save will be available later. (Saving is only offered on OpenTopoMap and the
  two USGS layers; OpenStreetMap's own rules don't allow bulk offline downloads from its
  servers.)
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
>    file…**. (On an iPhone or iPad, install first: step 1.)
>
> Map data from this tool carries the same OpenStreetMap attribution the app already shows.

**7. Take a backup.**
On **Mission**, press **Back up mission**. This writes a file containing your settings,
roster, ranger photos, places and any reports. Keep it somewhere safe — a USB stick, another
device. If the browser data is ever lost, **Restore mission** restores everything.

- If any report carries a photo, audio or video, a second file ending `-attachments.zip` is
  saved beside it. Keep the two together.
- The file holds your people's names, addresses and phone numbers. It is **plain, readable
  text unless you give it a passphrase** when you back up — see
  [Putting a passphrase on a mission backup](#putting-a-passphrase-on-a-mission-backup).
  Device encryption does not cover it.
- Your Google geocoding key, if you set one, goes in the backup only when it has a passphrase.

> **Tip:** restored the wrong file, or imported the wrong roster? **Mission > Data safety > Undo
> last import** (also shown on the Rangers page after a roster import), within 24 hours. Undoing
> a roster import puts back only the roster and photos, never your log.

**8. Try it for real.**
Turn off Wi-Fi and mobile data, then open RangerTrak and enter a test report. Five minutes
of this now is worth more than any checklist. Delete the test report afterwards.

---

## During the mission (the entry phase)

Setup is infrequent and considered; entry is repetitive and time-critical — the same person
may do both, but they're different modes of working. See the in-app Help page for more on
the distinction.

### Entering a report

On the **Entry** page, pick the ranger (the **Ranger ID** field: type their ID, call sign or
name), set the location, choose a status, add notes, and submit. Reports save to the device
immediately.

The same box also offers the mission's tactical calls. Pick one and the operator's call sign is
filled in for you (left blank if they have none). The optional **To station** box
records which station the message went to, with the same choices; leave it blank if it does not
matter. It is separate from **ICS-213 addressed to**, further down.

### Setting a location

The small "Current Location" map on the Entry page is the fastest way: click anywhere on it
and that position is set immediately, no typing needed (it's also copied to your clipboard).
Clicking the big **Map** page does *not* set it; there, a click only copies the coordinate
under your cursor, for you to paste into Entry.

You can also type coordinates, or an address for RangerTrak to look up. RangerTrak accepts a
position in whichever format it was called in over the radio. A small switcher above the
coordinate fields picks which one you type into; every other format updates underneath it,
read-only, so you can see the same position however else it's expressed:

- **Decimal Degrees, Degrees/Decimal Minutes, or Degrees-Minutes-Seconds** — the usual
  latitude/longitude formats.
- **MGRS** (the grid system US SAR, wildland fire, and the National Guard use, printed
  on every USGS topo quad) and **UTM** — each entered as its own set of boxes (grid
  zone, easting, northing, and so on), matching how they're read aloud in digit groups
  over the air.
- **Maidenhead grid locators** (used by ham radio operators) — typed into the same box
  as a street address, Plus Code, or What3Words address; RangerTrak recognizes the
  shape and converts it automatically.

Every format is always available from Entry's own switcher. **Mission → Location defaults**
only picks which one Entry opens on — a convenience, not a restriction. Don't see a
coordinate system your team uses (e.g. PLSS Township/Range/Section, or another country's
national grid)? Open an issue on [GitHub](https://github.com/SteadyEOC/RangerTrak/issues) —
genuine field use is exactly what decides what gets added next.

> - All of these assume a modern GPS position (WGS84). A coordinate read off an **older
>   paper topo map** may use an older reference (NAD27), which can be off by 100–200 m in the
>   western US.
> - **Address lookup needs Internet.** Without it, you'll see a message saying so.
>   Coordinates always work offline — if the network is down, work in coordinates.

### Message numbers

Every entry gets a number when it is logged, such as **A007**: the station letter, then a
count. In full it reads `26-0142 / OP 2 / A007` (mission, operational period, number), and
that is what a printed ICS-213 shows in its top margin.

- The number never changes afterwards.
- The count starts again at 001 in each operational period.
- The letter belongs to the device (Mission → **Operational period**). Give each device on
  your net its own.
- Reports loaded from a ranger's phone get the next number on the scribe's device.
- If two different entries turn up with the same number, the app tells you and leaves both as
  they are; change one device's letter.

### Marking entries

The first column of the Radio Log is a small box. Click it to mark an entry handled (✓),
passed on (→) or needing action (!), and again to clear it. The printed ICS-309 log shows the
mark in its first column, with an empty box for entries you have not marked, so a paper copy
can be ticked by hand.

### The Radio Log and Rangers tables

Both pages work the same way:

- **Fit to screen** sizes the columns to the window.
- When a column filter is on, a strip above the table names it, so nobody forgets rows are
  hidden. The x on a filter removes it; **Show everything** clears them all. On the Radio Log,
  entries from the current op period carry a coloured edge, and **Current op period** above the
  table shows only those (it starts off each visit; change the period name on Mission when a new one begins).
- The Export card says how many rows it will save: every row if **All rows** is ticked,
  otherwise the rows you have selected, otherwise the rows the table is showing. The printed
  ICS-309 follows the filter too.
- **Print roster** (Rangers, *Import, export & print*) prints a contact sheet of those rows by
  team: call sign, name, role, phone and ID. It carries names and phone numbers, so keep the
  paper safe.
- To remove a ranger, click their row on **Rangers** (more rows if you like) and press
  **Delete** beside **Add**. It asks first. Reports already logged stay as they are.
- Two rangers with the same ID or call sign are allowed, but shown in red so a typo stands out.

### Attaching photos, video and audio

The **Attach** button under Notes (in Full view, or in Simple view once the mission has an
attachment) adds files to the entry you are typing; on a phone or tablet, **Take photo /
video** opens the camera. They wait as chips and are stored when you save the entry; a saved
entry shows a **📎 N** chip that opens the viewer. In the viewer you can **Add** more, **Save**
or **Share** the original, and **Remove** one — which deletes it from this device but leaves
"Removed 14:02 by K7ABC" on the entry.

- **Keep original is the default.** The original is stored exactly as it arrived and given a
  SHA-256 fingerprint, shown in short form with a Copy button, so a copy can later be shown to
  be identical. Backups and hand-overs re-check every file against its fingerprint when they
  open it.
- **Smaller copy (your choice, per file).** Each photo, video or audio file also offers
  **Smaller copy**: much faster over a field network, but fine detail is lost. The file's own
  location, time and camera details are kept wherever the file has them. Only the smaller copy
  is stored; the viewer says so ("Smaller copy, made on K7ABC's phone from 4.2 MB") and shows
  two fingerprints, this file's and the original's. A long video takes a while; **Cancel**
  keeps the original. If a copy would not be smaller, or your browser cannot make one, the
  original is kept.
- **If you receive a file, think before you shrink it.** In the viewer, **Make a smaller
  copy...** warns that the copy will not match the sender's fingerprint. **Keep both** (the
  default) adds the copy beside the original. **Replace the original** needs you to type
  REPLACE; the entry then shows "Replaced by a smaller copy 14:02 by N7XYZ".
- **Originals keep the camera's hidden details, GPS position included.** The small pictures
  used in lists and printouts do not. Think before sharing an original outside the team.
- **Hover to peek.** On the Radio Log, hold the pointer over a **📎 N** chip to see small
  pictures of the entry's files; click to open.
- **Long videos:** set the camera to 720p before you record. The file starts far smaller.
- **An iPhone may convert a HEIC photo to JPEG** before RangerTrak sees it. RangerTrak
  fingerprints what it is given.
- **Space.** Mission > Data safety shows "Attachments: 41 MB of 512 MB (8%)" and lets you
  change the budget. RangerTrak warns at 80% and 100% and asks before any file over 100 MB; it
  never refuses (only the browser's own storage limit can).

### The Map page

The Map page plots every report. Where reports cluster together, they are grouped into a
numbered circle; zoom in to separate them. Click a marker for detail.

- **Two engines.** **Leaflet** is the default: standard online road maps, best detail,
  anywhere in the world, but it needs Internet except where you saved an area (setup step 6).
  The **Alternative** engine (MapLibre) has its map built in and works with no Internet: a
  low-detail world map everywhere, real street detail in each demo area while that demo is
  loaded, and wherever you load your own map file.
- **Layers** (the box at the top right of the Leaflet map): a satellite base map with optional
  roads and place names, marked hiking trails and terrain relief (these need Internet; their
  providers don't allow offline saving); USGS aerial photos and shaded relief (US only, can be
  saved for offline use, about twice OpenTopoMap's size); your **Places**; a USNG / MGRS grid
  and range rings around the command post (both work with no Internet). **Zoom to offline
  tiles** shows the areas you have saved.
- **Trails.** Each ranger's trail runs thin and faint (older) to thick and bright (newest), and
  the newest leg slowly flows toward the latest position.
- **Show** narrows what is drawn: **Latest per ranger** (one marker each, no trails) or
  **Needs attention** (statuses flagged on the Mission page). A strip along the top of the map
  lists whatever is hidden.
- **Just the selected reports.** Select rows on the **Radio Log**, then on the Map turn on
  **Just those selected on the Radio Log page**. Useful for a single team or incident.
- **Print map** makes a one-page landscape map sheet: north arrow, scale bar, map credit,
  latitude/longitude marks, a title box (mission, operational period, time printed), a legend
  of markers, teams and places, range rings and a "Prepared by" line. Every report prints as
  its own marker with its "minutes since" number; reports at nearly the same spot fan out on
  thin lines so each can be read. It takes a few seconds to load a more detailed map for
  paper: online it fetches it, offline it uses your saved area (print at about the zoom you
  saved at). Use it rather than the browser's own Print command.
- **Print places** (in *Import, export & print* under the map) prints a list of the chosen
  places by category, with a small map of them across the top.

Every Print button opens the browser's own print dialog: pick your printer there once (it
often starts on "Save as PDF") and the browser remembers it.

### Walk-ups and roster fixes

Volunteers who turn up on the day, and the phone numbers and call signs corrected at the desk,
go back to whoever keeps your master roster: on **Rangers**, *Import, export & print* →
**Export changes** saves only the rangers added or edited on this device since the roster was
imported. Treat the file like the roster itself.

### Reports from rangers' own phones

A device is set up as either the **full app** (the command post) or **field mode** (a ranger's
own phone: Entry and Help only). Choose field mode once on a new device, from the welcome
panel on a phone or tablet, or **Mission** > **Advanced** > **Field phone** on a laptop; undo
it with **Turn off field mode** in Help. Install the app on each phone from rangertrak.org
**before** heading out.

- **RangerTrak never sends a report over the network by itself.** Every report saves on the
  phone straight away.
- **Send my reports** bundles them into one file and opens the phone's share sheet. The ranger
  picks the route: email or a messaging app over cell data or Wi-Fi, or AirDrop / Quick Share
  to a station device nearby.
- **At the command post,** **Load Report Packet** on the Radio Log page merges it, skipping
  reports it already has. Pick the packet and any photos together: each photo is stored only if
  it matches a report in the packet, and the app says how many were added and how many are
  still on the ranger's phone. If the share sheet can't take the photos (too big), only the
  packet goes and the app says so.
- **The phone gets no receipt.** With no data path, or for anything urgent, read the report
  over the radio as always.

### RangerTrak Board

The Board is not a third mode. It is an option on the command post's app that shows a
read-only copy of the log to anyone on the station's Wi-Fi, behind an optional password you set
on the Mission page. Viewers see two tabs: **Radio log** and **ICS-213 messages** (open a
message to read or print it). Phones cannot send reports through it. Only one device publishes
to it at a time, and another device with the password can take it over.

**Starting the Board.** It runs on a laptop or desktop, often the scribe's own. Download the
RangerTrak Board kit (`rangertrak-board-<version>.zip`, under **Assets** on the latest release at
<https://github.com/SteadyEOC/RangerTrak/releases>), unzip it, and double-click **Start RangerTrak
Board**. It needs Node.js 24 or newer and nothing else. Paste the address it prints into the
Mission page's Board card. Use the `rangertrak-board.local` or numbered address even on the same
computer: `localhost` publishes, but the viewer link made from it opens nowhere else.

**If the Board won't connect,** press **Test connection** on the Mission page's RangerTrak
Board card. It tells you, in one sentence, the most likely reason:

- this device is not on a network,
- it is on a different Wi-Fi from the Board laptop,
- the browser has not accepted the Board's certificate yet (press **Open the Board**, choose
  Advanced, then Proceed, and come back),
- the browser is blocking access to devices on this network, or
- something answered that is not a RangerTrak Board.

These are best guesses; **Details** shows the technical line for whoever is helping. The Board
laptop's own window lists what it found when it started, and prints a line whenever the
scribe, the number of viewers or the latest report changes. On a viewer's screen:

- **lost** means the viewer can't reach the Board ("Lost the Board at 12:04. Still on the
  Wi-Fi? Is the Board laptop awake?"); the last reports stay on screen.
- **Scribe quiet** means the Board is fine but the scribe's device has not checked in for over
  2 minutes.

### Handing over to another scribe

There are two ways, depending on whether the other device is blank:

- **The other device is blank:** press **Back up mission** on **Mission**, give the file to the
  incoming scribe, and they use **Restore mission**.
- **The other device has entries of its own** (a mission running past one scribe, or a second
  scribe at another radio): on the Radio Log page, **Hand over to another scribe** saves one file
  with the people, the places and every entry on this device. On the other device, **Merge in**
  shows what it would add or change, and only then merges it.

What a merge does:

- Nothing is replaced or removed. Entries keep the numbers they were given, and a correction
  made before handing over comes across.
- Merging the same file twice, or handing it back and forth, never makes duplicates. A walk-up
  typed in on both devices becomes one person with their entries attached.
- The app then asks who this device is from now on: **Take over station A** (the other device
  stops logging and the count carries on) or **Log alongside as station B** (both keep logging,
  each with its own letter).
- The file holds people's names and phone numbers, so type a passphrase to lock it, or leave
  the box blank and it is not locked. A forgotten passphrase cannot be recovered.
- Photos and other attachments travel in the file's own `attachments/` folder.

### Noting things for the debrief (AAR/214)

Press **AAR/214** at the top of any page, type a line and save; you stay on the page you were
on. At the top of the box, choose what the line is:

- **Mission** — something about this mission to fix or improve later, such as a relay point
  out of range.
- **App** — something about RangerTrak itself, such as a form field that slows you down.
- **ICS-214** — a line for your **ICS-214 activity log**: what you did or what changed at your
  position, such as arriving, a shift change or a radio that stopped working. It is not a radio
  call, so it is not in the radio log. The time starts as now; change it if you are writing
  something down late.

Each save makes one line of one kind. After the mission, the **AAR notes** page lists them:

- Give each note an area, a recommendation and an owner, then print the mission notes as an
  improvement-plan table, or export them all as a spreadsheet.
- The ICS-214 section lists the 214 lines, and **Export ICS-214** fills in FEMA's own form to
  print and sign.
- Notes are in the mission backup, and device encryption covers them.
- An AAR note is private to this device. **Feedback** (Help) is the separate, public path to
  RangerTrak's developers: only an **App** note can go there, through **Review and send**,
  after you check it.

---

## What's on each screen

For what each screen does and how to use it, press **Help** at the top of that screen, or open
the in-app **Help** page from the menu. It ships with the app, always matches the version
you're running, and works with no Internet. This guide covers what Help can't: getting a
device ready before you no longer have a connection to fall back on.

**Simple view and Full view.** A new install starts in **Simple view**, which shows the everyday
controls. **Full view** shows every option, including **Attach**, From / To stations, the
Alternative map and Print map. Press the **Full view** button at the top of Entry, Map, Mission or
Rangers & Teams to switch (its dot is empty in Simple view, filled plum in Full view); each device
keeps its own choice. Simple view never hides something your
mission already uses: once an entry has an attachment, **Attach** shows in Simple view too.
Switching changes only what is shown, never your data.

**Demo, Exercise or Incident.** The icon at the left of the status pill in the header shows what
the mission is (hover it to change it). An exercise stamps **EXERCISE** on the printed radio
messages (ICS-213), the communications log (ICS-309), the After Action report and the map sheet.

**While a mission is under way** (a report in the last 12 hours, or an operational period that
is running or about to start) RangerTrak stays out of your way: no first-run tips, no install
prompt, and a new version waits as a small *Update ready* note rather than a reload bar.

<!-- SCREENSHOT SLOT: Settings page, 0.43.x or later. Replaces the Nov-2022 capture, which
     showed the removed Google Maps page and the MIT licence. -->

<!-- SCREENSHOT SLOT: Map page's "Save this area for offline use" control, 0.43.x or later. -->

---

## Starting over: what to clear

**Back up first** (Mission → **Back up mission**). Clearing cannot be undone.

Three actions empty or replace the mission, and each shows the same **What to clear** list
before it does anything:

- **Load a demo** (Entry's demo card, Help, or Mission → *Danger zone*) and **Start a real
  mission** (Entry) replace the whole mission. The roster, ranger photos, radio log (with its
  attachments), places and mission settings always go; they show ticked and greyed out. Your
  After Action notes about this mission, your ICS-214 lines and the ICS-214 header start
  ticked; untick any you want to keep. Notes about RangerTrak start unticked.
- **Delete radio log entries and messages** (Radio Log → *Danger zone*) clears only the radio
  log and its attachments. Everything else in the list starts unticked; tick what you also
  want to go.
- The list has a **Back up mission first** button. During a live mission you must also type the
  mission name before it will go ahead.

Two more, for a full reset:

- **Rangers** → *Danger zone* → **Delete all rangers** empties the roster.
- **Mission** → *Danger zone* → **Reset mission to defaults** puts every mission setting back
  to its default.

**Restore mission** (also in Mission → *Danger zone*) replaces everything with the backup
file's contents; **Undo last import** can put it back within 24 hours.

RangerTrak also keeps a **journal** of what was done to the mission's data on the device:
loading a demo, restoring, importing, backing up, exporting, printing, clearing. None of the
steps above clear it. It lives on the Log page, on its Journal tab, which says whether it is
intact. The newest entry's short code is printed on the radio log, the summary and the map
sheet.

If the device is being handed to another group, clear the roster too: it holds your people's
personal details.

---

## What needs Internet, and what doesn't

| Feature | **Works with no Internet?** |
| --- | --- |
| Entering and saving reports | ✅ Works |
| Roster, Radio Log table, Mission, Log | ✅ Works |
| Backing up, restoring, exporting and importing | ✅ Works |
| Coordinate entry and conversion | ✅ Works |
| **Map — Leaflet (the default engine)** | ⚠️ Only the areas you saved in advance |
| **Map — Alternative (MapLibre + PMTiles)** | ✅ Works everywhere at low detail; street-level detail *only where you loaded a map file, or in a loaded demo's area* |
| Address lookup (typing an address to get coordinates) | ❌ Needs Internet |
| Reverse lookup (coordinates to a street address) | ❌ Needs Internet |

---

## Getting a newer version

RangerTrak keeps working from the copy already on your device, so a new release does not
reach you until the app fetches it. When it has, a banner appears at the **top of the
screen, whichever page you're on**, with a **Reload now** button; accept when you are between
reports, not mid-report. Nothing reloads on its own. The footer names the running version and
when it last checked.

If you suspect you are running an old copy, reload the page while holding **Ctrl+Shift**
(**Cmd+Shift** on a Mac).

---

## Your data: where it lives, and who can see it

Everything lives **on your device only**, in this browser's storage. Nothing is uploaded.

### What keeps your data, and what loses it

**Each report is saved the moment you enter it.** It stays put through:

- switching the device off or the battery running flat,
- closing the browser or the app, and restarting the device,
- losing Wi-Fi or mobile data,
- a new version of RangerTrak.

**What does lose it:**

- **Clearing the browser's data** for rangertrak.org (often bundled into "clear history" or
  "clear cookies").
- **A private or incognito window.** Everything goes when the window closes. Don't run a
  mission in one.
- **A different browser or device.** Each has its own, separate copy: Firefox knows nothing
  about what you did in Chrome. (That also makes a second browser a handy place to experiment
  without disturbing a real mission.)
- **Uninstalling the app** on iPhone or iPad, and on some Android devices.
- **The browser running short of space.** Without persistent storage (setup step 2), it may
  quietly discard a site's data.
- **iPhone, iPad and Safari on a Mac,** which can clear a site's data after about a week
  unused, and don't reliably honour persistent storage. Every browser on iPhone and iPad,
  Chrome included, works this way. There, installing the app and **Back up mission** are the
  real protection.

Nobody else can recover lost data either. **Back up regularly.**

### Who can see it

- **Nobody else can see your mission data** — no server, no account, no third party.
- **The roster is the sensitive part:** names, personal phone numbers, photos, and call signs
  that tie back to publicly searchable licence records. On the device it is unencrypted unless
  you turn on device encryption (below).
- **Log exports are never encrypted.** The log records what the app did, not what was entered
  — no report text or addresses — but it can name call signs, file names and map positions.

Given a callsign, the FCC's own public licensee lookup already shows more than this roster
does — legal name and mailing address for any licensed amateur radio operator. This app does
not meaningfully add to that public exposure, with one exception: photographs, which are not
part of any public record.

### Encrypting the roster and reports on this device

Mission → Data safety has a **Device encryption** toggle. Turned on, it encrypts the roster,
radio log entries, after-action notes, ranger photos and attachments stored in this browser
with a passphrase you choose — so a lost or stolen device, or someone else's hands on a shared
command-post laptop, doesn't hand over the roster in the clear. It does **not** protect the app
while it is open and unlocked, the same as any lock screen wouldn't.

- **Requires a recent backup first** — one finished in the last 10 minutes, plain or
  passphrase-protected. That guarantees a way back if the passphrase is ever mistyped or
  forgotten.
- **The passphrase is typed twice, with no hint stored anywhere.** Forget it, and that data
  is gone for good — there is no reset and no recovery.
- **You will be asked for it again** on your next visit and after every app update.
- **Places and mission settings stay in the clear either way** — they carry little to no
  personal data, and keeping them plain means the map still works if you are ever locked out.
- If you ever cannot remember the passphrase, the lock screen offers **"Forgot it: erase this
  device's mission data"** — it deletes the roster, reports and photos on this device (not any
  backup file elsewhere) and lets you restore from a backup afterward.

### Putting a passphrase on a mission backup

**Mission → Back up mission** offers a passphrase. This is the file most worth protecting: it
contains the whole roster *and* every report, and it is the one meant to travel — onto a USB
stick, into an email, across to another laptop.

- **Leave the passphrase blank** and you get a plain file. That is the default.
- **Type one** and the file is encrypted, attachments file included. You type it a second
  time, because a mistyped passphrase is not discovered until the day you need the backup.
- Encrypted backups are saved as `.rtenc.json` (and `.rtenc.zip` for the attachments) so you
  can spot them in a folder. Restoring one asks for the passphrase.

> ⚠️ **A forgotten passphrase cannot be recovered.** There is no server, no reset, and
> nobody to ask. Keep one unencrypted copy somewhere physically secure, or store the
> passphrase the way your agency stores other credentials.

This protects a file that has left your device. Device encryption (above) protects the copy in
the browser. Neither helps once the device is open and unlocked.

### Files that are always plain

Rangers' **Export roster** and **Export changes**, and the Radio Log and Rangers spreadsheet
exports, have no passphrase option. If roster data must leave the device protected, send a
mission backup with a passphrase instead.

For anything plain, lock the device and treat exported files the way you would a printed
roster: share only with people who need it for the mission, delete exports when the mission is
over, and follow your agency's policy on handling participant information.

---

## Trying it out, and known rough edges

**Want to see it populated?** The Entry page shows a demo card whenever the device is empty or
holds only demo data, and **Help** → *Start* has a **Load a demo** button. You can also go to
**Mission** → *Danger zone*, pick a **Demo scenario** and press **Load sample mission**. A demo
replaces what is on the device (see [Starting over](#starting-over-what-to-clear)).

- The standard demos fill the app with a roster and about thirty reports in the area you pick
  (Grand Canyon by default) — for training, demonstrating, or seeing what a busy mission looks
  like.
- **Montecito debris flows (large):** about 400 radio log entries, 30 teams and 100 roster
  rows, *modeled on* the January 9, 2018 debris flows in Montecito, California.
- **Oso landslide (large):** about 510 radio log entries (51 of them ICS-213 messages), 40
  teams, 128 roster rows and a command post on each side of the slide, *modeled on* the March
  22, 2014 SR 530 landslide near Oso, Washington.

In every demo, each person, team and message is invented.

**Rough edges to be aware of:**

- **The Alternative map's built-in street detail covers the demo areas only**, and only
  while that demo is loaded. Everywhere else you get a low-detail world map with your report
  markers on it — correct positions, no streets — unless you load your own map file for that
  area (see "For coordinators: make your own offline map file" above). The map says so when
  you zoom in where it has no detail.
- **Report selection resets** when you reload the page.

If something looks wrong, check the **Log** page — it records what the app did and any
errors, which is the most useful thing to include when reporting a problem.
