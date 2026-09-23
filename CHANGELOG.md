# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.95.1](https://github.com/SteadyEOC/RangerTrak/compare/v0.95.0...v0.95.1) (2026-09-23)


### Features

* **entry:** auto-print the ICS-213 on submit ([864db6b](https://github.com/SteadyEOC/RangerTrak/commit/864db6b52c1a04f5561bc06bea8dc9c640b3503f))
* **map:** zoom to extent of currently-displayed reports, evidence and locations ([ab86aef](https://github.com/SteadyEOC/RangerTrak/commit/ab86aefdcb8226b74224857e117d5a080ad15dea))
* **radio-log:** let the three action bars sit side by side on a wide screen ([e042293](https://github.com/SteadyEOC/RangerTrak/commit/e042293fd46fd98c65a3c2b6edcc84b64e5ce57a))

## [0.95.0](https://github.com/SteadyEOC/RangerTrak/compare/v0.94.0...v0.95.0) (2026-09-23)

## [0.94.0](https://github.com/SteadyEOC/RangerTrak/compare/v0.93.0...v0.94.0) (2026-09-22)


### Features

* **backup:** optional passphrase on mission backups (E-122 Phase 1) ([3fdb574](https://github.com/SteadyEOC/RangerTrak/commit/3fdb574778c6bf9af98cfafb411c9333d2bd768a))

## [0.93.0](https://github.com/SteadyEOC/RangerTrak/compare/v0.92.0...v0.93.0) (2026-09-22)


### Features

* **brand:** RangerTrak's own mark replaces the Material compass ([daf036d](https://github.com/SteadyEOC/RangerTrak/commit/daf036d65a3c61202542aa80293382e72de69cd8))
* **mission:** flag overdue check-ins, relative to the mission's own interval ([6d96ae5](https://github.com/SteadyEOC/RangerTrak/commit/6d96ae55b265854f261d30c700e0e5f9174f614e))


### Bug Fixes

* **worker:** file feedback issues in SteadyEOC/RangerTrak ([31ff9ae](https://github.com/SteadyEOC/RangerTrak/commit/31ff9ae5f34cd8b35c4f560e1dcfa4e8d488434c))

## [0.92.0](https://github.com/EOCOnline/rangertrak/compare/v0.91.4...v0.92.0) (2026-09-15)


### Features

* **map:** bundle a world+Vashon basemap, warm it stall-safely ([0ecbff8](https://github.com/EOCOnline/rangertrak/commit/0ecbff8764bc743c2e02d46a0273748cc3406cd4))
* **sample-data:** offer four demo scenarios instead of one fixed mission ([41f351e](https://github.com/EOCOnline/rangertrak/commit/41f351e30f32588f2ab2673d9debee91bf315db2))
* **worker:** rate limit, hotlink-protect, and cache the map/feedback Worker ([d0b85a6](https://github.com/EOCOnline/rangertrak/commit/d0b85a6edb6a2082d342b7ab7a8f547989e563bb))


### Bug Fixes

* **map:** harden the custom .pmtiles loader ([7f8d53c](https://github.com/EOCOnline/rangertrak/commit/7f8d53c8ee0cc31e548a8601ede14f314484ee1e))
* **map:** let the offline-save estimate wrap so /map fits a phone ([0961640](https://github.com/EOCOnline/rangertrak/commit/09616404a9405881990296c934e5699d33643fbe))
* **map:** multi-zoom Leaflet save, tile cap, and disable on OSM ([bebeb11](https://github.com/EOCOnline/rangertrak/commit/bebeb11e3fba7b5386df1cd8086ba7c0090037ca))
* **perf:** stop MapLibre/RadioLog from bundling Leaflet, fix low-res GitHub icon ([3745ac6](https://github.com/EOCOnline/rangertrak/commit/3745ac655f7039825914c3294b65fe4ec9104050))

### [0.91.4](https://github.com/EOCOnline/rangertrak/compare/v0.91.3...v0.91.4) (2026-09-02)


### Bug Fixes

* **perf:** stop the header status-pill from rendering empty then jumping wide ([0b7c631](https://github.com/EOCOnline/rangertrak/commit/0b7c63170cfb15baa0717873cea9734b8bdb194c))

### [0.91.3](https://github.com/EOCOnline/rangertrak/compare/v0.91.2...v0.91.3) (2026-09-01)


### Bug Fixes

* **map:** stop permanently-abandoned PMTiles tile fetches, retry the rest ([f30b9e6](https://github.com/EOCOnline/rangertrak/commit/f30b9e646c59ab80709672517a246712a6825f86))
* **perf:** size the deferred Entry mini-map placeholder like the real component ([1775901](https://github.com/EOCOnline/rangertrak/commit/1775901b6f96957fe1134c667c71b3427281e63b))

### [0.91.2](https://github.com/EOCOnline/rangertrak/compare/v0.91.1...v0.91.2) (2026-09-01)


### Bug Fixes

* **perf:** control experiment - drop router preloading entirely (NoPreloading) ([a84a0b4](https://github.com/EOCOnline/rangertrak/commit/a84a0b43281616308d6049d23645fc141997453e))

### [0.91.1](https://github.com/EOCOnline/rangertrak/compare/v0.91.0...v0.91.1) (2026-09-01)


### Bug Fixes

* **perf:** gate route preloading on window 'load', not just requestIdleCallback ([99e0b12](https://github.com/EOCOnline/rangertrak/commit/99e0b12318e225915b8c6b61ff1b71f3ffbcfac9))

## [0.91.0](https://github.com/EOCOnline/rangertrak/compare/v0.90.9...v0.91.0) (2026-09-01)


### Bug Fixes

* **csp:** allow fonts.gstatic.com under connect-src too ([8d9f408](https://github.com/EOCOnline/rangertrak/commit/8d9f4081e488a60c9c351c4f525d37729c716774))
* **map:** stop MapLibre canceling adjacent tiles mid zoom-out gesture ([712b6d1](https://github.com/EOCOnline/rangertrak/commit/712b6d1c56b59a5d7b776d4e0ed6a568eaac887d))
* **perf:** defer route preloading to browser idle instead of firing on boot ([51ff52b](https://github.com/EOCOnline/rangertrak/commit/51ff52b8bb9bc75aefe0a98d51b29401be8200b4))

### [0.90.9](https://github.com/EOCOnline/rangertrak/compare/v0.90.8...v0.90.9) (2026-09-01)


### Bug Fixes

* **map:** sync the MapLibre overview on 'moveend', not every 'move' frame ([d747298](https://github.com/EOCOnline/rangertrak/commit/d7472984de6d89fb74c883f15c71de346f297cb7))

### [0.90.8](https://github.com/EOCOnline/rangertrak/compare/v0.90.7...v0.90.8) (2026-09-01)


### Bug Fixes

* **csp:** close the observed script-src/img-src violations from real DevTools evidence ([4bd3285](https://github.com/EOCOnline/rangertrak/commit/4bd32855bbbe8e730db44b4cfac887321ec96e67))

### [0.90.7](https://github.com/EOCOnline/rangertrak/compare/v0.90.6...v0.90.7) (2026-09-01)


### Bug Fixes

* **sw:** stop the service worker from swallowing PMTiles Range requests ([2927139](https://github.com/EOCOnline/rangertrak/commit/292713970e62e1d0b4af32ce55f3aace8e214921))

### [0.90.6](https://github.com/EOCOnline/rangertrak/compare/v0.90.5...v0.90.6) (2026-09-01)


### Features

* **worker:** allow rangertrak.com to file feedback cross-origin ([f6ca89a](https://github.com/EOCOnline/rangertrak/commit/f6ca89a089cc3e3b77582ccd24a230fe26a90166))


### Bug Fixes

* **dates,mission:** restore Dates lost to JSON round-trips; forbid zero-length op periods ([c74f2c9](https://github.com/EOCOnline/rangertrak/commit/c74f2c90842c774c949ea4d4fdeb8e75b1eaae18))
* **docs:** repoint the Vashon ACS link, the old URL 404s ([94ffdc9](https://github.com/EOCOnline/rangertrak/commit/94ffdc9d2f7306e442e920e1bdf7e30d44a00df2))
* **maps:** cancel Leaflet's orphaned zoom-transition timer before teardown ([d683b28](https://github.com/EOCOnline/rangertrak/commit/d683b28a1fe5ab4422811c37712bfc0e930e951f))

### [0.90.5](https://github.com/EOCOnline/rangertrak/compare/v0.90.4...v0.90.5) (2026-09-01)


### Bug Fixes

* **headers:** geolocation=(self) so field-mode GPS auto-fill can actually work ([eaa6a99](https://github.com/EOCOnline/rangertrak/commit/eaa6a995ad548960371c55cd025721ea26fca90b))

### [0.90.4](https://github.com/EOCOnline/rangertrak/compare/v0.90.3...v0.90.4) (2026-09-01)


### Features

* **rangers:** give the empty roster a real way forward ([0b6a96d](https://github.com/EOCOnline/rangertrak/commit/0b6a96d57f1fc12a8af33b5daba20953a4358cbe))


### Bug Fixes

* **map:** draw the earth layer so land isn't the same grey as the background ([08e769d](https://github.com/EOCOnline/rangertrak/commit/08e769d23b351e9e8daf6a98596aa35987c48f7c)), closes [#e0e0e0](https://github.com/EOCOnline/rangertrak/issues/e0e0e0)

### [0.90.3](https://github.com/EOCOnline/rangertrak/compare/v0.90.2...v0.90.3) (2026-09-01)


### Features

* **prep,rangers:** E-109 v2 - Setup files merge instead of replacing ([f83d536](https://github.com/EOCOnline/rangertrak/commit/f83d536e6511360bcf4addf53141f3810745ce9e))


### Bug Fixes

* **photos:** commit IndexedDB writes before a caller can reload them away ([71bd817](https://github.com/EOCOnline/rangertrak/commit/71bd817e18acebc0470ce9d11f9c3235b4d3e1e5))

### [0.90.2](https://github.com/EOCOnline/rangertrak/compare/v0.90.1...v0.90.2) (2026-08-31)


### Features

* **command-post:** double-click launchers, and copy the server address to the clipboard ([ecfdd32](https://github.com/EOCOnline/rangertrak/commit/ecfdd320abaf82266d2a87bd7939916dc150b9a0))
* **entry:** E-114 §1a - field-mode device foundation, GPS auto-fill, remembered coordinate format ([f37c887](https://github.com/EOCOnline/rangertrak/commit/f37c88710f83ff8f2d7b071690897b2fa6bb4916))
* **entry:** E-114 Phase 1 - give field-mode devices their own Report Packet hand-off ([6d767c5](https://github.com/EOCOnline/rangertrak/commit/6d767c59fb361b4b3c45f5b35f2802604780e5cc))
* **mission:** a targeted phone-specific note, not just general prose ([c86b576](https://github.com/EOCOnline/rangertrak/commit/c86b5760f0539fc0ab68c2992f7ae740ebcc3307))
* **mission:** let the Command Post address/viewer link be copied back out later ([89df0da](https://github.com/EOCOnline/rangertrak/commit/89df0da9f4f23ae891f8f3eb277001face205b91))
* **radio-log:** mark merged-in reports, validate incoming timestamps/locations ([fbc8bb4](https://github.com/EOCOnline/rangertrak/commit/fbc8bb41183636c81aba80d9e8e4faea1c60889d))


### Bug Fixes

* **maps,rangers:** mini-map size containment, Leaflet control clear, roster export selection ([877f928](https://github.com/EOCOnline/rangertrak/commit/877f92840a91d25e38b180b15bf4c03986a4fa87))
* **mission-readiness:** stop CI's headless Chrome from failing the readiness-dot href test ([a11b5a1](https://github.com/EOCOnline/rangertrak/commit/a11b5a119be3277241be91522e18c5f7c8b0ecaa))
* **mission:** disable copy buttons with a note when clipboard isn't available; explain the phone limit ([d172bbc](https://github.com/EOCOnline/rangertrak/commit/d172bbc074bfaaa958387d2a304395913d3a8264))
* **mission:** show a visible alert on copy failure; simplify the section's text ([a007faf](https://github.com/EOCOnline/rangertrak/commit/a007faf983cdc4cc088c3ef35ba06f12bef383d7))
* **mission:** warn inline if the Command Post server address still starts with http:// ([eb12b1d](https://github.com/EOCOnline/rangertrak/commit/eb12b1d6c7e68d049594833f5c37c4106dd4de6e))

### [0.90.1](https://github.com/EOCOnline/rangertrak/compare/v0.90.0...v0.90.1) (2026-08-31)


### Features

* **radio-log:** E-114 Phase 0 - merge reports that originated on another device ([007f9ab](https://github.com/EOCOnline/rangertrak/commit/007f9ab6cc5150575212a8072de1961fb77144e2))
* **radio-log:** E-114 Phase 1 - Report Packet build/load, hand off via Web Share ([5312df0](https://github.com/EOCOnline/rangertrak/commit/5312df0b58a56becce8d659a6eb85289a74418f2))
* **time-picker:** show the day of week, embedded in the field's own border ([fa44a71](https://github.com/EOCOnline/rangertrak/commit/fa44a71ed2f2d9c8948b4df8f77861a7674cbdc7))


### Bug Fixes

* **command-post:** serve HTTPS with a self-signed cert - publishing was blocked by mixed content ([83988b4](https://github.com/EOCOnline/rangertrak/commit/83988b4577b99d4276700a831b666526f13761cd))
* **guide:** Command Post steps described the wrong order; add a clickable /view link ([6ff13e9](https://github.com/EOCOnline/rangertrak/commit/6ff13e9f16054b70142c1ae59409de504fb4ed73))
* **header:** the readiness dot didn't join the unified info panel on touch ([96e4cef](https://github.com/EOCOnline/rangertrak/commit/96e4cefc4a986cbceaaa28f03c5d0c3735b3cb35))
* **map:** offline-controls buttons dropped below the overview map's float ([0ce432f](https://github.com/EOCOnline/rangertrak/commit/0ce432fd33700e4ca0c6f588311439f281f21085))
* **mission:** "Reset mission to defaults" reset storage but not the visible form ([024153d](https://github.com/EOCOnline/rangertrak/commit/024153dd64e4142e5b8f7f0b64c7f63a1630ea7d))
* **time-picker:** stale value on arrow-key step, and no date rollover at midnight ([2d5a0b6](https://github.com/EOCOnline/rangertrak/commit/2d5a0b6cda1b7ea069e05620be22cafbf7ebd2ab))

## [0.90.0](https://github.com/EOCOnline/rangertrak/compare/v0.89.3...v0.90.0) (2026-08-31)


### ⚠ BREAKING CHANGES

* **radio-log:** rename FieldReport*/field-report* to RadioLog*/radio-log*, including persisted keys

### Features

* **command-post:** E-87 Stage 1 - serve the live comms log to nearby devices ([21ff76c](https://github.com/EOCOnline/rangertrak/commit/21ff76c615dee12fd6615b1b875458b0becf15fd))
* **map:** let a scribe load their own .pmtiles file for MapLibre offline coverage ([3fd4eda](https://github.com/EOCOnline/rangertrak/commit/3fd4edadca845c23942b0ef17877acac4600efcc))
* **prep:** finish E-109 v1 - Locations in the payload, stale-photo clearing, roster warnings ([6d755e2](https://github.com/EOCOnline/rangertrak/commit/6d755e230d55a37ed01b87ca93e2c573c21769d5))
* **prep:** Mission Zip v1 - package roster, photos, and settings into one file ([97372e5](https://github.com/EOCOnline/rangertrak/commit/97372e57ad675815911ab7aa48a8c01e5332ac14))
* **radio-log:** generate and print an ICS-309 comms log; collapse the danger zone ([1fccc6d](https://github.com/EOCOnline/rangertrak/commit/1fccc6d6478fcd4e1b02597111bc400fd3815a86))
* **rangers:** add a "Last Contact" column, link to the new Mission Zip page ([3bfd702](https://github.com/EOCOnline/rangertrak/commit/3bfd702da7e822ae85309d0c655ac4750cf08f80))


### Bug Fixes

* **entry:** stop a dead handler from logging a false ERROR on every report ([a993789](https://github.com/EOCOnline/rangertrak/commit/a99378912d41096c9380f1f47eda861d36c9174f))
* **entry:** stop an MDC floating-label's clipped text from widening the phone layout viewport ([279fa39](https://github.com/EOCOnline/rangertrak/commit/279fa39aa16907a7e9e675d4c5668dbf30dd50bb))
* **map:** E-11 - draw the evidence/clue marker on the MapLibre engine too ([fa7a85e](https://github.com/EOCOnline/rangertrak/commit/fa7a85e98519b68d6299e3087927dfe2eef73d9b))
* **map:** relabel the stale "Field Report panel" toggle text to match the Radio Log rename ([3731e3a](https://github.com/EOCOnline/rangertrak/commit/3731e3ac4e11bceef4160688b8ce36577b759320))
* **mission:** dark-mode status-row text and log noise in the Field Report Statuses grid ([291617b](https://github.com/EOCOnline/rangertrak/commit/291617b68ae82ce2f2cd898f0663ef14ecf1203d)), closes [#111111](https://github.com/EOCOnline/rangertrak/issues/111111) [#111111](https://github.com/EOCOnline/rangertrak/issues/111111)
* **rangers:** recognize a Mission Zip handed to Import roster, point at /prep ([e69b828](https://github.com/EOCOnline/rangertrak/commit/e69b82844124312bf7c204812b4a25849bd7c209)), closes [#6](https://github.com/EOCOnline/rangertrak/issues/6)


* **radio-log:** rename FieldReport*/field-report* to RadioLog*/radio-log*, including persisted keys ([d8f2e2d](https://github.com/EOCOnline/rangertrak/commit/d8f2e2d3687e18a69d4b22dd4420ae89631e4878))

### [0.89.3](https://github.com/EOCOnline/rangertrak/compare/v0.89.2...v0.89.3) (2026-08-31)


### Bug Fixes

* **entry:** stop the mini-map's Leaflet zoom-proxy computing an absurd transform ([70300c9](https://github.com/EOCOnline/rangertrak/commit/70300c9a3050e422e8a67b4454c7177f4fee1e86))
* **header:** make the mission-info panel reachable on touch devices ([9cfde23](https://github.com/EOCOnline/rangertrak/commit/9cfde23816e8cc5fbb3e8771f8d97987f7213518))
* **header:** the mission-info hover panel inflated scrollWidth even while hidden ([2e1c4d6](https://github.com/EOCOnline/rangertrak/commit/2e1c4d6284d400e57423ff7000dfa9afbcf8de21))

### [0.89.2](https://github.com/EOCOnline/rangertrak/compare/v0.89.1...v0.89.2) (2026-08-30)


### Features

* **entry:** offer Load Demo Data on the welcome panel for a genuinely fresh install ([f963f76](https://github.com/EOCOnline/rangertrak/commit/f963f76b280c5614fbe06555d90dc55c67415bc5))


### Bug Fixes

* **map:** move the overview mini-map directly under the main map ([1900f83](https://github.com/EOCOnline/rangertrak/commit/1900f83c963c161c80adda0559ee8e30a3a4242d))
* **messages:** reorder detail fields per maintainer spec ([386ece2](https://github.com/EOCOnline/rangertrak/commit/386ece2505f134347fa180a19212407a027a1497))

### [0.89.1](https://github.com/EOCOnline/rangertrak/compare/v0.69.0...v0.89.1) (2026-08-30)


### Features

* **app,entry,radio-log,mission:** update banner app-wide, ranger-ID labels, grid fixes (0.77.0) ([250b156](https://github.com/EOCOnline/rangertrak/commit/250b156b5d780251ac0b36db00a565b9e689f6cd))
* **entry,map:** F29-6 - Entry mini-map shows contours + hillshading by default ([ac44332](https://github.com/EOCOnline/rangertrak/commit/ac443322e804f63208cb4ba269bbec56de14d33b))
* **entry,mission,messages:** Batch 4 Source + operator identity from the 2026-08-29 feedback stream (F29-43, F29-45, F29-46, F29-47, F29-48) ([a0e4994](https://github.com/EOCOnline/rangertrak/commit/a0e49940356781a154364537fcbe9d99b7eef832))
* **feedback,log,map,mapLeaflet:** Material-M3 completeness audit (0.70.0) ([7695624](https://github.com/EOCOnline/rangertrak/commit/7695624f069cfc2b5c04a290f400d446b64c6f4a))
* **help,mission,rangers:** Help tab split, Log discoverability, per-mission ID label (0.74.0) ([a6a95bb](https://github.com/EOCOnline/rangertrak/commit/a6a95bb36bc2dc42c71d6d08ab9d60f7b5c1baf9))
* **help,shared,log:** Batch 3 Help restructure from the 2026-08-29 feedback stream (D-d, F29-18, F29-29, F29-31, F29-32, F29-33) ([81fbd31](https://github.com/EOCOnline/rangertrak/commit/81fbd3194e2f349691884c232bdf09df04a72638))
* **messages:** show Subject/Operator, make messages editable, warn once printed ([061f489](https://github.com/EOCOnline/rangertrak/commit/061f4891869aa3b2a160aad3118f122356a655f5))
* **mission-readiness:** F29-21 - each readiness row links to the section that fixes it ([c86f2af](https://github.com/EOCOnline/rangertrak/commit/c86f2afcc4df6bd3f24693453642b61cc9c31908))
* **mission,map:** add Locations (ADR D-49) - place, edit, delete on the map ([c978931](https://github.com/EOCOnline/rangertrak/commit/c97893197016c1980934ea534fd408e044b09f97))
* **mission,shared:** F29-23 - warn before leaving Mission with unsaved changes ([9e06977](https://github.com/EOCOnline/rangertrak/commit/9e0697742a1f689dfbe35fa52c85c809d12700fb))
* **mission:** add a Locations list; fix "honour" for a US audience ([631a4c7](https://github.com/EOCOnline/rangertrak/commit/631a4c76d1307fb9daf0d8ab77ea3c8468b5226c))
* **mission:** make Location categories mission-editable ([a6b238d](https://github.com/EOCOnline/rangertrak/commit/a6b238dfb807ae6fa5897f5b0b8ea63366582d1f))
* **radio-log,messages:** ICS-309/213 IA restructuring (0.75.0) ([860a678](https://github.com/EOCOnline/rangertrak/commit/860a678877fbbfd9d31bb294eba442d8b5746264))
* **sample-data:** F29-11 - rewrite the demo mission with an ICS structure, walking-distance clusters, and real messages ([016dace](https://github.com/EOCOnline/rangertrak/commit/016dace596efd91d89721ce018503003210154ed))
* **time:** use a 24-hour clock everywhere, drop the AM/PM segment ([b6a7158](https://github.com/EOCOnline/rangertrak/commit/b6a7158c1b2a70f62b3c63730355826d13868565))


### Bug Fixes

* **app,mission:** stop Mission's double update bar, keep install offer low-key (0.77.1) ([9c64a19](https://github.com/EOCOnline/rangertrak/commit/9c64a19553e309a2b6f03b2a56df383ae1866c7f))
* **entry,guide:** root-cause a phone-viewport overflow contributor, Notes rows, guide text (0.71.0) ([7298611](https://github.com/EOCOnline/rangertrak/commit/729861196b65681fdb27764b1b57aedf7f5e718b))
* **entry,map:** evidence-checkbox wrap, address Enter key, offline-tile buttons (0.76.0) ([78007d5](https://github.com/EOCOnline/rangertrak/commit/78007d5f8d9aff767e5fd89cb60a69aadaf6b6f9))
* **entry:** center the evidence checkbox; flag offline geocoding ([a00968d](https://github.com/EOCOnline/rangertrak/commit/a00968d0ffef222f13b84006f06dde01897700b3))
* **entry:** remove a stray <br/> inflating the Operator row's top gap; tighten evidence checkbox wording ([57d9458](https://github.com/EOCOnline/rangertrak/commit/57d94580fab57b4ac39ede7ee83d83471001d44a))
* **entry:** strip locality suffix before validating a short +Code (0.77.2) ([4170b9d](https://github.com/EOCOnline/rangertrak/commit/4170b9d2b26bc8d3a60ba80ab49113f7fc701e3d))
* **entry:** unify the When field's background with every other field ([95360b2](https://github.com/EOCOnline/rangertrak/commit/95360b29148069512e2fd44e5b08d3a86a454033))
* **export:** drop the ICS-213 template's sample/instructions page ([a5e4422](https://github.com/EOCOnline/rangertrak/commit/a5e4422b79896416bbd00166aeca42e515717f62))
* **field-reports,messages:** name pages after the ICS form they produce ([9761833](https://github.com/EOCOnline/rangertrak/commit/97618331a9830c9def60cff8b7d1d4c7d926e9d9))
* **guide:** correct Entry guide wording, link coordinate-format terms ([ea80a93](https://github.com/EOCOnline/rangertrak/commit/ea80a93ab2f5d22d1a59ae58da6b82f038bb885a))
* **guide:** explain what Operator means on the Entry page ([d668487](https://github.com/EOCOnline/rangertrak/commit/d6684878497631512080c0f4adb980aa3fde7d47))
* **header:** hover reveals the mission-info panel, folds in readiness, drops the icon ([e248dd8](https://github.com/EOCOnline/rangertrak/commit/e248dd81141a1ef3de04e21426d3ab6c83b554d6))
* **header:** move mission name/notes into a popup, narrow the status pill ([3d3ceb4](https://github.com/EOCOnline/rangertrak/commit/3d3ceb4fb381e634b2a5d40d1af1a60eeb02aa26))
* **help:** scope the licence text to About; move page-specific tabs to Guide ([c12a4c5](https://github.com/EOCOnline/rangertrak/commit/c12a4c57da8d0a41946c0cb80c982665943cb1d1))
* **i18n:** convert British spelling to American throughout the app ([dacb873](https://github.com/EOCOnline/rangertrak/commit/dacb8735a17bf790d791e243ce1bbf6dc8b05cdc))
* **log:** bump font size for readability ([5a184d4](https://github.com/EOCOnline/rangertrak/commit/5a184d458357d208d17bed5042a8a701a3062bfa))
* **map,entry:** Batch 5 first pass - MapLibre per-ranger marker colour (F29-7/8, partial) ([e35b86d](https://github.com/EOCOnline/rangertrak/commit/e35b86dfd95fe5022b5d53404f795daa854c42a4)), closes [#c0392](https://github.com/EOCOnline/rangertrak/issues/c0392)
* **map:** default to contour base layer with hillshading on ([0f0cdec](https://github.com/EOCOnline/rangertrak/commit/0f0cdec1480ca724bf8dfbf2d6c506bfdeed9fe3))
* **map:** give the whole map page a consistent margin, not just the frame ([72d72ec](https://github.com/EOCOnline/rangertrak/commit/72d72ec087db12ff13c381b0b7a926fe847d87f7))
* **mapLeaflet:** green-orange-red scale for elapsed-time trail labels ([af7e41e](https://github.com/EOCOnline/rangertrak/commit/af7e41e238ae847715a8cef7346c0982e7675c79))
* **map:** revert MapLibre hillshade default-on from earlier today ([6e1c8ce](https://github.com/EOCOnline/rangertrak/commit/6e1c8ce96d08023656c3a4ce8c940672606dd334))
* **map:** stop MapLibre's basemap-warm fetch from racing fitBounds()'s tiles ([fcecdd1](https://github.com/EOCOnline/rangertrak/commit/fcecdd16070a7406274b3ec906b04b198bd9da12))
* **map:** stop the MapLibre basemap-cache-warming fetch racing pmtiles-js's Range fetch (0.73.0) ([3066ce6](https://github.com/EOCOnline/rangertrak/commit/3066ce60e60f2f1c128017d5a95558d1438f4b64))
* **map:** trail-elapsed tooltip styling never actually rendered ([62288dd](https://github.com/EOCOnline/rangertrak/commit/62288dd4baedcb35833c2371ab2d87d40dfd1052))
* **map:** wrap the map-page toggles beside the overview map on a phone ([2ec5e2e](https://github.com/EOCOnline/rangertrak/commit/2ec5e2e59e326ac2c372bddb1bba6d65d417aad5))
* **mission,guide:** §8 small items - F29-24, F29-16, F29-22 ([af5af2e](https://github.com/EOCOnline/rangertrak/commit/af5af2e30e39016d1261b373c5696d002e4b1fff))
* **mission,sample-data:** "REW/TEW" hint; realistic sample mission fields ([da20a63](https://github.com/EOCOnline/rangertrak/commit/da20a63ef92872c189616cda3618c2713f2c443b))
* **mission:** "Reset mission to defaults" left the footer showing "Version 0" ([0a6ad63](https://github.com/EOCOnline/rangertrak/commit/0a6ad633eb1d28dba9191118ca2cf9018333999a))
* **rangers,mission,map,guide:** matButton-on-label bug, guide text corrections (0.72.0) ([1412f30](https://github.com/EOCOnline/rangertrak/commit/1412f30c2afc725e3e33fa79ac23ebeaf73bebd4))
* **rangers,mission:** Batch 2 self-contained bugs from the 2026-08-29 feedback stream (F29-13, F29-1) ([fdf6e4d](https://github.com/EOCOnline/rangertrak/commit/fdf6e4da902345b71575e3e97ac1305e38be93a0))
* **sample-data:** keep every demo mission report on land ([5463b1c](https://github.com/EOCOnline/rangertrak/commit/5463b1cad5b85eec9d8479ccd096989cff9e5e6b))
* **sample-data:** restore MERT1's boat patrol as one water-based track ([93cdef8](https://github.com/EOCOnline/rangertrak/commit/93cdef8c944c3108266e53ed68fa745a3a074866))
* **ui:** Batch 1 mechanical fixes from the 2026-08-29 feedback stream (0.77.3) ([1a1bb56](https://github.com/EOCOnline/rangertrak/commit/1a1bb56f21979d6a3f026cde256e255c86d94f88))
* **ui:** tint the whole Danger Zone header row, not just its label ([8d16155](https://github.com/EOCOnline/rangertrak/commit/8d161551538af3a4189fc19d50d94fe97f7c208a))

## [0.89.0](https://github.com/EOCOnline/rangertrak/commit/HEAD) (2026-08-30)

### Fixes

* **help,guide:** Wave 4 content pass continued (F29-35) - Help's "Getting data off the device" button-reference table duplicated controls that live on Mission and Rangers; each button now documents itself in its own page's Guide drawer (Mission's new "Backup and advanced options" block, Rangers's existing "Loading a roster") and Help keeps only the comparison a per-page Guide can't make - which file to reach for and why. help-after-mission's cross-page wrap-up sequence (Radio Log, Rangers, Mission) was deliberately left as-is - it spans three routes, so no single page's Guide is the right home for it; recorded as a considered exception, not an oversight.

## [0.88.0](https://github.com/EOCOnline/rangertrak/commit/c86f2afcc4df6bd3f24693453642b61cc9c31908) (2026-08-30)

### Features

* **mission-readiness:** each row in the header readiness dot's tooltip breakdown now links straight to the section that fixes that specific signal (F29-21) - Rangers for the roster, Map for the two offline-prep checks, Mission for the rest - instead of every row being plain text pointing nowhere in particular, with only the dot itself linking (generically) to Mission. Uses the Router's fragment-scrolling (newly enabled app-wide) to land on the actual section, not just the page.

## [0.87.0](https://github.com/EOCOnline/rangertrak/commit/9e0697742a1f689dfbe35fa52c85c809d12700fb) (2026-08-30)

### Features

* **mission:** warns before leaving Mission with unsaved changes (F29-23) - a shared guard (`src/app/shared/guards/unsaved-changes.guard.ts`), not a Mission-only fix, so any future manual-Save page can adopt it by implementing one interface. Covers both in-app navigation (a router CanDeactivate guard) and closing the tab/refreshing/typing a new URL (a `beforeunload` listener) - a router guard alone can't see the second kind. The Save button turns amber and gains a `*` once the form is actually dirty, and Cancel only appears then too.
* Fixed a real bug found while building this: `onCancel()` reset the form's data but never its Signal Forms `dirty` state (a raw signal `.set()` doesn't clear `dirty` - only an explicit `reset()` does, confirmed by reading Signal Forms' own type definitions before assuming). Left uncaught, this would have made the guard fire a false "unsaved changes" warning immediately after using Cancel to discard those very changes.

## [0.86.0](https://github.com/EOCOnline/rangertrak/commit/016dace596efd91d89721ce018503003210154ed) (2026-08-30)

### Features

* **sample data:** rewrote the demo mission (F29-11) - a real ICS command structure (Incident Commander, three Section Chiefs, a PIO) instead of a flat list of interchangeable "Team N" callsigns; every name deliberately, obviously invented; field-team positions now cluster within walking distance inside two real Vashon-Maury parks (Maury Island Marine Park, Dockton Park) instead of spanning the whole island at driving-distance intervals; two real ICS-213 messages, since the original version of this data had none despite that being the actual original ask. Roster photos are AI-generated synthetic faces (thispersondoesnotexist.org) - real images, but of no real person, downscaled to a sane avatar size before shipping as bundled assets.
* **e2e:** new `checkSampleMissionLoads` check verifies the rewritten sample data's counts/roles/messages, and is the first check to exercise clicking a button inside a collapsed danger-zone section in read-write mode - a real regression net `--read-only` runs never touched.

## [0.85.0](https://github.com/EOCOnline/rangertrak/commit/ac443322e804f63208cb4ba269bbec56de14d33b) (2026-08-30)

### Features

* **entry:** the Entry mini-map now shows real contour lines (OpenTopoMap, not plain street tiles) and terrain relief shading by default (F29-6) - both baked in/overlaid the same way the full Map page's opt-in equivalents already work, so the two previews of the same spot look consistent.
* **map:** "Save this area for offline use" now follows whichever base layer is actually selected (OSM or OpenTopoMap), instead of always saving OSM regardless - closes the gap that would have made the Entry mini-map's new OpenTopoMap default unreliable offline. Fixes a real, pre-existing limitation, not just new-feature plumbing.

## [0.84.0](https://github.com/EOCOnline/rangertrak/commit/af5af2e30e39016d1261b373c5696d002e4b1fff) (2026-08-29)

### Fixes

* **mission:** the persistent-storage-granted message now notes iOS/iPadOS doesn't reliably honour it, with an "export regularly regardless" nudge - the guarantee it implied was never fully true there (F29-24).
* **guide:** the "Tactical call signs" Guide text now leads with Ranger ID, not call sign, as what actually identifies a responder - the old wording implied callsign was the identifier, which stopped being true once D-42 shipped (F29-16).
* **mission:** Data safety and the danger zone now sit side by side on a wide monitor instead of both always being full width - the component never had a grid parent to fulfil `.rt-mission-card`'s own layout contract (F29-22).

## [0.83.0](https://github.com/EOCOnline/rangertrak/commit/dc37558f60477fe3baa5521e11e2aca8c12f09be) (2026-08-29)

### Fixes

* **help:** Wave 4 content pass (F29-35, F29-36, F29-38) - Help's "Entering reports" and "Maps" tabs were substantially duplicating their own page's in-app Guide drawer content (button-by-button walkthroughs), rather than the "what does this mean" job Help is actually for. Trimmed to what the Guide drawer doesn't cover; the Guide's own Entry ("Positions") and Map ("What is shown") sections picked up the operational detail that had nowhere else to live. Also fixed a real overclaim introduced by `0.82.0`'s marker-colour fix: "each ranger has their own marker shape and colour" was never true for MapLibre (colour only, no distinct shapes) - now says so precisely on both engines. Coordinate-format Help now links out to a neutral explainer for MGRS/UTM instead of duplicating one.

## [0.82.1](https://github.com/EOCOnline/rangertrak/commit/2ec5e2e59e326ac2c372bddb1bba6d65d417aad5) (2026-08-29)

### Fixes

* **map:** the "Just those... selected" and "Use MapLibre..." toggles below each engine's overview map dropped to full width underneath it on a phone, instead of wrapping into the narrower column beside it - raised live from a phone screenshot. MDC's slide-toggle lays its switch+label out as an unconstrained line with no wrap, so the whole control needed one long line that didn't fit beside the floated 175px overview map and dropped below it instead. Capped to the space actually available beside the map, with the label now wrapping onto more than one line - saves real vertical space on a phone.

## [0.82.0](https://github.com/EOCOnline/rangertrak/commit/e35b86dfd95fe5022b5d53404f795daa854c42a4) (2026-08-29)

### Fixes

* **map:** MapLibre's report markers now colour by ranger identity (the same `rangerColorFor()` Leaflet's own markers and route trails already use), instead of every report rendering as an identical red dot. This was never a regression - MapLibre never had a per-ranger marker system built for it at all. Distinct per-ranger *shapes* (matching Leaflet's) would need a bigger change (a `symbol` layer with pre-registered images) and isn't done here; colour alone answers the reported complaint. The basemap-not-rendering half of this report is still open - see the roadmap for what was and wasn't ruled out this pass.
* **entry:** dropped the operator field's "Optional - blank is fine" placeholder text.

## [0.81.0](https://github.com/EOCOnline/rangertrak/commit/a0e49940356781a154364537fcbe9d99b7eef832) (2026-08-29)

### Features

* **entry:** Source now includes "Phone" (F29-43), and is finally shown - a Radio Log column and an ICS-309 export column, since capturing it on every report and never surfacing it anywhere made adding a new option pointless on its own (F29-46).
* **entry:** operator identity (D-44, ADR-worthy) - a name field right above Submit, stamped onto each report at the moment it's filed and never looked up later, so a mid-mission shift change can't retroactively re-attribute a past report. Carries forward from the previous entry within the same session (no persisted setting, no device default); collapses to a compact summary line with an edit affordance once set, so the hot path doesn't carry a permanently-open extra input for the common case of many entries by the same scribe. Fills ICS-213's "8 Approved by Name" and a new `Ics309LogHeader.preparedBy`; also a Radio Log column.
* **entry:** a genuinely new "Subject" field, last inside the "Also generate an ICS-213" section, right after Message - fills "4 Subject", declared on the real ICS-213 form since the original PDF-fill work but never actually populated, so it printed blank on every 213 generated until now.
* **mission:** the "Ranger ID field name" setting now states the operational expectation plainly - every responder should have their own, and anyone without one shows as not yet checked in - worded as an expectation, not an enforced rule the app will block on (F29-45).

## [0.80.0](https://github.com/EOCOnline/rangertrak/commit/81fbd3194e2f349691884c232bdf09df04a72638) (2026-08-29)

### Features

* **help:** restructured the Help page (D-d, F29-32, F29-33) - "Start here" and "Mission setup" merged into one onboarding checklist (still eight tabs total: a new "After mission" tab, split out of "Your data", offsets the merge); FAQ moved up next to About, its answers collapsed by default and independently expandable; "Log" renamed "Feedback" and now carries the in-app feedback form (moved on from "About", where it landed as an interim stop in the previous release) with the diagnostic log folded in as an optional, closed-by-default section.
* **shared:** new `ExpandableSectionComponent` - a collapsed-by-default, click-to-open block, sibling to the always-open `SectionComponent`. Built once and reused for the FAQ, the Log-inside-Feedback section, and both Rangers' and Mission's danger zones (F29-18) - a stray click can no longer land on a destructive button, and the section stays visually out of the way as the exceptional action it is. This is a deliberate, named exception to the 2026-08-25 "remove all collapsible sections" decision, not a reversal of it - `SectionComponent` itself is untouched and still always renders open.
* **log:** a "Copy log to clipboard" button (F29-29), so the diagnostic log can be pasted straight into the feedback form or a GitHub issue - replaces an instruction to "export the log and attach it to your report," which was never actually possible with a plain-text feedback form.

### Fixes

* **help:** fixed two spots that still promised "attach the log to your report" - a leftover from before the clipboard button existed.

## [0.79.0](https://github.com/EOCOnline/rangertrak/commit/5bb97b1993a0bca0414e6b5b8fe64478523eb33e) (2026-08-29)

### Fixes

* **rangers:** "Clear photos" used to unconditionally promise rangers would show the generic silhouette afterward - false whenever a ranger's roster entry already names its own `image`, a separate source (untouched by the on-device photo store this button actually clears). Read as the button not working when it had; the confirmation dialog now says so accurately.
* **mission:** the Field Report status grid's `no this.gridApi yet in refreshStatusGrid()` console log, previously firing on every normal page load - it was being called on the very first `rowData` binding, before ag-Grid had mounted. The grid's own `onGridReady()` already refreshes itself once it exists; the early call only mattered for a later reassignment (import/reset), which is what it still does.
* **perf:** preconnect to `nominatim.openstreetmap.org` (Entry's reverse-geocode of the mission's default position sits on the critical path on first load) and fix the navbar GitHub mark rendering slightly out of square (32x29 against its real 32x32 source), both flagged by a PageSpeed Insights pass. Also adds a `profiling` build configuration (production's optimized output plus hidden source maps) for local DevTools investigation, kept separate from the `production` configuration CI actually deploys.

## [0.78.0](https://github.com/EOCOnline/rangertrak/commit/fe0c047af70555e12d27a3e26543ffde813d8335) (2026-08-29)

### Fixes

* **rangers:** column order changed to Image, [Ranger ID], Call Sign, Full Name, Phone, Role, Notes - identity now leads the row instead of trailing it.
* **header:** a `|` now separates the mission pill's operational-period label from the elapsed-time clock, so a bare number can't be misread as a clock time - enlarged and heavier than surrounding text, since a plain `|` at body-sm size was easy to lose, especially in dark mode.
* **help:** the marmot backdrop's opacity raised from 0.15 to 0.30 (an absolute change, not a relative one) - reported as too dim to read as a photograph at the old value.
* **guide:** roster-import guidance now says "a UNIQUE ID" instead of "at least an id"; the stale "(Before v0.15.3 ...)" parenthetical about the built-in station list is removed.
* **radio-log:** the CallSign column's header no longer reads the mission's "Ranger ID field name" (`idFieldLabel`) while the column itself still shows callsign data - a mission that renamed that label (e.g. to "REW") could show a column headed "REW" full of callsigns. The header now always says "Callsign", matching what the column actually holds. (Whether to collapse this column with the roster's own id column, when a mission's id field IS the callsign, is a separate, still-open question.)
* **help:** the About/Send Feedback/How-it's-built content that used to sit below the tab group - and so rendered beneath whichever tab was open, not just About - now lives inside the About tab itself, once instead of on every tab.
* **nav,mission,map:** "Backup Map" retired app-wide in favour of "Alternative Map" (ADR D-31, reversed 2026-08-29) - the old wording ranked the two map engines against each other rather than naming an actual difference between them.
* **forms:** the app-wide outlined `mat-form-field` notches its floating label into the field's own top edge; a few extra px of top margin keeps that notch from colliding with whatever content sits directly above the field.

## [0.77.2](https://github.com/EOCOnline/rangertrak/commit/4170b9d2b26bc8d3a60ba80ab49113f7fc701e3d) (2026-08-27)

### Fixes

* **entry:** a short +Code entered in its normal shareable form - "CODE LOCALITY", e.g. "FGPM+MC7 Vashon, Washington" - silently did nothing on Enter or Tab, in Where's address field, even after `0.76.0`'s Enter-key fix. Root cause: `chkPCodes()` validated the WHOLE string including the locality text, and every letter/space/comma in a locality fails `OpenLocationCode`'s own alphabet check, so `isValid()` returned false and the function did nothing at all - no error, no fallback. Now only the first whitespace-delimited token (the code itself, which never contains spaces) is validated/decoded; the locality text is ignored, since a short code is already recovered against this mission's own default lat/lng, a better reference for an incident-local code anyway.

## [0.77.1](https://github.com/EOCOnline/rangertrak/commit/9c64a19553e309a2b6f03b2a56df383ae1866c7f) (2026-08-27)

### Fixes

* **app,mission:** `0.77.0`'s new app-wide update bar duplicated Mission's own pre-existing `[detailed]` instance, showing two identical "Reload now" bars on that one page. `InstallUpdateComponent` gets two new inputs, `showUpdate`/`showInstall` (both default `true`, so navbar/footer are unaffected) - the app-shell instance now sets `[showInstall]="false"` (version updates only, everywhere - a scribe mid-incident needs these to be impossible to miss), and Mission's own instance sets `[showUpdate]="false"` (install offer only, with its fuller explanation - the update half is already covered app-wide). An "install this app" offer stays low-key (footer, plus Mission's explanation) rather than competing for attention on an incident-tracking page.

## [0.77.0](https://github.com/EOCOnline/rangertrak/commit/250b156b5d780251ac0b36db00a565b9e689f6cd) (2026-08-27)

### Features

* **app:** the "Reload now - a new version is ready" bar (previously only shown inline on Mission, `[detailed]` mode of the shared `InstallUpdateComponent`) now also renders app-wide, just below the navbar on every page - revisits E-57(1)'s earlier "top banner -> footer only" call, since the footer's `[stickyBottom]` instance only pins near the bottom of view once a page has actually scrolled that far, so a short page could go a while without a visible prompt. Mission keeps its own instance too - same intentional multi-surface overlap `InstallUpdateComponent`'s own doc comment already covers for navbar/footer/Settings.
* **entry:** the ranger picker's label ("CallSign") now reads this mission's own "Ranger ID field name" (`idFieldLabel`, Mission Setup) instead of always "Callsign" - same live-settings pattern already used by the Rangers grid's id column.
* **radio-log:** four grid fixes/renames at once - the `id` column (this report's own sequential number, not a ranger identifier) renamed "ID" to "#", clearer about what it actually is; the CallSign column's header now reads the mission's "Ranger ID field name" too, same as Entry's picker above; CallSign text now colours by ranger identity (`rangerColorFor`, the same hash-based colour already used for that ranger's map marker/trail), so one person's reports are easy to pick out scanning the column; Address and Notes both get a real AG Grid cell tooltip (`tooltipField`) showing the full value on hover over the whole cell, not just the visible truncated characters; Notes' minimum width raised from 200 to 260 for more room on longer entries.

### Fixes

* **mission:** the Field Report Recipients card renamed "ICS-213 recipients" to "Listed Message Recipients" (mentioning 213 in the subtitle instead), and its suggested starter list shortened/simplified from the original ten entries (Incident Commander, Ops Section, Planning Section, Situation Awareness, Logistics Section, Finance/Admin Section, EOC, Sheriff/Police, Air unit, Utilities) to Incident Commander, Ops, Planning, Logistics, Finance, EOC, LEO, PI. Existing missions' own saved lists are untouched - this only changes what "Restore suggested starter list" restores and what a brand-new mission starts with.

## [0.76.0](https://github.com/EOCOnline/rangertrak/commit/78007d5f8d9aff767e5fd89cb60a69aadaf6b6f9) (2026-08-27)

### Fixes

* **entry:** the evidence-location checkbox's label (long enough with the Alt+click hint appended) could run past its section's own width toward the mini-map beside it instead of wrapping - `mat-checkbox`'s host and internal form-field both shrink-to-fit by default, so a bare checkbox wasn't guaranteed to stay capped at the section's width in every layout it could end up in. Forced to a full-width block with the icon top-aligned instead. Also dropped "above" from the hint text, since the map isn't always positioned above the checkbox.
* **entry:** typing a street address, +Code, or Maidenhead locator into Where's address field and pressing Enter did nothing - the field only handled the native `change` event, which browsers fire on Enter only as part of implicit form submission, and Entry's Submit button is disabled until the whole report is valid, which suppresses that path entirely. Added an explicit Enter-key handler that runs the lookup directly. This was also why the derived Address/+Code/Maidenhead panel only ever updated from a map click. Renamed "+Codes" to "+Code" in that panel to match the singular value shown.
* **map:** the "Save this area for offline use"/"Remove saved tiles" buttons on the full map page stretched the full page width (block-level flex items with no width constraint); now shrink-wrapped to their own content. The tile-count/size estimates that used to sit as their own full-width rows above and below the buttons are now appended inside each button's own label instead.

## [0.75.0](https://github.com/EOCOnline/rangertrak/commit/860a678877fbbfd9d31bb294eba442d8b5746264) (2026-08-27)

### Features

* **radio-log,messages:** the ICS-309/213 IA restructuring - Reports is now Radio Log (route `reports` → `radio-log`, redirect kept for old links; same grid, same behavior, just renamed) and a genuinely new Messages page (route `messages`) shows every field report with "Also generate an ICS-213" checked. Messages is deliberately not a second AG Grid clone - a list of messages plus an expanded detail pane for the selected one, since a message is opt-in per report and the list is expected to stay short. A **Print as ICS-213** button on the detail pane fills FEMA's real ICS-213 form (`fillIcs213Pdf()`, shipped `0.57.0` but never wired to any UI until now) and downloads the result as a PDF. `FieldReportType` has no Subject or Approved-by field today, so those two of the form's eight fillable fields print blank rather than invented.
* **guide,help:** every Reports/`/reports` reference across the Guide drawer and the Help page's tabs updated to Radio Log/`/radio-log`, plus a new Messages Guide entry - a rename that only touched the nav label and left every cross-reference stale would have been worse than not renaming at all.

## [0.74.0](https://github.com/EOCOnline/rangertrak/commit/a6a95bb36bc2dc42c71d6d08ab9d60f7b5c1baf9) (2026-08-27)

### Features

* **help:** "Start here" split into two tabs - it was doing two jobs at once (what RangerTrak is, and the first-five-minutes walkthrough). A new About tab carries the former; Start here keeps the onboarding steps and the offline-capability reference table.
* **help:** a new Log tab gives the Log page (deliberately absent from the main nav - it is a diagnostic tool, not a workflow page) a clearly-labelled way to be found, rather than only a link buried in the Your data tab's "Reporting a problem" prose.
* **mission,rangers:** per-mission label for a ranger's unique identifier (`idFieldLabel`, `MissionType`) - WA calls it REW; an IMT or another agency calls it something else, and a large multi-agency incident may have several systems in play with no single right answer. Only the label is settable (Mission Setup, under the Mission card); the identifier itself is still required to be unique. The Rangers grid's id column header now reads this setting live. Additive-only field, defaults to "ID" - no `MISSION_SCHEMA_VERSION` bump needed, `backfillMissingFields` supplies the default to any returning user, same mechanism `recipientOptions213` already relies on.

### Fixes

* **mission:** removed a real leftover - a static "Instructions" disclosure block dating to Sprint C, still rendering below the Danger zone on Mission Setup, that survived every later M3/E-84 pass untouched. Its substance already duplicated the `/mission` Guide entry (which the E-84 pass had written specifically to replace exactly this kind of on-page block); the one line with no equivalent (a generic "zoom with Ctrl+scroll" browser tip) wasn't RangerTrak-specific enough to be worth keeping either.

## [0.73.0](https://github.com/EOCOnline/rangertrak/commit/3066ce60e60f2f1c128017d5a95558d1438f4b64) (2026-08-27)

### Fixes

* **map:** the MapLibre basemap rendering blank (water/roads/buildings/landuse missing, only field-report markers visible - hillshade, a separate external source, was unaffected). Root cause: the Mission Readiness cache-warming fetch added in `0.68.0` did a plain `fetch(DEFAULT_PMTILES_URL)` from `MapLibreComponent`'s constructor, racing `pmtiles-js`'s own Range-based fetch of that same URL from `ngAfterViewInit()` moments later - both firing within milliseconds of each other let the browser coalesce them, handing the Range-requesting caller a full 200 response instead of the 206 partial one it needed (confirmed via `tools/serve-dist.js`'s own Range logic being correct in isolation). Moved the warming fetch to run only after the map's `'load'` event, once its own basemap fetches have already resolved, closing the race entirely; verified via `tools/e2e.js --full`'s `checkMapEngineSwitch`, which reproduced this exact error reliably before the fix and is clean after it, not just `ng build`.
* **entry:** Notes for radio log textarea capped to 600px on laptop-up screens - unconstrained, it spanned the full ~1000px form width despite being only 4 rows tall.

## [0.72.0](https://github.com/EOCOnline/rangertrak/commit/1412f30c2afc725e3e33fa79ac23ebeaf73bebd4) (2026-08-27)

### Fixes

* **rangers,mission:** the "Import roster"/"Import photos" (Rangers) and "Import mission" (Mission Advanced) file-picker controls were `<label matButton="outlined">` - `matButton`'s own selector only matches `button`/`a` elements, so it silently never attached, and all three rendered as bare unstyled text next to their real-button siblings. Now real `matButton` buttons that trigger their hidden `<input type="file">` via `.click()`, called synchronously inside the button's own click handler (opens the native file picker fine - the user-activation flag carries through a synchronous call).
* **guide:** several Rangers/Map guide-content corrections from live feedback: a "colour"/"color" inconsistency; the roster-import note said every entry "needs at least a callsign" (stale since D-42/D-43 - it needs an id, callsign is optional); the photo-naming line said "callsign" only (should be id-or-callsign) and didn't name accepted formats; "Tactical call signs" reworded to plainly describe rangers needing a unique id (often a state-issued credential) rather than framing it around ham-radio callsigns; the MapLibre offline-tiles note now says plainly that there is no in-app way to prepare additional coverage beyond the bundled pilot region today.

### Also this session

* Investigated a live report of the MapLibre basemap rendering blank (hillshade, a separate external source, unaffected) - matches this repo's own previously-known `checkMapEngineSwitch` e2e console-error failure exactly. Found a real suspect (`fetch(DEFAULT_PMTILES_URL)` in `mapLibreComponent`'s constructor, added `0.68.0`, competing with `pmtiles-js`'s own Range-based fetches of the same URL) and applied `cache: 'no-store'` to it - **tested and NOT confirmed**: the exact same e2e error still reproduced afterward. Left in as a real improvement on its own merits, but the actual cause is still unknown. See `Private Roadmap.md` for the full write-up - this is now the top open item.

## [0.71.0](https://github.com/EOCOnline/rangertrak/commit/729861196b65681fdb27764b1b57aedf7f5e718b) (2026-08-27)

### Fixes

* **entry:** root-caused (not just re-described) the long-standing Entry phone-viewport overflow - `.enter__Callsign` had `padding: 5px 5px` on the default `content-box` sizing, so its phone-breakpoint `width: 100%` added that 10px on top of the parent's available width instead of including it. Now `box-sizing: border-box`. One real, measured contributor found and fixed; a second, smaller overflow source remains on the same page and is not yet found - see `Private Roadmap.md`'s Path to 0.99.0-alpha checklist.
* **entry:** Notes for radio log textarea defaults to 4 rows instead of 5, per live feedback.
* **guide:** the Map page's guide content said "marker shape and colour" (should read "color" for consistency with the rest of that sentence) and understated MapLibre's offline limitation - it only works offline within its bundled pilot-region file, with no in-app way to prepare additional coverage before a mission; the guide now says so plainly and points to Leaflet's "Save this area" as the alternative for missions outside that region.

## [0.70.0](https://github.com/EOCOnline/rangertrak/commit/7695624f069cfc2b5c04a290f400d446b64c6f4a) (2026-08-27)

Material-M3 completeness audit: the redesign had been assumed complete since `0.58.0`/`0.59.0`,
but this was never actually re-verified against the code. It wasn't - three components had
non-Material markup left over, plus three straggler hardcoded colours the token layer was
supposed to have replaced everywhere by now.

### Fixes

* **feedback:** the in-app feedback form (Help page) was still entirely pre-M3 - a stale `.eButton`/plain `<textarea>`/`<input>`/`<label>` combination. `entry.component.scss`'s own comment from the `0.58.0` pass claimed all four copies of this rule (entry, mission, feedback, mission-advanced-options) were removed - three were, this one was missed and its markup never updated to match. Now `matButton`/`mat-form-field`/`matInput`, same as the other three.
* **log:** the "Save Log File" and "Clear Log" buttons were bare, unstyled native `<button>` elements - not even the `.eButton` class, no class at all. Now `matButton="outlined"`, with Clear Log using the same warn-palette treatment as Field Reports' and Mission's own danger buttons. The whole severity-colour palette (`.excessive`/`.verbose`/`.info`/`.warn`/`.error`) and the log panel's own background/border were hardcoded hex, never tokenized even at Sprint A - now resolve through `--rt-ink-*`/`--rt-readiness-*`/`--rt-notice-*`, so the Log page finally responds to light/dark and skin switching like every other page.
* **entry,field-reports:** three straggler hardcoded hex colours the token layer should have replaced - `entry.component.scss`'s error-state border/text (`#b3261e` → `--rt-readiness-red`, an exact match already used elsewhere) and Field Reports' `.cell-fail`/`.cell-pass` (`#f44336`/`#4caf50` → `--rt-readiness-red`/`--rt-readiness-green`).
* **map,mapLeaflet:** the map-engine switch, the terrain-hillshade toggle, and both engines' "All ({{n}}) / just those selected" control were raw `<input type="checkbox">` styled by hand - inconsistent with Entry's own coordinate-system toggle, already standardized to `<mat-slide-toggle>` back on 2026-08-22. All four converted; `tools/e2e.js`'s map-engine-switch checks updated from mutating a native checkbox's `.checked` property to clicking the toggle's underlying button and reading `aria-checked` (confirmed against a real `--full` run before and after, not just `ng build`).

### Also this session (documentation only, no code)

* Corrected a research error from earlier the same session: a claim that the Guide drawer rollout never extended past Entry was wrong - the design is route-driven and centralized in the shared header, and `guide-content.ts` already has full content for all five main routes. See `Private Roadmap.md`'s START HERE section and its own struck-through backlog row for the full correction.
* Brought `Private Roadmap.md`'s START HERE section current from `0.53.0` (16 releases stale) through `0.69.0`, and reconciled this document against the GitHub issue tracker's own current state (23 issues closed by the maintainer 2026-08-26, 11 remain open, all already tracked here).
* Confirmed, via `git stash` + a clean `--full` e2e run on unmodified `main`, that five e2e failures are pre-existing and unrelated to this batch: an Entry-page phone-width overflow (`.enter__form` 408px / document 425px against a 390px device - not yet root-caused, `.mapLeaflet-container`'s recent explicit `width: min(35vw, 500px)` is the leading suspect but unconfirmed), and a MapLibre PMTiles console error on the engine-switch round trip ("Server returned no content-length header"). Neither blocks this push; both are recorded as new Path-to-0.99.0-alpha rows.

## [0.69.0](https://github.com/EOCOnline/rangertrak/compare/v0.68.0...v0.69.0) (2026-08-27)


### Features

* **map:** mile grid overlay on the Leaflet map ([e7cecae](https://github.com/EOCOnline/rangertrak/commit/e7cecaeecb3a8ebc9ed6c8ce148deed6d8ab5eeb))

## [0.68.0](https://github.com/EOCOnline/rangertrak/compare/v0.67.0...v0.68.0) (2026-08-27)


### Bug Fixes

* **entry:** clean up derived-coordinate/213 text and default recipients ([d704fcc](https://github.com/EOCOnline/rangertrak/commit/d704fcc8d6dbab9b9e127a0376d2ac0d94ed8f1b))
* **map:** the bundled MapLibre readiness signal could never turn green ([97daf71](https://github.com/EOCOnline/rangertrak/commit/97daf715e5e017284a3076f2207a2131cf073155))

## [0.67.0](https://github.com/EOCOnline/rangertrak/compare/v0.66.0...v0.67.0) (2026-08-27)


### Features

* **theme:** complete the redesign canvas's five-scheme skin set; surface Alt+click on the evidence checkbox ([f699ba4](https://github.com/EOCOnline/rangertrak/commit/f699ba4a6229c3d79867665b093a96ec397fa4dc))

## [0.66.0](https://github.com/EOCOnline/rangertrak/compare/v0.65.0...v0.66.0) (2026-08-27)


### Features

* **map:** scale legend and print-only mission title/timestamp (E-item 13) ([9e9a217](https://github.com/EOCOnline/rangertrak/commit/9e9a217df87a98f791dd1c688baaf8dd0cd8839a))

## [0.65.0](https://github.com/EOCOnline/rangertrak/compare/v0.64.0...v0.65.0) (2026-08-27)


### Features

* **entry:** Alt+click the mini-map to mark an evidence location (E-item 5) ([c575423](https://github.com/EOCOnline/rangertrak/commit/c5754239782280aa9a1b95878327fbb7d1b7582e))

## [0.64.0](https://github.com/EOCOnline/rangertrak/compare/v0.63.1...v0.64.0) (2026-08-27)


### Features

* **theme:** runtime colour-scheme switcher (E-item 3, the mockup's 3 skins) ([0675714](https://github.com/EOCOnline/rangertrak/commit/0675714d72708b6a4674fa7c404320edca03370d))

### [0.63.1](https://github.com/EOCOnline/rangertrak/compare/v0.63.0...v0.63.1) (2026-08-27)


### Bug Fixes

* **mission:** floatLabel="always" on every remaining placeholder field ([8fc60a4](https://github.com/EOCOnline/rangertrak/commit/8fc60a4a25956abb7b1e51596fc338d2355891bc))

## [0.63.0](https://github.com/EOCOnline/rangertrak/compare/v0.62.0...v0.63.0) (2026-08-27)


### Features

* **navbar,header:** collapse phone nav behind a hamburger menu ([7c15993](https://github.com/EOCOnline/rangertrak/commit/7c1599381f824a7117db6474f03e923c042a8cd4))

## [0.62.0](https://github.com/EOCOnline/rangertrak/compare/v0.61.2...v0.62.0) (2026-08-27)


### Features

* **entry,mission:** app-wide spacing scale, Material density -2, cap mini-map growth ([3e186d0](https://github.com/EOCOnline/rangertrak/commit/3e186d05c5f406b0208eb992e6cc491564d70331))

### [0.61.2](https://github.com/EOCOnline/rangertrak/compare/v0.61.1...v0.61.2) (2026-08-27)


### Bug Fixes

* **entry:** cap form width, pair Lat/Lng on one row, drop redundant info icon ([b0e0b12](https://github.com/EOCOnline/rangertrak/commit/b0e0b125218b4a7d53c3585f8343c47ebf9b2179))

### [0.61.1](https://github.com/EOCOnline/rangertrak/compare/v0.61.0...v0.61.1) (2026-08-26)


### Features

* **guide:** About RangerTrak paragraph atop the Entry page's guide ([bf3b260](https://github.com/EOCOnline/rangertrak/commit/bf3b2600dcff2f06c3a001f11561976ad5b91856))

## [0.61.0](https://github.com/EOCOnline/rangertrak/compare/v0.60.0...v0.61.0) (2026-08-26)


### Features

* **mission,entry:** default coordinate format is a real radio choice; drop Maidenhead toggle ([16cdf98](https://github.com/EOCOnline/rangertrak/commit/16cdf989b5de1f4ce34f4a15f2f2874fade1f4f9))

## [0.60.0](https://github.com/EOCOnline/rangertrak/compare/v0.59.2...v0.60.0) (2026-08-26)


### Features

* **entry:** embedded field labels, Source chip style, real fix for submit contrast ([54ee42e](https://github.com/EOCOnline/rangertrak/commit/54ee42e0c4ba91cee59b5524594b0bd29120ddda)), closes [#962f10](https://github.com/EOCOnline/rangertrak/issues/962f10) [#442C2](https://github.com/EOCOnline/rangertrak/issues/442C2)

### [0.59.2](https://github.com/EOCOnline/rangertrak/compare/v0.59.1...v0.59.2) (2026-08-26)


### Bug Fixes

* **entry,mapLeaflet:** submit-button contrast, Note label, trail badge, Mobile icon ([8b8fdfc](https://github.com/EOCOnline/rangertrak/commit/8b8fdfccf8b797ea08e7deca91ae3e48e299acbb))

### [0.59.1](https://github.com/EOCOnline/rangertrak/compare/v0.31.0...v0.59.1) (2026-08-26)


### Features

* **cla:** draft E-23 CLA and gating workflow (ADR D-01) ([d7295de](https://github.com/EOCOnline/rangertrak/commit/d7295de9b9a7a7bfc052f01490c5b05ba71d6fb0))
* **entry,header,services,e2e:** E-83 - reopenable Entry welcome panel (0.43.0) ([db9f3dd](https://github.com/EOCOnline/rangertrak/commit/db9f3dd76ede29c6a8152550fc4d1a1f1440877d))
* **entry,settings:** E-103 per-mission recipient checklist for ICS-213 "To" ([587817c](https://github.com/EOCOnline/rangertrak/commit/587817cf301189ab8c23ba30b1ef751878f6c196))
* **entry:** D-42 phase 4 - attribute reports by rangerUid; no-callsign rangers selectable ([78fa3c8](https://github.com/EOCOnline/rangertrak/commit/78fa3c819c9c54d71dd35966a3cb2070bd8e5a3d))
* **entry:** E-104 - one editable coordinate format at a time, others read-only ([5b37485](https://github.com/EOCOnline/rangertrak/commit/5b374851d42dcba4a2508414da9e37ffd7475e97))
* **entry:** E-41 phase 1 - source type and opt-in ICS-213 fields (0.52.0) ([50f547d](https://github.com/EOCOnline/rangertrak/commit/50f547d8687499dd8a75ab7c63ad9bfa8bfc210e)), closes [angular/components#32072](https://github.com/angular/components/issues/32072)
* **entry:** evidence/clue location - range and bearing, own map marker (0.53.0) ([a09d7d8](https://github.com/EOCOnline/rangertrak/commit/a09d7d876c691a9e5c850f5bf0ad8da9d69502ce))
* **entry:** rebuild the flagship Field Entry screen on Material M3 ([17e5697](https://github.com/EOCOnline/rangertrak/commit/17e56978c546dade43c752a348dd4896ddb5611d)), closes [angular/components#32072](https://github.com/angular/components/issues/32072)
* **export:** ICS-213 PDF fill service, against the real official form ([81b35b1](https://github.com/EOCOnline/rangertrak/commit/81b35b1d01636fce40c5218f7aff2c87a3588a25))
* **export:** ICS-309 log data shaper ([d231241](https://github.com/EOCOnline/rangertrak/commit/d23124176a26e5452f5f1db68dbd3de15c693544))
* **guide:** one Guide drawer replaces the on-page instruction blocks ([2fd9a3d](https://github.com/EOCOnline/rangertrak/commit/2fd9a3d643cc611c305643858e295c7fa681e002))
* **help,shared,field-reports,rangers,mapLeaflet,map,entry:** E-84 documentation rewrite + map marker tooltip time format (0.44.0) ([204720e](https://github.com/EOCOnline/rangertrak/commit/204720e0efaa2f6d8a3279290b961bf76f79562d))
* **install-update:** hover panel explains what install/update involves (0.36.0) ([94d868a](https://github.com/EOCOnline/rangertrak/commit/94d868a76cc8b0f5959270e7d5e18957afae186b))
* **lmap:** show offline saved-area size and a live estimate ([b9a111c](https://github.com/EOCOnline/rangertrak/commit/b9a111c7759687125dab2738c6f2441aa44fb04b))
* **map,field-reports:** E-11 evidence-location visible on main map and Reports ([50af972](https://github.com/EOCOnline/rangertrak/commit/50af972cf6ac6fd5acfa0a65ea37d1233fb1a14b))
* **map,mapLeaflet,entry:** status colour halo on map markers (0.49.0) ([2ca40fe](https://github.com/EOCOnline/rangertrak/commit/2ca40fe3ec7afbf654d6c54c186eb0543f2893d2)), closes [#hex1](https://github.com/EOCOnline/rangertrak/issues/hex1) [#hex2](https://github.com/EOCOnline/rangertrak/issues/hex2)
* **map,mapLeaflet:** terrain relief overlay with a real visibility toggle, both engines (0.48.0) ([dbc4e03](https://github.com/EOCOnline/rangertrak/commit/dbc4e03ffca161de1b4e6b0bb4b9f9ecd5990e6c))
* **map,rangers:** flag missing callsigns instead of silently collapsing them (0.51.0) ([dd97974](https://github.com/EOCOnline/rangertrak/commit/dd97974d4c8d7962355ee7c158e6cc954a210942)), closes [#c0392](https://github.com/EOCOnline/rangertrak/issues/c0392) [#c0392](https://github.com/EOCOnline/rangertrak/issues/c0392)
* **map:** full-screen toggle for both map engines (E-78, 0.46.0) ([7307b5b](https://github.com/EOCOnline/rangertrak/commit/7307b5b1d945d8e881108f26ad37b281a74a684a))
* **mapLeaflet,e2e:** E-80 follow-on - static elapsed-time label on route trails (0.42.0) ([64363d4](https://github.com/EOCOnline/rangertrak/commit/64363d446e33dbf75c1cbbdfd52ec0cc79bf5c2f))
* **mapLeaflet,e2e:** E-80 phase 1 - static per-callsign team route trails (0.38.0) ([2c074ce](https://github.com/EOCOnline/rangertrak/commit/2c074ce1f2fe310edd33ba2cd73311c750933e03))
* **mapLeaflet,e2e:** E-85 phase 1 - Leaflet base-layer switcher infrastructure (0.39.0) ([eb4f84e](https://github.com/EOCOnline/rangertrak/commit/eb4f84e0e43cf6c1bd1cad58cf06f594c536ab1c))
* **mapLeaflet,e2e:** E-85 phase 2 - wire in OpenTopoMap as first alternate base layer (0.40.0) ([b57f47e](https://github.com/EOCOnline/rangertrak/commit/b57f47eabd865401e5590402ed8450a444e6368b))
* **mapLeaflet:** saved offline tiles verification overlay (0.50.0) ([777fade](https://github.com/EOCOnline/rangertrak/commit/777fadea0cd2bd572e732e2cb5be41e4120c1112))
* **mapping,mapLeaflet,e2e:** E-86 - unique per-ranger map markers (0.41.0) ([be7f75a](https://github.com/EOCOnline/rangertrak/commit/be7f75a8db47fc967d6c5003535b5f6d549fb809))
* **mapping:** D-42 phase 5 - distinct markers/trails for callsignless rangers ([6208b34](https://github.com/EOCOnline/rangertrak/commit/6208b34e347588e2feae88d6a5db1b886ba2a1c9))
* **mission,settings:** name the specific readiness gap(s), not just the aggregate dot (E-79, 0.47.0) ([a892a40](https://github.com/EOCOnline/rangertrak/commit/a892a40b3ad37e427d65e35db3c7991e4b5735c9))
* **mission:** rebuild the Mission page on Material M3 ([78ca124](https://github.com/EOCOnline/rangertrak/commit/78ca124c9e3416dc060384c59d5c11bc2de6e3e5)), closes [angular/components#32072](https://github.com/angular/components/issues/32072) [#teamgrid1](https://github.com/EOCOnline/rangertrak/issues/teamgrid1) [#962f10](https://github.com/EOCOnline/rangertrak/issues/962f10)
* **nav,entry,settings:** theme switcher, header/Where/When live-review fixes (0.32.0) ([319a09c](https://github.com/EOCOnline/rangertrak/commit/319a09c13ac94f2865c1546760081d93cf2afd5f))
* **rangers,reports:** D-42 phase 2 - wire the migrations into the load paths ([aee5a82](https://github.com/EOCOnline/rangertrak/commit/aee5a82ac19c1b5b634fa3a4c557b0d508b814aa))
* **rangers,reports:** schema-version seam for both stores; IDs are never minted ([38f6aba](https://github.com/EOCOnline/rangertrak/commit/38f6aba863242aa7f5102e84039a5e473e198b72))
* **rangers:** ADR D-42 phase 1 - ranger id model + migration, not yet wired ([24d8147](https://github.com/EOCOnline/rangertrak/commit/24d8147736726f74cb4b803cc889892d35f6739b))
* **rangers:** D-42 phase 3 - CRUD keys on the surrogate uid, lookups name their key ([578a5d1](https://github.com/EOCOnline/rangertrak/commit/578a5d140a3f8c23b64638261ae588714b062c72))
* **rangers:** D-42 phase 6 - photo matching accepts id or callsign ([7309e1e](https://github.com/EOCOnline/rangertrak/commit/7309e1e251e5de4923bd1876e91ff04875207089))
* **rangers:** D-42 phase 7 - id replaces callsign/rew across the UI surface ([1233846](https://github.com/EOCOnline/rangertrak/commit/1233846a4b3148e655a9928fa3409c489a399c0a))
* **rangers:** D-42 phase 8 - retire rew from RangerType ([98a4df7](https://github.com/EOCOnline/rangertrak/commit/98a4df7a3ef7f483fd84ba5ecaa207e29fc115fb))
* **rangers:** internal surrogate key (uid) as the ranger/report join key ([e8fa0ff](https://github.com/EOCOnline/rangertrak/commit/e8fa0ff375da27910515a2a890aa4fc99f3d9665))
* **rangers:** warn on roster import when entries have no callsign (0.51.1) ([8093b4d](https://github.com/EOCOnline/rangertrak/commit/8093b4d138f832ffb6b43efeaaab6ef39755c9cd))
* **routes,nav,grid,toggle:** URLs match nav labels, AG-Grid help moved (0.35.0) ([a1f988c](https://github.com/EOCOnline/rangertrak/commit/a1f988ce63677a710a12daf43231e630dbdedcde))
* **shared,navbar,field-reports,settings,entry,mapping:** remove collapsible sections and dead controls app-wide, drop dead settings fields (0.45.0) ([ca7fcf9](https://github.com/EOCOnline/rangertrak/commit/ca7fcf941a6218dcbf6b7daecd786686e283bebe))
* **styles:** Material M3 foundation - global field appearance + page patterns ([113a354](https://github.com/EOCOnline/rangertrak/commit/113a354ec90460472a05223b42ab1bb4347b668e))
* **time-picker,footer,settings:** segmented hour/min/AM-PM entry (0.34.0) ([af17493](https://github.com/EOCOnline/rangertrak/commit/af17493eac293e349c29453ff6384d7064654bb4))


### Bug Fixes

* **deps:** install xlsx from SheetJS's own CDN, clearing its 2 CVEs ([c126d3f](https://github.com/EOCOnline/rangertrak/commit/c126d3f15e8a803ea9184e52bad0b967a2d4cd2b))
* **deps:** remove unused jshint ([cbe33f3](https://github.com/EOCOnline/rangertrak/commit/cbe33f3a6eb040ba9d644c0bca1db066e28becf8))
* **deps:** remove unused mock-browser, clearing both critical CVEs ([e1624fb](https://github.com/EOCOnline/rangertrak/commit/e1624fbf9e7a3bc6812444d9634bfce55865466a))
* **deps:** remove unused xlsx-style ([0ad65f3](https://github.com/EOCOnline/rangertrak/commit/0ad65f3f2de3b241454c07ad4dd7e2b70b84371c))
* **e2e:** repair checkSettingsFormSave, which had been aborting the suite ([66f264c](https://github.com/EOCOnline/rangertrak/commit/66f264c8db61bbf78f5039db02a75d263b4a58f8)), closes [#2](https://github.com/EOCOnline/rangertrak/issues/2) [#2](https://github.com/EOCOnline/rangertrak/issues/2)
* **entry,footer:** Entry-screen spacing/sizing pass from live screenshots ([32c64b1](https://github.com/EOCOnline/rangertrak/commit/32c64b1cd6cfc7d8c309f885b857e34f76baba1d))
* **entry,install-update,routes,e2e:** phone-width panel overflow, dead /about redirect, stale AG Grid v36 e2e selectors ([d51fd7d](https://github.com/EOCOnline/rangertrak/commit/d51fd7df1fac330502c3d45cd59a0fbd53ec7e83))
* **entry:** 213 section fields render regardless of the checkbox ([8e2e41d](https://github.com/EOCOnline/rangertrak/commit/8e2e41d49926fff4c5192ea20a322508d9c6a8fe))
* **entry:** callsign autocomplete no longer auto-opens over the mini-map (E-66, 0.47.1) ([5233f49](https://github.com/EOCOnline/rangertrak/commit/5233f4941799ad60b86ae75742c6e7248bf6164d))
* **entry:** coordinate-system toggles keep their tab stops when hidden ([53060cb](https://github.com/EOCOnline/rangertrak/commit/53060cb93f3c4b8375d4b91d91ef90e1f08a56f2))
* **entry:** reserve layout space for the derived-location block (CLS) ([b67ac49](https://github.com/EOCOnline/rangertrak/commit/b67ac495a0ecae6bd1527295421ffc0028bf7cbb))
* **entry:** restore access to every coordinate format; quiet the submit confirmation ([48eb69a](https://github.com/EOCOnline/rangertrak/commit/48eb69ad00b4d7f01eca2b3b1fecd831b437a506))
* **entry:** standard coordinate toggle, sized MGRS/UTM fields (0.37.0) ([ef5817f](https://github.com/EOCOnline/rangertrak/commit/ef5817fc7a9e82837472116964767dc9035a2bac))
* **entry:** Where-section cleanup from live review ([f5a0e45](https://github.com/EOCOnline/rangertrak/commit/f5a0e45a7994c9d2ae8e24830d56dc26424ef1ce))
* **footer:** vertically centre the Install pill in the footer row ([925a41e](https://github.com/EOCOnline/rangertrak/commit/925a41edded741a11fe032e3fe7780652653b5ab))
* **grids:** size columns to their content instead of an even share ([832d639](https://github.com/EOCOnline/rangertrak/commit/832d63992d232e094058f9ff623c9477e47945ce))
* **help:** reference-table row labels distinguishable from their description on phone (0.49.2) ([06523ef](https://github.com/EOCOnline/rangertrak/commit/06523ef2518b08bb5c6613a6a697f4df6eb0c01c))
* **map,entry:** engine switch above Instructions on both engines; drop mini-map status halo (0.49.1) ([8d2ab08](https://github.com/EOCOnline/rangertrak/commit/8d2ab085644484dcb28bb9365ceff13ed81fc7df))
* **map,mapLeaflet:** hillshade tiles actually load (0.48.1) ([589f7c5](https://github.com/EOCOnline/rangertrak/commit/589f7c5f07372a329d130e8567767ab7becff5a6))
* **mapLeaflet,mapping:** sequential-name hash collision, offline controls out of the map, minor UI polish (0.43.1) ([4c8d3db](https://github.com/EOCOnline/rangertrak/commit/4c8d3dbe1be66bd9de2852626dc20dfd070a0467))
* **mapLeaflet,mapping:** trail colours match markers, offline control restyled, overview map no longer overlaps footer (0.44.1) ([6fd77c1](https://github.com/EOCOnline/rangertrak/commit/6fd77c1953740a5f99584bb450c81c28ec927b6a))
* **map:** MapLibre stays mounted after navigating away from /map and back (E-77, 0.45.1) ([60a77ab](https://github.com/EOCOnline/rangertrak/commit/60a77abe20937c7f55a6c193dbe89fb4a92cb6e8))
* **mapping,mapLeaflet,help:** retry Nominatim 429s, stop savetiles control from float-escaping its wrapper, clarify Field Entry nav ([bb4ad6d](https://github.com/EOCOnline/rangertrak/commit/bb4ad6dd18b2449ae2093b9492b69bd51e5b4144))
* **navbar,entry,settings,footer:** live-review fixes round 2 (0.33.0) ([8b06661](https://github.com/EOCOnline/rangertrak/commit/8b06661c845578684f43a1495663f9482eec411c))
* **rangers,header:** blank-start roster, drop address PII, reorder pages, CLS fixes ([35b6cae](https://github.com/EOCOnline/rangertrak/commit/35b6caeb2fc6a1530dd98c000023a71ba7e7409a))
* **settings:** MGRS/UTM off by default so "Show all systems" does something ([9d59477](https://github.com/EOCOnline/rangertrak/commit/9d59477cd330d46938b01c28a3d0531ca05b4f6d))
* **settings:** sticky Save/Cancel bar and live mission-readiness gaps ([ebf9507](https://github.com/EOCOnline/rangertrak/commit/ebf9507c1ade44c32fdddd7d60cc16230f9a6032))
* **site:** E-44 audit pass - fonts, favicon, dead code, security headers ([f1478dd](https://github.com/EOCOnline/rangertrak/commit/f1478ddc064064901e71de636350005fc002831b))
* **test:** pin jasmine-core back to 5.13, undoing the v7 bump ([eee5936](https://github.com/EOCOnline/rangertrak/commit/eee59361ef83ab0a5a65e7fc7e83a9e012d11605))

## [0.59.0](https://github.com/EOCOnline/rangertrak/commit/HEAD) (2026-08-26)

### Fixes

* **entry:** every coordinate format is reachable again from the Where switcher, regardless of Mission Settings. E-104 replaced the old "Show all coordinate systems" toggle with a one-format-at-a-time switcher, but that toggle had also been the only way to reach a format Settings hadn't enabled - and MGRS/UTM default off, so an unexpected MGRS/UTM radio call became impossible to enter without a trip to Mission Settings first, mid-incident. The switcher now always offers all five; Settings' checkboxes only pick which format Entry OPENS on
* **entry:** the fading confirmation that landed at the TOP of the page on every submit (a snackbar dumping the whole serialized report over the page header) is debug-mode only now. The fading line beside the Submit button stays, and shows just the report id unless debug mode is on

### Features

* **entry:** the derived coordinate rows follow the existing derived-address styling - small italic text on the same tinted panel, under one "Derived" divider, instead of a second bordered panel with its own heading
* **entry:** click any derived coordinate to copy it to the clipboard, with a brief "copied" acknowledgement. Same idiom the two Leaflet maps already use for click-to-copy; reading MGRS back over the radio or pasting a position into a separate CAD/ICS system no longer means retyping a 15-character grid reference by hand

## [0.58.0](https://github.com/EOCOnline/rangertrak/commit/HEAD) (2026-08-26)

Start of the Material-M3 redesign. Mockups for the whole app: https://claude.ai/code/artifact/a6e52cb1-0759-4eb0-9930-4d1af4dd07e7

### Features

* **styles:** Material M3 foundation. `MAT_FORM_FIELD_DEFAULT_OPTIONS` sets `appearance: 'outline'` and `subscriptSizing: 'dynamic'` app-wide, so every field - including ones converted from bare `<input>` markup - picks up the house style with no per-field attribute. New `styles/_patterns.scss` defines the page-structure blocks (`.rt-action-bar`, `.rt-danger-zone`, `.rt-alert`, `.rt-field-grid`) once instead of per page
* **mission:** the Mission page rebuilt on Material. Every control was a bare `<input>` with an inline pixel width and a `<span class="strong">Label: </span>` beside it; they are `<mat-form-field>`s, `<mat-checkbox>`es and `matButton`s now, laid out as six outlined cards in a two-column grid that collapses to one on a phone. Destructive actions (Reset settings, Import mission, Load sample mission) are fenced in a Danger zone instead of sharing an "Advanced Options" block with the non-destructive export and storage-protection controls
* **guide:** one Guide drawer, opened from a button in every page header, replaces the on-page instruction blocks - Field Reports' Tips, Rangers' Instructions and Privacy, both map engines' Instructions, and the grid keyboard help. Content lives as data in a single `guide-content.ts`, which is what finally makes the twice-requested "is all this verbiage still true?" audit a one-file review. Settles E-57(2), open since 2026-08-22

### Fixes

* **grids:** columns size to their content instead of an even share. Both grids called `sizeColumnsToFit()`, which distributes grid width and ignores per-column `flex` - so on Field Reports `Address` (flex 30) genuinely rendered narrower than `Lat` (flex 1), and Lat/Lng each took ~290px to show 9 characters while addresses truncated. Replaced with `autoSizeStrategy: { type: 'fitCellContents' }` plus honest per-column min/max bounds; exactly one column per grid (Notes) keeps `flex` so it absorbs leftover width
* **footer:** the Install pill sat 10px above the footer's centreline. `.rt-footer__left` centres with flex, which aligns each item's *margin* box - so the pill's lone `margin-bottom: 20px` (added for viewport clearance when stuck) pushed it up. The clearance moved onto the sticky offset instead
* **e2e:** `checkSettingsFormSave()` had been throwing a TypeError partway through and aborting the rest of the run - repairing it took the suite from 110 checks to **149**, so ~39 assertions had silently not been executing. It also looked up the Save button as `.settings__Save-button` (capital S) against a template that renders `settings__save-button`, so that assertion could never have passed. Both controls now use `data-testid`, and a new guard asserts the checkbox actually toggled rather than letting "the saved value matches what we set" pass vacuously

## [0.57.0](https://github.com/EOCOnline/rangertrak/commit/1835529c3031cfc9e946ca763c3c7f452ec4300c) (2026-08-26)

### Features

* **export:** ICS-213 PDF fill service - fills FEMA's own real fillable form (downloaded and verified field-by-field, not a layout drawn from scratch), and an ICS-309 log data shaper that orders field reports chronologically into Time/From/Message rows. First two of four pieces toward a printable 309/213 workflow (E-31/E-41 phase 3); not wired into any UI yet.

### Fixes

* **entry:** the ICS-213 section's fields (Reply requested/213 Message/To) rendered regardless of the "Also generate an ICS-213" checkbox - an unconditional `display: flex` was overriding the browser's native `[hidden]` behavior. Caught live and verified fixed before/after with a real browser, not just read from the code.
* **settings:** MGRS/UTM coordinate systems are off by default now, so Entry's "Show all coordinate systems" toggle actually reveals something the first time someone tries it, instead of everything already being shown
* **entry:** moved the evidence/clue-location section into the Where area (it IS a location) instead of after the entire ICS-213 section, recomputing the full keyboard tab-order chain to match; renamed "Message" to "213 Message" and added hover-tooltips clarifying it from Notes (the always-saved communications-log entry vs. a separate addressed message some reports also generate); the ICS-213 section now reads as a clearly bounded box instead of a thin indent
* **field-reports:** `recipients213` changed from a bare string to a list - a per-mission definable recipient checklist is coming, and a list is the natural fit for it and for future delivery options (email, etc.)

### Features

* **rangers,entry,field-reports,mapping:** ADR D-42/D-43 - rangers no longer join to field reports by callsign. An internal surrogate `uid` (app-minted, never shown) is the real join key; a new `id` field (`REW-0038`/`TEW-1003`, or a preserved regional credential like `VI-0038`) replaces the WA-specific `rew` column as the displayed, searchable credential. Not every CERT/MERT responder is ham-licensed, so a ranger with no callsign is now a fully supported case throughout - selectable on Entry, attributed correctly on Reports, given a real distinct map marker/trail instead of collapsing into the shared "unassigned" icon, and matched by id-or-callsign for locally-stored photos. Both the roster and field-report stores gained real migration machinery (previously bare `JSON.parse()`) with a versioned wrapper, canonicalizing existing credentials on load without ever inventing one - a TEW/REW number is issued by the incident at check-in, not by this app. The Rangers grid's `REW` column is now `ID`, and roster import accepts a callsign-less entry as long as it carries a resolvable id/rew

### Fixes

* **rangers:** removed a real amateur radio callsign baked into `westy.png` (used by both the hardcoded station starter set and the sample demo mission) and a real name/callsign sitting in a dead commented-out tooltip example - neither belongs in a public repo

## [0.55.0](https://github.com/EOCOnline/rangertrak/commit/7d52ed4c77402f91115da73c7c81f669c483072e) (2026-08-26)

### Features

* **rangers:** a fresh install no longer auto-seeds the 18 hardcoded Vashon station callsigns - the roster starts blank, indicating a new mission; the stations remain available opt-in via Rangers > Advanced > "Add station callsigns"

### Fixes

* **rangers:** removed `address` (home address) from the ranger data model entirely - confirmed unused by any feature, unlike phone/rew/image; updated every export confirmation dialog and doc that mentioned it, and added context that a callsign already resolves to more via the FCC's public licensee lookup
* **rangers,field-reports:** moved the Instructions/Tips/Privacy/keyboard-help sections below the grid on both pages, so the grid is the first prominent thing visible
* **header:** `timeElapsed$`/`timeLeft$`/the clock used `interval(1000)`, which doesn't emit immediately - the header's status cluster rendered empty for a full second, measured live as the dominant remaining CLS contributor; switched to `timer(0, 1000)`
* **navbar:** added explicit width/height to the GitHub icon (Lighthouse: unsized image, second-largest layout-shift culprit)

## [0.54.2](https://github.com/EOCOnline/rangertrak/commit/b67ac495a0ecae6bd1527295421ffc0028bf7cbb) (2026-08-26)

### Fixes

* **entry:** Location's derived-results block (Address/+Codes/MGRS/UTM/Maidenhead) was `display:none` until ready, so it popped in at full height once the location resolved - measured live as a 0.35-0.40 CLS score, the dominant layout-instability cause on the page. Switched to `visibility:hidden`, which reserves the same space from first paint while keeping the exact DOM-persistence guarantee the reveal logic depends on

## [0.54.1](https://github.com/EOCOnline/rangertrak/commit/c88b7ad4e3269052a81d9c6784441baaff7ec93e) (2026-08-26)

### Fixes

* **site:** securityheaders.com scan follow-up - added `Cross-Origin-Resource-Policy: same-origin` (enforcing) and `Cross-Origin-Embedder-Policy-Report-Only: credentialless` (deliberately not enforcing - confirmed live that OpenStreetMap's tile servers send no CORP header, so the strict `require-corp` mode would likely break the map tiles)

## [0.54.0](https://github.com/EOCOnline/rangertrak/commit/1415a1d05e2eba7dea9cb70a1a8bf7b1a1cb9c00) (2026-08-26)

### Features

* **map:** checking "Saved offline tiles" on the Leaflet map now zooms out to fit the saved-tiles extent, so it doesn't land on an empty view; unchecking it does not reset the view

### Fixes

* **site:** E-44 audit pass - trimmed a stale 8-family Google Fonts request down to the real three (Roboto, Faster One, Material Icons - the last one was never actually loaded despite live ligature-icon usages rendering as unstyled text), fixed a broken meta description tag, removed the dead keyless What3Words script include, added a real `robots.txt`, deleted the fully-dead `IconsComponent`, added a `Cross-Origin-Opener-Policy` header, and fixed `favicon.ico` shipping the stale pre-2022 icon due to a build-glob path mismatch with the E-62 fix

## [0.53.0](https://github.com/EOCOnline/rangertrak/commit/a09d7d876c691a9e5c850f5bf0ad8da9d69502ce) (2026-08-26)

### Features

* **entry:** evidence/clue location - range and bearing from the reporter's own position, hidden by default behind a checkbox, drawn as its own marker on the Entry mini-map

## [0.52.0](https://github.com/EOCOnline/rangertrak/commit/50f547d8687499dd8a75ab7c63ad9bfa8bfc210e) (2026-08-26)

### Features

* **entry:** E-41 phase 1 - every report now records a source type (Voice/Packet/APRS/Email), and can optionally flag itself as also generating an ICS-213 (reply-requested, message, recipients) - data collection only, no export yet

## [0.51.1](https://github.com/EOCOnline/rangertrak/commit/8093b4d138f832ffb6b43efeaaab6ef39755c9cd) (2026-08-26)

### Features

* **rangers:** roster import now warns when entries have no callsign, alongside the existing duplicate/nameless warnings

## [0.51.0](https://github.com/EOCOnline/rangertrak/commit/dd97974d4c8d7962355ee7c158e6cc954a210942) (2026-08-26)

### Features

* **map,rangers:** a report or ranger with no callsign now flags distinctly on the map (a fixed dashed-red "?" marker) and on the Rangers grid, instead of silently blending in

## [0.50.0](https://github.com/EOCOnline/rangertrak/commit/777fadea0cd2bd572e732e2cb5be41e4120c1112) (2026-08-26)

### Features

* **mapLeaflet:** "Saved offline tiles" overlay - a browsable, verifiable view of which map areas are actually cached, not just a running total

## [0.49.2](https://github.com/EOCOnline/rangertrak/commit/06523ef2518b08bb5c6613a6a697f4df6eb0c01c) (2026-08-26)

### Bug Fixes

* **help:** reference-table row labels (e.g. "Google Geocoding API key") no longer read as identical body text on phone width

## [0.49.1](https://github.com/EOCOnline/rangertrak/commit/8d2ab085644484dcb28bb9365ceff13ed81fc7df) (2026-08-26)

### Bug Fixes

* **map:** the MapLibre engine-switch checkbox now renders above each engine's own Instructions section, not below it, on both engines
* **entry:** reverted the status halo on the Entry mini-map's markers - that map is a deliberately minimal position-picker, not a mission overview

## [0.49.0](https://github.com/EOCOnline/rangertrak/commit/2ca40fe3ec7afbf654d6c54c186eb0543f2893d2) (2026-08-26)

### Features

* **map,mapLeaflet,entry:** map markers show a coloured "shadow" halo for the report's status (Normal/Urgent/Need Rest/...), using the same colours configured on the Mission page - both map engines and the Entry mini-map

## [0.48.1](https://github.com/EOCOnline/rangertrak/commit/589f7c5f07372a329d130e8567767ab7becff5a6) (2026-08-26)

### Bug Fixes

* **map,mapLeaflet:** hillshade overlay tiles actually load - wrong Esri service URL (missing the `Elevation/` folder segment) made every tile 404 on both engines

## [0.48.0](https://github.com/EOCOnline/rangertrak/commit/dbc4e03ffca161de1b4e6b0bb4b9f9ecd5990e6c) (2026-08-25)

### Features

* **map,mapLeaflet:** terrain relief (hillshade) overlay with a real visibility toggle on both map engines

## [0.47.1](https://github.com/EOCOnline/rangertrak/commit/5233f4941799ad60b86ae75742c6e7248bf6164d) (2026-08-25)

### Bug Fixes

* **entry:** callsign autocomplete no longer auto-opens covering the whole roster on load or after submit+reset (E-66)

## [0.47.0](https://github.com/EOCOnline/rangertrak/commit/a892a40b3ad37e427d65e35db3c7991e4b5735c9) (2026-08-25)

### Features

* **mission,settings:** Mission page names which specific readiness gap(s) are behind the header's red/amber dot, not just the aggregate colour (E-79)

## [0.46.0](https://github.com/EOCOnline/rangertrak/commit/7307b5b1d945d8e881108f26ad37b281a74a684a) (2026-08-25)

### Features

* **map:** full-screen toggle on the shared map page shell, working for both Leaflet and MapLibre (E-78)

## [0.45.1](https://github.com/EOCOnline/rangertrak/commit/60a77abe20937c7f55a6c193dbe89fb4a92cb6e8) (2026-08-25)

### Bug Fixes

* **map:** MapLibre stays mounted after navigating away from /map and back with it already selected, instead of rendering neither engine (E-77) ([60a77ab](https://github.com/EOCOnline/rangertrak/commit/60a77abe20937c7f55a6c193dbe89fb4a92cb6e8))

## [0.45.0](https://github.com/EOCOnline/rangertrak/commit/ca7fcf941a6218dcbf6b7daecd786686e283bebe) (2026-08-25)

### Features

* **shared,rangers,field-reports,settings,map,help:** remove every collapsible section app-wide - `DisclosureComponent` is now `SectionComponent`, always visible, no click-to-expand ([ca7fcf9](https://github.com/EOCOnline/rangertrak/commit/ca7fcf941a6218dcbf6b7daecd786686e283bebe))
* **navbar,field-reports,settings,entry,mapping:** remove dead controls found by the E-84 audit - navbar's unwired search box, Reports' fake-report generator and dead refresh buttons, Settings' dead refresh button, the What3Words derived row (E-88, E-92 through E-95)
* **settings:** drop the dead `w3wLocale`/`defPlusCode` settings and the unimported `plus-code.ts` file, with a `schemaVersion` 3→4 migration (E-89, E-90, E-91)

## [0.44.1](https://github.com/EOCOnline/rangertrak/commit/6fd77c1953740a5f99584bb450c81c28ec927b6a) (2026-08-25)

### Bug Fixes

* **mapLeaflet,mapping:** route trails now match their ranger's marker colour (E-97), offline "Save this area" control restyled off Leaflet's own white-card chrome (E-98), overview mini-map no longer overlaps the footer (E-99) ([6fd77c1](https://github.com/EOCOnline/rangertrak/commit/6fd77c1953740a5f99584bb450c81c28ec927b6a))

## [0.44.0](https://github.com/EOCOnline/rangertrak/commit/204720e0efaa2f6d8a3279290b961bf76f79562d) (2026-08-25)

### Features

* **help,shared,field-reports,rangers:** E-84 - Help page tabs, on-page text fixes, deduplicated grid-keyboard-help component, FIELD-GUIDE.md and README.md rewrite per the documentation audit ([204720e](https://github.com/EOCOnline/rangertrak/commit/204720e0efaa2f6d8a3279290b961bf76f79562d))

### Bug Fixes

* **mapping,mapLeaflet,map,entry:** map marker tooltips show short local time + "N min ago", not the raw `Date` object ([204720e](https://github.com/EOCOnline/rangertrak/commit/204720e0efaa2f6d8a3279290b961bf76f79562d))

## [0.43.1](https://github.com/EOCOnline/rangertrak/commit/4c8d3dbe1be66bd9de2852626dc20dfd070a0467) (2026-08-24)

### Bug Fixes

* **mapLeaflet,mapping:** sequential-name hash collision, offline controls out of the map, minor UI polish ([4c8d3db](https://github.com/EOCOnline/rangertrak/commit/4c8d3dbe1be66bd9de2852626dc20dfd070a0467))

## [0.43.0](https://github.com/EOCOnline/rangertrak/commit/db9f3dd76ede29c6a8152550fc4d1a1f1440877d) (2026-08-24)

### Features

* **entry,header,services,e2e:** E-83 - reopenable Entry welcome panel ([db9f3dd](https://github.com/EOCOnline/rangertrak/commit/db9f3dd76ede29c6a8152550fc4d1a1f1440877d))

## [0.42.0](https://github.com/EOCOnline/rangertrak/commit/64363d446e33dbf75c1cbbdfd52ec0cc79bf5c2f) (2026-08-24)

### Features

* **mapLeaflet,e2e:** E-80 follow-on - static elapsed-time label on route trails ([64363d4](https://github.com/EOCOnline/rangertrak/commit/64363d446e33dbf75c1cbbdfd52ec0cc79bf5c2f))

## [0.41.0](https://github.com/EOCOnline/rangertrak/commit/be7f75a8db47fc967d6c5003535b5f6d549fb809) (2026-08-24)

### Features

* **mapping,mapLeaflet,e2e:** E-86 - unique per-ranger map markers ([be7f75a](https://github.com/EOCOnline/rangertrak/commit/be7f75a8db47fc967d6c5003535b5f6d549fb809))

## [0.40.0](https://github.com/EOCOnline/rangertrak/commit/b57f47eabd865401e5590402ed8450a444e6368b) (2026-08-24)

### Features

* **mapLeaflet,e2e:** E-85 phase 2 - wire in OpenTopoMap as first alternate base layer ([b57f47e](https://github.com/EOCOnline/rangertrak/commit/b57f47eabd865401e5590402ed8450a444e6368b))

## [0.39.0](https://github.com/EOCOnline/rangertrak/commit/eb4f84e0e43cf6c1bd1cad58cf06f594c536ab1c) (2026-08-24)

### Features

* **mapLeaflet,e2e:** E-85 phase 1 - Leaflet base-layer switcher infrastructure ([eb4f84e](https://github.com/EOCOnline/rangertrak/commit/eb4f84e0e43cf6c1bd1cad58cf06f594c536ab1c))

## [0.38.0](https://github.com/EOCOnline/rangertrak/commit/2c074ce1f2fe310edd33ba2cd73311c750933e03) (2026-08-24)

### Features

* **mapLeaflet,e2e:** E-80 phase 1 - static per-callsign team route trails ([2c074ce](https://github.com/EOCOnline/rangertrak/commit/2c074ce1f2fe310edd33ba2cd73311c750933e03))

## [0.37.0](https://github.com/EOCOnline/rangertrak/commit/ef5817fc7a9e82837472116964767dc9035a2bac) (2026-08-21)

### Bug Fixes

* **entry:** standard coordinate toggle, sized MGRS/UTM fields ([ef5817f](https://github.com/EOCOnline/rangertrak/commit/ef5817fc7a9e82837472116964767dc9035a2bac))
* **entry,install-update,routes,e2e:** phone-width panel overflow, dead /about redirect, stale AG Grid v36 e2e selectors ([d51fd7d](https://github.com/EOCOnline/rangertrak/commit/d51fd7df1fac330502c3d45cd59a0fbd53ec7e83))

_Also landed under this version, not separately bumped: `mapL` → `mapLeaflet` rename ([958ec38](https://github.com/EOCOnline/rangertrak/commit/958ec3896073d1eb613ee8bf0315c6405f904409)), About → Help component rename ([47983c4](https://github.com/EOCOnline/rangertrak/commit/47983c4902746718314c064041800787758deac1))._

## [0.36.0](https://github.com/EOCOnline/rangertrak/commit/94d868a76cc8b0f5959270e7d5e18957afae186b) (2026-08-21)

### Features

* **install-update:** hover panel explains what install/update involves ([94d868a](https://github.com/EOCOnline/rangertrak/commit/94d868a76cc8b0f5959270e7d5e18957afae186b))

## [0.35.0](https://github.com/EOCOnline/rangertrak/commit/a1f988ce63677a710a12daf43231e630dbdedcde) (2026-08-21)

### Features

* **routes,nav,grid,toggle:** URLs match nav labels, AG-Grid help moved ([a1f988c](https://github.com/EOCOnline/rangertrak/commit/a1f988ce63677a710a12daf43231e630dbdedcde))

## [0.34.0](https://github.com/EOCOnline/rangertrak/commit/af17493eac293e349c29453ff6384d7064654bb4) (2026-08-21)

### Features

* **time-picker,footer,settings:** segmented hour/min/AM-PM entry ([af17493](https://github.com/EOCOnline/rangertrak/commit/af17493eac293e349c29453ff6384d7064654bb4))

## [0.33.0](https://github.com/EOCOnline/rangertrak/commit/8b06661c845578684f43a1495663f9482eec411c) (2026-08-21)

### Bug Fixes

* **navbar,entry,settings,footer:** live-review fixes round 2 ([8b06661](https://github.com/EOCOnline/rangertrak/commit/8b06661c845578684f43a1495663f9482eec411c))

## [0.32.0](https://github.com/EOCOnline/rangertrak/commit/319a09c13ac94f2865c1546760081d93cf2afd5f) (2026-08-21)

A larger batch than most releases here - a toolchain bump (ag-grid v35→v36, Angular
22.1.3) and its fallout, plus a session of live-review fixes across Entry/Settings/footer.

### Features

* **nav,entry,settings:** theme switcher, header/Where/When live-review fixes ([319a09c](https://github.com/EOCOnline/rangertrak/commit/319a09c13ac94f2865c1546760081d93cf2afd5f))
* **lmap:** show offline saved-area size and a live estimate ([b9a111c](https://github.com/EOCOnline/rangertrak/commit/b9a111c7759687125dab2738c6f2441aa44fb04b))
* **cla:** draft E-23 CLA and gating workflow (ADR D-01) ([d7295de](https://github.com/EOCOnline/rangertrak/commit/d7295de9b9a7a7bfc052f01490c5b05ba71d6fb0))

### Bug Fixes

* **entry:** Where-section cleanup from live review ([f5a0e45](https://github.com/EOCOnline/rangertrak/commit/f5a0e45a7994c9d2ae8e24830d56dc26424ef1ce))
* **deps:** install xlsx from SheetJS's own CDN, clearing its 2 CVEs ([c126d3f](https://github.com/EOCOnline/rangertrak/commit/c126d3f15e8a803ea9184e52bad0b967a2d4cd2b))
* **entry,footer:** Entry-screen spacing/sizing pass from live screenshots ([32c64b1](https://github.com/EOCOnline/rangertrak/commit/32c64b1cd6cfc7d8c309f885b857e34f76baba1d))
* **deps:** remove unused xlsx-style ([0ad65f3](https://github.com/EOCOnline/rangertrak/commit/0ad65f3f2de3b241454c07ad4dd7e2b70b84371c))
* **deps:** remove unused jshint ([cbe33f3](https://github.com/EOCOnline/rangertrak/commit/cbe33f3a6eb040ba9d644c0bca1db066e28becf8))
* **deps:** remove unused mock-browser, clearing both critical CVEs ([e1624fb](https://github.com/EOCOnline/rangertrak/commit/e1624fbf9e7a3bc6812444d9634bfce55865466a))
* **test:** pin jasmine-core back to 5.13, undoing the v7 bump ([eee5936](https://github.com/EOCOnline/rangertrak/commit/eee59361ef83ab0a5a65e7fc7e83a9e012d11605))

_Also landed under this version: `chore(deps)` toolchain bump - ag-grid v36, Angular
22.1.3, wrangler 4.125 ([cacfeb3](https://github.com/EOCOnline/rangertrak/commit/cacfeb36a9efdd1d4b81a857781cd7f64de40d3a)), the commit several of this version's own fixes exist to clean up after._

## [0.31.0](https://github.com/EOCOnline/rangertrak/compare/v0.30.0...v0.31.0) (2026-08-21)


### Features

* **feedback:** in-app feedback endpoint, files public GitHub issues (ADR D-15) ([be2ad5a](https://github.com/EOCOnline/rangertrak/commit/be2ad5a1d6ca8134cee73d6e9ddc680545f16abb))

## [0.30.0](https://github.com/EOCOnline/rangertrak/compare/v0.29.0...v0.30.0) (2026-08-21)


### Features

* **settings:** E-73 - gate Field Report status renaming instead of just warning ([5be7551](https://github.com/EOCOnline/rangertrak/commit/5be75519b8e402b5a17a731424dfc7b26f85add0))


### Bug Fixes

* **entry:** compact the mini-map's header/footer text at tablet-down widths ([92b9ba3](https://github.com/EOCOnline/rangertrak/commit/92b9ba35df23c9ec9786d6b46cd25beea4ab8d09))
* **settings:** E-71 - clamp Operational Period end to start ([b85cdd6](https://github.com/EOCOnline/rangertrak/commit/b85cdd602d216f1a0284e8a149a312637a1d33d2))

## [0.29.0](https://github.com/EOCOnline/rangertrak/compare/v0.28.0...v0.29.0) (2026-08-21)


### Features

* **entry:** mini-map reflows under Where and shrinks to 30% at tablet-down widths ([7812087](https://github.com/EOCOnline/rangertrak/commit/78120878abd510bc1466985647ec1fe8dc907f2c))


### Bug Fixes

* **entry,header:** close mini-map float-intrusion gap; fix oversized status pill; link readiness dot to Settings ([7c995d0](https://github.com/EOCOnline/rangertrak/commit/7c995d05bca7a48881456ba1bdb7fc2ed8cb8b49))

## [0.28.0](https://github.com/EOCOnline/rangertrak/compare/v0.27.0...v0.28.0) (2026-08-21)


### Bug Fixes

* **settings:** unify the date/time picker widget; single update notice; restore footer font ([0080649](https://github.com/EOCOnline/rangertrak/commit/00806490e73f038f2cd027ed73d041f590770555))

## [0.27.0](https://github.com/EOCOnline/rangertrak/compare/v0.26.0...v0.27.0) (2026-08-20)


### Features

* **header:** group the mission status readout into one cluster ([d342aed](https://github.com/EOCOnline/rangertrak/commit/d342aedbe10256c0af6c2b256de76af36916bc92))

## [0.26.0](https://github.com/EOCOnline/rangertrak/compare/v0.25.0...v0.26.0) (2026-08-20)


### Features

* **navbar:** brand mark replaces Home; E-62 cheap-tier icon fixes ([22b77dd](https://github.com/EOCOnline/rangertrak/commit/22b77dd7ff6d2be8f2b997574a8e2eff516be77a))

## [0.25.0](https://github.com/EOCOnline/rangertrak/compare/v0.24.0...v0.25.0) (2026-08-20)


### Bug Fixes

* **readiness:** stop crashing getStorageLength() on every page view ([23ab061](https://github.com/EOCOnline/rangertrak/commit/23ab061598271f008b64ac1991290fdc1efe966d))

## [0.24.0](https://github.com/EOCOnline/rangertrak/compare/v0.23.0...v0.24.0) (2026-08-20)


### Features

* **nav:** rename About to Help, move Log off the main menu ([b83582f](https://github.com/EOCOnline/rangertrak/commit/b83582ffff0bf81efd2b04e0d31e2e4781437918))

## [0.23.0](https://github.com/EOCOnline/rangertrak/compare/v0.22.0...v0.23.0) (2026-08-20)


### Features

* **install-update:** simplify to a v0.12-era pill, move to a footer chip ([c338bfb](https://github.com/EOCOnline/rangertrak/commit/c338bfbe3d49d38fa470ca78890dbf3173f06314))

## [0.22.0](https://github.com/EOCOnline/rangertrak/compare/v0.21.0...v0.22.0) (2026-08-20)


### Features

* **header:** add the mission readiness indicator ([891d51a](https://github.com/EOCOnline/rangertrak/commit/891d51ac2a632f4bf9411fefccd70f11f876c889))

## [0.21.0](https://github.com/EOCOnline/rangertrak/compare/v0.20.0...v0.21.0) (2026-08-20)

## [0.20.0](https://github.com/EOCOnline/rangertrak/compare/v0.19.0...v0.20.0) (2026-08-20)


### Features

* **map:** collapse Map/Backup map into one page with an engine switch ([482ad62](https://github.com/EOCOnline/rangertrak/commit/482ad62d4bd023b0d8f9a0d46e2b3c60b380ac1b))

## [0.19.0](https://github.com/EOCOnline/rangertrak/compare/v0.18.0...v0.19.0) (2026-08-20)


### Bug Fixes

* **maps:** purge Google Maps leftovers, rename settings.google to maplibre ([e389ddf](https://github.com/EOCOnline/rangertrak/commit/e389ddf4e250ecf8c46576e700e44b1f35cb163a))

## [0.18.0](https://github.com/EOCOnline/rangertrak/compare/v0.17.0...v0.18.0) (2026-08-20)


### Bug Fixes

* **entry:** stop section-header rules from running under the mini-map ([fc07f98](https://github.com/EOCOnline/rangertrak/commit/fc07f980cea8d2751da7d9ddb70d96af526dc913))

## [0.17.0](https://github.com/EOCOnline/rangertrak/compare/v0.16.9...v0.17.0) (2026-08-20)


### Bug Fixes

* **navbar:** route brand link internally instead of opening stale www origin ([a507970](https://github.com/EOCOnline/rangertrak/commit/a507970b3686c20c2d22619f56cc4055de422ea5))

### [0.16.9](https://github.com/EOCOnline/rangertrak/compare/v0.16.8...v0.16.9) (2026-08-20)


### Bug Fixes

* **about:** restore Menu Keyboard interaction section, mislabeled AG Grid ([185fa46](https://github.com/EOCOnline/rangertrak/commit/185fa463963b0749b45619832445c20dcabfcc2a))

### [0.16.8](https://github.com/EOCOnline/rangertrak/compare/v0.16.7...v0.16.8) (2026-08-20)


### Bug Fixes

* **settings:** backfill missing fields on every load, not just a version bump ([6ae1d9c](https://github.com/EOCOnline/rangertrak/commit/6ae1d9c35c9c6e00dc97f244af65444b3dddddf0))

### [0.16.7](https://github.com/EOCOnline/rangertrak/compare/v0.16.6...v0.16.7) (2026-08-20)


### Bug Fixes

* **e44:** stop declaring a Strict-Transport-Security header nobody reads ([f9ab27f](https://github.com/EOCOnline/rangertrak/commit/f9ab27f41f82cb4d8e16fabe851f5499fdd5f888))

### [0.16.6](https://github.com/EOCOnline/rangertrak/compare/v0.16.5...v0.16.6) (2026-08-20)


### Features

* **e44:** security headers - HSTS/nosniff/frame-deny/referrer-policy enforcing, CSP report-only ([da0dd48](https://github.com/EOCOnline/rangertrak/commit/da0dd48aaf7800d58aa73255568ec6140a2454f8))

### [0.16.5](https://github.com/EOCOnline/rangertrak/compare/v0.16.4...v0.16.5) (2026-08-20)


### Features

* **e45:** nudge visitors stranded on the old www. origin toward the canonical host ([7cd9562](https://github.com/EOCOnline/rangertrak/commit/7cd95627b174cc41b0dbabf208cc9bc80b04596c))

### [0.16.4](https://github.com/EOCOnline/rangertrak/compare/v0.16.3...v0.16.4) (2026-08-20)


### Bug Fixes

* **e43:** update-ready notice now stays visible regardless of scroll position ([bdee1e3](https://github.com/EOCOnline/rangertrak/commit/bdee1e3a5cfeca8d10165f9116b8e23631b80208))

### [0.16.3](https://github.com/EOCOnline/rangertrak/compare/v0.16.2...v0.16.3) (2026-08-20)


### Bug Fixes

* **e67:** mini-map now fills its box - it had been rendering at ~36% width, at every size ([a6e50c6](https://github.com/EOCOnline/rangertrak/commit/a6e50c64eeba9a9eb2394c69842478fc25ffc45a))

### [0.16.2](https://github.com/EOCOnline/rangertrak/compare/v0.16.1...v0.16.2) (2026-08-20)


### Features

* **e57:** floating back-to-top control on tall pages ([6fe078b](https://github.com/EOCOnline/rangertrak/commit/6fe078b5a8bea7ae1e8df63156b01dc930eb40e4))


### Bug Fixes

* **e48:** derived values actually clear on submit; harden a flaky file-input lookup ([79689c7](https://github.com/EOCOnline/rangertrak/commit/79689c794754a504327a773bca56160945d03e13))
* **e65:** every route now fits a phone, and the e2e check can finally see when one doesn't ([ff1622c](https://github.com/EOCOnline/rangertrak/commit/ff1622ca2d5fab2f440d845503e029dcb63b20a2))

### [0.16.1](https://github.com/EOCOnline/rangertrak/compare/v0.16.0...v0.16.1) (2026-08-20)


### Features

* **sprint-i:** app chrome polish - phase 4, sprint complete (E-53, E-54, E-55, E-42) ([5396b02](https://github.com/EOCOnline/rangertrak/commit/5396b020d7bd4db305814e5449446ed2209b2d2e)), closes [#0B5FA8](https://github.com/EOCOnline/rangertrak/issues/0B5FA8) [#1976d2](https://github.com/EOCOnline/rangertrak/issues/1976d2)

## [0.16.0](https://github.com/EOCOnline/rangertrak/compare/v0.15.14...v0.16.0) (2026-08-20)


### Features

* **sprint-i:** entry screen polish - phases 1-3 (E-46, E-61, E-47, E-52, E-48, E-49, E-50, E-51) ([0795cef](https://github.com/EOCOnline/rangertrak/commit/0795cef0037d459f8f06590d3bc966d68317273a))

### [0.15.14](https://github.com/EOCOnline/rangertrak/compare/v0.15.13...v0.15.14) (2026-08-19)


### Features

* **sprint-h:** add MGRS, UTM, and Maidenhead coordinate systems ([762b417](https://github.com/EOCOnline/rangertrak/commit/762b417739c962b2358a6e8cd76acb7efdcda949))

### [0.15.13](https://github.com/EOCOnline/rangertrak/compare/v0.15.12...v0.15.13) (2026-08-19)


### Features

* **sprint-g:** convert remaining callback-mutated fields to signals ([5f7a496](https://github.com/EOCOnline/rangertrak/commit/5f7a496742b62fdbbec7e9acdbc31406bb2a9bb0))

### [0.15.12](https://github.com/EOCOnline/rangertrak/compare/v0.15.11...v0.15.12) (2026-08-19)


### Features

* **sprint-f:** re-theme AG Grid onto the v35 Theming API, phone card carve-out for Field Reports ([972b48d](https://github.com/EOCOnline/rangertrak/commit/972b48de010a8c44656a533ce19d88b9c2a84a37))

### [0.15.11](https://github.com/EOCOnline/rangertrak/compare/v0.15.10...v0.15.11) (2026-08-19)


### Features

* **sprint-e:** accessibility sweep, evidence-based via Lighthouse (step 6) ([72378b2](https://github.com/EOCOnline/rangertrak/commit/72378b259867f26c7188a3372aecd0e253b31023)), closes [#e1e8](https://github.com/EOCOnline/rangertrak/issues/e1e8)

### [0.15.10](https://github.com/EOCOnline/rangertrak/compare/v0.15.9...v0.15.10) (2026-08-19)


### Features

* **sprint-e:** restore min/max/pattern as Signal Forms schema validators (step 5) ([4faa7f6](https://github.com/EOCOnline/rangertrak/commit/4faa7f6355c666fcd79bd6a9412972fb8a1bcb60))

### [0.15.9](https://github.com/EOCOnline/rangertrak/compare/v0.15.8...v0.15.9) (2026-08-19)


### Features

* **settings:** migrate status colours to accessible semantic keys ([1aaa8ec](https://github.com/EOCOnline/rangertrak/commit/1aaa8ec3fac513a163030432a93e3f6f3bf4be1a))


### Bug Fixes

* **entry:** callsign was never actually saved to the report (BUG-1) ([fb1cdb3](https://github.com/EOCOnline/rangertrak/commit/fb1cdb3d4bf0d688b7491407eda8d7ba15255328))
* **entry:** guard the derived-location DOM writes against a destroyed view ([a84fa4a](https://github.com/EOCOnline/rangertrak/commit/a84fa4a485c19a75aa280e35307e2ee7001ee370))
* **services:** five components ran their own private singleton (BUG-2) ([3964a4d](https://github.com/EOCOnline/rangertrak/commit/3964a4d958fdb215731388200bb2724655a456d2))
* **settings:** backfill fields added after a settings object was saved (BUG-3) ([4e30ff5](https://github.com/EOCOnline/rangertrak/commit/4e30ff59ad44de5bc48249d45e77e1cc29854452))

### [0.15.8](https://github.com/EOCOnline/rangertrak/compare/v0.15.7...v0.15.8) (2026-08-19)


### Features

* **sprint-d:** convert Entry to Angular Signal Forms ([2a25bf5](https://github.com/EOCOnline/rangertrak/commit/2a25bf528742ef944d3a478060cf7be5ca5f523b)), closes [angular/components#32072](https://github.com/angular/components/issues/32072)
* **sprint-d:** convert Location to Angular Signal Forms ([60d6008](https://github.com/EOCOnline/rangertrak/commit/60d6008a2ece80df16cf62bd4a19d78518daf2c4))
* **sprint-d:** convert Settings to Angular Signal Forms ([a65bb95](https://github.com/EOCOnline/rangertrak/commit/a65bb95aec41ddf5c10d61bbd2fe35c20572cd65))
* **sprint-d:** convert Time-picker to Angular Signal Forms ([9dcff2e](https://github.com/EOCOnline/rangertrak/commit/9dcff2ec675819deba63d006897fd4408c1c3bf4))


### Bug Fixes

* **sprint-d:** remove min/max/pattern attributes NG8022 disallows on [formField] ([dd9c98e](https://github.com/EOCOnline/rangertrak/commit/dd9c98ea6cbaeb5420865f64723cfcb0a9daf35d))

### [0.15.7](https://github.com/EOCOnline/rangertrak/compare/v0.15.6...v0.15.7) (2026-08-17)


### Features

* **settings:** break settings.component into sections (Sprint C) ([0a66e49](https://github.com/EOCOnline/rangertrak/commit/0a66e49cba64f87b2b20ddfad0dfde425842a455))

### [0.15.6](https://github.com/EOCOnline/rangertrak/compare/v0.15.5...v0.15.6) (2026-08-15)


### Features

* **rangers:** one-step bundle import, and make the Install buttons real ([d801433](https://github.com/EOCOnline/rangertrak/commit/d801433d02adb5da4e693ceda037aa59e1cb802f))

### [0.15.5](https://github.com/EOCOnline/rangertrak/compare/v0.15.4...v0.15.5) (2026-08-15)


### Features

* **rangers:** ranger photos, stored on the device and never in the repo ([16e6e71](https://github.com/EOCOnline/rangertrak/commit/16e6e710b07cd1537b3a7409726d4f68ffe87eb4))

### [0.15.4](https://github.com/EOCOnline/rangertrak/compare/v0.15.3...v0.15.4) (2026-08-15)


### Bug Fixes

* **rangers:** say what deleting the roster actually does ([42b5b76](https://github.com/EOCOnline/rangertrak/commit/42b5b765f42696e1faa8df141c6dc37a499a22ac))

### [0.15.3](https://github.com/EOCOnline/rangertrak/compare/v0.15.2...v0.15.3) (2026-08-15)


### Features

* **rangers:** import and export a roster on its own, and make deletion stick ([5e60248](https://github.com/EOCOnline/rangertrak/commit/5e60248d53f422087ba801b77095b542bd83ea2e))

### [0.15.2](https://github.com/EOCOnline/rangertrak/compare/v0.15.1...v0.15.2) (2026-08-15)


### Features

* **nav:** D-31 - rename the two map pages "Map" and "Backup map" ([cd87078](https://github.com/EOCOnline/rangertrak/commit/cd87078c57d1bea70a34fcdc7624ef34cf5f5068))


### Bug Fixes

* **settings:** the Save button kept the electric yellow Entry's Submit lost ([64f58e9](https://github.com/EOCOnline/rangertrak/commit/64f58e9818484e76ec5e80a126eff6efc3e20ed1)), closes [#teamgrid1](https://github.com/EOCOnline/rangertrak/issues/teamgrid1)

### [0.15.1](https://github.com/EOCOnline/rangertrak/compare/v0.15.0...v0.15.1) (2026-08-15)


### Features

* **rangers:** make the confidentiality notice a dismissable bar ([7d9c521](https://github.com/EOCOnline/rangertrak/commit/7d9c521a7982d61b71e8201890d198ad7be6bdf7)), closes [#d9a300](https://github.com/EOCOnline/rangertrak/issues/d9a300) [#fff8e1](https://github.com/EOCOnline/rangertrak/issues/fff8e1) [#8a6100](https://github.com/EOCOnline/rangertrak/issues/8a6100)


### Bug Fixes

* **ui:** six hardcoded colours and layouts that Sprint A missed ([d5ba589](https://github.com/EOCOnline/rangertrak/commit/d5ba58998ad2cc4066a52571b8f91c2047f97b08)), closes [#7d1f02](https://github.com/EOCOnline/rangertrak/issues/7d1f02)

## [0.15.0](https://github.com/EOCOnline/rangertrak/compare/v0.14.1...v0.15.0) (2026-08-15)


### Features

* **theme:** a real token layer and M3 theme - Sprint A ([9b36722](https://github.com/EOCOnline/rangertrak/commit/9b367226b26a2d54ea13138fe66b96f8b6f8a0f1)), closes [#0d60a9](https://github.com/EOCOnline/rangertrak/issues/0d60a9) [#a53c19](https://github.com/EOCOnline/rangertrak/issues/a53c19) [#962f10](https://github.com/EOCOnline/rangertrak/issues/962f10)


### Bug Fixes

* **hosting:** stop re-attaching www to the Worker, which broke its redirect ([44a1e5e](https://github.com/EOCOnline/rangertrak/commit/44a1e5e0e2af239cb87e6d6abad2c98a3058d228))
* **maps:** three components shared id="map", so Leaflet drew into the wrong one ([927e0ec](https://github.com/EOCOnline/rangertrak/commit/927e0ecdbc475da6cb73ca1bac8e4fbc78934436))
* **ui:** the A2HS button says "Add to Home Scree" ([d643d28](https://github.com/EOCOnline/rangertrak/commit/d643d286c06f18af82e17a99168cf0363b3e2300))

### [0.14.1](https://github.com/EOCOnline/rangertrak/compare/v0.14.0...v0.14.1) (2026-08-15)


### Bug Fixes

* **privacy:** remove real roster data and a key-shaped string from tracked source ([17bfc95](https://github.com/EOCOnline/rangertrak/commit/17bfc951ba7c39931b572fd4c4bdaeb95d92228e))
* **state:** stop snapshotting settings that later change ([b3803f5](https://github.com/EOCOnline/rangertrak/commit/b3803f5105271ea1eec74c8efbdb46bcd77e64fb))

## [0.14.0](https://github.com/EOCOnline/rangertrak/compare/v0.13.0...v0.14.0) (2026-08-15)

A hosting and defect-clearing release, and the first one actually deployed by CI to
<https://rangertrak.org>. Nothing here is new functionality — it is the known problems
cleared out before the interface work starts.

### Fixed — things that had never worked

- **New versions were never installed.** An installed copy kept serving the build it had
  cached, so browsers still ran 0.12.0 after 0.13.0 shipped. The app detected the new
  version and did nothing with it. It now tells you a version is ready, installs it when
  you accept, and never reloads the page out from under you mid-report. The footer shows
  a standing "new version ready" button and when it last checked.
- **The "Add to Home Screen" button could never appear.** Its event handler was wired to
  the wrong class member, so it threw on every load instead of running.
- **The Leaflet map opens zoomed to your reports.** The map extent was stored in a form
  that did not survive being saved, so zoom-to-fit had been switched off and markers
  opened off-screen.
- **The "show only selected reports" switch works**, and no longer carries a `[Broken:]`
  label. The switch and the map had disagreed about its state, and the code that would
  have redrawn the markers was unimplemented.
- **Corrections typed into the Reports grid are saved**, automatically. The grid was
  editable but a "Save Reports" button alerted "UNIMPLEMENTED" and every edit was lost on
  reload. Editing a latitude or longitude now moves the report; invalid values are
  refused rather than stored.
- **The Leaflet map no longer opens blank** when reached from another page.
- **The Entry page no longer logs errors on every load.**
- **Report counts** no longer drift.

### Fixed — hosting

- **The offline map renders again.** The new host does not support HTTP byte serving, and
  the map data is read in byte ranges; a small Worker now serves that one file properly.
- **Cache headers** keep the service-worker control files from being served stale, which
  is what silently pinned users to old builds.

### Security and privacy

- **API keys are no longer bundled.** Five inlined credentials (Google Maps, Firebase,
  two Mapbox tokens, AgmCore) were being published inside the application JavaScript on
  every deploy. A pre-deploy scan now fails the build if any reappear.
- **A roster of 286 real people** — names, phone numbers and street addresses — was being
  compiled into the shipped JavaScript and published to anyone who loaded the site. It is
  gone. Rosters come from Import Mission.

### Internal

- The project can be built from a clean clone for the first time: two imports of
  gitignored files meant it never could, which is why CI had never run.
- Deploys run from `main` via GitHub Actions, gated on typecheck, the full test suite,
  and the secret scan.
- Test suite: 80 specs, all passing (was 73 of 78).
- Initial download 1.96 MB → 1.73 MB.

### Known issues

- **The navbar and page layouts are unpolished** — the interface pass is the next work.
- **`rangertrak.com` does not yet redirect** to `.org`.
- Offline operation after the first visit is not yet confirmed on the live site, though
  the update mechanism proves the app is being cached.

## [0.13.0](https://github.com/EOCOnline/rangertrak/compare/v0.12.0...v0.13.0) (2026-08-14)

A repair-and-harden release. Several core screens had stopped working; all are
functional again, and verified in a real browser rather than only by a passing build.

### Fixed — screens that were not working

- **Rangers and Field Reports grids showed nothing at all.** AG Grid v33+ requires its
  feature modules to be registered before a grid is created; without that each grid
  rendered an empty shell. Both listings work again.
- **The offline map (MapLibre + PMTiles) rendered a blank grey panel.** Its worker was
  never shipped, so the basemap *and* every report marker silently failed to draw.
- **The Field Reports page threw on load**, taking the whole page down, from a Material
  slider binding that has been invalid since Material v15.
- **The Settings page crashed** whenever stored settings were reloaded, because dates
  round-trip through storage as text.
- **The Field Reports Address column was blank for every report** — bound to the wrong
  field while the addresses were present in the data.
- **"Save Log File" did nothing** beyond logging "UNIMPLEMENTED".

### Added

- **Sample mission** — a demonstration roster and about thirty field reports across
  recognizable locations, loadable in one click for demos, training, and seeing how a
  screen looks with realistic data.
- **Crash reporting into the Log page.** Uncaught exceptions and rejected promises now
  appear in the log, where a field user can actually see them and export them. Previously
  the log only contained what the code chose to log.
- **Log export** as CSV, with proper quoting.
- **Confidentiality warnings** on the Rangers page and before any export of roster or log
  data.
- **A loading placeholder** for the Entry page mini-map.

### Security

- **Fixed an injection flaw on the Log page.** Log messages — which include free-text
  ranger notes and serialized field reports — were written into the page as raw HTML, so
  content typed from radio traffic could execute. All entries are now escaped.
- The in-app About page stated the wrong software licence.

### Performance

- **Initial download cut from 4.95 MB to 1.96 MB** (999 kB to 355 kB transferred) by
  loading each screen only when opened. The first screen now paints without waiting for
  the grid, spreadsheet, and mapping libraries.
- **Log rendering no longer degrades over a long mission** — it previously rebuilt every
  entry each time a new one arrived.
- The in-memory log is now bounded rather than growing for the life of the session.

### Documentation

- New **[Field Guide](FIELD-GUIDE.md)** for operators: what each screen does, and how to
  prepare a device so it works when the network doesn't — including the step people
  forget, which is opening the offline map once while connected.
- New **[Developing guide](DEVELOPING.md)**; **[Architecture](ARCHITECTURE.md)** now
  covers the two map engines, geocoding, and a plan for encryption at rest.
- The README is now a short front door rather than a catch-all, and no longer promises
  features that do not exist.

## [0.12.0](https://github.com/EOCOnline/rangertrak/compare/v0.11.40...v0.12.0) (2026-08-14)

### [0.11.45](https://github.com/EOCOnline/RangerTrak/compare/v0.11.44...v0.11.45) (2024-02-26)

### [0.11.44](https://github.com/EOCOnline/RangerTrak/compare/v0.11.40...v0.11.44) (2022-11-25)

- Basic functinoality but Field Report Selection not yet working.

### [0.11.41](https://github.com/EOCOnline/RangerTrak/compare/v0.11.40...v0.11.41) (2022-10-22)

### [0.11.40](https://github.com/EOCOnline/RangerTrak/compare/v0.11.38...v0.11.40) (2022-09-24)

- See EXTENSIVE rlease notes at: <https://github.com/EOCOnline/rangertrak/releases/tag/v0.11.40>

### [0.11.38](https://github.com/EOCOnline/RangerTrak/compare/v0.11.37...v0.11.38) (2022-02-12)

### 0.11.37 (2022-02-11)

- Typescript version at time we started version control.

### 0.11.36 (2022-02-6)

- Initial stable 4.2 Javascript Version, released Sep 9, 2020, first used at an ACS/CERT exercise
