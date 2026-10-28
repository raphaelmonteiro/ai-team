// Mapeia o "esperando" de cada change para a etapa do fluxo da página /equipe.
// Etapas: voce, po, devs, correcao, revisao, qa, integra, indefinido.
// (integra = tudo [x] e APROVADO, falta integrar na v2/integration e arquivar.)

export const STAGES = ['voce', 'po', 'devs', 'correcao', 'revisao', 'qa', 'integra', 'indefinido'];

// view: { id, status, archived, waiting: { text } | null }
// etapa declarada (linha "estado:" do tasks.md) -> etapa da página /equipe
const DECLARED_TO_STAGE = { proposta: 'po', aprovacao: 'voce', implementacao: 'devs', revisao: 'revisao', correcao: 'correcao', qa: 'qa', integracao: 'integra', arquivada: null };

export function stageOf(view) {
  if (!view || view.archived || view.status === 'avulsa' || !view.waiting) return null;
  if (view.declared && view.declared.valid) return DECLARED_TO_STAGE[view.declared.etapa] || null;
  const t = String(view.waiting.text || '');
  if (/^nada\b/.test(t)) return null;
  if (/^esperando o desenvolvedor/.test(t)) return 'voce';
  if (/^esperando corre[çc][ãa]o/.test(t)) return 'correcao';
  if (/^esperando revis[ãa]o/.test(t)) return 'revisao';
  if (/^esperando (?:executar )?a task/.test(t)) {
    const sec = (/\(([^)]*)\)\s*$/.exec(t) || [])[1] || '';
    if (/^QA\b/i.test(sec)) return 'qa';
    if (/^(?:Processo|Documenta[çc][ãa]o)\b/i.test(sec)) return 'po';
    return 'devs';
  }
  if (/^indefinido/.test(t) && view.status === 'concluída') return 'integra';
  return 'indefinido';
}

// views: changes do coletor. Devolve { counts, changes: { etapa: [ids] } }
export function stageCounts(views) {
  const changes = Object.fromEntries(STAGES.map((s) => [s, []]));
  for (const v of views || []) {
    const s = stageOf(v);
    if (s) changes[s].push(v.id);
  }
  return { counts: Object.fromEntries(STAGES.map((s) => [s, changes[s].length])), changes };
}

// ---------------------------------------------------------------------------
// Trilha da change (stepper do drawer)
// ---------------------------------------------------------------------------
export const TRAIL = [
  { key: 'proposta', label: 'Proposta', who: 'product-owner' },
  { key: 'aprovacao', label: 'Aprovação', who: 'você' },
  { key: 'implementacao', label: 'Implementação', who: 'devs' },
  { key: 'revisao', label: 'Revisão', who: 'code-reviewer', loop: true },
  { key: 'correcao', label: 'Correção', who: 'devs', loop: true },
  { key: 'qa', label: 'QA', who: 'qa' },
  { key: 'integracao', label: 'Integração', who: 'tech-lead' },
];
// "esperando" (stageOf) -> etapa da trilha. 'po' = tasks de Processo/Documentação, no fim do fluxo.
const STAGE_TO_FLOW = { voce: 'aprovacao', po: 'integracao', devs: 'implementacao', correcao: 'correcao', revisao: 'revisao', qa: 'qa', integra: 'integracao' };
const EXPECTED = { proposta: 'product-owner', revisao: 'code-reviewer', qa: 'qa' };
const approved = (r) => /APROVADO/i.test(r || '') && !/MUDAN[ÇC]AS/i.test(r || '');
const asksChanges = (r) => /MUDAN[ÇC]AS/i.test(r || '');

