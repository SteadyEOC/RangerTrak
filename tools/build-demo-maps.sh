#!/usr/bin/env bash
# Rebuilds the Alternative map's bundled PMTiles files (E-124 split, 2026-09-26):
#
#   world-z5-<build>.pmtiles           z0-5 world background. Downloaded by every device that
#                                      opens the Alternative map, and only by those.
#   demo-<scenario>-<build>.pmtiles    z6-15 street detail for one demo scenario. Downloaded
#                                      only while that demo is the loaded mission AND the
#                                      Alternative map is open - never for a real mission.
#
# The build date is in every filename on purpose: Cache Storage keys on the URL, so a file
# replaced under the same name would keep being served from every device that already warmed
# it (see src/app/shared/mapping/pmtiles-config.ts). After running this, update the URLs in
# pmtiles-config.ts to the new <build> and delete the old files.
#
# Needs the pmtiles CLI: `go install github.com/protomaps/go-pmtiles@latest`
# (the binary installs as go-pmtiles; set PMTILES=/path/to/it if it isn't `pmtiles` on PATH).
#
# Usage: tools/build-demo-maps.sh [YYYYMMDD]   (default: today's Protomaps build)
set -euo pipefail

BUILD="${1:-$(date -u +%Y%m%d)}"
SRC="https://build.protomaps.com/${BUILD}.pmtiles"
OUT="$(dirname "$0")/../src/assets/maps"
PMTILES="${PMTILES:-pmtiles}"

# Demo areas, west,south,east,north. Keep each box tight: every extra square km at z15 is
# downloaded by everyone who opens that demo's map.
declare -A DEMOS=(
  [grand-canyon]="-112.20,36.03,-112.07,36.12"  # Bright Angel Trail to Plateau Point, Hopi to Mather Point
  [vashon]="-122.53,47.32,-122.40,47.51"         # Vashon and Maury islands
  [state-fair]="-122.32,47.17,-122.27,47.20"     # Washington State Fair grounds, Puyallup
)

"$PMTILES" extract "$SRC" "$OUT/world-z5-${BUILD}.pmtiles" --maxzoom=5
"$PMTILES" verify "$OUT/world-z5-${BUILD}.pmtiles"

for id in "${!DEMOS[@]}"; do
  "$PMTILES" extract "$SRC" "$OUT/demo-${id}-${BUILD}.pmtiles" --bbox="${DEMOS[$id]}" --minzoom=6 --maxzoom=15
  "$PMTILES" verify "$OUT/demo-${id}-${BUILD}.pmtiles"
done

ls -l "$OUT"
