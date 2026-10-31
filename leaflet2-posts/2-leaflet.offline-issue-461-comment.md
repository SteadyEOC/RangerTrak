<!-- Post to: Comment on allartk/leaflet.offline#461 -->
<!-- Attach: D:\Projects\_SteadyEOC\Rangertrak\wt-leaflet2\patches\leaflet.offline+3.2.1.patch (rename to .txt if GitHub refuses .patch) -->

Two things that may unblock this:

- Leaflet now ships first-party TypeScript types on `main` (Leaflet/Leaflet#7591 closed
  2026-10-30, c2a5abe6), which I think was the dependency you mentioned.
- We ran 3.2.1 against Leaflet `main` @ c152e0d. It's already ES-class based, so the port was
  small. Changes we needed (patch below):
  - `leaflet` is in `dependencies` (`^1.6.0`), so npm nests a second Leaflet 1.9.4 under the
    plugin and the app ships two Leaflets. Moving it to `peerDependencies` (`^1.6.0 || >=2.0.0-0`)
    fixes that.
  - `Util.bind(f, ctx, …)` → `f.bind(ctx, …)` (2 places); `Browser.retina` →
    `window.devicePixelRatio > 1`; `bounds(a, b)` → `new Bounds(a, b)`.
  - `DomEvent.on(...).on(...)` chaining is gone in v2 (split the calls), and `mousedown` → `pointerdown`.
  - `.d.ts`: `tileLayerOffline(url, options: TileLayerOptions)` needs
    `options?: Partial<TileLayerOptions>`. In v2's types, `TileLayerOptions` is the fully
    resolved shape with every field required.

Separately, and on Leaflet 1.9.4 too, a bug that hit us in real use: one failed tile download stops a save
worker for good, and `saveend` never fires after a partial save. `downloadTile()` throws on a non-OK
response (OpenTopoMap 504s under load), and `loader()` isn't awaited or caught, so with `parallel: 3`, three
failures stop the whole save silently. Repro: 49 tiles, every 4th fetch answered 504 → 12 fetches, 9 tiles
stored, no `saveend`. `saveend` also needs `lengthSaved === lengthToBeSaved`, which skipped (already
stored) tiles never satisfy, so any re-save over stored tiles never ends either. A `try/catch` in
`loader()`, counting failed and skipped tiles, and firing `saveend` once all are attempted would fix both.

With the patch, saving an area and showing the saved tiles both work on Leaflet `main` in our app.
Happy to open a PR if you'd like.
