// ai-team — data for the /team page (no dependencies, read only).
//   listTeam(projectDir)    agents from <project>/.claude/agents/*.md (frontmatter)
//   readConf(projectDir)    public keys of <project>/.claude/ai-team.conf
//   entryInfo(projectDir)   how the team enters sessions (fixed agent, /team, hooks)
//   teamInfo(projectDir)    { project, agents, context, entry } — what /api/team returns
import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[a-z0-9-]+$/;

// Simple frontmatter (--- key: value ---). Accepts quotes and indented continuation
// lines; returns null if the file does not open with ---.
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
  return null;   // not closed: invalid frontmatter
}
const unquote = (s) => String(s || '').replace(/^(['"])(.*)\1$/, '$2');

export function listTeam(projectDir) {
  const dir = path.join(projectDir, '.claude', 'agents');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const agents = [];
  for (const f of files) {
    const m = /^([a-z0-9-]+)\.md$/.exec(f);
    if (!m || !NAME_RE.test(m[1])) continue;   // names outside the pattern never go out
    let st; try { st = fs.statSync(path.join(dir, f)); } catch { continue; }
    if (!st.isFile()) continue;
    let text = ''; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const fm = parseFrontmatter(text);
    agents.push({
      id: m[1],                               // file name = route /agents/<id>.md
      name: unquote(fm && fm.name) || m[1],
      description: unquote(fm && fm.description),
      model: unquote(fm && fm.model),
      tools: unquote(fm && fm.tools),
      frontmatter: !!fm,
    });
  }
  const rank = (a) => (a.id === 'orchestrator' ? 0 : 1);
  return agents.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

// ai-team.conf keys the page may show (no GIT_REMOTE, which may
// carry credentials, nor paths outside the project).
export const PUBLIC_CONF_KEYS = [
  'PROJECT_NAME', 'PROJECT_DESCRIPTION', 'OUTPUT_LANGUAGE', 'LAYOUT', 'HAS_OPENSPEC', 'CI', 'HUB_TEAM',
  'GIT_DEFAULT_BRANCH', 'GIT_WORK_BRANCH', 'GIT_PROTECTED_BRANCHES',
  'BACKEND_DIR', 'BACKEND_STACK', 'BACKEND_BRANCH', 'BACKEND_PROTECTED_BRANCH',
  'FRONTEND_DIR', 'FRONTEND_STACK', 'FRONTEND_BRANCH', 'FRONTEND_PROTECTED_BRANCH',
  'DOCS_CONTEXT', 'DOCS_STANDARDS', 'DOCS_ENV',
];
const GATE_PARTS = ['LINT', 'FORMAT', 'TYPECHECK', 'TEST', 'BUILD'];

// KEY='value' (the conf's shell format), without running anything.
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

// How the team enters: "agent" fixed in settings.json (every session), or per session with the
// /team skill (needs the SessionStart/UserPromptExpansion hooks to keep the role after
// compaction) or claude --agent orchestrator. Only names and booleans leave here.
export function entryInfo(projectDir) {
  const dir = path.join(projectDir, '.claude');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) || {}; } catch { /* no settings */ }
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const usesHook = (ev) => JSON.stringify(hooks[ev] || '').includes('hook.sh');
  return {
    fixedAgent: typeof settings.agent === 'string' && NAME_RE.test(settings.agent) ? settings.agent : null,
    skill: fs.existsSync(path.join(dir, 'skills', 'team', 'SKILL.md')),
    compactHooks: usesHook('SessionStart') && usesHook('UserPromptExpansion'),
    timingHooks: usesHook('SubagentStart') && usesHook('SubagentStop'),
    looseTasks: (() => { try { return /Ad-hoc task/i.test(fs.readFileSync(path.join(dir, 'agents', 'orchestrator.md'), 'utf8')); } catch { return false; } })(),
  };
}

export function teamInfo(projectDir) {
  const conf = readConf(projectDir);
  const context = {};
  for (const k of PUBLIC_CONF_KEYS) if (conf[k]) context[k] = conf[k];
  for (const P of ['BACKEND', 'FRONTEND']) {   // gate commands, as the installer derives them
    const cmds = GATE_PARTS.map((g) => conf[`${P}_CMD_${g}`]).filter(Boolean);
    if (cmds.length) context[`${P}_GATE`] = cmds.join('; ');
  }
  return {
    project: context.PROJECT_NAME || path.basename(projectDir),
    agents: listTeam(projectDir),
    context,
    entry: entryInfo(projectDir),
    hasConf: Object.keys(conf).length > 0,
  };
}
