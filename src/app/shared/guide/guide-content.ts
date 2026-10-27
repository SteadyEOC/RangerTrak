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
            heading: 'Attaching photos, video and audio',
            text: 'Attach, under Notes, adds files to the entry you are typing. On a phone or tablet, Take photo / video opens the camera straight away. The files wait as small chips (x removes one) and are stored when you save the entry. A saved entry shows a 📎 chip with how many it has; the chip opens the viewer.',
            bullets: [
              'Keep original is chosen unless you change it: the file is kept exactly as it arrived and given a fingerprint (SHA-256). The viewer shows it short, with a Copy button for the whole value; a copy of the file can later be proved identical to the original.',
              'Each photo, video or audio file you pick also offers Smaller copy. It sends much faster over a field network, but fine detail isn\'t kept. The file\'s own location, time and camera data are kept wherever it has them. Only the smaller copy is stored; the original\'s fingerprint is noted on it, and the viewer always says "Smaller copy, made on K7ABC\'s phone from 4.2 MB". A long video can take a while: a Cancel button keeps the original instead. If the copy would not be smaller, the original is kept. A browser that cannot make one does not show the choice.',
              'A smaller copy has its own fingerprint, so it does not match the fingerprint of the file that was sent. The viewer shows both: "Fingerprint" for this file and "Original\'s fingerprint" for the one it was made from.',
              'On the Radio Log, hover over a 📎 chip to see small pictures of the entry\'s files (click to open); a smaller copy carries a small "smaller copy" tag.',
              'Originals keep everything the camera wrote into them, including the GPS position where the photo was taken. Think before you share a photo outside your team. The small pictures RangerTrak shows in lists and prints carry none of that.',
              'An iPhone may turn a HEIC photo into a JPEG before RangerTrak ever sees it. RangerTrak fingerprints what it is given.',
              'Space: Mission > Data safety shows how much of the mission\'s attachment budget is used (512 MB to start; you can change it). Near the limit, and for any file over 100 MB, you are asked first. It never refuses; only the browser\'s own storage limit can.',
              'In the viewer: Add attaches more files to a saved entry, Save downloads the original, Share hands it to another app, and Remove deletes the file from this device but leaves a note on the entry saying when and by whom. Arrow keys or a swipe move between files.',
              'Make a smaller copy… in the viewer is for a file someone else sent, and it warns you more strongly: the fingerprint proves it is exactly what they sent, and a copy will not match it. Keep both (the default) adds the copy beside the original. Replace the original needs you to type REPLACE; the entry then shows "Replaced by a smaller copy 14:02 by N7XYZ" and the original is deleted from this device.',
              'An entry from another device can name a file whose bytes are not here; the viewer says "On another device" until the backup\'s attachments file or a hand-over brings it.'
            ]
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
              'At the command post, the matching Load Report Packet button on the Radio Log page merges those reports in — see that page\'s own Help.'
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
            heading: 'Message numbers',
            bullets: [
              'Every entry gets a number when it is logged, such as A007: a station letter, then a count. Hover a number to see it in full, for example 26-0142 / OP 2 / A007 (mission, operational period, number).',
              'The number never changes afterwards, even if you edit the entry or rename the operational period. The count starts again at 001 in each operational period, and a number is never used twice, even if an entry is deleted.',
              'The station letter belongs to this device. Set it on the Mission page, under Operational period ("This station logs as"). If two devices log on the same net, give each its own letter.',
              'Entries that arrive from a ranger\'s phone get this device\'s next number when you load them. Entries from a hand-over file keep the number they already have.',
              'If two different entries end up with the same number (two devices used the same letter), the merge says so and the Mission page shows a warning. Nothing is renumbered; change one device\'s letter.',
              'Typing a number such as A007 in the Msg # filter finds the entry.'
            ]
          },
          {
            heading: 'Status marks',
            bullets: [
              'The first column is a small box. Click it to mark the entry: ✓ handled, → passed on, ! needs action. Click again to move to the next mark, and once more to clear it.',
              'The same mark is on the Messages page. Marks print in the first column of the ICS-309 log, and an unmarked entry prints an empty box you can tick by hand.',
              'If two devices mark the same entry, the later mark is kept when they are merged.'
            ]
          },
          {
            heading: 'Exporting',
            bullets: [
              'Only the filtered and sorted rows are exported, unless you tick All rows.',
              'Comma-separated imports into Excel most cleanly.',
              'The message number is exported in parts (msg_mission, msg_op_period, msg_station, msg_seq) and in full (msg_no), with the status mark in handled.',
              'The file has an Attachments count and the attachments\' file names, joined with a semicolon.'
            ]
          },
          {
            heading: 'Selection and the maps',
            text: 'Rows selected here can be isolated on either map engine, using the switch on the Map page.'
          },
          {
            heading: 'Report Packet — reports from another device',
            text: 'A separate pair of buttons from the CSV export above — this one is for merging reports IN from another device, most often a ranger\'s own field phone (see "Field mode" in the Entry page\'s own Help), not for reading data out.',
            bullets: [
              'Build Report Packet packages every report on THIS device into one small file, ready to hand to another device.',
              'Load Report Packet reads one of those files back in and merges it — it only ever ADDS reports this device does not already have; nothing existing is ever replaced or overwritten.',
              'A merged-in report is marked with a small 📦 in its own column (or next to the callsign on a phone) — a quick way to tell it apart from one typed directly on this device.',
              'A report that can\'t be read — a bad timestamp or an out-of-range position, usually a sign the file was hand-edited or corrupted — is skipped on its own and you\'re told how many, rather than the whole file being refused.',
              'Importing the exact same file twice is safe — the second time changes nothing, so there is no harm in re-sending one if you are not sure it landed.',
              'If the file names a different mission than this device\'s current one, you are warned and asked to confirm before anything is merged in.',
              'The file names real people and describes an active incident — treat it like a printed page from the log: keep it on a device you control, and delete it once its reports are safely merged in here.'
            ]
          },
          {
            heading: 'Hand over to another scribe',
            text: 'For when another scribe, or the next shift, already has entries of their own on their device. Starting on a blank device? Use Restore on the Mission page instead.',
            bullets: [
              'Hand over saves one file with the roster (with photos), the places and every radio log entry on THIS device. Add a passphrase to lock it, or leave the box blank and the file is not locked. A forgotten passphrase cannot be recovered.',
              'Merge in opens such a file on the other device. If it is locked you are asked for the passphrase first; a wrong one changes nothing.',
              'You see a preview before anything happens: people added or updated (and which details change), places added or updated, and entries added, updated, already here, or unreadable. A different mission, event or operational period name is flagged, but never blocks the merge.',
              'Nothing is replaced or removed. This device keeps its own entry numbers. If the file holds a later correction of an entry you already have, that entry is updated and named in the summary.',
              'A walk-up typed in on both devices becomes one person, and the entries from the file attach to them.',
              'Merging the same file twice, or handing back and forth, never makes duplicates.',
              'Attachments go in the file too (not the ones that were removed). The preview counts how many would be added, are already here, or do not match their fingerprint; a file that does not match is never stored.',
              'The file names real people and their phone numbers: keep it on a device you control, and delete it once it is merged in.'
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
            heading: 'Current summary',
            text: 'Current summary shows where the mission stands: messages per hour, traffic by team, station and operator, the entries that need attention, and these notes grouped by area. Run it whenever you like. It only reads the radio log, so it never stops logging. Print or Export it for the after-action review: the paper is the record of that moment, stamped with the period it covers and when it was made. Nothing is saved on the device.'
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

  '/log': {
    // E-222 / D-67
    screen: 'Log and journal',
    tabs: [
      {
        label: 'Journal',
        blocks: [
          {
            heading: 'What the journal records',
            text: 'The Journal tab lists what was done to the mission data on this device: loading a demo, starting a real mission, restoring, importing, backing up, exporting, printing, clearing and turning encryption on or off. It records that something happened and how many, never what a report or note said. It stays when you load a demo, start a real mission or clear the radio log.'
          },
          {
            heading: 'Intact or broken',
            text: 'Each entry is linked to the one before it. "Intact" means every link checks out. "Broken at entry 57" means entry 57 or the one before it was changed or lost. The short code of the newest entry is printed on the radio log, the summary and the map sheet, so a printed copy can be compared with this page later.'
          },
          {
            heading: 'Not tamper-proof',
            text: 'The check catches accidents and casual edits. It cannot stop someone determined who controls this device, and there is no way to delete an entry from here. Export journal gives a spreadsheet of every entry.'
          },
          {
            heading: 'ICS-214',
            text: 'When you export an ICS-214, the dialog can suggest journal entries as lines. Nothing goes on the form unless you tick it.'
          }
        ]
      },
      {
        label: 'Event log',
        blocks: [
          {
            heading: 'Event log',
            text: 'The Event log tab is for diagnosing problems. It is kept in memory only, can be cleared and is lost when the page reloads. The journal is separate and is saved.'
          }
        ]
      }
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
              'Import a list adds people from an Excel or CSV file. It shows which column is which, then a preview of who would be added and who would be updated, before anything changes. Add to roster is the usual choice: nobody is deleted, and a blank cell never erases what is already here. Replace roster starts over, and asks first.',
              'You can import several lists one after another (the CERT list, then the radio club). Download template gives you a blank spreadsheet to start from. A file made by Setup files, or an older RangerTrak file, also works.',
              'Export roster saves the roster as a spreadsheet or CSV that Import a list reads straight back in.',
              'Layer name, in the import preview, is what the device remembers a list by. Import a newer version of the same list under the same name and RangerTrak asks, for example, "2 people are no longer in Fernhollow CERT. Remove them?" The answer starts at No. Yes removes only those people, and only if no other list also has them. People you added by hand are never offered. Leave the name blank and the import is not remembered. "Layers on this device", in the same panel, lists what the device remembers and has Remove this layer.',
              'Photos are kept on this device only, never uploaded and never in the repo. Name each file after the ranger\'s id or callsign - any common image format works (JPG, PNG, GIF, WEBP, etc.).',
              'Import a list, Import photos, Export roster, Export changes and Print roster all live under "Import, export & print", collapsed near the bottom of this page. Print roster is a contact sheet (call sign, name, role, phone and ID, grouped by team) of the selected rows, or of the rows the table is showing; it carries names and phone numbers, so keep the paper safe. The Setup files button takes you to the Setup file card on the Mission page.'
            ]
          },
          {
            heading: 'Emptying the roster',
            text: 'Delete all rangers empties it and it stays empty, including after a reload.'
          },
          {
            heading: 'Moving a whole mission',
            text: 'To move the roster, settings and radio log entries together, use Back up mission/Restore mission on the Mission page. Import and Export here move only the roster. To hand a coordinator a starting point for a NEW device before a mission begins - any combination of roster, photos, locations and settings, no radio log entries - use the Setup file card on the Mission page (Data safety) instead.'
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
            heading: 'Attachments and space',
            text: 'Under Data safety: "Attachments: 41 MB of 512 MB (8%)" is always shown, with the setting for how much the mission may use. Past 80% the Entry page shows it beside Attach too. Back up mission also saves an attachments file beside the backup when there are any (locked with the same passphrase); Restore takes the backup, the attachments file, or both together, and checks every file against its fingerprint.'
          },
          {
            heading: 'Flag on map',
            text: 'Under Radio log statuses, the Flag on map column picks which statuses the map shows when it is set to Needs attention. Urgent, need-rest-food and evidence statuses are flagged to start with, as is any status with a custom color; tick or untick to change it.'
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
            heading: 'Mode: Demo, Exercise or Incident',
            bullets: [
              'The Mode card at the top of this page explains the three modes. The icon at the left of the header status pill shows the current one; hover it to change it.',
              'An Exercise stamps EXERCISE on the printed radio messages, communications log, After Action report and map sheet. While a mission is under way (a report in the last 12 hours, or an operating period running or about to start) RangerTrak holds back tips, the install prompt and the Reload bar.'
            ]
          },
          {
            heading: 'Backup and advanced options',
            bullets: [
              'Back up mission (Data safety card) downloads settings, rangers and radio log entries as one file — the way to back up a mission or move it to another device. Restore mission, in the Danger zone below, round-trips it back in.',
              'Setup file (Data safety card, also reached from the Setup files button on Rangers) is a starter kit for a NEW device: mission settings, roster with photos and places, any of the three, never radio log entries. Importing one shows what it would do first: the roster and places are added to what is here (nothing is removed, a blank cell never erases), and settings replace this device\'s settings wholesale. Load one file at a time. Old /prep links land here.',
              'Load sample mission and Reset mission to defaults are also in the Danger zone — each replaces data already on this device and cannot be undone. Loading a sample mission first shows what will go and lets you choose what else to clear, such as your notes and ICS-214 lines.'
            ]
          },
          {
            heading: 'RangerTrak Board (optional)',
            text: 'Lets other people on the SAME WiFi or hotspot read the live comms log from their own phone, tablet or laptop — a read-only view, on a separate small server, not a way to edit this mission from another device. Off by default; this device\'s own copy is exactly the same either way, whether it\'s on or off.',
            bullets: [
              '1. Someone runs the RangerTrak Board program on a laptop at the command post. It is a small Node.js program in the RangerTrak source code (tools/command-post-server.js), started with npm run command-post. Not a phone (phones can\'t run it, only supply the WiFi). It prints its own address on startup — normally https://rangertrak-board.local, a name that stays the same on every network (older Android phones may not find it; the screen also lists the numeric address, e.g. https://192.168.1.5:8080, to use instead). It only listens on the command-post laptop\'s own local network, never on the public Internet.',
              '2. On EVERY device that will publish to it or view it — including this one — open that address directly in the browser once. It will warn "Your connection is not private" — expected, the same warning most home routers show, since this is a private server with no public certificate. Click Advanced, then Proceed. Needed once per device; skipping this step is the #1 reason publishing silently does nothing.',
              '3. On THIS device (the one actually filing reports), turn the "Send this log to a RangerTrak Board" toggle on below — the "Server address" field only appears once it\'s on — then paste that exact address into it. Reports start publishing there automatically from then on, every time one is filed or edited.',
              '4. Give viewers the SAME address with /view added — e.g. https://rangertrak-board.local/view — and make sure they\'re joined to the SAME WiFi/hotspot as the command-post laptop (and have done step 2 on their own device). They\'ll see a live, auto-refreshing table (time, callsign, status, message), each with their own filter and sort, independent of everyone else looking at it. Phones can scan the QR code the Board shows instead of typing: it is printed on the laptop\'s screen once publishing starts, and https://localhost/qr (add the port if the screen shows one) on that laptop shows it full screen.',
              'The roster never goes with it — only report content. Full names, phone numbers and photos stay on this device; a viewer only ever sees a callsign, same as anyone standing at the map.',
              'If the server isn\'t reachable (not running yet, wrong address, step 2 skipped, or you\'re off that WiFi), publishing just fails quietly in the background — this device keeps working exactly as normal either way.',
              'Board password (optional). Leave it blank and anyone on that WiFi can read the Board, so the WiFi password is the real access control. Type one and viewers are asked for it once (the QR code carries it, so phones do not have to type). Change it here any time.',
              'Only one device publishes at a time. The first one to publish claims the Board; the Board shows who (call sign, mission, browser) and when. If a second device publishes with the same password, it takes over at once, and the first one stops and says so on this card. Press Take over to get the Board back. If the Board program is restarted, the publishing device notices within seconds and claims it again by itself, but it never takes the Board away from another device that got there first.',
              'Show attachments on the Board (off by default): off, viewers only see how many photos, audio or video clips a report has. On, they see small thumbnails, and clicking one asks this device to send the full-size file. It is held in the Board laptop\'s memory only (never saved to disk) and the viewer\'s browser checks its fingerprint before showing "Verified". This device has to be on and publishing for that to work.',
              'What the password protects against: casual access by other people on a shared network. It does not stop a determined attacker who sets up a fake Board. Some guest WiFi (hotels, public hotspots) blocks devices from reaching each other at all; use your own router or a phone hotspot.'
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
            text: 'Print map gives you a one-page landscape map sheet: the map filling the whole page, with a north arrow, a scale bar, the map credit and latitude/longitude marks around its edge; a title box (the mission, the operational period and when it was printed) and a legend box (every marker, team, place and shading on the map) placed on the map where they hide none of your markers, or, on a very crowded map, the title above the map and the legend whole on a second page; range rings around the command post, always drawn; and a line at the bottom to sign as the person who prepared it. Every report prints as its own marker (no numbered bubbles), and reports at nearly the same spot fan out around it on thin lines so each can be read (the "minutes since" number for each ranger sits on the newest marker of that ranger), so a PDF can be zoomed to see them. Print map spends a few seconds ("Preparing the map...") loading a more detailed map for paper: online it fetches it; offline it uses the area saved for offline use (saving keeps two closer zoom levels too, so print at about the zoom you saved at), and if some of that detail is missing it prints what is on screen rather than leaving blank patches. Use the Print map button, not the browser\'s own Print command, which skips that step.'
          },
          {
            // 2026-09-30, John: E-162 / E-138 - map layers and the Zoom to offline tiles button.
            heading: 'Map layers and overlays (Leaflet map)',
            bullets: [
              'Open the layers box at the top right of the map to pick a base map — OpenStreetMap, OpenTopoMap (contours), Satellite (Esri World Imagery, which needs Internet) or USGS aerial photos (US only) — and to switch overlays on and off, including USGS shaded relief (US only).',
              'Which layers can be saved for offline use depends on each provider\'s rules, not on RangerTrak. OpenTopoMap, USGS aerial photos and USGS shaded relief can be saved with Save this area (the relief is saved along with the base map while it is switched on). OpenStreetMap, Esri satellite, Esri hillshade, roads and place names, and hiking trails are online only, because their providers do not allow saving their maps in bulk. Aerial photos take roughly twice the space of the same area on OpenTopoMap; the size is shown before anything is saved.',
              'USNG / MGRS grid draws the grid squares used in search and rescue, with the numbers you read out for a grid reference; it is worked out on your device and works with no Internet.',
              'Range rings (from command post) draws evenly spaced circles around your Command Post location (or the default location on the Mission page if you have not placed one), each labelled with its distance. The spacing fits what you are looking at, like the scale bar: tenths of a mile zoomed in on a fairground, miles zoomed out over a search area. To keep one distance at any zoom (say, a 2 mile radio range), move the Range ring spacing slider under the map off Auto; the rings go bold for a moment while it moves so you can see them on a busy map. It works with no Internet.',
              'Under the map, the position under the pointer is shown in decimal degrees (DD), degrees and decimal minutes (DDM, used by air operations) or USNG (the same grid as MGRS); pick one with the DD / DDM / USNG buttons. Clicking the map copies that position in the same format. On a phone, tap the map to see a position.',
              'Hiking trails (Waymarked Trails) shows marked hiking routes and needs Internet. Roads and place names draws roads and labels over the Satellite map, and needs Internet. Hillshade (terrain relief) also needs Internet, and the Mile grid works with no Internet.',
              'Zoom to offline tiles, under the map, shows the areas you have saved for offline use and zooms out to fit them; press it again to hide them. It is grayed out until you have saved something.'
            ]
          },
          {
            heading: 'Filtering the map',
            text: 'Under the layers box, Locations, Radio log entries and Ranger paths can each be switched off, and Show under the map can thin the entries to the Latest per ranger or only those that Need attention (the statuses flagged on the Mission page). With Ranger paths on, All and Need attention still draw each ranger\'s whole trail; Latest per ranger shows one point each, so it draws no trails. A strip on the top edge of the map lists whatever is hidden, each with an x, and Show everything brings it all back. Nothing is remembered: the map starts with everything shown each time. A printed map says "Filtered:" with the same list in its title box when anything is hidden.'
          },
          {
            // 2026-10-15, E-187 phase B (ADR D-58): places in and out, in the Import, export & print panel.
            heading: 'Putting places on the map, and handing them on',
            bullets: [
              'Import, export & print, near the bottom of this page, puts places on the map from an Excel or CSV sheet, a Google My Maps export (KML or KMZ) or a GeoJSON file. You see what would change first, nothing is removed without asking, and rows without a latitude and longitude are skipped.',
              'Export places hands on the categories you tick, as a spreadsheet, a CSV or a named Setup file.',
              'Print places (beside Export places, using the same categories) prints a portrait list of the places grouped by category - name, address, coordinates and note - with a small map of them across the top. Coordinates are written in the format picked on the card (DD, DDM or USNG). With the MapLibre map the list prints without the map. Print map, under the map, is a different print and is unchanged.',
              'Give an import a Layer name and the device remembers it. Importing a newer version under the same name asks, with the answer set to No, about places that are no longer in it. A place renamed in the newer file is updated, not added twice. "Layers on this device" lists what is remembered and has Remove this layer; places you added by hand are never touched.'
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
