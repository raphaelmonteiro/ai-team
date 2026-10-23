// Mapeia o "esperando" de cada change para a etapa do fluxo da página /equipe.
// Etapas: voce, po, devs, correcao, revisao, qa, integra, indefinido.
// (integra = tudo [x] e APROVADO, falta integrar na v2/integration e arquivar.)

export const STAGES = ['voce', 'po', 'devs', 'correcao', 'revisao', 'qa', 'integra', 'indefinido'];

// view: { id, status, archived, waiting: { text } | null }
export function stageOf(view) {
  if (!view || view.archived || view.status === 'avulsa' || !view.waiting) return null;
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
  const tasks = v.tasks || { total: 0, done: 0 };
  const list = v.taskList || [];

  // etapa atual: a rodada ativa manda; senão o "esperando"
  const act = runs.filter((r) => r.active && r.flow).sort((a, b) => (b.start || 0) - (a.start || 0))[0];
  let current = v.archived ? null : act ? act.flow : (STAGE_TO_FLOW[stageOf(v)] || null);
  if (!current && !v.archived && hasDir && tasks.total === 0) current = 'proposta';
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
  if (v.archived) for (const k of Object.keys(ev)) ev[k] = k !== 'correcao' || loops.correcao > 0;
  ev.aprovacao = v.archived || ev.implementacao || ev.revisao || ev.qa || tasks.done > 0 || runs.some((r) => ['implementacao', 'revisao', 'correcao', 'qa'].includes(r.flow));
  ev.integracao = !!v.archived || finished('integracao');

  const steps = TRAIL.map((s, i) => {
    let state;
    if (s.key === current) state = 'andamento';
    else if (cIdx >= 0 && i < cIdx) state = (s.key === 'correcao' && loops.correcao === 0) ? 'pendente' : 'concluida';
    else state = ev[s.key] ? 'concluida' : 'pendente';
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
  return { steps, current, next: ref(next), after: ref(after), rounds: runs.length, loops,
    delegations: runs.filter((r) => r.delegated).length };
}
