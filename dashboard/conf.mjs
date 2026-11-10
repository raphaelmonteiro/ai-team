// ai-team — light reader of .claude/ai-team.conf, without the collector's dependencies
// (used by notify.mjs inside the hooks, where loading collect.mjs would create a cycle with ask.mjs).
import fs from 'node:fs';
import path from 'node:path';

// every KEY='value' of .claude/ai-team.conf as an object (shell quoting undone); {} without the file
export function readConf(projectDir) {
  const out = {};
  try {
    for (const m of fs.readFileSync(path.join(projectDir, '.claude', 'ai-team.conf'), 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)='((?:[^']|'\\'')*)'$/gm)) out[m[1]] = m[2].replace(/'\\''/g, "'");
  } catch { /* no conf */ }
  return out;
}

// PROJECT_NAME from .claude/ai-team.conf (installer), otherwise the folder name
export function readProjectName(projectDir) {
  try {
    const m = /^PROJECT_NAME='((?:[^']|'\\'')*)'$/m.exec(fs.readFileSync(path.join(projectDir, '.claude', 'ai-team.conf'), 'utf8'));
    if (m && m[1]) return m[1].replace(/'\\''/g, "'");
  } catch { /* no conf */ }
  return path.basename(projectDir);
}

// the gate's test commands from .claude/ai-team.conf (BACKEND_CMD_TEST, FRONTEND_CMD_TEST, any *_CMD_TEST), unquoted
export function readGateCommands(projectDir) {
  try {
    const text = fs.readFileSync(path.join(projectDir, '.claude', 'ai-team.conf'), 'utf8');
    return [...text.matchAll(/^[A-Z_]*CMD_TEST='((?:[^']|'\\'')*)'$/gm)].map((m) => m[1].replace(/'\\''/g, "'").trim()).filter(Boolean);
  } catch { return []; }
}
