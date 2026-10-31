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

### F-7 (friction, npm/our setup): `$leaflet` override fails when Leaflet is a `file:` dependency

To make `leaflet.offline` (which *depends on* `leaflet ^1.6.0`, see F-4) share our copy we tried
`"overrides": { "leaflet.offline": { "leaflet": "$leaflet" } }`. With `"leaflet": "file:vendor/leaflet-main-c152e0d.tgz"`:

```
npm ERR! Invalid comparator: file:vendor/leaflet-main-c152e0d.tgz
```

`"*"` installs but leaves the stale nested `leaflet@1.9.4` in the lockfile (1.9.4 satisfies `*`).
`">=2.0.0-alpha.1"` works: `npm ls leaflet` then shows a single `leaflet@2.0.0-alpha.1`, deduped under both plugins.
Not a Leaflet bug; recorded because anyone testing `main` from a tarball will hit it.

### F-8 (blocker, plugin: @kristjan.esperanto/leaflet.markercluster 3.0.3): imports `Browser`

The fork's peer range is `leaflet >=2.0.0-alpha.1` and it was written against alpha.1, so it breaks on `main`:

```
X [ERROR] No matching export in "node_modules/leaflet/src/Leaflet.js" for import "Browser"
    node_modules/@kristjan.esperanto/leaflet.markercluster/dist/leaflet.markercluster.js:14:77
```

It uses only `Browser.mobile` and `Browser.touch`. Patch: a two-line local object
(`/mobi/i.test(navigator.userAgent)`, `navigator.maxTouchPoints > 0`).

### F-9 (blocker, plugin): still built on `Class.extend()` and `initialize()`

After F-8 the app builds, but the first page that loads the plugin dies at module evaluation:

```
Uncaught TypeError: Marker.extend is not a function
    at node_modules/@kristjan.esperanto/leaflet.markercluster/dist/leaflet.markercluster.js:372:32
```