// v: visão da change { id, status, archived, unknown, waiting, tasks, taskList, review, reviewRounds, qa, runs }
// runs: { flow, agent, active, start, delegated }. Devolve null para rodadas avulsas.
export function buildTrail(v, mainAgent = 'tech-lead') {
  if (v && v.status === 'avulsa' && String(v.id || '').startsWith('avulsa:')) return looseTrail(v, mainAgent);
  if (!v || v.status === 'avulsa') return null;
  const runs = v.runs || [];
  const of = (k) => runs.filter((r) => r.flow === k);
  const rounds = v.reviewRounds || [];
  const needsFix = asksChanges(v.review);
  const loops = {
    revisao: Math.max(rounds.length, of('revisao').length),
    correcao: Math.max(rounds.filter(asksChanges).length, of('correcao').length),
  };
  const hasDir = !v.unknown;
  const actNow = runs.some((r) => r.active && r.flow);
  const declared = v.declared && v.declared.valid ? v.declared : null;
  const arch = !!v.archived || !!(declared && declared.etapa === 'arquivada');
  const meta = {
    source: declared ? 'declarado' : 'inferido', rule: declared ? 'linha "estado:" no cabeçalho do tasks.md' : actNow ? 'há agente rodando nesta etapa' : (v.waiting && v.waiting.rule) || null,
    since: declared ? declared.since : null, nota: declared ? declared.nota : '', aguarda: declared ? declared.aguarda : null,
    warning: v.declared && !v.declared.valid ? `estado declarado inválido: ${v.declared.reason}` : null,
  };
  // sem pasta em openspec/ não há etapa conhecida: trilha toda pendente (a interface mostra o aviso e o "esperando")
  if (v.unknown) {
    return { ...meta, unknown: true, current: null, next: null, after: null, rounds: runs.length, loops,
      steps: TRAIL.map((s) => ({ ...s, state: 'pendente', rounds: 0, times: null, result: null, active: false, queued: false, agents: [] })),
      delegations: runs.filter((r) => r.delegated).length };
  }
  const tasks = v.tasks || { total: 0, done: 0 };
  const list = v.taskList || [];

  // etapa atual: a rodada ativa manda; senão o "esperando"
  const act = runs.filter((r) => r.active && r.flow).sort((a, b) => (b.start || 0) - (a.start || 0))[0];
  let current = arch ? null : declared ? declared.etapa : act ? act.flow : (STAGE_TO_FLOW[stageOf(v)] || null);
  if (!current && !arch && hasDir && tasks.total === 0) current = 'proposta';
  const cIdx = TRAIL.findIndex((s) => s.key === current);

  // evidências de etapa concluída
  const core = list.filter((t) => !/^QA\b/i.test(t.section || '') && !/^(Processo|Documenta)/i.test(t.section || ''));
  const implDone = core.length ? core.every((t) => t.done) : (tasks.total > 0 && tasks.done === tasks.total);
  const finished = (k) => !hasDir && of(k).length > 0 && !of(k).some((r) => r.active);
  const ev = {
    proposta: tasks.total > 0 || of('proposta').length > 0 || finished('proposta'),
    implementacao: implDone || finished('implementacao'),
    revisao: !!v.review || finished('revisao'),
    correcao: (loops.correcao > 0 && !needsFix) || finished('correcao'),
    qa: approved(v.qa) || finished('qa'),
    integracao: false,
  };
  if (arch) for (const k of Object.keys(ev)) ev[k] = k !== 'correcao' || loops.correcao > 0;
  ev.aprovacao = arch || ev.implementacao || ev.revisao || ev.qa || tasks.done > 0 || runs.some((r) => ['implementacao', 'revisao', 'correcao', 'qa'].includes(r.flow));
  ev.integracao = arch || finished('integracao');

  const steps = TRAIL.map((s, i) => {
    let state;
    if (s.key === current) state = 'andamento';
    else if (cIdx >= 0 && i < cIdx) state = (s.key === 'correcao' && loops.correcao === 0) ? 'pendente' : 'concluida';
    else state = !declared || arch ? (ev[s.key] ? 'concluida' : 'pendente') : 'pendente';
    return { ...s, state, rounds: of(s.key).length, times: s.loop && loops[s.key] > 1 ? loops[s.key] : null,
      result: s.key === 'revisao' ? v.review || null : s.key === 'qa' ? v.qa || null : null,
      active: of(s.key).some((r) => r.active), queued: false, agents: [] };
  });
  const skipFix = (s) => s.key === 'correcao' && loops.correcao === 0 && !needsFix;
  const open = steps.filter((s, i) => s.state !== 'concluida' && s.key !== current && !skipFix(s) && (cIdx < 0 || i > cIdx));
  const [next, after] = open;
  for (const s of steps) {
    const by = new Map();
    for (const r of of(s.key)) {
      const a = by.get(r.agent) || { agent: r.agent, state: 'done', runs: 0 };
      a.runs++; if (r.active) a.state = 'on'; by.set(r.agent, a);
    }
    s.agents = [...by.values()];
    if (s.key === 'aprovacao' && s.state !== 'pendente') s.agents = [{ agent: 'voce', state: s.state === 'concluida' ? 'done' : 'wait', runs: 0 }];
    if (s.key === 'integracao' && s.state !== 'pendente') s.agents = [{ agent: mainAgent, state: s.state === 'concluida' ? 'done' : 'wait', runs: 0 }];
    if (s.state === 'pendente' && next && next.key === s.key) {
      s.queued = true;
      const who = EXPECTED[s.key];
      if (who && !s.agents.some((a) => a.agent === who)) s.agents.push({ agent: who, state: 'wait', runs: 0 });
    }
    if (s.key === 'implementacao') s.tasks = { done: tasks.done, total: tasks.total };
  }
  const ref = (s) => (s ? { key: s.key, label: s.label } : null);
  return { ...meta, steps, current, next: ref(next), after: ref(after), rounds: runs.length, loops,
    delegations: runs.filter((r) => r.delegated).length };
}

