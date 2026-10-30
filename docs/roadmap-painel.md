# Roadmap do painel: sessão, decisões, notificações e acesso remoto

Levantado em 28/10/26. Ponto de partida: `origin/main` (hub, tarefas avulsas, hook com `SessionStart`/`UserPromptExpansion`).

## Pedidos

1. Ver no painel a lista de etapas da sessão e a pergunta que ela está fazendo.
2. Expor o painel na internet, fechado, rodando a partir da máquina local; ser avisado quando um agente termina.
3. Responder pelo painel as decisões da sessão (opções ou texto livre) e a resposta chegar na sessão.
4. Notificação sempre que chegar uma decisão.
5. Trilha de agentes do drawer da change (como num projeto com changes do OpenSpec) também no pas.

O 3 cabe dentro do 1 e do 4.

## O que já existe

- **5.** O drawer de change com trilha de etapas e conversa está no `origin/main`, o mesmo para todo projeto. No pas não aparece porque lá só há tarefa avulsa e `buildTrail` (`dashboard/stages.mjs`) devolve `null` para `status === 'avulsa'`.
- **1 (lista de etapas).** O app desktop grava no transcript da sessão as chamadas `mcp__ccd_turn__update_plan` (`items` / `advance` / `done` / `start`) e `mcp__ccd_turn__wrap_up` (`recap`, `ask`, `actions`). `feedSession` em `collect.mjs` já percorre esses registros.
- **1 (pedido de permissão).** Não fica no transcript enquanto está pendente; só por hook.

## Hooks do Claude Code que servem (https://code.claude.com/docs/en/hooks)

- `PermissionRequest`: stdin com `tool_name`, `tool_input`, `permission_suggestions`. Responde com `hookSpecificOutput.decision.behavior` = `allow` (com `updatedInput`, `updatedPermissions`) ou `deny` (com `message`, `interrupt`). Saída vazia = fluxo normal. Roda em subagentes. Com host `canUseTool` (caso do app desktop) roda junto, e vale quem decidir primeiro. **Não documentado:** se o diálogo aparece enquanto o hook espera. Testar antes de construir.
- `PreToolUse` em `AskUserQuestion`: `permissionDecision: "allow"` + `updatedInput` com as `questions` originais e `answers` `{ "<texto da pergunta>": "<resposta>" }`. Só `allow` sem `answers` não basta.
- `Notification`: `notification_type` (`permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input`, `agent_completed`…), `message`, `title`. Só efeito colateral; `permission_prompt` chega ~6 s depois do diálogo.
- `SubagentStop`: `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`. `Stop`: `last_assistant_message`.
- Mandar mensagem para uma sessão local em andamento: só pelo Remote Control. A pergunta da caixa de próximo passo do app (`wrap_up`) não é `AskUserQuestion`; o painel mostra, mas não responde.

## Etapas

### A. Lista de etapas e pergunta da sessão (só leitura)
- `feedSession`: guardar o último `update_plan` com `items` e aplicar `advance`/`done`/`start` por cima; guardar o último `wrap_up` (`recap`, `ask`, `actions`), limpo no próximo prompt real.
- `/api/state`: `plan` e `ask` por sessão. Painel: na linha da sessão principal e no drawer, a lista com o passo atual e a pergunta pendente.
- Testes com fixture de transcript contendo as duas chamadas.
- Estado: implementado na branch `feat/painel-plano-sessao` (`dashboard/plan.mjs`). Também lê `TodoWrite` e `AskUserQuestion` sem resposta, e desfaz chamada que voltou com erro: num dos projetos o orchestrator não tem `update_plan` ("No such tool available").

