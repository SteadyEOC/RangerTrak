# Leaflet 2 trial: drafts to post (John posts, under his own account)

Three posts, each ready to paste into GitHub. Full detail is in `LEAFLET2-TRIAL-FINDINGS.md`; F-numbers
below refer to it. Nothing here names a team, region or person beyond the app itself.

---

## 1. Comment on Leaflet/Leaflet#10435

> Thanks for picking v2 back up. We ported a production app to `main` @ c152e0d this week, in
> case early feedback before beta.1 is useful.
>
> **Context:** RangerTrak, an offline-first PWA for volunteer field teams (CERT/SAR/ham). Angular 22 +
> esbuild, TypeScript strict. Leaflet is the default map engine, in 10 files (~100 factory
> calls), with markercluster and leaflet.offline. Built from `main` via `npm pack`.
>
> **Result:** builds clean and our map e2e suite passes (70/70). Performance is neutral to
> slightly better (Lighthouse desktop, median of 3: Map TBT 16 → 10 ms). ESM is the big win for
> us: under 1.x's CommonJS, esbuild always hoisted Leaflet into our eager bundle, and now
> we can split it out. The factory → constructor port was mechanical, and the
> `initialize() is not called in Leaflet 2` guard message saved us time.
>
> **Things that cost us time, in case they help the upgrade guide:**
>
> 1. **`Map.getRenderer()` now requires a `Path`** (#10438). It used to fall back to a map-level
>    renderer; now it calls `layer._createRenderer()`. markercluster's spiderfier (and every fork
>    of it) calls `this._map.getRenderer(this)` with the cluster group, so it fails only at
>    runtime, when the layer is added: `TypeError: t._createRenderer is not a function`. The
>    types say `(layer: Path)`, but plain-JS plugins never see them. Could it keep a map-level
>    fallback, or throw a clear "expects a Path" error ("break loudly")?
> 2. **Option type names changed meaning.** In `@types/leaflet`, `TileLayerOptions`,
>    `PolylineOptions` etc. are the all-optional bag you pass. In the new types, the same names are the
>    *resolved* options with every field required (constructors correctly take `Partial<O>`).
>    Existing annotations and plugin `.d.ts` files still compile against the names, but now fail with
>    "missing pane, attribution, bubblingPointerEvents, stroke, and 11 more". leaflet.offline's
>    `tileLayerOffline(url, options: TileLayerOptions)` is one example. Keeping the v1 meaning for
>    the public names and giving the resolved shape another name would spare every plugin author.
> 3. **`Marker.prototype.options.icon = …` throws at module load** ("Cannot set properties of
>    undefined"). It's the standard bundler fix for the default marker image, so it's very widespread.
>    `Marker.mergeOptions({icon})` works; worth a line in the guide with that exact example.
> 4. **Small type gaps:** `LayerGroup.addLayer(layer: Layer)` rejects a `Tooltip` (now a
>    `LayerBase`, which `Map.addLayer` accepts); `TileLayer.createTile` is typed `HTMLImageElement`,
>    so overrides returning a `div` need a cast.
> 5. **Rename table wanted:** `LatLngTuple` and `LeafletMouseEvent` (→ `LeafletPointerEvent`)
>    have no export; `mouseEventToLatLng` → `pointerEventToLatLng`; `DomUtil.addClass` gone;
>    `mousemove/over/out` → `pointer*` on layer listeners.
> 6. **Housekeeping for testers on `main`:** `main` still says `2.0.0-alpha.1` in package.json
>    and `version`, so a `main` build can't be told from the 2025 alpha. And CHANGELOG has nothing
>    after alpha.1, though `Browser` (#10447), `PosAnimation` (#10446), DomEvent chaining,
>    `preferCanvas` (#10438) etc. have changed since. A `-dev` version and an "Unreleased"
>    section would help.
>
> **Plugins:** markercluster is the blocker for most apps. Upstream #984 only fixes the import,
> not v2. The v2 fork `@kristjan.esperanto/leaflet.markercluster@3.0.3` targets alpha.1 and needed
> three fixes for `main` (`Browser` import, `Class.extend`, item 1). leaflet.offline needed four
> small changes. Patches available if useful, and I'll file 1 and 2 as separate issues if you'd
> prefer them tracked.

---

## 2. Comment on allartk/leaflet.offline#461

> Two things that may unblock this:
>
> - Leaflet now ships first-party TypeScript types on `main` (Leaflet/Leaflet#7591 closed
>   2026-10-30, c2a5abe6), which I think was the dependency you mentioned.
> - We ran 3.2.1 against Leaflet `main` @ c152e0d. It's already ES-class based, so the port was
>   small. Changes we needed (patch below):
>   - `leaflet` is in `dependencies` (`^1.6.0`), so npm nests a second Leaflet 1.9.4 under the
>     plugin and the app ships two Leaflets. Moving it to `peerDependencies` (`^1.6.0 || >=2.0.0-0`)
>     fixes that.
>   - `Util.bind(f, ctx, …)` → `f.bind(ctx, …)` (2 places); `Browser.retina` →
>     `window.devicePixelRatio > 1`; `bounds(a, b)` → `new Bounds(a, b)`.
>   - `DomEvent.on(...).on(...)` chaining is gone in v2 (split the calls), and `mousedown` → `pointerdown`.
>   - `.d.ts`: `tileLayerOffline(url, options: TileLayerOptions)` needs
>     `options?: Partial<TileLayerOptions>`. In v2's types, `TileLayerOptions` is the fully
>     resolved shape with every field required.
>
> Separately, and on Leaflet 1.9.4 too, a bug that hit us in real use: one failed tile download stops a save
> worker for good, and `saveend` never fires after a partial save. `downloadTile()` throws on a non-OK
> response (OpenTopoMap 504s under load), and `loader()` isn't awaited or caught, so with `parallel: 3`, three
> failures stop the whole save silently. Repro: 49 tiles, every 4th fetch answered 504 → 12 fetches, 9 tiles
> stored, no `saveend`. `saveend` also needs `lengthSaved === lengthToBeSaved`, which skipped (already
> stored) tiles never satisfy, so any re-save over stored tiles never ends either. A `try/catch` in
> `loader()`, counting failed and skipped tiles, and firing `saveend` once all are attempted would fix both.
>
> Build and bundle verified with Leaflet `main`.
> Happy to open a PR if you'd like.
>
> *(attach `patches/leaflet.offline+3.2.1.patch`)*

---

## 3. New issue on KristjanESPERANTO/Leaflet.markercluster

**Title:** 3.0.3 against Leaflet `main` (pre-beta.1): `Browser` import, `Class.extend`, `getRenderer`

> Thanks for the fork; it's the only v2 cluster option we found. Against Leaflet `main` @ c152e0d
> (heading for 2.0.0-beta.1), 3.0.3 needed four fixes:
>
> 1. **`Browser` no longer exists** (Leaflet#10447): `No matching export in "leaflet/src/Leaflet.js"
>    for import "Browser"`. Only `Browser.mobile`/`.touch` are used, so a local
>    `navigator.maxTouchPoints > 0` / `/mobi/i.test(navigator.userAgent)` covers it.
> 2. **`Class.extend` / `initialize` are gone:** `TypeError: Marker.extend is not a function` at
>    module load. Converting `MarkerCluster`, `MarkerClusterGroup` and `MarkerClusterNonAnimated` to
>    `class … extends …` + `mergeOptions` + `include` took about 40 lines; spiderfy code unchanged.
> 3. **`Map.getRenderer()` now requires a `Path`** (Leaflet#10438): `_spiderfierSetup`'s
>    `this._map.getRenderer(this)` throws `t._createRenderer is not a function` when the group is
>    added. We use `this._map.getRenderer(new Polyline([]))`, which keeps the "create the SVG
>    renderer at load" intent.
> 4. **Types:** `declare module "leaflet" { … }` can't resolve `LayerOptions`/`FeatureGroup`
>    against Leaflet's own types (no global `L` namespace any more), so `MarkerClusterGroup` isn't
>    assignable to `Layer`. Named `import type { … } from 'leaflet'` and a top-level export fix it.
>
> Patch attached (patch-package format). Cluster/spiderfy behaviour with real data is still being
> hand-checked on our side; I'll update if anything else turns up.
>
> *(attach `patches/@kristjan.esperanto+leaflet.markercluster+3.0.3.patch`)*

---

### Before posting

- [ ] Hand checks (below) done, so the posts don't claim more than we verified.
- [ ] Post 1 first; posts 2 and 3 can reference it.
- [ ] Append a row to `..\claude\go-to-market\publishing-log.md`? (Not marketing; John's call.)

Hand checks, on `http://localhost:8095` from the worktree build (`node tools/serve-dist.js` with
`PORT=8095`), Fernhollow demo: clusters and spiderfy, Save tiles + offline layer, Print map,
trail elapsed-time labels, long-press on touch, layers-control overlay toggles.
