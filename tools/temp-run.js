/**
 * One throwaway temp folder per test or tool run, removed however the run ends.
 *
 * 2026-11-08, John: leftover Chrome profiles from these tools (693 rangertrak-e2e-* folders) took
 * Windows sign-in to 12 minutes, because the User Profile Service walks %TEMP% file by file. The
 * old cleanup killed Chrome and deleted the folder in the same tick, inside an empty catch.
 *
 *   const run = makeTempRun('rangertrak-e2e-')   // creates run.dir
 *   const chrome = run.track(spawn(...))         // stopped at cleanup, with its child processes
 *   run.cleanup()                                // also runs by itself on exit and Ctrl+C
 *
 * A hard kill of Node runs none of this, so each new run first removes folders with its own
 * prefix that are over a day old.
 *
 * Run folders live in the git-ignored .tmp folder of this repo, not %TEMP%. Pass run.env to whatever
 * you spawn: Chrome also writes scoped_dir*, chrome_drag* and the like to its own %TEMP%, outside
 * --user-data-dir, and run.env points that inside the run folder too.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const TMP_ROOT = path.resolve(__dirname, '..', '.tmp')
const STALE_MS = 24 * 60 * 60 * 1000
const DELETE_ATTEMPTS = 40
const DELETE_RETRY_MS = 250

const blockFor = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Stops a process we spawned and its children, by PID. Must run while the parent is alive: taskkill finds children through it. */
function stopProcess(proc) {
  if (!proc || !proc.pid || proc.exitCode !== null || proc.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try { proc.kill('SIGKILL') } catch { }
  }
}

/** Deletes a folder, retrying while Windows still holds its files. Returns true once it is gone. */
function removeDir(dir) {
  for (let attempt = 0; attempt < DELETE_ATTEMPTS; attempt++) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { }
    if (!fs.existsSync(dir)) return true
    blockFor(DELETE_RETRY_MS)
  }
  return false
}

function removeStale(prefix) {
  // %TEMP% too, for anything an older copy of these tools left there.
  for (const root of [TMP_ROOT, os.tmpdir()]) {
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith(prefix)) continue
      const full = path.join(root, name)
      try {
        const stat = fs.statSync(full)
        // One attempt, no retries: a folder still locked belongs to something running.
        if (stat.isDirectory() && Date.now() - stat.mtimeMs > STALE_MS) fs.rmSync(full, { recursive: true, force: true })
      } catch (e) {
        console.error(`WARNING: could not delete stale temp folder ${full}: ${e.code || e.message}`)
      }
    }
  }
}

/** outsideRepo: for a run that must not sit in the repo, such as the regional tools, which refuse to write there. */
function makeTempRun(prefix, { outsideRepo = false } = {}) {
  fs.mkdirSync(TMP_ROOT, { recursive: true })
  removeStale(prefix)
  const dir = fs.mkdtempSync(path.join(outsideRepo ? os.tmpdir() : TMP_ROOT, prefix))
  const childTemp = path.join(dir, '_temp')
  fs.mkdirSync(childTemp)
  const procs = new Set()
  let finished = false

  const stopAll = () => { for (const p of procs) stopProcess(p) }
  const cleanup = () => {
    if (finished) return
    finished = true
    stopAll()
    if (!removeDir(dir)) console.error(`WARNING: could not delete temp folder ${dir}`)
  }

  process.on('exit', cleanup)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(signal, () => { cleanup(); process.exit(130) })
  }

  return {
    dir,
    env: { ...process.env, TEMP: childTemp, TMP: childTemp, TMPDIR: childTemp },
    track(proc) { procs.add(proc); return proc },
    cleanup,
    /** Leaves the folder and any running processes in place when the run ends. The caller says where. */
    keep() { finished = true },
  }
}

module.exports = { makeTempRun, stopProcess, removeDir }
