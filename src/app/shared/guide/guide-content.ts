/**
 * Every screen's on-page guidance, in one file.
 *
 * Before the Material-M3 pass (2026-08-25) this content was 15 `<rangertrak-section>`
 * blocks spread across 8 components - "Instructions", "Tips", "Advanced",
 * "Privacy & data handling", "Location Guidance", "Grid Menu Keyboard interaction" - each
 * sitting permanently in its page's main column, below the grid or form it described.
 * Nothing collapsed them (the 2026-08-25 de-collapse pass made them all always-visible),
 * so a scribe who had read them once still scrolled past them on every visit.
 *
 * They live here instead, behind one Guide button that sits in the same place in every
 * page header. Two things fall out of that which are worth the move on their own:
 *
 *   1. The relevance audit the roadmap has asked for twice (2026-08-22 and again
 *      2026-08-24 - "ensure all such verbiage still makes sense") is now a review of ONE
 *      file, not a hunt across eight components.
 *   2. Reference material stops competing with the thing the page is actually for. The
 *      redesign's page-order rule puts the primary object first; guidance was the main
 *      thing violating it.
 *
 * What deliberately did NOT move here: anything a scribe acts on rather than reads.
 * Export controls, row-count pickers, the map engine switch and every destructive button
 * stay grounded on their page - hiding a control behind a drawer is a different and worse
 * bargain than hiding an explanation.
 */

/** One heading plus its body. `text` renders as a paragraph, `bullets` as a list. */
export interface GuideBlock {
  heading: string
  text?: string
  bullets?: string[]
}

/**
 * Renders a `text`/bullet string for display, turning any `[label](https://...)` markers
 * into a real external link. Everything else is HTML-escaped first, so this is safe to bind
 * via `[innerHTML]` even though the source is a plain string, not markdown - the guide has no
 * other use for HTML markup, and this content is developer-authored, never user input.
 */
