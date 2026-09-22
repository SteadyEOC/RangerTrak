# 🌲 RangerTrak™ 📡

[![SWUbanner](https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/banner2-direct.svg)](https://vshymanskyy.github.io/StandWithUkraine)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

> **New here?** Start at **[rangertrak.com](https://rangertrak.com)** — what it is, the Field
> Guide, and how to try it without a GitHub account. Try the app itself at
> **[rangertrak.org](https://rangertrak.org)**. This repo is the source, issues and releases.

**RangerTrak tracks and maps CERT, ACS, SAR, wildland-fire and other teams who are
reachable only by HAM radio.** Field teams radio in their locations; a scribe at the
command post transcribes them; RangerTrak builds a single mapped log of who was where,
when, and in what condition — for live situational awareness and after-action
documentation.

It is a [Progressive Web App](https://en.wikipedia.org/wiki/Progressive_web_app) that runs
entirely in the browser. **No server, no account, and no Internet required** once it has
been loaded — which is the point, because the command post often has none. No API key is
required either, for RangerTrak's core function; address lookup uses a keyless default
(OpenStreetMap's Nominatim), with an optional Google Geocoding key if you supply your own.

Because reading latitude and longitude over a radio is slow and error-prone, locations can
also be reported as street addresses or Plus Codes.

**Try it: <https://RangerTrak.org>**

---

## 📚 Documentation

| Document | For | Contents |
| --- | --- | --- |
| **[FIELD-GUIDE.md](FIELD-GUIDE.md)** | Operators, ECs, scribes | How to prepare a device before a mission, so it still works when the network doesn't |
| **In-app Help** | Operators, ECs, scribes | The full reference for every screen — built into the app, always matches the version you're running, and works with no Internet |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Developers | How the app is built: map engines, geocoding, bundle and loading strategy |
| **[DEVELOPING.md](DEVELOPING.md)** | Developers | Running, testing, releasing, updating dependencies, deploying |
| **[contributing.md](contributing.md)** | Everyone | Code of conduct |
| **[CHANGELOG.md](CHANGELOG.md)** | Everyone | Release history |
| **[.vscode/SETUP.md](.vscode/SETUP.md)** | Developers | VS Code workspace setup |

**New to RangerTrak? Start with the [Field Guide](FIELD-GUIDE.md).** In particular, read
"Before the mission" — the difference between a prepared device and an unprepared one is
the difference between a working tool and a blank screen.

---

## ✨ What it does

- **Works offline.** Entering reports, the roster, the report table, coordinate
  conversion, and mission export/import are all local to your device.
- **Six coordinate formats**, entered however the field team read them out: Decimal
  Degrees, Degrees/Decimal Minutes, Degrees-Minutes-Seconds, MGRS, UTM, and Maidenhead grid
  locators — plus Plus Codes and street addresses. All lat/long and grid conversion is
  computed on-device, so it keeps working with no connection.
- **Two map engines, switchable on one page.** A Leaflet map over standard online road
  maps — with a switchable base layer (OpenStreetMap or OpenTopoMap) and the ability to
  save an area's tiles for offline use — and an offline map (MapLibre + PMTiles) whose
  basemap data ships inside the app. Both cluster markers and have overview maps.
- **Per-ranger markers and route trails.** Each callsign gets a distinct marker shape and
  colour, with a trail showing where they've been.
- **Roster with call-sign lookup.** Fast entry by tactical call sign, for individuals or
  teams.
- **Editable statuses** with custom names and colours, plus searchable free-text notes.
- **Mission and operational period tracking.**
- **Export and import.** Reports and roster export to CSV/Excel; a whole mission
  (settings, roster, reports) exports to a single file for backup or handover.
- **Sample data** for demonstrations and training, loadable in one click.
- **Free and open source**, under the AGPL — free to use, free to modify.

> ⚠️ The roster contains personal information — names, addresses, phone numbers, and call
> signs that map to public licence records — **stored unencrypted on the device**. Mission
> backups can be encrypted with a passphrase (optional, and blank still writes a plain
> file), but data at rest is not yet. See the Field Guide for handling guidance.

## 🗺️ Roadmap

What has actually shipped is in [CHANGELOG.md](CHANGELOG.md) and the
[releases](https://github.com/SteadyEOC/RangerTrak/releases) — that is the accurate record,
and it moves most weeks. The [issues page](https://github.com/SteadyEOC/RangerTrak/issues) is
the place for comments and feature suggestions, and
[milestones](https://github.com/SteadyEOC/RangerTrak/milestones) group the longer-range ones;
neither is a complete picture of day-to-day work. A consolidated public `ROADMAP.md` will
follow once the next release's scope is firm.

Note on version numbers: the minor version bumps **rapidly and deliberately**. `0.x.0` means
"a meaningful batch of work landed," not "this is stable and supported." The release others
are actively encouraged to adopt will be `1.0.0-rc.1`, and it is not near.

Known gaps worth stating plainly:

- It will not **interrupt** you. Overdue teams are shaded green through red on the map, the
  roster and the Radio Log, against your mission's own check-in interval — but nothing beeps
  or pops up, and the times refresh when a screen redraws rather than ticking.
- There is no **geo-fence** — nothing warns that a ranger is outside an expected area.
- The bundled offline map covers the **whole world at low detail**, with street-level detail
  only for the demo area. Your own area needs saving on the street map beforehand, or a
  `.pmtiles` file loading for it.
- **What3Words** is not wired up, and would be the only coordinate format needing a key and a
  network call — every other one is computed on-device.
- The UI is **English-only** and the ICS forms are the **US** versions.

## 🚀 Quick start

**Using it:** visit <https://RangerTrak.org>, then set up the mission in **Settings**, add
people on the **Rangers** page, and enter reports on the **Home** screen. Full walkthrough
in the [Field Guide](FIELD-GUIDE.md).

**Developing it:**

```bash
git clone https://github.com/YOUR_USERNAME/rangertrak.git
cd rangertrak
npm install
npm start
```

Details, testing and release process in [DEVELOPING.md](DEVELOPING.md).

## 🌐 SteadyEOC

RangerTrak is a free, open-source project from [SteadyEOC](https://steadyeoc.com). We'd
love to hear how you use RangerTrak and what you need from it.

## 🗣️ Feedback & contribution

- **[GitHub issues](https://github.com/SteadyEOC/RangerTrak/issues)** — bugs and specific
  pieces of work.
- **GitHub discussions** — open-ended conversation about the project.
- **Pull requests** — including small edits made entirely in GitHub's browser editor; no
  local setup needed for a documentation fix.
- **Email** — <RangerTrak@steadyeoc.com>.
- **Support** — RangerTrak is free and stays free. If it helps your team, you can
  [buy the developer a coffee](https://buymeacoffee.com/JohnCornelison). That goes to John
  Cornelison personally, not a charity, so it isn't tax-deductible.

## 📜 License

Copyright © 2019–2026 John Cornelison

RangerTrak is free software: you can redistribute it and/or modify it under the terms of
the **GNU Affero General Public License** as published by the Free Software Foundation,
either version 3 of the License, or (at your option) any later version. See
[LICENSE](LICENSE) for the full text.

- **Using RangerTrak — including at your EOC, exercise, or incident — is completely free
  and always will be.** The AGPL places no obligations at all on people who simply *use*
  the application.
- If you **modify** RangerTrak and distribute it, or run your modified version as a network
  service, you must make your modified source available under the same license.
- Contributions are welcome. Note that the project may offer commercially licensed versions
  in future, so contributors may be asked to sign a Contributor License Agreement.

*(Releases prior to this change were published under the MIT License and remain available
under those terms.)*

## 💬 Testimonials

> "*(We) all agreed that this is a WOW program with high value added to SAR. I really hope
> you continue to refine it!*"

— Michael Meyer, KB7MTM, [Vashon ACS](https://vashonbeprepared.org/partnerorganization/acs/)