### B. Pendências respondidas pelo painel
- Primeiro: experimento no app desktop com um `PermissionRequest` que espera 60 s, para ver se o diálogo do app aparece junto e quem vence.
- `hook.sh` (ou um `pending.mjs` chamado por ele): grava `.claude/ai-team/pending/<id>.json` (sessão, agente, ferramenta, comando ou perguntas e opções) e espera `.claude/ai-team/answers/<id>.json` até um prazo (`AI_TEAM_ANSWER_WAIT`, padrão curto); sem resposta, sai vazio e o app pergunta como sempre.
- `PermissionRequest` → permitir uma vez / negar (com motivo). `PreToolUse` `AskUserQuestion` → opções, multisseleção e "Outro" em texto.
- Servidor: `GET /api/pending`, `POST /api/answer` (grava o arquivo de resposta). Painel: cartão "decisões pendentes" no topo, e no drawer da sessão.
- Pendência some quando respondida no app (o transcript ganha o `tool_result`) ou quando o prazo vence.

- Estado: implementado na branch `feat/painel-decisoes` (`dashboard/ask.mjs`). Resultado do laboratório (28/10, app desktop, Claude Code 2.1.310):
  - o diálogo do app aparece enquanto o hook `PermissionRequest` espera; vale a primeira resposta (app ou hook);
  - `allow` do hook roda o comando; `updatedInput.answers` no `PermissionRequest` responde a `AskUserQuestion`;
  - pelo `PreToolUse` a pergunta só aparece na tela depois que o hook sai: não usar para perguntas;
  - sem `tool_use_id` no `PermissionRequest`: "respondida no app" é detectada pelo `tool_use` de mesmo nome e input com `tool_result` no transcript.

### C. Notificações
- Servidor observa `pending/` (decisão nova) e `events.jsonl` (`SubagentStop`, `Stop`) e publica no **ntfy** (tópico com token; servidor próprio opcional), com link para a pendência ou a change.
- Conf: `NOTIFY_NTFY_URL`, `NOTIFY_NTFY_TOKEN`, `NOTIFY_ON=agent_stop,decision`.
- Depois, se valer a pena: Web Push com o painel como PWA (precisa de HTTPS, que o passo D dá).

- Estado: implementado na branch `feat/painel-notificacoes` (`dashboard/notify.mjs`). Os hooks mandam direto ao ntfy, sem depender do painel aberto: `ask.mjs` (decisão), `hook.sh` em `SubagentStop` e `Stop`. Config do usuário em `~/.config/ai-team/notify.json`; `detail: false` para não mandar comando nem texto ao servidor. Próximo passo possível: botões de ação do ntfy chamando o `/api/answer`, quando o painel tiver login (D).

### D. Acesso remoto fechado
- **Tailscale Serve** (recomendado): HTTPS dentro da tailnet, sem abrir porta; celular com o app do Tailscale. Servidor continua em `127.0.0.1`.
- Alternativa com domínio próprio: Cloudflare Tunnel + Cloudflare Access (login por e-mail).
- Obrigatório quando B existir: o painel passa a aprovar comandos, então nada público (sem Funnel), token nas rotas `POST`, checagem de `Origin` e log de quem respondeu o quê.

- Estado: implementado na branch `feat/painel-acesso-remoto` (`dashboard/auth.mjs`). Local livre; de fora (proxy, outro Host, outra interface) só com token, por cookie do `/login` ou Bearer; sem token, recusado. `X-Forwarded-Host` aceito na checagem de origem do `POST /api/answer`. Tailscale ainda não instalado nesta máquina (28/10).

### E. Trilha para tarefas avulsas (pedido 5)
Ver a seção abaixo.

## E. Trilha da tarefa avulsa

Hoje o drawer da avulsa mostra a faixa "Agora" e a conversa, mas não a trilha. Proposta: trilha curta montada só das rodadas, sem proposta/aprovação/tasks:

- Etapas: Build → Review → Fix → Validation → Integration (o `flow` de cada rodada, que já é inferido do prompt).
- Cada etapa com os avatares de quem trabalhou nela, estado (concluída, agora, na fila) e número de rodadas; Integração fica com o orchestrator.
- Etapa atual = rodada ativa; sem rodada ativa e com rodadas concluídas, a última etapa com rodada fica concluída e a seguinte fica pendente.
- Rodadas fora da equipe (`flow` nulo: Explore, general-purpose) não entram na trilha.
- Estado: implementado na branch `feat/painel-trilha-avulsa` (`looseTrail` em `dashboard/stages.mjs`).
