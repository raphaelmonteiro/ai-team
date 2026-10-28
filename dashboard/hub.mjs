// ai-team — registro do hub (times → projetos) e resumo barato de cada projeto.
//
//   node dashboard/hub.mjs add <dir> --team <time> [--name <nome>] [--id <id>] [--hub <arquivo>]
//   node dashboard/hub.mjs remove <id> [--hub <arquivo>]
//   node dashboard/hub.mjs list [--json] [--hub <arquivo>]
//
// Registro padrão: $AI_TEAM_HUB, senão $XDG_CONFIG_HOME/ai-team/hub.json
// (~/.config/ai-team/hub.json). Formato:
//   { "teams": [ { "id": "pagamentos", "name": "Pagamentos",
//                  "projects": [ { "id": "checkout-api", "name": "Checkout API", "dir": "~/Sites/checkout-api" } ] } ] }
// O id do projeto é único no hub inteiro (vai na URL: /p/<id>/).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSlug } from './collect.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const defaultHubFile = () => process.env.AI_TEAM_HUB
  || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'ai-team', 'hub.json');
export const slugId = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const expandHome = (d) => (d === '~' || d.startsWith('~/') ? path.join(os.homedir(), d.slice(1)) : d);

// lê e normaliza; entradas inválidas ou repetidas viram avisos em `warnings`
export function loadHub(file) {
  const hub = { teams: [], warnings: [] };
  if (!fs.existsSync(file)) return hub;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`${file}: JSON inválido (${e.message})`); }
  const seen = new Set();
  for (const t of Array.isArray(raw && raw.teams) ? raw.teams : []) {
    const id = slugId(t && (t.id || t.name));
    if (!id) { hub.warnings.push('time sem id ignorado'); continue; }
    if (hub.teams.some((x) => x.id === id)) { hub.warnings.push(`time repetido ignorado: ${id}`); continue; }
    const team = { id, name: String(t.name || t.id), projects: [] };
    for (const p of Array.isArray(t.projects) ? t.projects : []) {
      const dir = p && typeof p.dir === 'string' && p.dir ? path.resolve(expandHome(p.dir)) : '';
      const pid = slugId(p && (p.id || p.name || (dir && path.basename(dir))));
      if (!pid || !dir) { hub.warnings.push(`projeto sem id ou dir ignorado no time ${id}`); continue; }
      if (seen.has(pid)) { hub.warnings.push(`projeto repetido ignorado: ${pid}`); continue; }
      seen.add(pid);
      team.projects.push({ id: pid, name: String(p.name || pid), dir });
    }
    hub.teams.push(team);
  }
  return hub;
}

export function saveHub(file, hub) {
  const out = { teams: hub.teams.map((t) => ({ id: t.id, name: t.name, projects: t.projects.map((p) => ({ id: p.id, name: p.name, dir: p.dir })) })) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function findProject(hub, id) {
  for (const team of hub.teams) { const project = team.projects.find((p) => p.id === id); if (project) return { team, project }; }
  return null;
}

// registra ou atualiza: o mesmo dir mantém o id (e muda de time se preciso)
export function addProject(hub, { dir, team, name, id }) {
  dir = path.resolve(expandHome(dir));
  const teamId = slugId(team);
  if (!teamId) throw new Error(`time inválido: ${JSON.stringify(team)}`);
  if (id != null && !ID_RE.test(id)) throw new Error(`id inválido: ${id} (use [a-z0-9-])`);
  let action = 'adicionado', prev = null;
  for (const t of hub.teams) {
    const i = t.projects.findIndex((p) => p.dir === dir);
    if (i >= 0) { prev = t.projects[i]; if (t.id !== teamId) { t.projects.splice(i, 1); action = 'movido'; prev = { ...prev }; } else action = 'atualizado'; break; }
  }
  let t = hub.teams.find((x) => x.id === teamId);
  if (!t) { t = { id: teamId, name: String(team), projects: [] }; hub.teams.push(t); }
  let project;
  if (prev && action === 'atualizado') {
    project = t.projects.find((p) => p.dir === dir);
    if (name) project.name = String(name);
  } else {
    let pid = prev ? prev.id : id || slugId(name || path.basename(dir)) || 'projeto';
    if (!prev) { const base = pid; for (let n = 2; findProject(hub, pid); n++) pid = `${base}-${n}`; }
    project = { id: pid, name: String(name || (prev && prev.name) || path.basename(dir)), dir };
    t.projects.push(project);
  }
  return { action, team: t, project };
}

export function removeProject(hub, id) {
  for (const t of hub.teams) {
    const i = t.projects.findIndex((p) => p.id === id);
    if (i >= 0) { t.projects.splice(i, 1); if (!t.projects.length) hub.teams.splice(hub.teams.indexOf(t), 1); return true; }
  }
  return false;
}

// --- resumo barato: só stat/readdir, sem ler transcripts ----------------------
const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
function newestMtime(dir, depth, test) {
  let best = 0, entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) best = Math.max(best, newestMtime(f, depth - 1, test)); }
    else if (test(e.name)) { try { best = Math.max(best, fs.statSync(f).mtimeMs); } catch {} }
  }
  return best;
}