Three classes use it (`MarkerCluster`, `MarkerClusterGroup`, `MarkerClusterNonAnimated`), with
`options:` on the prototype, `initialize:` and `Marker.prototype.initialize.call(...)`. We converted
them to `class X extends Y` with the constructor body taken from `initialize`, `X.mergeOptions({...})`
for the options, `X.include({...methods})` for the rest, `Marker.defaultOptions.pane` in place of
`Marker.prototype.options.pane`, and `this.options.icon = this` after `super()` (the cluster
marker is its own icon). Leaflet's guard message (`initialize() is not called in Leaflet 2.
Rename it to constructor()`) is helpful. `Class.include` and `mergeOptions` kept the conversion
small (about 40 changed lines in a 2,900-line file); the spiderfy code needed no change.
Cluster rendering and spiderfy are NOT verified by the e2e groups we ran (see end of this file).

### F-10 (friction, plugin types): the fork's `.d.ts` cannot resolve Leaflet names

`types/index.d.ts` is written as `import * as L from "leaflet"; declare module "leaflet" { ... } export = L;`.
Against Leaflet `main` every name inside the augmentation is unresolved:

```
index.d.ts(7,47): error TS2552: Cannot find name 'LayerOptions'.
index.d.ts(139,36): error TS2304: Cannot find name 'FeatureGroup'.
```

so `MarkerClusterGroup` degrades to something not assignable to `Layer`
(`TS2345: Argument of type 'MarkerClusterGroup' is not assignable to parameter of type 'LayerBase<LayerOptions, LayerEventMap>'`).
`@types/leaflet` declared a global `L` namespace; the first-party types do not. Patch: named
`import type { ... } from 'leaflet'`, top-level `export class MarkerClusterGroup`, options typed
`InteractiveLayerOptions & MarkerClusterGroupOptions` (the v2 base class wants the fully
resolved options, see F-5), and the `Marker.refreshIconOptions` augmentation kept in `declare module "leaflet"`.

### F-11 (blocker, plugin: leaflet.offline 3.2.1): the four calls from F-4, patched

Patched with `patch-package` (`patches/leaflet.offline+3.2.1.patch`, about 6 changed lines in
`dist/bundle.js`, 2 in the `.d.ts`), the seed of a PR for allartk/leaflet.offline:

- `Util.bind(f, ctx, ...a)` becomes `f.bind(ctx, ...a)` (2 places)
- `Browser.retina` becomes `window.devicePixelRatio > 1`
- `bounds(a, b)` becomes `new Bounds(a, b)`
- `DomEvent.on(link, 'mousedown dblclick', stopPropagation).on(...)` becomes separate `DomEvent.on` calls, and `mousedown` becomes `pointerdown`
- `.d.ts`: `tileLayerOffline(url, options: TileLayerOptions)` becomes `options?: Partial<TileLayerOptions>` (F-5); `createTile(...): HTMLElement` becomes `HTMLImageElement` (F-13)

The `window.L` registration blocks are harmless and were left. Saving tiles (the `savetiles`
control and `downloadTile`) is NOT verified at runtime, only type-checked and bundled.

### F-12 (friction, Leaflet docs): the default-icon idiom `Marker.prototype.options.icon = ...` now throws at load

A very common snippet (also the standard fix for bundlers breaking the default marker image):

```ts
L.Marker.prototype.options.icon = iconDefault
// TypeError: Cannot set properties of undefined (setting 'icon')   (at module evaluation of the lazy /map chunk)
```

TypeScript did not catch it, and the unit tests never load that module. It surfaced only as a
router NavigationError on `/map` in a real browser; our first e2e run failed on it (36/37).
Fix: `L.Marker.mergeOptions({ icon: iconDefault })`. Suggest the upgrade guide list
"`prototype.options` is gone, use `mergeOptions` / `defaultOptions`" with this exact example.

### F-13 (friction, Leaflet types): `Tooltip` is not a `Layer`; `createTile` is typed `HTMLImageElement`

- We add a permanent `Tooltip` (a text label at a lat/lng) to a `LayerGroup`:
  `TS2345: Argument of type 'Tooltip<...>' is not assignable to parameter of type 'Layer<...>'`.
  `Tooltip` now extends `DivOverlay extends LayerBase`, and `LayerGroup.addLayer(layer: Layer)`.
  At runtime it should work, because `Map.addLayer` only needs `_layerAdd` (not verified in a browser). We cast.
  `LayerGroup.addLayer` could take `LayerBase`, as `Map.addLayer` already does.
- We override `createTile` to return a `div` (a "no tile here" placeholder). v1 typed it `HTMLElement`;
  v2 types `TileLayer.createTile` as `HTMLImageElement`: `TS2322: Type 'HTMLElement' is missing the following properties from type 'HTMLImageElement'`. We cast.

### F-14 (note, Leaflet types): more removed names and renamed events

Beyond F-6: `L.MarkerClusterGroup` (a global augmentation before, now an import from the plugin);
`import L from 'leaflet'` has no default export (use `import * as L`); a bare `import 'leaflet'`
now draws an esbuild warning because the package's `sideEffects` array excludes it.
`LeafletMouseEvent` becomes `LeafletPointerEvent`. Event names we changed on map and marker
listeners: `mousemove` to `pointermove`, `mouseover`/`mouseout` to `pointerover`/`pointerout`
(`click` is unchanged). `bubblingMouseEvents` still works (the `?? bubblingPointerEvents`
fallback in `_fireDOMEvent` is a good touch).

### F-15 (note, ours): the mechanical port, for scale

About 100 factory calls in 10 files became `new X(...)` (marker 13, point 10, divIcon 8, layerGroup 8,
tileLayer 7, map / latLng / latLngBounds / polyline 5 each, bounds 4, icon 4, a few others);
`L.control.layers` / `L.control.scale` became `new L.LayersControl` / `new L.ScaleControl`;
`L.control({...})` with an `onAdd` assignment became `new L.Control({...})`;
`DomUtil.addClass` became `classList.add` (3); `mouseEventToLatLng` became `pointerEventToLatLng` (3);
`L.LatLngTuple` became `[number, number]`; `L.PolylineOptions` annotations became `Partial<...>` (2).
Non-mechanical edits in our own code: about 10 lines.

### F-16 (resolved, ours to catch): the Entry "regression" was F-17 throwing

The first trial run measured Entry at perf 68 / LCP 5.00 s / CLS 0.080. The CLS was a
"Something went wrong" notice: our global error handler had caught F-17's `TypeError` and
showed a snackbar. Lighthouse and our e2e both missed it, because a caught error never reaches
the console as uncaught. With F-17 fixed, Entry is back to baseline (below). Nothing for Leaflet
here beyond F-17.

### F-17 (blocker at runtime, Leaflet behaviour change): `Map.getRenderer()` now requires a `Path`

```
TypeError: t._createRenderer is not a function
    at Map.getRenderer
    at MarkerClusterGroup._spiderfierSetup
    at MarkerClusterGroup.fire / onAdd
