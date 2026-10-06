/**
 * Finds the region folder a roster-build script works on, and its settings.
 *
 * Every script takes the region folder as an argument (or REGION=), for example
 * us/wa/king/vashon. It may be given relative to the current folder or to the top of
 * rangertrak-regional-data. The folder holds a region.json and the usual layout:
 *
 *   region.json   name, area ZIPs, and where the roster's source files are
 *   sources/      raw inputs as received (volunteer tables, photos, FCC pulls)
 *   rangers/      the crosswalk (ranger-ids.csv), the built roster and the drive bundle
 *   locations/    places
 *   teams/        teams and units
 *   work/         dated outputs of tool runs
 */
const fs = require('fs')
const path = require('path')

/**
 * Where region folders are looked up when a relative path is given. The scripts live in the app
 * repo but the data never does, so the data root is found outside it: RANGERTRAK_DATA if set,
 * otherwise a `rangertrak-regional-data` folder beside any folder above this script (the umbrella
 * layout), otherwise two levels up (when the scripts sit inside the data folder itself).
 */
function dataRoots() {
  const roots = []
  if (process.env.RANGERTRAK_DATA) roots.push(path.resolve(process.env.RANGERTRAK_DATA))
  for (let d = __dirname; ; d = path.dirname(d)) {
    const sibling = path.join(d, 'rangertrak-regional-data')
    if (fs.existsSync(sibling)) { roots.push(sibling); break }
    if (path.dirname(d) === d) break
  }
  roots.push(path.resolve(__dirname, '../..'))
  return roots
}

module.exports = function region(argv = process.argv.slice(2)) {
  const candidates = [process.env.REGION, ...argv].filter(Boolean)
  const roots = dataRoots()
  for (const c of candidates) {
    for (const dir of [path.resolve(c), ...roots.map(r => path.resolve(r, c))]) {
      const file = path.join(dir, 'region.json')
      if (!fs.existsSync(file)) continue
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
      const name = cfg.name || path.basename(dir)
      return {
        dir, cfg, name,
        /** A path inside the region folder. */
        at: (...p) => path.join(dir, ...p),
        /** A path from region.json, taken relative to the region folder unless absolute. */
        setting: p => p && path.resolve(dir, p),
      }
    }
  }
  console.error('Which region? Pass its folder, e.g.  node 1-make-roster.js us/wa/king/vashon')
  console.error('(A region folder holds a region.json. Relative paths are also tried under RANGERTRAK_DATA or a rangertrak-regional-data folder found above this script.)')
  process.exit(1)
}
