# Regional data tools

Scripts that turn a community's own records into RangerTrak rosters and bundles. **They hold no
data, and no data may ever be committed here:** rosters, crosswalks, photos, FCC extracts and
outputs all contain personal information (ADR D-35). They live outside the repo, in a data folder
laid out by place:

```
rangertrak-regional-data\          (never in git)
  us\_national\fcc\                the FCC amateur license file
  us\<state>\<county>\<locality>\  region.json, sources\, rangers\, locations\, teams\, work\
```

| Tool | What it does |
|---|---|
| `ham-roster\` | FCC weekly license file + area ZIPs (+ your club list) → area hams, call-sign changes, lapsed licences, a merge report, a RangerTrak roster. Standalone, no npm install (fflate vendored, MIT) |
| `roster-build\` | Volunteer table + ID crosswalk + photos → RangerTrak roster JSON and a thumb-drive zip, for any region folder |
| `demo\` | Fernhollow, a made-up region generated at test time, and the test that runs the tools on it (`npm run test:regional`). Start here to see what a region folder looks like |

**Finding the data:** pass a region folder, e.g. `node roster-build/1-make-roster.js us/wa/king/vashon`.
A relative path is tried from the current folder, then under `RANGERTRAK_DATA` (set it to your
data folder), then in a `rangertrak-regional-data` folder beside any folder above the scripts.

Needs Node 18 or later. Everything runs on your machine. The only network call is
`ham-roster download`, which fetches the FCC's public file and sends nothing about you.

The long-range plan, including running these inside the app one day, is in the regional-data
session's `PLAN-community-onboarding.md` (outside the repo).
