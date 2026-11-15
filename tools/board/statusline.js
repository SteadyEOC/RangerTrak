// E-216 slice 2: the one status line the RangerView web server prints while it runs, only when it changes:
//   Scribe: connected (K7ABC, 12:04) · Viewers: 3 · Last report 12:03
// It answers "is it working?" at a glance. Counts and times only: the same scribe name the claim already
// printed, and never an address or an identity for a viewer.
const SCRIBE_CONNECTED_MS = 30 * 1000;
const STATUS_EVERY_MS = 30 * 1000;

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// `st` is createBoard().status(): { claimed, scribe, claimedAt, scribeSeenAt, viewers, lastReportAt }, times in epoch ms.
function statusLine(st, nowMs = Date.now()) {
  let scribe;
  if (!st.claimed || !st.scribeSeenAt) scribe = 'none yet';
  // "connected" shows when the scribe connected (stable), "quiet" shows when it was last heard (stable once quiet),
  // so the line only changes when something real changes.
  else if (nowMs - st.scribeSeenAt <= SCRIBE_CONNECTED_MS) scribe = `connected (${st.scribe}, ${clock(st.claimedAt || st.scribeSeenAt)})`;
  else scribe = `quiet since ${clock(st.scribeSeenAt)}`;
  const report = st.lastReportAt ? `Last report ${clock(st.lastReportAt)}` : 'No reports yet';
  return `Scribe: ${scribe} · Viewers: ${st.viewers} · ${report}`;
}

/**
 * Every 30 s, logs the line if it differs from the last one logged. The timer is unref'd, so it never keeps the
 * process alive. Returns { tick, stop } (tick is for tests).
 */
function startStatusLine({ status, log = console.log, now = Date.now, everyMs = STATUS_EVERY_MS }) {
  let last = '';
  const tick = () => {
    const line = statusLine(status(), now());
    if (line === last) return;
    last = line;
    log(line);
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { statusLine, startStatusLine, SCRIBE_CONNECTED_MS };
