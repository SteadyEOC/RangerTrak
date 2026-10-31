<!-- Post to: New issue on KristjanESPERANTO/Leaflet.markercluster -->
<!-- Issue title: 3.0.3 against Leaflet `main` (pre-beta.1): `Browser` import, `Class.extend`, `getRenderer` -->
<!-- Attach: D:\Projects\_SteadyEOC\Rangertrak\wt-leaflet2\patches\@kristjan.esperanto+leaflet.markercluster+3.0.3.patch (rename to .txt if GitHub refuses .patch) -->

Thanks for the fork; it's the only v2 cluster option we found. Against Leaflet `main` @ c152e0d (heading for 2.0.0-beta.1), 3.0.3 needed four fixes:

1. **`Browser` no longer exists** (Leaflet#10447): `No matching export in "leaflet/src/Leaflet.js" for import "Browser"`. Only `Browser.mobile`/`.touch` are used, so a local `navigator.maxTouchPoints > 0` / `/mobi/i.test(navigator.userAgent)` covers it.
2. **`Class.extend` / `initialize` are gone:** `TypeError: Marker.extend is not a function` at module load. Converting `MarkerCluster`, `MarkerClusterGroup` and `MarkerClusterNonAnimated` to `class … extends …` + `mergeOptions` + `include` took about 40 lines; spiderfy code unchanged.
3. **`Map.getRenderer()` now requires a `Path`** (Leaflet#10438): `_spiderfierSetup`'s `this._map.getRenderer(this)` throws `t._createRenderer is not a function` when the group is added. We use `this._map.getRenderer(new Polyline([]))`, which keeps the "create the SVG renderer at load" intent.
4. **Types:** `declare module "leaflet" { … }` can't resolve `LayerOptions`/`FeatureGroup` against Leaflet's own types (no global `L` namespace any more), so `MarkerClusterGroup` isn't assignable to `Layer`. Named `import type { … } from 'leaflet'` and a top-level export fix it.

Patch attached (patch-package format). With it, clustering and spiderfy work in our app on Leaflet `main`, including a print layout that reuses the spiral; I'll update if anything else turns up.
