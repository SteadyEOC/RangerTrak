// E-255: build the ready-to-run RangerView zip from an existing app build.
//
//   npm run build            (first: the zip carries dist/rangertrak/browser)
//   npm run build:board-kit  -> dist/board-kit/rangerview-<version>/
//
// Zip layout, instructions first:
//   READ-ME-FIRST.txt
//   Start RangerView.bat / .command   double-click launchers; they only check for Node.js 24
//   rangerview.js                     RangerView and its npm dependencies, bundled by esbuild
//   app/                                    the built app and the viewer, without assets/maps/
//   viewer-lib/                             E-293: the viewer's Map tab: maplibre-gl, pmtiles and the world base map
//   LICENSE, THIRD-PARTY-NOTICES.txt        AGPL for RangerTrak; the bundled packages' own licences
//
// The release workflow zips the folder and attaches it to the release beside the web zip.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { version } = require('../../package.json');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'dist', 'rangertrak', 'browser');
const NAME = `rangerview-${version}`;
const OUT = path.join(REPO, 'dist', 'board-kit', NAME);

async function main() {
  if (!fs.existsSync(path.join(APP, 'index.html'))) {
    console.error('No app build in dist/rangertrak/browser. Run npm run build first.');
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'entry.js')],
    outfile: path.join(OUT, 'rangerview.js'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    metafile: true,
    legalComments: 'none', // the full licence texts go in THIRD-PARTY-NOTICES.txt instead
    banner: { js: `// RangerView ${version}. AGPL-3.0-or-later; see LICENSE and THIRD-PARTY-NOTICES.txt.` },
    logLevel: 'warning',
  });

  fs.cpSync(APP, path.join(OUT, 'app'), { recursive: true });
  fs.rmSync(path.join(OUT, 'app', 'assets', 'maps'), { recursive: true, force: true });

  // E-293: the Map tab's code and the world base map, served at /view-lib/ (tools/board/viewer-lib.js). They sit
  // in their own folder, not in app/, because app/assets/maps is removed above.
  const lib = path.join(OUT, 'viewer-lib');
  fs.mkdirSync(lib, { recursive: true });
  const mapLibre = path.join(REPO, 'node_modules', 'maplibre-gl', 'dist');
  for (const f of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl.css']) {
    fs.copyFileSync(path.join(mapLibre, f), path.join(lib, f));
  }
  fs.copyFileSync(path.join(REPO, 'node_modules', 'pmtiles', 'dist', 'pmtiles.js'), path.join(lib, 'pmtiles.js'));
  const maps = path.join(REPO, 'src', 'assets', 'maps');
  const world = fs.readdirSync(maps).filter((f) => /^world-z5-.*\.pmtiles$/.test(f)).sort().pop();
  if (!world) throw new Error('No world-z5 map in src/assets/maps');
  fs.copyFileSync(path.join(maps, world), path.join(lib, 'world.pmtiles'));

  // Line endings set here, not left to the checkout: CI checks out on Linux, and cmd.exe misreads
  // some LF-only batch files, while a CRLF .command fails on its shebang (see .gitattributes).
  const copyWithEol = (f, eol) => {
    const text = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r?\n/g, eol);
    fs.writeFileSync(path.join(OUT, f), text);
  };
  copyWithEol('READ-ME-FIRST.txt', '\r\n'); // Notepad on older Windows shows LF-only text as one line
  copyWithEol('Start RangerView.bat', '\r\n');
  copyWithEol('Start RangerView.command', '\n');
  fs.chmodSync(path.join(OUT, 'Start RangerView.command'), 0o755);
  fs.copyFileSync(path.join(REPO, 'LICENSE'), path.join(OUT, 'LICENSE'));
  fs.writeFileSync(path.join(OUT, 'THIRD-PARTY-NOTICES.txt'), notices(result.metafile));

  console.log(`RangerView: ${path.relative(REPO, OUT)}`);
  console.log(`  viewer-lib: ${(dirBytes(lib) / 1048576).toFixed(1)} MB; whole folder ${(dirBytes(OUT) / 1048576).toFixed(1)} MB`);
}

/** Total bytes of every file under dir (the kit's size, printed so a jump is noticed). */
function dirBytes(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
  }
  return n;
}

/** The licence of every npm package that ended up in the bundle, from its own folder. */
function notices(metafile) {
  const dirs = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.split(path.sep).join('/').match(/^(.*node_modules\/(@[^/]+\/)?[^/]+)\//);
    if (m) dirs.set(m[1], true);
  }
  const parts = ['RangerView bundles these npm packages. Their licences follow.\n'];
  for (const dir of [...dirs.keys()].sort()) {
    const abs = path.join(REPO, dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(abs, 'package.json'), 'utf8'));
    const file = fs.readdirSync(abs).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    parts.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version} (${pkg.license || 'see below'})\n${'='.repeat(72)}\n`);
    parts.push(file ? fs.readFileSync(path.join(abs, file), 'utf8').trim() + '\n' : `No licence file shipped; package.json says ${pkg.license}.\n`);
  }
  return parts.join('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
