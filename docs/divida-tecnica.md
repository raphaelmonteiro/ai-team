# Dívida técnica

Achados de severidade "backlog" das revisões, um item `DT-<n>` por módulo.
Numeração sequencial e nunca reaproveitada. Item resolvido fica no lugar,
marcado com a data e o sha da correção.

## Documentação de ambiente (`docs/ambiente.md`)

### DT-1: regra de edição dos achados de ambiente
- **Local:** `docs/ambiente.md:55`, commit `3f95e17`.
- **Origem:** revisão da tarefa avulsa `shellcheck-nativo`, achado R2, 2026-10-29.
- **Problema:** o commit editou um achado antigo da seção "Achados recentes",
  acrescentando "(Superado pelo achado seguinte...)". O template dos agentes
  diz "Achado novo de ambiente entra só ao fim de 'Achados recentes'"
  (`templates/agents/frontend-dev.md:80`), mas não diz se as entradas antigas
  podem ser editadas.
- **Decisão pendente:** definir se "Achados recentes" é só de acréscimo
  (achado superado ganha uma entrada nova que o referencia) ou se anotar a
  entrada antiga é permitido. Depois, deixar a regra escrita em
  `docs/padroes.md`, e no template se for o caso.
- **Severidade:** backlog.
- **Responsável sugerido:** devops.
- **Estado:** aberto.

## Painel (`dashboard/ask.mjs`)

### DT-2: pendência já respondida continua em `pending`
- **Local:** `dashboard/ask.mjs:62` (`listPending`).
- **Origem:** decisão provisória PV-1 da change `painel-custo-collect`, mantida pelo PO, 2026-10-29.
- **Problema:** `listPending` lista a pendência mesmo quando já existe
  `answers/<id>.json`; ela só some quando o hook `ask.mjs` lê a resposta (a
  cada 300 ms) e apaga os dois arquivos. Um `GET /api/state` nessa janela, ou
  com o hook vivo mas travado, mostra a decisão de novo e permite responder
  outra vez (a segunda resposta substitui a primeira).
- **Proposta:** `listPending` ignorar pendência que já tem resposta, ou
  marcá-la como "respondida". Muda o contrato de `pending` do `/api/state`.
- **Severidade:** backlog.
- **Responsável sugerido:** backend-dev.
- **Estado:** aberto.

## Testes do painel (`tests/`)

### DT-3: `bytesRead` de `projectdirs.test.mjs` não restaura o `closeSync`
- **Local:** `tests/projectdirs.test.mjs:65-73`, commit `862231f`.
- **Origem:** revisão da change `painel-custo-collect`, achado R4 (rodada 1), 2026-10-29.
- **Problema:** o helper repete o de `tests/cache.test.mjs:53-58` e também
  troca `fs.closeSync` sem restaurá-lo no `finally`. Cada chamada embrulha a
  anterior e o monkeypatch fica ativo no resto do arquivo.
- **Proposta:** restaurar o `closeSync` no `finally`, como `openSync` e
  `readSync`. A duplicação entre os dois arquivos fica para quando houver um
  helper de teste comum aos `.test.mjs`.
- **Severidade:** backlog.
- **Responsável sugerido:** backend-dev.
- **Estado:** aberto.

### DT-4: `live.test.mjs` conta cálculos com temporizadores reais
- **Local:** `tests/live.test.mjs:63,86,110,130`, commit `c40e187`.
- **Origem:** revisão da change `painel-custo-collect`, achado R5 (rodada 1), 2026-10-29.
- **Problema:** o relógio do coletor é injetado, mas as asserções de contagem
  dependem de `sleep` reais (350, 250 e 500 ms contra debounce de 700 ms e
  polling de 40 ms). No macOS o `fs.watch` pode entregar dois eventos da mesma
  escrita com mais de `debounceMs` (100 ms) entre eles, o que dá dois cálculos
  e um vermelho falso no gate. Contra a regra "testes de invariante no gate
  determinísticos, sem tempo".
- **Proposta:** disparar o `broadcast` por um gancho do contexto, ou deixar
  `debounceMs` e `pollMs` sob controle do teste, em vez de esperar o temporizador.
- **Severidade:** backlog.
- **Responsável sugerido:** backend-dev.
- **Estado:** aberto.

## Painel (`dashboard/live.mjs`)

### DT-5: `fs.watch` de `.claude/ai-team/` só abre no tick seguinte
- **Local:** `dashboard/live.mjs` (abertura dos watchers).
- **Origem:** limitação do `qa-report.md` da change `painel-custo-collect` (pré-existente), 2026-10-29.
- **Problema:** se `.claude/ai-team/` não existe na partida do servidor, o
  `fs.watch` dessa pasta só abre no próximo tick do polling (5 s). Uma
  pendência criada nesse intervalo só aparece no tick.
- **Proposta:** vigiar o pai até a pasta existir, ou criá-la na partida.
- **Severidade:** backlog.
- **Responsável sugerido:** backend-dev.
- **Estado:** aberto.

## Painel (`dashboard/hook.sh`)

### DT-6: `dashboard/hook.sh` com modo 100644 no git
- **Local:** `dashboard/hook.sh` (modo `100644` no índice).
- **Origem:** limitação do `qa-report.md` da change `painel-custo-collect` (pré-existente), 2026-10-29.
- **Problema:** a execução direta dá `Permission denied`. Os `settings.json`
  instalados dependem do `chmod` do instalador, e os testes usam `bash hook.sh`.
- **Proposta:** `git update-index --chmod=+x dashboard/hook.sh` e um teste que
  confira o bit de execução.
- **Severidade:** backlog.
- **Responsável sugerido:** devops.
- **Estado:** aberto.
