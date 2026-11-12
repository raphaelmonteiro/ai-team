// What the person opened and chose on the main page, in one place. The page redraws on every update; whatever is
// here survives it. Open rows and folds are also kept in this tab's sessionStorage (per page path), so a reload
// keeps them; the changes view lives in this browser (localStorage). Layout and open tabs keep their own shapes
// (shell.mjs loadLayout, index.html saveTabs) under the same KEYS.
//
//   kinds of "open": changes (expanded change rows), sessions (session and finished-round lines), problems (a
//   Problems row's "why"), details (<details> folds by id: older changes, quiet sessions, finished recently…)
import { store, tabStore, KEYS } from './ui.mjs';

const KINDS = ['changes', 'sessions', 'problems', 'details'];
const MAX = 200;   // per kind: an id list never grows without bound
const path = () => (typeof location !== 'undefined' ? location.pathname : '');

export const ui = {
  open: Object.fromEntries(KINDS.map((k) => [k, new Set()])),
  boardView: store.get(KEYS.boardView) === 'cards' ? 'cards' : 'table',
  filter: '',   // the explorer filter: this page only, never kept
};

// restore what was open in this tab before a reload
{
  const saved = tabStore.json(KEYS.open(path()), {});
  for (const k of KINDS) if (Array.isArray(saved && saved[k])) for (const id of saved[k].slice(-MAX)) if (typeof id === 'string') ui.open[k].add(id);
}
const save = () => tabStore.setJson(KEYS.open(path()), Object.fromEntries(KINDS.map((k) => [k, [...ui.open[k]].slice(-MAX)])));

export const isOpen = (kind, id) => ui.open[kind].has(id);
// on = true / false sets it, undefined toggles; returns the new state
export function setOpen(kind, id, on) {
  const set = ui.open[kind];
  const next = on === undefined ? !set.has(id) : !!on;
  if (next) set.add(id); else set.delete(id);
  save();
  return next;
}
export function clearOpen(kind) { ui.open[kind].clear(); save(); }

export function setBoardView(v) {
  ui.boardView = v === 'cards' ? 'cards' : 'table';
  store.set(KEYS.boardView, ui.boardView);
  return ui.boardView;
}

// "since you left": when this browser last marked the project's events as seen
export const seenAt = (dir) => Number(store.get(KEYS.seen(dir))) || 0;
export const markSeen = (dir, t = Date.now()) => store.set(KEYS.seen(dir), t);