export function projectSummary({ dir, claudeDir, staleMin, now = Date.now() }) {
  const exists = fs.existsSync(dir);
  const changesDir = path.join(dir, 'openspec', 'changes');
  const open = dirs(changesDir).filter((d) => d !== 'archive');
  const lastActivity = Math.max(
    newestMtime(path.join(claudeDir, 'projects', projectSlug(dir)), 2, (n) => n.endsWith('.jsonl')),
    newestMtime(path.join(dir, '.claude', 'ai-team'), 0, (n) => n.endsWith('.jsonl')),
    ...open.map((c) => newestMtime(path.join(changesDir, c), 0, (n) => n.endsWith('.md'))),
  ) || null;
  let agents = 0;
  try { agents = fs.readdirSync(path.join(dir, '.claude', 'agents')).filter((f) => f.endsWith('.md')).length; } catch {}
  return {
    exists, lastActivity, active: !!lastActivity && now - lastActivity < staleMin * 60e3,
    changes: { open: open.length, archived: dirs(path.join(changesDir, 'archive')).length },
    agents, openspec: fs.existsSync(changesDir),
  };
}

// --- CLI -----------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
  const file = path.resolve(expandHome(opt('--hub') || defaultHubFile()));
  const team = opt('--team'), name = opt('--name'), id = opt('--id'), json = flag('--json');
  const [cmd, arg] = args;
  const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };
  try {
    const hub = loadHub(file);
    for (const w of hub.warnings) console.error(`! ${w}`);
    if (cmd === 'add') {
      if (!team) die('add precisa de --team <time>');
      const r = addProject(hub, { dir: arg || process.cwd(), team, name, id });
      saveHub(file, hub);
      console.log(`hub: ${r.action} ${r.team.id}/${r.project.id} (${r.project.dir}) em ${file}`);
    } else if (cmd === 'remove') {
      if (!arg) die('remove precisa do id do projeto');
      if (!removeProject(hub, arg)) die(`projeto não encontrado: ${arg}`);
      saveHub(file, hub);
      console.log(`hub: removido ${arg} de ${file}`);
    } else if (cmd === 'list') {
      if (json) console.log(JSON.stringify({ file, teams: hub.teams }, null, 2));
      else if (!hub.teams.length) console.log(`(hub vazio: ${file})`);
      else for (const t of hub.teams) { console.log(`${t.name} (${t.id})`); for (const p of t.projects) console.log(`  ${p.id.padEnd(24)} ${p.dir}`); }
    } else die('uso: hub.mjs add <dir> --team <time> [--name N] [--id ID] | remove <id> | list [--json]   [--hub arquivo]');
  } catch (e) { die(e.message); }
}
