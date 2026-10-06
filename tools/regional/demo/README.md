# Fernhollow: the made-up demo region

Fernhollow is a community that doesn't exist. It gives the regional tools something to run on
in CI, and it shows another community what its own data folder should look like. The real data
the tools are for may never be committed (ADR D-35), so this is the only region the repo knows.

| | |
|---|---|
| `make-demo-region.js <folder>` | writes Fernhollow under `<folder>`, laid out like `rangertrak-regional-data`: `us/zz/demo/fernhollow/` (region.json, volunteer table, ID crosswalk, photos) and a tiny FCC licence file in `us/_national/fcc/demo/`. The folder must be outside the repo |
| `test-demo-region.js` | builds Fernhollow in a temp folder, runs the roster build, the drive bundle and ham-roster on it, and checks each case planted in the data. `npm run test:regional`; `--keep` leaves the folder to look at |

**Nothing here is real.** The names come from the same stock as the app's sample missions,
phones are 555-01xx, the ZIPs (00001, 00002) and state (ZZ) don't exist, and credentials use
a `DM-` prefix. The photos are the app's own AI-generated demo faces. Call signs have to look
like US calls for the tools to accept them, so they are invented in the WZ0/KZ0 blocks.

The data is generated, not committed: `check-regional-tools.js` fails on any CSV, JSON, image or
zip under `tools/regional/`, demo or not. To add a case, add it to the tables at the top of
`make-demo-region.js`, list it in the header comment, and add a check to the test.

This folder belongs to the code session. Real regions (Vashon and the rest) belong to the
regional-data session, in its own folder outside git.