export function renderGuideText(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(
    /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
    (_match, label: string, href: string) =>
      `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
  )
}

/** One tab in the drawer. */
export interface GuideTab {
  label: string
  blocks: GuideBlock[]
}

export interface GuideEntry {
  /** Shown as the drawer's subtitle, so a reader knows which screen they are reading about. */
  screen: string
  tabs: GuideTab[]
}

/**
 * Shared across the two AG Grid screens (Reports, Rangers). De-duplicated once already -
 * the two "Grid Menu Keyboard interaction" blocks were byte-identical and became
 * GridKeyboardHelpComponent on 2026-08-24; this is that same content, now with nowhere
 * left to be duplicated to.
 */
const GRID_KEYBOARD: GuideTab = {
  label: 'Keyboard',
  blocks: [
    {
      heading: 'Column and filter menus',
      bullets: [
        'Down arrow — move to the next menu item.',
        'Up arrow — move to the previous menu item.',
        'Right arrow — open a submenu.',
        'Left arrow or Escape — close the current menu.',
        'Enter — activate the focused item.',
        'Tab — leave the menu entirely.'
      ]
    },
    {
      heading: 'Moving around the grid',
      bullets: [
        'Arrow keys move the focused cell.',
        'Enter starts editing the focused cell; Escape cancels without saving.',
        'Tab moves to the next cell, wrapping to the next row at the end.'
      ]
    }
  ]
}

const YOUR_DATA: GuideTab = {
  label: 'Your data',
  blocks: [
    {
      heading: 'Where it lives',
      text: 'Everything RangerTrak knows is stored in this browser, on this device. There is no server, no account and no login. Your mission stays on this device. When online, the app fetches map images and looks up addresses for report locations automatically. Sending feedback, and turning on RangerTrak Board publishing yourself (on the Mission page, off by default), only happen if you choose to. See "RangerTrak Board" on the Mission page for exactly what that sends and to whom, and https://rangertrak.com/privacy.html for the full privacy policy.'
    },
    {
      heading: 'What that means',
      bullets: [
        'Another device — even another browser on this same machine — has its own separate copy.',
        'Clearing site data clears the mission. Back up mission, on the Mission page, guards against this.',
        'Especially on iPhone and iPad, every browser can clear a site\'s data after about a week unused, and storage protection is not reliable there (nor in Safari on a Mac). Install RangerTrak and back up the mission.',
        'Roster exports and spreadsheet exports contain the ranger roster in the clear: legal names, phone numbers and call signs. A mission backup is encrypted only if you give it a passphrase; left blank, it is plain text too.',
        'The roster, radio log entries, after-action notes and ranger photos on this device are stored unencrypted unless you turn on device encryption on the Mission page (Data safety > Device encryption).',
        // Item 9 (2026-09-28, John): so a scribe who opens a second tab/window and sees
        // either notice understands why, rather than assuming something broke.
        'Only ONE tab of this browser saves at a time. Opening RangerTrak in a second tab or window shows a notice offering to make that one active instead - the other stops saving, with its own notice, until reloaded.'
      ]
    }
  ]
}

export const GUIDE_CONTENT: Record<string, GuideEntry> = {

  '/': {
    screen: 'Radio Log Entry',
    tabs: [
      {
        label: 'This page',
        blocks: [
          {
            heading: 'About RangerTrak',
            text: 'RangerTrak is a free, open-source app for keeping the radio log during a Search & Rescue, CERT, or other volunteer emergency-response incident - the kind of radio check-ins ("I\'m at grid B4, all clear") a scribe would otherwise write on a paper log. It runs entirely in this browser, on this device, with no server, account, or internet connection required. A SteadyEOC project; see github.com/SteadyEOC/RangerTrak to learn more, report a problem, or contribute.'
          },
          {
            heading: 'The four questions',
            text: 'Each radio log entry (a field report, if that is what your team calls it) answers four questions: who is reporting, where they are, when it happened, and what they said. Tab moves through them in radio-call order, so a whole report can be typed without touching the mouse. When it is complete, log it with the "Add to radio log" button at the bottom, or press Ctrl+Enter (Cmd+Enter on a Mac) from any box.'
          },
          {
            heading: 'Operator',
            text: 'Not who the report is about — who is at the keyboard recording it. Stamped on each report and message at submit, and never changed later, so a shift change never retroactively re-attributes a report someone else logged.'
          },
          {
            heading: 'Positions',
            bullets: [
              'Type a position in whichever format it was read to you — the rest are derived and shown below the fields.',
              'Click the map to move the pin, which fills the coordinates in for you.',
              'Alt+click the map to mark evidence or a clue at a different location instead, once that section is showing.',
              'Every format here assumes WGS84 / modern GPS. A position read off an older paper topo quad may use NAD27 instead, which can be 100–200 m off in the western US.',
              'Every format (DD, DDM, DMS, MGRS, UTM) is always one tap away here, regardless of mission settings — a call in an unexpected format is never blocked. Mission → Location Defaults only picks which one this screen opens on by default; a team that mostly works in MGRS can set that as the default while every other format stays reachable.'
            ]
          },
          {
            heading: 'Notes and 213 messages are not the same thing',
            text: 'Notes is the general record of this report — always saved, and what appears on the Radio Log grid and in the ICS-309 communications log: a ranger\'s status, purpose, or what happened. A 213 message is a separate, addressed message that only some reports generate (see the Messages page) — a formal request, order, or notification to a specific recipient. It is typed independently, not derived from your notes, because the two often serve different purposes entirely.'
          },
          {
            heading: 'Location formats',
            text: 'Enter the location however the team read it out — everything converts to everything else, and whatever you enter, the rest fills in underneath as Derived values (click any of them to select and copy).',
            bullets: [
              'Decimal Degrees (DD) — 47.4476° −122.4626°',
              'Degrees + Decimal Minutes (DDM) — 47° 26.8′ N',
              'Degrees Minutes Seconds (DMS) — 47° 26′ 51″ N',
              '[MGRS](https://en.wikipedia.org/wiki/Military_Grid_Reference_System) (Military Grid Reference System) — 10TFS 12345 67890',
              '[UTM](https://en.wikipedia.org/wiki/Universal_Transverse_Mercator_coordinate_system) (Universal Transverse Mercator) — Zone 10 N, easting, northing',
              '[Plus Code](https://en.wikipedia.org/wiki/Open_Location_Code) or [Maidenhead](https://en.wikipedia.org/wiki/Maidenhead_Locator_System) — the single field below the coordinates, computed on-device like everything above',
              // Maintainer ask, 2026-09-22: the app's own dimmed-label/offline-tag UI
              // (location.component.html) already says this at the point of use, but the
              // Guide text listed street address alongside Plus Code/Maidenhead as if all
              // three behaved the same way - they don't. Both directions need saying: typing
              // one in (geocodeAddress) and the Derived address filled in from coordinates
              // you DID type (reverseGeocode) are both live lookups against Nominatim (or a
              // Google key, if configured) - see geocoding-provider.interface.ts. Neither
              // Plus Code nor Maidenhead touch the network either direction.
              'Street address — same field, but unlike every format above it this is a live lookup, not an on-device conversion: needs Internet both to turn a typed address into coordinates AND to fill in a Derived address from coordinates you entered another way. Offline, that field just stays blank — nothing is lost, use one of the formats above instead.'
            ]
          },
          {
            heading: 'Getting it wrong',
            text: 'Submit anyway. It is better to have the report logged than to hold the radio while you fix it. Corrections happen on the Radio Log page: click a cell, type, and move on — grid edits save themselves. Editing a latitude or longitude moves that report on the map.'
          },
          {
            heading: 'The map beside the form',
            text: 'The small map confirms where the location you typed actually landed — glance at it, and if the pin is in the water, re-read the coordinates back over the radio. It is also a drawing surface: click anywhere on it to set the location directly instead of typing coordinates.'
          },
          {
            heading: 'Field mode — a ranger\'s own phone',
            text: 'This turns a personal phone into a stripped-down device for filing your own reports — not a second command post. On a phone or tablet the welcome panel offers the choice; on a laptop it is under Mission > Advanced > Field phone. Either way only on a genuinely empty device (before any rangers, reports, or mission name are set). To go back to the full app, use Turn off field mode in Help (Rangers\' phones section).',
            bullets: [
              'Everything except this page and Help disappears from the menu — a field phone has no reason to see the roster, the map, or the Mission page, and a typed-in address to one of those pages is blocked the same way.',
              'Location starts from the phone\'s own GPS instead of the mission\'s configured default, if the phone allows it — a best-effort fill, never required, and never overwrites a position already typed by hand.',
              'Whichever coordinate format (DD, DDM, MGRS…) you last used is what this device opens on next time, on any mission — every device, not just field mode, remembers this now.',
              'Install the PWA from [rangertrak.org](https://rangertrak.org) BEFORE heading out, not after — loading it fresh from a command-post laptop\'s own address in the field gets no offline capability at all, since that address is not secure enough for a browser to allow it.'
            ]
          },
          {
            heading: 'Sending your reports (field mode)',
            text: 'A small "Online"/"Offline" badge shows above the form at all times on a field-mode device — a coarse signal ("this device has some kind of network connection"), not a promise that a report will actually arrive anywhere. If a report is urgent or expects a reply and there is any doubt, read it over the radio instead of trusting the badge — that channel does not depend on anything RangerTrak does.',
            bullets: [
              'Send my reports, next to the badge, packages every report on this device into one file and hands it to whatever app you pick — Mail, Messages, AirDrop, a messaging app — the same "Share" sheet a photo or a link uses. Where it goes from there is up to the person you choose, not RangerTrak.',
              'Nothing is ever lost by staying offline — every report saves to this device the instant it is submitted, exactly like normal. Sending is a separate, later step, never a requirement to file a report at all.',
              'At the command post, the matching Load Report Packet button on the Radio Log page merges those reports in — see that page\'s own guide entry.'
            ]
          }
        ]
      },
      YOUR_DATA
    ]
  },

  '/radio-log': {
    screen: 'Radio Log',
    tabs: [
      {
        label: 'This page',
        blocks: [
          {
            heading: 'Editing',
            bullets: [
              'Edits save automatically — there is no Save button on this page.',
              'Address and Lat are single-click to edit; other cells are double-click.',
              'Click a column heading to sort by it, or drag it to reorder the columns.',
              'Hovering a cell may show more than the column has room for.'
            ]
          },
          {
            heading: 'Exporting',
            bullets: [
              'Only the filtered and sorted rows are exported, unless you tick All rows.',
              'Comma-separated imports into Excel most cleanly.'
            ]
          },
          {
            heading: 'Selection and the maps',
            text: 'Rows selected here can be isolated on either map engine, using the switch on the Map page.'
          },
          {
            heading: 'Report Packet — reports from another device',
            text: 'A separate pair of buttons from the CSV export above — this one is for merging reports IN from another device, most often a ranger\'s own field phone (see "Field mode" on the Entry page\'s own guide entry), not for reading data out.',
            bullets: [
              'Build Report Packet packages every report on THIS device into one small file, ready to hand to another device.',
              'Load Report Packet reads one of those files back in and merges it — it only ever ADDS reports this device does not already have; nothing existing is ever replaced or overwritten.',
              'A merged-in report is marked with a small 📦 in its own column (or next to the callsign on a phone) — a quick way to tell it apart from one typed directly on this device.',
              'A report that can\'t be read — a bad timestamp or an out-of-range position, usually a sign the file was hand-edited or corrupted — is skipped on its own and you\'re told how many, rather than the whole file being refused.',
              'Importing the exact same file twice is safe — the second time changes nothing, so there is no harm in re-sending one if you are not sure it landed.',
              'If the file names a different mission than this device\'s current one, you are warned and asked to confirm before anything is merged in.',
              'The file names real people and describes an active incident — treat it like a printed page from the log: keep it on a device you control, and delete it once its reports are safely merged in here.'
            ]
          }
        ]
      },
      GRID_KEYBOARD,
      YOUR_DATA
    ]
  },

  '/messages': {
    screen: 'Messages',
    tabs: [
      {
        label: 'This page',
        blocks: [
          {
            heading: 'What shows up here',
            text: 'Only radio log entries with "Also generate an ICS-213" checked on Entry - not every report, and not the same list as Radio Log.'
          },
          {
            heading: 'Reading one',
            text: 'Click a message in the list to read it in full on the right, including who it is addressed to and whether a reply was requested.'
          },
          {
            heading: 'Printing',
            text: 'Both Print and Save PDF fill FEMA’s own real ICS-213 form the same way - Print opens the print dialog directly (one click to paper), Save PDF downloads the file instead, for attaching to an email or filing. Subject comes from the report\'s own Subject field, and Approved by is the operator who filed the report. The Reply section is left blank for the recipient to fill in.'
          }
        ]
      },
      YOUR_DATA
    ]
  },

  '/after-action': {
    // 2026-09-27: "AAR notes" - matches the page's own title (after-action.component.ts)
    // and the header's "AAR note" capture button now that the old "After Action" nav item
    // is gone (navbar.component.html).
    screen: 'AAR notes',
    tabs: [
      {
        label: 'This page',
        blocks: [
          {
            heading: 'Where notes come from',
            text: 'AAR note, at the top of every page, records something to fix or improve later in one line, without leaving the page. The note remembers which page it was taken on and when.'
          },
          {
            heading: 'At the debrief',
            text: 'Give each note an area (for example Communications or Logistics), a recommendation and an owner. Changes save as soon as you leave a field. Filter to see only the notes about the incident, or only the ones about RangerTrak.'
          },
          {
            heading: 'Printing and exporting',
            text: 'Print gives an improvement-plan table of the incident notes: observation, area, recommendation, owner and time. Export downloads every note as a spreadsheet (CSV).'
          },
          {
            heading: 'Notes about RangerTrak',
            text: 'Review and send opens Help > Feedback with those notes filled in. Nothing is sent until you press Submit there, and it becomes a public GitHub issue, so take out names and places first.'
          }
        ]
      },
      YOUR_DATA
    ]
  },

  '/rangers': {
    screen: 'Rangers & Teams',
    tabs: [
      {
        label: 'This page',
        blocks: [
          {
            // 2026-09-28: edits now save the same way the Radio Log grid always has - on
            // each cell you finish editing, no separate step. The "Save edits" button this
            // heading used to describe is gone.
            heading: 'Edits here save automatically',
            text: 'Same as the Radio Log grid: every cell you finish editing saves right away. Importing, adding and deleting a ranger all save themselves too.'
          },
          {
            heading: 'Loading a roster',
            bullets: [
              'Import roster replaces the whole roster from a JSON file, or MERGES rangers in from a setup file (a .zip built on the Setup files page). Radio log entries and settings are left alone either way. Each entry needs a UNIQUE ID — a callsign is optional.',
              'Export roster writes that file back out. Do it before importing if you want to keep the roster you already have.',
              'JSON round-trips: it can be imported back in. Export CSV is for Excel and cannot.',
              'Photos are kept on this device only, never uploaded and never in the repo. Name each file after the ranger\'s id or callsign - any common image format works (JPG, PNG, GIF, WEBP, etc.).',
              'Import roster, Export roster, Import photos, Export CSV, and Setup files all live under "Bulk roster tools", collapsed near the bottom of this page.'
            ]
          },
          {
            heading: 'Emptying the roster',
            text: 'Delete all rangers empties it and it stays empty, including after a reload.'
          },
          {
            heading: 'Moving a whole mission',
            text: 'To move the roster, settings and radio log entries together, use Back up mission/Restore mission on the Mission page. Import/Export roster here moves only the roster. To hand a coordinator a starting point for a NEW device before a mission begins - any combination of roster, photos, locations and settings, no radio log entries - use the Setup files page instead.'
          },
          {
            heading: 'Tactical call signs',
            // F29-16 (2026-08-29): reworded to lead with Ranger ID - post-D-42, that (not
            // callsign) is what actually identifies a responder throughout the app. Callsign
            // is what gets said over the radio, which not everyone has (no amateur license);
            // the old wording implied callsign was the identifier, which stopped being true
            // once D-42 shipped.
            //
            // E-165 (2026-09-30): rewritten for mission tactical calls. A tactical call is now a
            // mission-level name (Mission page) that can be staffed by a roster member, and
            // Entry has a To station - so this no longer tells people to put a tactical name in
            // the call sign column. Existing roster rows that already hold a tactical name keep
            // working exactly as they did.
            text: 'A tactical call is the name of a position or team, such as "Vashon EOC" or "CERT Team 1", as opposed to a an individual FCC call sign. List them on the Mission page under Tactical call signs, and pick who is operating each one if you know. On Entry, choose a tactical call in the From box (or the To station box) and the call sign of whoever is operating it fills in for you. If you change the operator at shift change, earlier radio log entries keep the call sign they were logged with. Not everyone has a call sign: a tactical call with no call sign, or an operator without one, is perfectly fine and nothing warns about it. A responder is still identified by their Ranger ID, so someone without an amateur license can be picked on Entry by name or ID.'
          }
        ]
      },
      GRID_KEYBOARD,
      {
        label: 'Privacy',
        blocks: [
          {
            heading: 'This roster is confidential',
            text: 'It holds participant personal data — legal names, personal phone numbers, call signs — stored unencrypted in this browser (unless you turn on device encryption on the Mission page) and exported unencrypted.'
          },
          {
            heading: 'Handling it',
            bullets: [
              'Treat an exported roster the way you would a printed contact list: keep it on a device you control, and delete it when the mission is over.',
              'Nothing here is transmitted anywhere by RangerTrak itself.'
            ]
          }
        ]
      }
    ]
  },

  '/mission': {
    screen: 'Mission',
    tabs: [
      {
        label: 'This page',
        blocks: [
          {
            heading: 'Saving',
            text: 'There is no Save button. Changes on this page save themselves about a second after you stop typing, and a note at the top says Saved when they have. If a value is not allowed (a latitude past 90, say), the note says Not saved yet and the field shows why; it saves as soon as you fix it. Everything takes effect straight away, except the address-search key, which needs a reload (the page offers a Reload now button).'
          },
          {
            heading: 'Starting a new incident',
            bullets: [
              'Set the mission name and operational period — both feed the header and every printed ICS form.',
              'Load or update the roster on the Rangers page.',
              'Clear out the previous exercise’s radio log entries from the Radio Log page.',
              'Or reset everything at once from the Danger zone at the bottom of this page.'
            ]
          },
          {
            heading: 'Location defaults',
            text: 'These seed the Entry form’s starting position only. Maps ignore them — a map auto-centers on the centroid of the reports actually entered, then zooms to fit them all.'
          },
          {
            heading: 'Readiness',
            text: 'The colored dot in the page header tracks six setup checks. When it is not green, this page lists exactly which ones are failing and links to the field that fixes each.'
          },
          {
            heading: 'Backup and advanced options',
            bullets: [
              'Back up mission (Data safety card) downloads settings, rangers and radio log entries as one file — the way to back up a mission or move it to another device. Restore mission, in the Danger zone below, round-trips it back in.',
              'Load sample mission and Reset mission to defaults are also in the Danger zone — each replaces data already on this device and cannot be undone.'
            ]
          },
          {
            heading: 'RangerTrak Board (optional)',
            text: 'Lets other people on the SAME WiFi or hotspot read the live comms log from their own phone, tablet or laptop — a read-only view, on a separate small server, not a way to edit this mission from another device. Off by default; this device\'s own copy is exactly the same either way, whether it\'s on or off.',
            bullets: [
              '1. Someone runs the RangerTrak Board program on a laptop at the command post. It is a small Node.js program in the RangerTrak source code (tools/command-post-server.js), started with npm run command-post. Not a phone (phones can\'t run it, only supply the WiFi). It prints its own address on startup, e.g. https://192.168.1.5:8080 — that\'s the "whose WiFi" part: it\'s always the command-post laptop\'s own network, and the address is whatever that laptop\'s network gives it, not something you choose.',
              '2. On EVERY device that will publish to it or view it — including this one — open that address directly in the browser once. It will warn "Your connection is not private" — expected, the same warning most home routers show, since this is a private server with no public certificate. Click Advanced, then Proceed. Needed once per device; skipping this step is the #1 reason publishing silently does nothing.',
              '3. On THIS device (the one actually filing reports), turn the "Send this log to a RangerTrak Board" toggle on below — the "Server address" field only appears once it\'s on — then paste that exact address into it. Reports start publishing there automatically from then on, every time one is filed or edited.',
              '4. Give viewers the SAME address with /view added — e.g. https://192.168.1.5:8080/view — and make sure they\'re joined to the SAME WiFi/hotspot as the command-post laptop (and have done step 2 on their own device). They\'ll see a live, auto-refreshing table (time, callsign, status, message), each with their own filter and sort, independent of everyone else looking at it.',
              'The roster never goes with it — only report content. Full names, phone numbers and photos stay on this device; a viewer only ever sees a callsign, same as anyone standing at the map.',
              'If the server isn\'t reachable (not running yet, wrong address, step 2 skipped, or you\'re off that WiFi), publishing just fails quietly in the background — this device keeps working exactly as normal either way.',
              'There is no password on the view page itself in this version — anyone who can join the command post\'s WiFi can see it, the same as they already could reach anything else on that network. Treat the WiFi/hotspot password as the real access control.'
            ]
          }
        ]
      },
      YOUR_DATA
    ]
  },

  '/map': {
    screen: 'Map',
    tabs: [
      {
        label: 'This page',
        blocks: [
          {
            heading: 'What is shown',
            bullets: [
              'All radio log entries for all rangers, by default.',
              'If rows are selected on the Radio Log page, the switch below the map isolates just those.',
              'Nearby reports group into clusters — click a cluster to zoom in.',
              // F29-7/8 (2026-08-29): MapLibre's markers only got per-ranger COLOUR this
              // session, not distinct shapes too (that would need a symbol layer with
              // pre-registered images - a bigger change, not built yet) - this used to claim
              // "shape and color" unconditionally, which overclaimed for MapLibre specifically.
              'Each ranger has their own marker color, consistent across sessions. Leaflet also gives each ranger a distinct marker shape; MapLibre currently distinguishes by color only.',
              'On the Leaflet map, the control in the top-right corner switches the base map between street and topographic.'
            ]
          },
          {
            heading: 'Working offline',
            bullets: [
              'Map areas you have never viewed or saved are blank when the network goes — save the area while you still have a signal, not when you need it.',
              // Fixed 2026-09-14 (P1-2): used to save only the exact zoom level on screen -
              // zooming in one level once offline showed blank tiles. Now saves that level
              // plus two deeper ones in the same press (mapLeaflet.component.ts's own
              // zoomLevelsForSave() - a named constant, easy to change later).
              'Leaflet keeps the map tiles you have already looked at. Its "Save this area" button stores the area on screen at the current zoom level plus two levels deeper, so a bit of extra zooming in still works offline. It refuses a save that would be too large and asks you to zoom in first.',
              // Added 2026-09-14 (P1-4): OpenStreetMap's own tile-server rules forbid bulk/
              // offline downloading ("Save area for later" is one of its own named examples
              // of what is not allowed) - OpenTopoMap has no such rule.
              'Saving only works while OpenTopoMap (the contour map) is showing. Switch away from OpenStreetMap first if the Save button is grayed out — OpenStreetMap\'s own rules do not allow bulk offline saving from its servers.',
              // Corrected 2026-09-14: this used to say there was "no in-app way" to add MapLibre
              // coverage, but "Load a custom .pmtiles file…" (CustomPmtilesService) has existed
              // since 2026-08-27.
              'The MapLibre + PMTiles engine needs no network at all. A low-detail world map is built into the app everywhere, with real street-level detail in each demo area while that demo is loaded. If you have a .pmtiles map file for your own area, press "Load a custom .pmtiles file…" below that map to add real detail there too — it then works offline the same way.',
              'A coordinator can build that map file ahead of time with a free command-line tool — see "Make a map file for your area" in Help > Your data for the steps.'
            ]
          },
          {
            heading: 'Choosing an engine',
            bullets: [
              'Leaflet (shown by default) — best detail, anywhere in the world. Needs Internet for areas you have not saved.',
              'MapLibre + PMTiles (the switch below the map) — map data ships inside the app, so it works with no connection at all: a low-detail world map everywhere, plus real detail in a loaded demo area or wherever you load a map file for your own area.'
            ]
          },
          {
            heading: 'Printing the map',
            text: 'Print map gives you a one-page landscape map sheet: a title line with the mission, the operational period and when it was printed; the map filling most of the page, with a north arrow, a scale bar, the map credit and latitude/longitude marks around its edge; a legend beside the map explaining every marker, team, place and shading on it; and a line at the bottom to sign as the person who prepared it. Every report prints as its own marker (no numbered bubbles), so a PDF can be zoomed to see them. Print map spends a few seconds ("Preparing the map...") loading a more detailed map for paper: online it fetches it; offline it uses the area saved for offline use (saving keeps two closer zoom levels too, so print at about the zoom you saved at), and if some of that detail is missing it prints what is on screen rather than leaving blank patches. Use the Print map button, not the browser\'s own Print command, which skips that step.'
          },
          {
            // 2026-09-30, John: E-162 / E-138 - map layers and the Zoom to offline tiles button.
            heading: 'Map layers and overlays (Leaflet map)',
            bullets: [
              'Open the layers box at the top right of the map to pick a base map — OpenStreetMap, OpenTopoMap (contours) or Satellite (Esri World Imagery, which needs Internet) — and to switch overlays on and off.',
              'USNG / MGRS grid draws the grid squares used in search and rescue, with the numbers you read out for a grid reference; it is worked out on your device and works with no Internet.',
              'Range rings (from command post) draws evenly spaced circles around your Command Post location (or the default location on the Mission page if you have not placed one), each labelled with its distance. The spacing fits what you are looking at, like the scale bar: tenths of a mile zoomed in on a fairground, miles zoomed out over a search area. To keep one distance at any zoom (say, a 2 mile radio range), move the Range ring spacing slider under the map off Auto; the rings go bold for a moment while it moves so you can see them on a busy map. It works with no Internet.',
              'Under the map, the position under the pointer is shown in decimal degrees (DD), degrees and decimal minutes (DDM, used by air operations) or USNG (the same grid as MGRS); pick one with the DD / DDM / USNG buttons. Clicking the map copies that position in the same format. On a phone, tap the map to see a position.',
              'Hiking trails (Waymarked Trails) shows marked hiking routes and needs Internet. Roads and place names draws roads and labels over the Satellite map, and needs Internet. Hillshade (terrain relief) also needs Internet, and the Mile grid works with no Internet.',
              'Zoom to offline tiles, under the map, shows the areas you have saved for offline use and zooms out to fit them; press it again to hide them. It is grayed out until you have saved something.'
            ]
          },
          {
            heading: 'Route trails',
            text: 'Route trails join one ranger\'s reports oldest to newest on the Leaflet map (the MapLibre map does not draw them), so you can see which way a team has been moving: thin and faint is older, thick and bright is newest, and the newest leg slowly flows toward the latest position. The label at the newest end is a snapshot from when the map was drawn, not a running clock.'
          }
        ]
      },
      YOUR_DATA
    ]
  },

  '/prep': {
    screen: 'Setup files',
    tabs: [
      {
        label: 'This page',
        blocks: [
          {
            heading: 'What a setup file is - and is not',
            text: 'A pre-mission PROVISIONING file for setting up a device: any combination of this device\'s current roster (with ranger photos), locations, and mission settings, bundled into one file - check only the categories you want to hand off. It has no radio log entries, because it is built before a mission has any. That makes it a different artifact from the Mission page\'s "Back up mission," which IS a mid/post-mission backup and always includes radio log entries - export setup files to hand a coordinator a starting point, back up a mission to protect or move one already in progress.'
          },
          {
            heading: 'Loading merges, it does not replace',
            bullets: [
              'Rangers and locations in a loaded file MERGE into what is already on this device - a row that matches an existing one is updated, everything else already here is kept.',
              'Mission settings, when a file carries them, are applied wholesale, the same as always.',
              'No photo already stored on this device is cleared first - one only changes if a loaded file replaces it.',
              'Radio log entries already on this device are never touched.',
              'Pick several files at once to apply them together, in filename order, after one confirmation.'
            ]
          },
          {
            heading: 'Photos are downscaled, not originals',
            text: 'Stored photos are shrunk to a small size on import (they only ever render at 40-60px), so a setup file is a deployment artifact, not a photo archive. It does not replace the full-size roster/photo bundle a coordinator may build outside the app.'
          }
        ]
      },
      YOUR_DATA
    ]
  }
}

/**
 * Resolves a router URL to its guide entry. Query strings and fragments are stripped, and
 * an unknown route returns undefined - the Guide button hides itself rather than opening
 * an empty drawer.
 */
export function guideFor(url: string): GuideEntry | undefined {
  const path = url.split('?')[0].split('#')[0]
  return GUIDE_CONTENT[path] ?? GUIDE_CONTENT[path.replace(/\/$/, '')]
}
