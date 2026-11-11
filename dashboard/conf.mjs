// ai-team — light reader of .claude/ai-team.conf, without the collector's dependencies
// (used by notify.mjs inside the hooks, where loading collect.mjs would create a cycle with ask.mjs).
import fs from 'node:fs';
import path from 'node:path';

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
