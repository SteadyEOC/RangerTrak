// The Board's update check (John, 2026-11-13). Once at start-up, ask GitHub for the newest RangerTrak
// release and say so in the window when it is newer than this kit. It sends nothing about the mission:
// one anonymous GET of the public releases API. With no Internet (the usual case in the field) it gives
// up after a few seconds and says nothing; the Board never waits on it.
const RELEASES_API = 'https://api.github.com/repos/SteadyEOC/RangerTrak/releases/latest';
const GUIDE_URL = 'https://rangertrak.org/board/';

/** '1.0.0-beta.3' or 'v1.0.0-beta.3' -> { core: [1,0,0], pre: ['beta', 3] }, or null if it isn't a version. */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(v || '').trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

/** Semver precedence: true when `candidate` is newer than `current`. A release beats its own betas. */
function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  if (!a.pre.length || !b.pre.length) return !a.pre.length && b.pre.length > 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return false;
    if (y === undefined) return true;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x > y;
    if (typeof x === 'number') return false; // numeric identifiers sort before text ones
    if (typeof y === 'number') return true;
    return x > y;
  }
  return false;
}

/**
 * Resolves with { version, url } when a newer release exists, else null. Never rejects.
 * @param {object} o
 * @param {string} o.current             this kit's version
 * @param {Function} [o.fetchImpl]       test hook; defaults to the global fetch
 * @param {number} [o.timeoutMs]
 */
async function checkForUpdate({ current, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  try {
    const res = await fetchImpl(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'rangertrak-board' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const tag = body && typeof body.tag_name === 'string' ? body.tag_name : '';
    if (!isNewer(tag, current)) return null;
    return { version: tag.replace(/^v/, ''), url: GUIDE_URL };
  } catch {
    return null;
  }
}

/** The line for the Board's window. */
function updateLine(update, current) {
  return `A newer RangerTrak Board kit is out: ${update.version} (this is ${current}). Get it from ${update.url} when you have the Internet.`;
}

module.exports = { parseVersion, isNewer, checkForUpdate, updateLine, RELEASES_API, GUIDE_URL };
