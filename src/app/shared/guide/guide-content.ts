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
      text: 'Everything RangerTrak knows is stored in this browser, on this device. There is no server, no account and no login, and nothing you type is sent anywhere — unless you turn on Command Post Server publishing yourself (on the Mission page), which is off by default. See "Command Post Server" on the Mission page for exactly what that sends and to whom.'
    },
    {
      heading: 'What that means',
      bullets: [
        'Another device — even another browser on this same machine — has its own separate copy.',
        'Clearing site data clears the mission. Back up mission, on the Mission page, guards against this.',
        'Roster exports and spreadsheet exports contain the ranger roster in the clear: legal names, phone numbers and call signs. A mission backup is encrypted only if you give it a passphrase; left blank, it is plain text too.'
      ]
    }
  ]
}

export const GUIDE_CONTENT: Record<string, GuideEntry> = {

  '/': {
    screen: 'Field Report Entry',
    tabs: [
      {
        label: 'This page',
        blocks: [
          {
            heading: 'About RangerTrak',
            text: 'RangerTrak is a free, open-source app for logging field reports during a Search & Rescue, CERT, or other volunteer emergency-response incident - the kind of radio check-ins ("I\'m at grid B4, all clear") a scribe would otherwise write on a paper log. It runs entirely in this browser, on this device, with no server, account, or internet connection required. A SteadyEOC project; see github.com/SteadyEOC/RangerTrak to learn more, report a problem, or contribute.'
          },
          {
            heading: 'The four questions',
            text: 'Who is reporting, where they are, when it happened, and what they said. Tab moves through them in radio-call order, so a whole report can be typed without touching the mouse.'
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
            text: 'This turns a personal phone into a stripped-down device for filing your own reports — not a second command post. The welcome panel offers the choice once, on a genuinely empty device (before any rangers, reports, or mission name are set); there is no way to turn it back off from within the app once chosen.',
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
            text: 'Only field reports with "Also generate an ICS-213" checked on Entry - not every report, and not the same list as Radio Log.'
          },
          {
            heading: 'Reading one',
            text: 'Click a message in the list to read it in full on the right, including who it is addressed to and whether a reply was requested.'
          },
          {
            heading: 'Printing',
            text: 'Print as ICS-213 fills FEMA’s own real ICS-213 form and downloads it as a PDF, ready to hand off or file. Subject comes from the report\'s own Subject field, and Approved by is the operator who filed the report. The Reply section is left blank for the recipient to fill in.'
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
            heading: 'Edits here are NOT saved automatically',
            text: 'Unlike the Radio Log grid, changes typed into this grid need the Save edits button before they stick. Importing, adding and deleting a ranger all save themselves.'
          },
          {
            heading: 'Loading a roster',
            bullets: [
              'Import roster replaces the whole roster from a JSON file, or MERGES rangers in from a setup file (a .zip built on the Setup files page). Field reports and settings are left alone either way. Each entry needs a UNIQUE ID — a callsign is optional.',
              'Export roster writes that file back out. Do it before importing if you want to keep the roster you already have.',
              'JSON round-trips: it can be imported back in. Export CSV is for Excel and cannot.',
              'Photos are kept on this device only, never uploaded and never in the repo. Name each file after the ranger\'s id or callsign - any common image format works (JPG, PNG, GIF, WEBP, etc.).'
            ]
          },
          {
            heading: 'Emptying the roster',
            text: 'Delete all rangers empties it and it stays empty, including after a reload.'
          },
          {
            heading: 'Moving a whole mission',
            text: 'To move the roster, settings and field reports together, use Back up mission/Restore mission on the Mission page. Import/Export roster here moves only the roster. To hand a coordinator a starting point for a NEW device before a mission begins - any combination of roster, photos, locations and settings, no field reports - use the Setup files page instead.'
          },
          {
            heading: 'Tactical call signs',
            // F29-16 (2026-08-29): reworded to lead with Ranger ID - post-D-42, that (not
            // callsign) is what actually identifies a responder throughout the app. Callsign
            // is what gets said over the radio, which not everyone has (no amateur license);
            // the old wording implied callsign was the identifier, which stopped being true
            // once D-42 shipped.
            text: 'Every responder is identified by their Ranger ID, not their call sign - so a responder without an amateur license still needs to be pickable on Entry. Give them a tactical sign, or leave the call sign blank and RangerTrak will fall back to their name.'
          }
        ]
      },
      GRID_KEYBOARD,
      {
        label: 'Privacy',
        blocks: [
          {
            heading: 'This roster is confidential',
            text: 'It holds participant personal data — legal names, personal phone numbers, call signs — stored unencrypted in this browser and exported unencrypted.'
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
            heading: 'Starting a new incident',
            bullets: [
              'Set the mission name and operational period — both feed the header and every printed ICS form.',
              'Load or update the roster on the Rangers page.',
              'Clear out the previous exercise’s field reports from the Radio Log page.',
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
              'Back up mission (Data safety card) downloads settings, rangers and field reports as one file — the way to back up a mission or move it to another device. Restore mission, in the Danger zone below, round-trips it back in.',
              'Load sample mission and Reset mission to defaults are also in the Danger zone — each replaces data already on this device and cannot be undone.'
            ]
          },
          {
            heading: 'Command Post Server (optional)',
            text: 'Lets other people on the SAME WiFi or hotspot read the live comms log from their own phone, tablet or laptop — a read-only view, on a separate small server, not a way to edit this mission from another device. Off by default; this device\'s own copy is exactly the same either way, whether it\'s on or off.',
            bullets: [
              '1. Someone runs the server — on a laptop at the command post, not a phone (phones can\'t run it, only supply the WiFi). It prints its own address on startup, e.g. https://192.168.1.5:8080 — that\'s the "whose WiFi" part: it\'s always the command-post laptop\'s own network, and the address is whatever that laptop\'s network gives it, not something you choose.',
              '2. On EVERY device that will publish to it or view it — including this one — open that address directly in the browser once. It will warn "Your connection is not private" — expected, the same warning most home routers show, since this is a private server with no public certificate. Click Advanced, then Proceed. Needed once per device; skipping this step is the #1 reason publishing silently does nothing.',
              '3. On THIS device (the one actually filing reports), turn the "Publish to Command Post Server" toggle on below — the "Server address" field only appears once it\'s on — then paste that exact address into it. Reports start publishing there automatically from then on, every time one is filed or edited.',
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
              'All field reports for all rangers, by default.',
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
              'The MapLibre + PMTiles engine needs no network at all. A low-detail world map is built into the app everywhere, with real street-level detail in the Vashon Island demo area today. If you have a .pmtiles map file for your own area, press "Load a custom .pmtiles file…" below that map to add real detail there too — it then works offline the same way.',
              'A coordinator can build that map file ahead of time with a free command-line tool — see "For coordinators: make your own offline map file" in the printed Field Guide for the steps.'
            ]
          },
          {
            heading: 'Choosing an engine',
            bullets: [
              'Leaflet (shown by default) — best detail, anywhere in the world. Needs Internet for areas you have not saved.',
              'MapLibre + PMTiles (the switch below the map) — map data ships inside the app, so it works with no connection at all: a low-detail world map everywhere, plus real detail in the Vashon Island demo area or wherever you load a map file for your own area.'
            ]
          },
          {
            heading: 'Route trails',
            text: 'Route trails join one ranger\'s reports oldest to newest, on both engines, so you can see which way a team has been moving — the label at the newest end is a snapshot from when the map was drawn, not a running clock.'
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
            text: 'A pre-mission PROVISIONING file for setting up a device: any combination of this device\'s current roster (with ranger photos), locations, and mission settings, bundled into one file - check only the categories you want to hand off. It has no field reports, because it is built before a mission has any. That makes it a different artifact from the Mission page\'s "Back up mission," which IS a mid/post-mission backup and always includes field reports - export setup files to hand a coordinator a starting point, back up a mission to protect or move one already in progress.'
          },
          {
            heading: 'Loading merges, it does not replace',
            bullets: [
              'Rangers and locations in a loaded file MERGE into what is already on this device - a row that matches an existing one is updated, everything else already here is kept.',
              'Mission settings, when a file carries them, are applied wholesale, the same as always.',
              'No photo already stored on this device is cleared first - one only changes if a loaded file replaces it.',
              'Field reports already on this device are never touched.',
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
