# Leaflet 2 trial: findings for the Leaflet maintainers

Running log for E-265. Each finding is written so it can be pasted into a Leaflet (or plugin) issue
as is: what we did, what happened, the exact message, and what we did about it. Public content: no
regional or roster data; screenshots use the Fernhollow demo only.

## Setup

| | |
| --- | --- |
| App | RangerTrak: offline-first PWA for CERT/SAR/ham field teams. Leaflet is the default map engine (MapLibre is the alternate). |
| Stack | Angular 22, esbuild application builder, TypeScript strict, Node 24.16.0, Windows 10 |
| Leaflet | `main` at `c152e0d7ec90b1a5735272a6ff93cb6753993759` (2026-10-31), built with `npm ci && npm run build && npm pack` |
| Baseline | RangerTrak `main` at `4d644481`, Leaflet 1.9.4, `@types/leaflet` 1.9.22 |
| Plugins | `leaflet.markercluster` 1.5.3, `leaflet.offline` 3.2.1 |
| Our usage | 10 files import `leaflet`. Heaviest: Marker 35, Map 24, TileLayer 18, DivIcon 19, Point 10, LayerGroup 8, DomUtil 7, DomEvent 4, MarkerClusterGroup 7, Control 6 |

## Baseline (Leaflet 1.9.4)

- Leaflet is CommonJS, so esbuild hoists it into the eager `main.js`: **145.9 KB** of an 802 KB
  `main.js`, paid on every page, including ones without a map. Plugins are lazy (markercluster
  33.5 KB, offline 6.9 KB).
- Initial total 1.89 MB raw / 415.20 kB transfer.
- e2e `map` + `entry` groups: 70/70 pass.
- Local Lighthouse 13.5.0 desktop, 3 runs, medians: Entry `/` perf 75, LCP 2.98 s, TBT 31 ms,
  CLS 0.012, unused JS 619 KB. Map `/map` perf 64, LCP 8.87 s, TBT 16 ms, CLS 0.035.

## Findings

Severity: **blocker** (cannot ship without a workaround), **friction** (cost us time; a doc line
or small change would fix it), **note** (worth knowing; no action asked).

### F-1 (friction, Leaflet): `main` still reports `2.0.0-alpha.1`

`package.json` and `export const version` on `main` both say `2.0.0-alpha.1`, so a tarball packed
from `main` is indistinguishable from the 2025 alpha in `npm ls` and lockfiles. We renamed ours
by SHA. Suggest a `-dev` / prerelease bump on `main` (e.g. `2.0.0-beta.0-dev`) so downstream
testers can report which build they ran.

### F-2 (friction, Leaflet): CHANGELOG has no entries after `2.0.0-alpha.1`

Breaking changes since alpha.1 that hit us or our plugins, none yet in `CHANGELOG.md`:

- `Browser` namespace removed (#10447)
- `PosAnimation` made internal (#10446)
- `preventOutline` / `restoreOutline` removed (#10455)
- `preferCanvas` option dropped (#10438)
- DomEvent chaining dropped (6806a7b3), PointerEvents folded into DomEvent (6ca71528)
- `Projection` namespace replaced by flat classes (98dd20ee)
- `keypress` marker event removed (#10473)

The planned upgrade guide will cover these. Until then a CHANGELOG "Unreleased" section
would let testers on `main` find them without bisecting.

### F-3 (blocker, leaflet.markercluster): peer range and `Class.extend`

`leaflet.markercluster@1.5.3` declares `peerDependencies: { leaflet: "^1.3.1" }`, so npm flags the
tree as invalid (`ELSPROBLEMS`). It also builds on `L.FeatureGroup.extend(...)`; on `main`,
`Class.extend` / `FeatureGroup.extend` are `undefined`. Open upstream PR
Leaflet/Leaflet.markercluster#984 ("Do not rely on global L") is the obvious candidate to test.

### F-4 (blocker, leaflet.offline): depends on, not peers with, Leaflet 1

`leaflet.offline@3.2.1` lists `leaflet: "^1.6.0"` under `dependencies`. Installing Leaflet 2 at
the top level makes npm nest a **second** `leaflet@1.9.4` under `leaflet.offline`, and its UMD
`require('leaflet')` resolves to that copy, so the app would ship two Leaflets and the offline
tile layer would be a v1 layer on a v2 map. The plugin is already ES-class based
(`class TileLayerOffline extends leaflet.TileLayer`), so the port looks small. Calls it makes
that `main` no longer exports:

| Used by leaflet.offline | On Leaflet `main` |
| --- | --- |
| `Util.bind` | removed (`Util` now: falseFn, formatNum, lastId, setOptions, splitWords, stamp, template, throttle, wrapNum) |
| `Browser.retina` | removed (#10447) |
| `leaflet.bounds(...)` factory | removed; use `new Bounds(...)` |
| `DomEvent.on(link, 'mousedown dblclick', ...).on(...)` | chaining dropped; `mousedown` vs pointer events to check |

Upstream tracking issue: allartk/leaflet.offline#461 ("Leaflet V2.0 Coming Soon").

### F-5 (friction, Leaflet types): v1 option type names now mean "fully resolved options"

In `@types/leaflet`, `TileLayerOptions`, `PolylineOptions` and friends are the bag you *pass*:
every field optional. In the new first-party types (c2a5abe6), the same names are the
*resolved* options (`interface TileLayerOptions extends GridLayerOptions, Omit<TileLayerDefaults, ...>`),
with every field required; constructors correctly take `Partial<O>`.

Because the names are the same, existing code and **every plugin's `.d.ts`** still compile
against them but now demand the full set. Two ways it hit us:

```ts
// our code, fine under @types/leaflet
const gridStyle: L.PolylineOptions = { color: '#3355ff', weight: 1, opacity: 0.5, interactive: false }
// TS2740: ... is missing the following properties from type 'PolylineOptions':
//   pane, attribution, bubblingPointerEvents, stroke, and 11 more.
```

```ts
// leaflet.offline 3.2.1, dist/types/TileLayerOffline.d.ts
export declare function tileLayerOffline(url: string, options: TileLayerOptions): TileLayerOffline;
// TS2345: Argument of type '{ maxZoom: number; minZoom: number; attribution: string; }'
//   is not assignable to parameter of type 'TileLayerOptions'.
```

Suggestion: keep the v1 meaning for the public names (`TileLayerOptions` = what you pass, all
optional) and give the resolved shape another name (`ResolvedTileLayerOptions`, or keep it
internal). Failing that, list it in the upgrade guide, with the `Partial<...>` fix, as the
first types item, since plugin authors will hit it before anything else.

### F-6 (note, Leaflet types): v1 type names with no v2 export

`LatLngTuple` and `LeafletMouseEvent` (both widely used from `@types/leaflet`) have no export on
`main`. `Map.mouseEventToLatLng` is now `pointerEventToLatLng`, and `DomUtil.addClass` is gone
(use `classList`). All easy once known; a rename table in the upgrade guide would cover them.
