// E-255: build the ready-to-run Board kit from an existing app build.
//
//   npm run build            (first: the kit carries dist/rangertrak/browser)
//   npm run build:board-kit  -> dist/board-kit/rangertrak-board-<version>/
//
// Kit layout, instructions first:
//   READ-ME-FIRST.txt
//   Start RangerTrak Board.bat / .command   double-click launchers; they only check for Node.js 24
//   rangertrak-board.js                     the Board and its npm dependencies, bundled by esbuild
//   app/                                    the built app and the viewer, without assets/maps/
//   LICENSE, THIRD-PARTY-NOTICES.txt        AGPL for RangerTrak; the bundled packages' own licences
//
// The release workflow zips the folder and attaches it to the release beside the web zip.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { version } = require('../../package.json');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'dist', 'rangertrak', 'browser');
const NAME = `rangertrak-board-${version}`;
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
    outfile: path.join(OUT, 'rangertrak-board.js'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    metafile: true,
    legalComments: 'none', // the full licence texts go in THIRD-PARTY-NOTICES.txt instead
    banner: { js: `// RangerTrak Board ${version}. AGPL-3.0-or-later; see LICENSE and THIRD-PARTY-NOTICES.txt.` },
    logLevel: 'warning',
  });

  fs.cpSync(APP, path.join(OUT, 'app'), { recursive: true });
  fs.rmSync(path.join(OUT, 'app', 'assets', 'maps'), { recursive: true, force: true });

  // Line endings set here, not left to the checkout: CI checks out on Linux, and cmd.exe misreads
  // some LF-only batch files, while a CRLF .command fails on its shebang (see .gitattributes).
  const copyWithEol = (f, eol) => {
    const text = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r?\n/g, eol);
    fs.writeFileSync(path.join(OUT, f), text);
  };
  copyWithEol('READ-ME-FIRST.txt', '\r\n'); // Notepad on older Windows shows LF-only text as one line
  copyWithEol('Start RangerTrak Board.bat', '\r\n');
  copyWithEol('Start RangerTrak Board.command', '\n');
  fs.chmodSync(path.join(OUT, 'Start RangerTrak Board.command'), 0o755);
  fs.copyFileSync(path.join(REPO, 'LICENSE'), path.join(OUT, 'LICENSE'));
  fs.writeFileSync(path.join(OUT, 'THIRD-PARTY-NOTICES.txt'), notices(result.metafile));

  console.log(`Board kit: ${path.relative(REPO, OUT)}`);
}

/** The licence of every npm package that ended up in the bundle, from its own folder. */
function notices(metafile) {
  const dirs = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.split(path.sep).join('/').match(/^(.*node_modules\/(@[^/]+\/)?[^/]+)\//);
    if (m) dirs.set(m[1], true);
  }
  const parts = ['RangerTrak Board bundles these npm packages. Their licences follow.\n'];
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
