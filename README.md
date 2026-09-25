<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/rangertrak-mark-on-dark.svg">
    <img src="src/assets/icons/rangertrak-mark.svg" width="96" alt="RangerTrak logo: a map pin that is also a handheld radio">
  </picture>
</p>

<h1 align="center">RangerTrak™</h1>

[![SWUbanner](https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/banner2-direct.svg)](https://vshymanskyy.github.io/StandWithUkraine)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

> **New here?** Start at **[rangertrak.com](https://rangertrak.com)** — what it is, and how
> to try it without a GitHub account. Try the app itself at
> **[rangertrak.org](https://rangertrak.org)**; its built-in **Help** is the full reference.
> This repo is the source, issues and releases.

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
also be reported as Plus Codes (computed on-device, always available) or street addresses
(a live lookup against Nominatim/Google — see [FIELD-GUIDE.md](FIELD-GUIDE.md#what-needs-internet-and-what-doesnt),
needs Internet).

**Try it: <https://RangerTrak.org>**

---

## 📚 Documentation

| Document | For | Contents |
| --- | --- | --- |
| **In-app Help** | Operators, ECs, scribes | The source of truth for every screen — built into the app, always matches the version you're running, and works with no Internet |
| **[rangertrak.com](https://rangertrak.com)** | Everyone | The front door: what RangerTrak is, the Field Notes blog, and a short field guide that points into Help |
| **[FIELD-GUIDE.md](FIELD-GUIDE.md)** | Operators, ECs, scribes | The printable pre-mission companion: preparing a device so it still works when the network doesn't |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Developers | How the app is built: map engines, geocoding, bundle and loading strategy |
| **[DEVELOPING.md](DEVELOPING.md)** | Developers | Running, testing, releasing, updating dependencies, deploying |
| **[contributing.md](contributing.md)** | Everyone | Code of conduct |
| **[CHANGELOG.md](CHANGELOG.md)** | Everyone | Release history |
| **[.vscode/SETUP.md](.vscode/SETUP.md)** | Developers | VS Code workspace setup |

**New to RangerTrak? Start at [rangertrak.com](https://rangertrak.com), then the in-app
Help.** Before a real mission, print or read the [Field Guide](FIELD-GUIDE.md)'s "Before
the mission" — the difference between a prepared device and an unprepared one is the
difference between a working tool and a blank screen.

---

## ✨ What it does

- **Works offline.** Field reports, the roster, the Radio Log, coordinate conversion and
  mission backups all stay on the device and need no connection.
- **Locations however the field reads them out:** lat/long in three notations, MGRS, UTM,
  Maidenhead and Plus Codes, all converted on-device. Street addresses work too, but need
  Internet.
- **Two map engines on one page:** Leaflet over online road and topo maps, with areas
  saveable for offline use, and MapLibre + PMTiles with a bundled offline basemap. Each
  ranger gets a distinct marker and a trail.
- **ICS paperwork:** a printable ICS-309 comms log, and ICS-213 messages generated from field reports.
- **Roster, statuses, mission and operational period**, all configurable per mission.
- **Backup, export and demo data:** spreadsheets, whole-mission backups (optionally
  passphrase-encrypted), and demo scenarios for training.
- **Free and open source**, under the AGPL.

How to use each screen is in the app's Help, not here; developer detail is in
[ARCHITECTURE.md](ARCHITECTURE.md).

> ⚠️ The roster contains personal information — names, addresses, phone numbers, and call
> signs that map to public licence records — **stored unencrypted on the device**. Mission
> backups can be encrypted with a passphrase (optional, and blank still writes a plain
> file), but data at rest is not yet. See Help → **Your data** in the app for handling
> guidance.

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

**Using it:** visit <https://RangerTrak.org>, then name the mission on the **Mission** page,
add people on the **Rangers** page, and enter reports on **Field Entry** (the RangerTrak
link at top left). Help → **Start here** walks through it.

**Developing it:**

```bash
git clone https://github.com/SteadyEOC/RangerTrak.git
cd RangerTrak
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