```

In 1.9.4, `map.getRenderer(layer)` accepted any layer with `options`; if nothing else matched,
it fell back to the map's own `_createRenderer()`. Since #10438 ("Move getRenderer into Map,
drop `preferCanvas`") the fallback is `layer._createRenderer()`, which only `Path` has:

```js
getRenderer(layer) {
	const renderer = layer.options.renderer ?? this._getPaneRenderer(layer) ?? this.options.renderer ??
		(this._renderer ??= layer._createRenderer());
```

The new types do say `getRenderer(layer: Path)`, but plugins are plain JS and never see them. So
this compiles, bundles and passes unit tests, and fails only when the layer is added to a map.
markercluster's spiderfier calls `this._map.getRenderer(this)` with the cluster group, to create
the SVG renderer early ("needs to happen in the pageload ... or animations don't work in
webkit"). Every markercluster derivative has this line, and other plugins may use the same idiom.

Our patch to the fork (in `patches/`): `this._map.getRenderer(new Polyline([]))`.

Suggestion for Leaflet: keep a map-level fallback when `layer._createRenderer` is missing
(`layer._createRenderer?.() ?? this._createDefaultRenderer()`), or throw a clear error
("getRenderer() expects a Path"), in line with #10435's "break loudly". Either way, list it in
the upgrade guide.

## After (Leaflet main c152e0d, with the F-17 patch)

- Build: 0 errors (first attempt 107). Unit tests: 1413/1413 pass. e2e `map` + `entry`: 70/70
  (after the F-12 fix; the first run was 36/37). Hand check in Chrome: Entry mini-map shows
  18 tiles and no error notice; `/map` shows 51 tiles plus zoom, layers, scale, attribution and
  save-tiles controls, with no console errors.
- Leaflet is native ESM now but still lands in the eager `main.js`: **140.9 KB** of an 816 KB
  `main.js` (baseline 145.9 KB of 802 KB). **The cause is ours, not Leaflet's.** `@defer` works:
  the mini-map has its own lazy chunk. But our barrels (`shared/index.ts`, `shared/mapping/index.ts`)
  re-export `AbstractMap` and the Leaflet-typed icon helpers, and eager code imports those barrels.
  Leaflet's `"sideEffects": ["*.css"]` claim checks out: no top-level registration in `src/`, and
  `Map.js` imports its handlers, controls, Popup and Tooltip explicitly.
- Plugins stay lazy: markercluster fork 34.2 KB (was 33.5), leaflet.offline 7.0 KB (was 6.9).
- Initial total 1.88 MB raw / 412.49 kB transfer (baseline 1.89 MB / 415.20 kB).

Local Lighthouse 13.5.0 desktop, medians of 3, after the F-17 patch. Entry LCP is the first OSM
tile, so it moves with the tile server: one run in each set was an outlier (4.1 s base, 6.6 s trial).

| | Baseline (1.9.4) | After (main c152e0d) |
| --- | --- | --- |
| Leaflet in eager main.js | 145.9 KB of 802 KB | 140.9 KB of 816 KB |
| markercluster / offline (lazy) | 33.5 / 6.9 KB | 34.2 / 7.0 KB |
| Initial total raw / transfer | 1.89 MB / 415.20 kB | 1.88 MB / 412.49 kB |
| e2e map + entry | 70/70 | 70/70 |
| Entry perf / LCP / TBT / CLS | 75 / 2.98 s / 31 ms / 0.012 | 77 / 2.72 s / 28 ms / 0.012 |
| Map perf / LCP / TBT / CLS | 64 / 8.87 s / 16 ms / 0.035 | 65 / 8.18 s / 10 ms / 0.035 |

Reading: performance is neutral to slightly better; the TBT drop on Map is the one consistent
gain. The real bundle win (Leaflet out of `main.js`) is our barrel fix to make, and v2's
ESM is what makes it possible at all. Under 1.9.4's CommonJS it could not be split.

Not verified (hand checks): marker clustering and spiderfy with real data, offline tile saving and
the saved-tiles layer, Print map, trail elapsed-time labels (the F-13 cast), touch / long-press
`contextmenu`, the layers control's overlay toggles.

### F-18 (blocker for users, plugin: leaflet.offline 3.2.1, NOT Leaflet-2-specific): one failed tile stops a save worker; `saveend` never fires

Found by John's hand check on the **1.9.4** build, then reproduced on the trial: the save offered
~309 tiles and stopped at 229 with no message, and the "saved" info never updated. In `_saveTiles()`:

1. `downloadTile()` throws on any non-OK response (OpenTopoMap returns 504 Gateway Timeout under
   load). `loader()` is started without `await`/`catch`, so the rejection is unhandled and that
   worker stops for good. With `parallel: N`, N failures anywhere stop the whole save.
2. `saveend` fires only when `lengthSaved === lengthToBeSaved`. A failed tile, or one skipped
   because `hasTile()` already had it (`alwaysDownload: false`), is never counted, so `saveend`
   never fires after a partial save or any re-save over stored tiles.

Repro on the trial (Chrome, `parallel: 3`, 49-tile view, store cleared, every 4th tile fetch
answered 504): 12 fetches, 3 unhandled rejections `Request failed with status Gateway Timeout`,
**9 of 49 tiles stored**, no `saveend`, no error shown.

Suggested upstream fix: `try/catch` around `_loadTile` in `loader()`, count failures and skips,
fire `saveend` (with `lengthFailed`) once every tile has been attempted, and optionally retry
5xx/429 with backoff. Ours: own the save loop (we already use the exported `downloadTile` /
`saveTile` / `hasTile` for relief tiles), with retries, a progress line and a "N tiles failed,
save again to fill the gaps" message.
