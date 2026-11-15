// E-216 slice 2: the mini web server's causes, read from the same JSON the app reads
// (src/app/domain/board-causes.json). `[[ ... ]]` is dropped when a placeholder inside has no value;
// the same fill rule is in src/app/domain/board-causes.ts.
const ALL = require('../../src/app/domain/board-causes.json');

function fill(template, values = {}) {
  const has = (k) => values[k] !== undefined && values[k] !== '' && values[k] !== null;
  const sub = (s) => s.replace(/\{(\w+)\}/g, (_m, k) => (has(k) ? String(values[k]) : ''));
  return sub(template.replace(/\[\[(.*?)\]\]/g, (_m, inner) => ([...inner.matchAll(/\{(\w+)\}/g)].every((m) => has(m[1])) ? inner : '')));
}

// { message, detail, anchor } for a cause id, placeholders filled. Throws on an unknown id.
function boardCause(id, values = {}) {
  const c = ALL.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown RangerView cause "${id}"`);
  return { message: fill(c.message, values), detail: fill(c.detail, values), anchor: c.anchor };
}

module.exports = { boardCause, fill, causes: ALL };
