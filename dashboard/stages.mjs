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
