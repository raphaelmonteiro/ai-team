// ai-team — leitura leve do .claude/ai-team.conf, sem dependências do coletor
// (usada pelo notify.mjs dentro dos hooks, onde carregar o collect.mjs criaria um ciclo com o ask.mjs).
import fs from 'node:fs';
import path from 'node:path';

// PROJECT_NAME do .claude/ai-team.conf (instalador), senão o nome da pasta
export function readProjectName(projectDir) {
  try {
    const m = /^PROJECT_NAME='((?:[^']|'\\'')*)'$/m.exec(fs.readFileSync(path.join(projectDir, '.claude', 'ai-team.conf'), 'utf8'));
    if (m && m[1]) return m[1].replace(/'\\''/g, "'");
  } catch { /* sem conf */ }
  return path.basename(projectDir);
}
