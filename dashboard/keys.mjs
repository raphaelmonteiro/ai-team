// One keymap for the main page: every global shortcut, the context it works in and its help text. index.html
// dispatches through matchKey (one keydown listener) and the "?" list is built from here, so the help can not drift
// from what the keys do. Keys that belong to a widget (arrows in the explorer, Enter in a form, Esc in the palette)
// stay in that widget and are listed as `local` for the help.
//
// mod: 'cmd' = ⌘ on a Mac, Ctrl elsewhere; 'ctrl' = Ctrl everywhere; 'alt' = Alt / ⌥; none = no modifier.
// when: 'always' (even inside a text field), 'free' (not typing, palette closed), 'overview' (free and no tab open),
//       'decision' (free, on the Overview, the focus inside a decision card).
// handledBy: 'palette' = mountPalette (ui.mjs) owns it, here only for the help and the conflict check.

export const KEYMAP = [
  { id: 'palette', mod: 'cmd', key: 'k', when: 'always', handledBy: 'palette', help: 'command palette: changes, agents, actions, theme' },
  { id: 'next', key: 'j', when: 'overview', help: 'next row, card or decision' },
  { id: 'prev', key: 'k', when: 'overview', help: 'previous row, card or decision' },
  { id: 'allow', key: 'a', when: 'decision', help: 'allow the focused permission' },
  { id: 'deny', key: 'd', when: 'decision', help: 'deny the focused permission (with the typed reason)' },
  { id: 'filter', key: '/', when: 'free', help: 'filter the changes and agents in the explorer' },
  { id: 'side', mod: 'cmd', key: 'b', when: 'free', help: 'show or hide the explorer' },
  { id: 'panel', mod: 'ctrl', code: 'Backquote', label: '`', when: 'free', help: 'show or hide the panel (Problems, Events, Output)' },
  { id: 'tab', mod: 'alt', code: /^Digit([1-9])$/, label: '1…9', when: 'free', help: 'Overview (1), open tab 1…7 (2…8), the last tab (9)' },
  { id: 'close', mod: 'alt', code: 'KeyW', label: 'W', when: 'free', help: 'close the open tab' },
  { id: 'back', key: 'Escape', label: 'esc', when: 'free', help: 'back to Overview (in a tab)' },
  { id: 'help', key: '?', when: 'free', help: 'this list' },
];

// keys a widget handles itself, shown in the help after the global ones
export const LOCAL_KEYS = [
  { keys: ['↵'], help: 'open or expand the focused row, card or item' },
  { keys: ['↑', '↓'], help: 'move in the explorer (← → fold a group)' },
  { keys: ['esc'], help: 'close the palette, or clear the explorer filter' },
  { keys: ['ctrl ↵'], help: 'send the free-text answer of a decision' },
];

// the modifiers a binding wants, checked exactly: ⌘ on a Mac (Ctrl elsewhere) for 'cmd', Ctrl for 'ctrl', Alt for
// 'alt', none at all otherwise. Shift only matters for letters (j and J are different keys); '?' needs it anyway.
function modsOk(b, e, mac) {
  const cmd = mac ? e.metaKey : e.ctrlKey, otherMeta = mac ? e.ctrlKey : e.metaKey;
  if (b.mod === 'cmd') return cmd && !e.altKey && !otherMeta;
  if (b.mod === 'ctrl') return e.ctrlKey && !e.altKey && !e.metaKey;
  if (b.mod === 'alt') return e.altKey && !e.ctrlKey && !e.metaKey;
  return !e.ctrlKey && !e.metaKey && !e.altKey;
}
function keyOk(b, e) {
  if (b.code instanceof RegExp) { const m = b.code.exec(e.code || ''); return m ? { arg: Number(m[1]) } : null; }
  if (b.code) return e.code === b.code ? {} : null;
  if (/^[a-z]$/.test(b.key)) return (b.mod ? (e.key || '').toLowerCase() === b.key && !e.shiftKey : e.key === b.key) ? {} : null;
  return e.key === b.key ? {} : null;
}
const whenOk = (when, ctx) => when === 'always' || (!ctx.typing && !ctx.paletteOpen
  && (when === 'free' || (!ctx.inTab && (when === 'overview' || (when === 'decision' && ctx.inDecision)))));

// event + context → { id, arg, handledBy } of the binding it fires, or null. ctx: { mac, typing, paletteOpen, inTab, inDecision }
export function matchKey(e, ctx, map = KEYMAP) {
  for (const b of map) {
    if (!modsOk(b, e, ctx.mac)) continue;
    const k = keyOk(b, e); if (!k) continue;
    if (!whenOk(b.when, ctx)) continue;
    return { id: b.id, arg: k.arg, handledBy: b.handledBy || null };
  }
  return null;
}

// how a binding's keys read on this platform: "⌘K" / "Ctrl K", "alt W", "ctrl `"
export function keyLabel(b, mac) {
  const k = b.label || (b.key.length === 1 ? b.key.toUpperCase() : b.key);
  if (!b.mod) return k;
  if (b.mod === 'cmd') return mac ? `⌘${k}` : `Ctrl ${k}`;
  return `${b.mod} ${k}`;
}
// rows for the "?" list (palette.help): the global keys, then the local ones
export const helpRows = (mac, map = KEYMAP) => [...map.map((b) => [[keyLabel(b, mac)], b.help]), ...LOCAL_KEYS.map((l) => [l.keys, l.help])];

// two bindings clash when the same key and modifiers fire in overlapping contexts (tested; a new key must pass it)
export function conflicts(map = KEYMAP) {
  const out = [];
  const sig = (b) => `${b.mod || ''}+${b.code instanceof RegExp ? b.code.source : b.code || b.key.toLowerCase()}`;
  const overlap = (a, b) => a === 'always' || b === 'always' || a === b || a === 'free' || b === 'free'
    || (a === 'overview' && b === 'decision') || (a === 'decision' && b === 'overview');
  for (let i = 0; i < map.length; i++) for (let j = i + 1; j < map.length; j++) {
    const a = map[i], b = map[j];
    if (sig(a) === sig(b) && overlap(a.when, b.when)) out.push([a.id, b.id]);
  }
  return out;
}