// Tarefa avulsa ("Tarefa avulsa: <slug>"): sem proposta, aprovação nem tasks.md; a trilha sai só das
// rodadas. Etapa com rodada ativa = agora; com rodadas e nenhuma ativa = concluída; correção sem
// rodada é pulada no "próximo"; integração fica com o agente principal.
const LOOSE_TRAIL = TRAIL.filter((s) => !['proposta', 'aprovacao'].includes(s.key));
function looseTrail(v, mainAgent) {
  const runs = v.runs || [];
  const of = (k) => runs.filter((r) => r.flow === k);   // flow null = fora da equipe (Explore etc.)
  const act = runs.filter((r) => r.active && r.flow).sort((a, b) => (b.start || 0) - (a.start || 0))[0];
  const current = act ? act.flow : null;
  const loops = { revisao: of('revisao').length, correcao: of('correcao').length };
  const steps = LOOSE_TRAIL.map((s) => {
    const rs = of(s.key), active = rs.some((r) => r.active);
    const by = new Map();
    for (const r of rs) {
      const a = by.get(r.agent) || { agent: r.agent, state: 'done', runs: 0 };
      a.runs++; if (r.active) a.state = 'on'; by.set(r.agent, a);
    }
    return { ...s, state: s.key === current ? 'andamento' : rs.length ? 'concluida' : 'pendente', rounds: rs.length,
      times: s.loop && loops[s.key] > 1 ? loops[s.key] : null, result: null, active, queued: false, agents: [...by.values()] };
  });
  const last = steps.reduce((m, s, i) => (s.state !== 'pendente' ? i : m), -1);
  const [next, after] = steps.filter((s, i) => i > last && s.state === 'pendente' && !(s.key === 'correcao' && loops.correcao === 0));
  if (next) {
    next.queued = true;
    const who = next.key === 'integracao' ? mainAgent : EXPECTED[next.key];
    if (who && !next.agents.some((a) => a.agent === who)) next.agents.push({ agent: who, state: 'wait', runs: 0 });
  }
  const integ = steps.find((s) => s.key === 'integracao');
  if (integ.state !== 'pendente' && !integ.agents.some((a) => a.agent === mainAgent)) integ.agents.push({ agent: mainAgent, state: 'done', runs: 0 });
  const ref = (s) => (s ? { key: s.key, label: s.label } : null);
  return { source: 'inferido', rule: act ? 'há agente rodando nesta etapa' : 'tarefa avulsa: etapas tiradas das rodadas',
    since: null, nota: '', aguarda: null, warning: null, loose: true,
    steps, current, next: ref(next), after: ref(after), rounds: runs.length, loops, delegations: runs.filter((r) => r.delegated).length };
}
