// Post-build gate: fail if a map library is back in the eager (initial) bundle.
//
// E-265 follow-up (2026-11-02): Leaflet 2 is native ESM, so it can stay in the lazy map
// chunks, but only while no eager code imports a Leaflet-importing module. The `shared`
// barrels re-exported AbstractMap and the Leaflet icon helpers, and that alone kept ~140 KB
// of Leaflet in main.js. MapLibre has the same trap (see the note in shared/mapping/index.ts).
// Nothing else notices when it comes back: the build stays green and only load speed drops.
//
// "Initial" here = main-*.js plus every chunk it reaches through static imports. Dynamic
// import("./chunk-...") targets are lazy and are not followed.
const fs = require('fs');
const path = require('path');

// CHECK_DIST overrides the folder, for proving the check fails on a doctored copy.
const DIST = process.env.CHECK_DIST || path.join(__dirname, '..', 'dist', 'rangertrak', 'browser');

// A string each library's own code carries and our eager code never does.
const LIBRARIES = [
  { name: 'Leaflet', marker: 'leaflet-container' },
  { name: 'MapLibre', marker: 'maplibregl-map' }
];

const STATIC_IMPORT = /(?:\bfrom\s*|\bimport\s*)["']\.\/((?:chunk|main)-[A-Za-z0-9_-]+\.js)["']/g;

function initialChunks() {
  const main = fs.readdirSync(DIST).find((f) => /^main-[A-Za-z0-9_-]+\.js$/.test(f));
  if (!main) {
    console.error(`FAIL: no main-*.js in ${DIST} - run "npm run build" first.`);
    process.exit(1);
  }
  const seen = new Set();
  const queue = [main];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(path.join(DIST, file), 'utf8');
    for (const m of text.matchAll(STATIC_IMPORT)) queue.push(m[1]);
  }
  return [...seen];
}

function main() {
  const files = initialChunks();
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(DIST, file), 'utf8');
    for (const { name, marker } of LIBRARIES) {
      if (text.includes(marker)) hits.push(`  ${name}  ->  ${file}`);
    }
  }

  console.log(`Scanned ${files.length} initial chunks in dist/rangertrak/browser`);
  if (hits.length === 0) {
    console.log('OK: no map library in the eager bundle.');
    return;
  }
  console.error('\nFAIL: a map library is in the eager bundle (it belongs in the lazy map chunks).\n');
  for (const line of hits) console.error(line);
  console.error(`
Usually an eager file imports a barrel (shared/index.ts, shared/mapping/index.ts) that
re-exports a module importing 'leaflet' or 'maplibre-gl'. Import that module from its own
file in the map code, and keep it out of the barrels.
`);
  process.exit(1);
}

main();
