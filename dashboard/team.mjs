// ai-team — dados da página /equipe (sem dependências, só leitura).
//   listTeam(projectDir)    agentes de <projeto>/.claude/agents/*.md (frontmatter)
//   readConf(projectDir)    chaves públicas de <projeto>/.claude/ai-team.conf
//   teamInfo(projectDir)    { project, agents, context } — o que /api/team devolve
import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[a-z0-9-]+$/;

// Frontmatter simples (--- chave: valor ---). Aceita aspas e linhas de continuação
// indentadas; devolve null se o arquivo não abre com ---.
export function parseFrontmatter(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const out = {};
  let key = null;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '---') return out;
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l);
    if (m) { key = m[1]; out[key] = m[2].trim(); continue; }
    if (key && /^\s+\S/.test(l)) out[key] = `${out[key]} ${l.trim()}`.trim();
  }
  return null;   // sem fechamento: frontmatter inválido
}
const unquote = (s) => String(s || '').replace(/^(['"])(.*)\1$/, '$2');

export function listTeam(projectDir) {
  const dir = path.join(projectDir, '.claude', 'agents');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const agents = [];
  for (const f of files) {
    const m = /^([a-z0-9-]+)\.md$/.exec(f);
    if (!m || !NAME_RE.test(m[1])) continue;   // nomes fora do padrão nunca saem
    let st; try { st = fs.statSync(path.join(dir, f)); } catch { continue; }
    if (!st.isFile()) continue;
    let text = ''; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const fm = parseFrontmatter(text);
    agents.push({
      id: m[1],                               // nome do arquivo = rota /agents/<id>.md
      name: unquote(fm && fm.name) || m[1],
      description: unquote(fm && fm.description),
      model: unquote(fm && fm.model),
      tools: unquote(fm && fm.tools),
      frontmatter: !!fm,
    });
  }
  const rank = (a) => (a.id === 'tech-lead' ? 0 : 1);
  return agents.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

// Chaves do ai-team.conf que a página pode mostrar (nada de GIT_REMOTE, que pode
// trazer credenciais, nem de caminhos fora do projeto).
export const PUBLIC_CONF_KEYS = [
  'PROJECT_NAME', 'PROJECT_DESCRIPTION', 'LAYOUT', 'HAS_OPENSPEC', 'CI',
  'GIT_DEFAULT_BRANCH', 'GIT_WORK_BRANCH', 'GIT_PROTECTED_BRANCHES',
  'BACKEND_DIR', 'BACKEND_STACK', 'BACKEND_BRANCH', 'BACKEND_PROTECTED_BRANCH',
  'FRONTEND_DIR', 'FRONTEND_STACK', 'FRONTEND_BRANCH', 'FRONTEND_PROTECTED_BRANCH',
  'DOCS_CONTEXT', 'DOCS_STANDARDS', 'DOCS_ENV',
];
const GATE_PARTS = ['LINT', 'FORMAT', 'TYPECHECK', 'TEST', 'BUILD'];

// KEY='valor' (formato shell do conf), sem executar nada.
export function parseConf(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)='(.*)'\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/'\\''/g, "'");
  }
  return out;
}

export function readConf(projectDir) {
  try { return parseConf(fs.readFileSync(path.join(projectDir, '.claude', 'ai-team.conf'), 'utf8')); }
  catch { return {}; }
}

export function teamInfo(projectDir) {
  const conf = readConf(projectDir);
  const context = {};
  for (const k of PUBLIC_CONF_KEYS) if (conf[k]) context[k] = conf[k];
  for (const P of ['BACKEND', 'FRONTEND']) {   // comandos de gate, como o instalador os deriva
    const cmds = GATE_PARTS.map((g) => conf[`${P}_CMD_${g}`]).filter(Boolean);
    if (cmds.length) context[`${P}_GATE`] = cmds.join('; ');
  }
  return {
    project: context.PROJECT_NAME || path.basename(projectDir),
    agents: listTeam(projectDir),
    context,
    hasConf: Object.keys(conf).length > 0,
  };
}
