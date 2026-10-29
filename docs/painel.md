# Painel

Referência do painel do ai-team: o que cada parte mostra, os hooks, as decisões, as notificações e o acesso de fora da máquina. Para abrir e para a visão geral, veja a seção "Painel" do [README](../README.md).

```bash
cd meu-projeto
node .claude/dashboard/server.mjs          # http://127.0.0.1:4321/
# ou, do repo clonado: make dashboard TARGET=~/Sites/projeto
```

O painel lê os transcripts que o Claude Code grava em `~/.claude/projects/<projeto>/` (sessão principal e `…/subagents/agent-*.jsonl`) e o `openspec/` do projeto. Não precisa de hook nem de dependência: Node 18+ e pronto. Atualiza sozinho (SSE sobre `fs.watch`, com polling de reserva). O servidor calcula o estado uma vez por mudança e o guarda: com alguma aba conectada (`/events`) e nada mudado desde o cálculo, `GET /api/state` devolve o estado guardado, para qualquer número de abas; sem aba, cada `GET` recalcula. Mudam o estado um evento de `fs.watch`, um `POST /api/answer` ou `/api/away` e o tick do polling (5 s), que continua como rede de segurança: cobre `fs.watch` perdido, as transições que dependem só do tempo (rodando → sem sinal depois de `--stale-min`) e as sessões do projeto em outra pasta de `~/.claude/projects`, que o `fs.watch` não observa. O aviso `update` só sai quando o estado difere do último avisado, sem contar o carimbo `generatedAt`; por isso o "atualizado HH:MM" do cabeçalho é a hora da **última mudança**, não da última conferência (com agente rodando muda a cada tick, porque a duração dele cresce). O formato de `/api/state` e de `/events` não mudou.

## Página principal

- **Esforço por agente**: tempo trabalhado, tokens (entrada, saída, cache lido e gravado), rodadas, changes tocadas, modelos usados. A sessão principal da equipe conta como o tech-lead (ou o `"agent"` do `settings.json`), com o tempo dos turnos ativos.
- **Sessão da equipe ou avulsa**: com `"agent"` fixo no `settings.json`, toda sessão é da equipe. Sem ele, uma sessão é da equipe quando chamou `/equipe` ou `/onboarding` ou delegou a um agente de `.claude/agents/`; as outras são *sessões avulsas* (Claude comum), mostradas à parte com contagem, tempo e tokens, fora do esforço dos agentes e das changes.
- **Quadro de changes**: os agentes rodando agora (change, etapa inferida do prompt, desde quando, última atividade; "terminou" não prova sucesso); as changes em andamento, bloqueadas e pendentes e as 3 últimas concluídas (as demais recolhidas), com início, tasks `x/y` por seção, última revisão e QA, rodadas, trocas de agente, tempo e tokens; e **"esperando o quê"** por heurística (regras em `dashboard/board.mjs`; mostra a regra que disparou e, sem regra, "indefinido"). Clicar numa change lista também os `.md` dela, servidos como texto em `/changes/<id>/<arquivo>.md` (só proposal, design, tasks, review/qa-report e `specs/**`; traversal recusado).
- **Agente ativo** em cada change em andamento, com modelo, há quanto tempo trabalha e quantos tokens já custou. Tokens aparecem em duas colunas: "novos" (entrada + saída + cache gravado) e "cache lido"; o `/api/state` traz também os campos brutos (`input`, `output`, `cacheRead`, `cacheCreation`) em `usage`/`tokenSplit`.
- **Clique na change**: a lista de rodadas, cada uma com início, fim, duração, tokens, modelo, de quem veio e para quem foi, descrição; clique na linha para ver o retorno e o prompt. **Clique no agente**: as rodadas dele em todas as changes.

Definições: uma *rodada* é uma delegação do tech-lead a um agente (uma chamada do Agent tool); *trocas* conta quantas vezes a change passou para um agente diferente do anterior; a change de uma rodada vem do prompt da delegação (`openspec/changes/<id>` ou o id citado). Rodadas sem change aparecem em "Fora de changes", e as de tarefa avulsa ficam agrupadas lá pelo slug de `Tarefa avulsa: <slug>`. Tokens somam `input + output + cache_read + cache_creation` de cada resposta, sem contar duas vezes os blocos da mesma requisição.

Estados do agente: rodando (verde), sem sinal (âmbar; sem atividade no transcript há mais de `--stale-min`, padrão 15, e sem término), terminou (cinza), falhou (vermelho), interrompido. Cada agente e rodada mostra a sessão de origem (título do transcript, senão o primeiro prompt encurtado, senão o id curto).

### Estado declarado

Uma linha no cabeçalho do `tasks.md` manda na etapa, no "esperando quem" e no "próximo" (a heurística fica de reserva; o painel mostra "declarado" ou "inferido" e avisa se a linha for inválida):

```
<!-- estado: <etapa> · aguarda: <quem> · desde: <aaaa-mm-ddThh:mmZ> · nota: <texto curto opcional> -->
```

`etapa`: proposta, aprovacao, implementacao, revisao, correcao, qa, integracao, arquivada. `aguarda`: desenvolvedor, tech-lead, product-owner, devops, backend-dev, frontend-dev, code-reviewer, qa, fila.

### Lista de etapas e pergunta da sessão

Sem hook: o painel lê do transcript de cada sessão da equipe a lista de etapas (`update_plan` do app desktop, ou `TodoWrite` do CLI) e a pergunta pendente (a do fim do turno, `wrap_up`, até o próximo prompt; ou uma `AskUserQuestion` ainda sem resposta). Sessões abertas com lista ou pergunta ganham um cartão abaixo de "Agentes agora", e a etapa atual aparece na coluna "etapa" da sessão principal. Chamada que voltou com erro (sessão sem as ferramentas do app) é ignorada. Lógica em `dashboard/plan.mjs`; no `/api/state`, `mainRuns[].plan`, `.ask` e `.recap`. Responder pelo painel: permissões e `AskUserQuestion` em "Decisões pelo painel"; a pergunta do fim do turno, só com "Longe do computador" ligado.

`node .claude/dashboard/collect.mjs` imprime o mesmo estado no terminal (`--json` para o JSON completo).

## Hooks

`settings.json` criado pelo instalador aponta `SubagentStart`/`SubagentStop` (painel) e `SessionStart`/`UserPromptExpansion` (`/equipe`) para `.claude/dashboard/hook.sh`, que repassa para o `hook.mjs` (Node 18+; sem node os hooks não fazem nada) e grava `.claude/ai-team/events.jsonl` (fora do git: ver "O que versionar" no README); com `--no-dashboard` só o `hook.sh` e o `hook.mjs` são copiados. O `events.jsonl` não cresce sem limite: ao passar de `AI_TEAM_EVENTS_MAX_BYTES` (padrão 1048576, 1 MiB; valor inválido vale o padrão) o hook o renomeia para `events.jsonl.1` (substituindo a geração anterior) e começa um arquivo novo com os `TeamStart` de cada sessão (até metade do limite, os mais recentes); só um hook gira por vez (trava `events.jsonl.lock`, abandonada depois de 30 s) e nenhuma linha se perde. O painel e o lembrete pós-compactação leem as duas gerações; o que se perde é o início e fim exatos de rodadas mais velhas que duas gerações, que voltam a usar os timestamps do transcript. Painel antigo com hook novo lê só o arquivo atual (mesma perda, até reiniciar o painel). O evento `TeamStart` (do `/equipe`, do `/onboarding` ou de `claude --agent tech-lead`) diz ao painel, com exatidão, quais sessões são da equipe. Com eles, início e fim de cada rodada ficam exatos mesmo em agentes de segundo plano; sem eles, o painel usa os timestamps dos transcripts e considera ativa uma rodada sem fim registrado com atividade nos últimos 10 minutos. Se o `settings.json` já existia, o instalador acrescenta só os hooks do ai-team que faltam (ver "Decisões pelo painel").

## Decisões pelo painel

O hook `PermissionRequest` (`node .claude/dashboard/ask.mjs`, que o instalador põe no `settings.json` novo) grava cada pedido de permissão e cada `AskUserQuestion` em `.claude/ai-team/pending/` e espera a resposta. O painel mostra no topo "Decisões esperando você": o comando (ou o arquivo) com **Permitir uma vez** / **Negar** (com motivo, que volta para o Claude), e as perguntas com as opções, multisseleção e "Outro" em texto livre. O app mostra o diálogo dele ao mesmo tempo e vale a primeira resposta; respondida no app (o transcript ganha o `tool_result`), a pendência some. Sem resposta, o hook desiste em `AI_TEAM_ASK_WAIT_S` (padrão 280 s) e fica só o app; com **longe do computador** ligado, espera `AI_TEAM_AWAY_WAIT_S` (padrão 3300 s, ~55 min). O `timeout` do hook é 3600; projeto instalado com 300 é ajustado por `node .claude/dashboard/settings.mjs`. A pergunta também aparece no cartão da sessão, só para leitura: enquanto o hook espera, o cartão aponta para "Decisões esperando você"; depois, avisa que o painel não espera mais e que a resposta é na sessão. Subagente em segundo plano não tem diálogo: o painel é o único lugar para aprovar. `AI_TEAM_ASK=0` desliga. Rotas: `pending` no `/api/state` e `POST /api/answer` (`{ id, behavior: allow|deny, message?, answers? }`, só JSON e da mesma origem). Como o painel aprova comandos, o acesso de fora da máquina exige token (ver "Acesso de fora da máquina"). Projeto com `settings.json` já existente: o instalador acrescenta só os hooks do ai-team que faltam (`dashboard/settings.mjs`, com cópia em `settings.json.bak-ai-team`; o resto do arquivo fica igual). Para fazer isso sem reinstalar: `node .claude/dashboard/settings.mjs` (`--dry-run` mostra antes). Se o JSON tiver comentários, ele não grava e mostra o trecho; o do `PermissionRequest` é

```json
"PermissionRequest": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/dashboard/ask.mjs\"", "timeout": 3600 }] }]
```

## Longe do computador

A pergunta do fim do turno do app (a caixa com botões) não é uma permissão nem uma `AskUserQuestion`: responder a ela é mandar uma mensagem à sessão, o que nenhum hook faz depois que o turno acabou. Por isso o painel só a mostra ("responda na sessão") e o celular recebe "pergunta para você" com a pergunta e as opções. Para responder pelo painel, ligue **longe do computador** no cabeçalho (`.claude/ai-team/away.json`, por projeto): quando o turno vai terminar com uma pergunta, o hook `Stop` (`timeout` 3600) segura o fim do turno e espera até `AI_TEAM_AWAY_WAIT_S` (padrão 3300 s); o painel mostra as opções, um campo de texto e **Deixar para o app**, e a resposta volta como `{"decision":"block","reason":…}`, que o Claude trata como a sua resposta (o app registra como "Stop hook feedback"). Enquanto espera, o app mostra a sessão rodando, sem os botões dele; sem resposta ou com o modo desligado no meio, o turno termina e a pergunta aparece no app. Rota: `GET/POST /api/away`.

## Notificações no celular (ntfy)

Com `~/.config/ai-team/notify.json`, os hooks avisam no app [ntfy](https://ntfy.sh): decisão nova (permissão ou pergunta, a mesma do painel), agente que terminou (`SubagentStop`, com o começo do resumo dele), sessão que terminou o turno e espera você (`Stop`), turno que parou por erro (`StopFailure`: limite de uso, API sobrecarregada, falha de login…) e sessão encerrada (`SessionEnd`: `/clear`, `/resume`, logout, saída; o hook tem `timeout` 10 porque o padrão do Claude Code é 1,5 s). Interromper com Esc ou o botão de parar não avisa: o Claude Code não tem hook para isso (o `Stop` não roda nesse caso). Configs antigas ganham os eventos novos ligados (`eventsVersion`). Sem o arquivo, nada é enviado. Para começar:

```bash
node .claude/dashboard/notify.mjs setup      # cria o arquivo com um tópico aleatório e diz como assinar no celular
node .claude/dashboard/notify.mjs test       # manda uma notificação de teste
```

O instalador cuida disso: se o PC ainda não tem a config, ele pergunta o tópico (enter pula, `novo` gera um) e oferece mandar um teste; sem terminal, use `install.sh --ntfy-topic <tópico>` (num PC já configurado, troca só o tópico). Também dá para configurar pela página **Notificações** do painel (`/notificacoes`): tópico, servidor, token (nunca é mostrado de volta), eventos, conteúdo, endereço do painel, eventos só daquele projeto (ou projeto mudo) e um botão de teste. A config é do PC (vale para todos os projetos); os hooks que disparam ficam no `settings.json` de cada projeto. No arquivo: `ntfy.server`/`topic`/`token` (servidor próprio ou ntfy.sh com token), `on` (`decision`, `agent_stop`, `turn_stop`), `detail` (`false` manda só o título, sem comando nem texto do agente; o ntfy.sh público é aberto a quem souber o tópico) e `dashboardUrl` (aberto ao tocar na notificação). `AI_TEAM_NOTIFY=0` desliga. O envio roda em segundo plano e nunca segura o hook. O `settings.json` novo traz os hooks `Stop`, `StopFailure` e `SessionEnd`; num já existente, o instalador acrescenta os que faltam.

## Acesso de fora da máquina

O painel continua em `127.0.0.1`, livre para quem está na máquina. Pedido que chega por proxy (`X-Forwarded-For`), com outro `Host` ou de outra interface só entra com o token: cookie depois do `/login` (30 dias, `HttpOnly`, `SameSite=Strict`, `Secure` atrás de HTTPS) ou `Authorization: Bearer`. Sem token, o acesso de fora é recusado. O token fica em `~/.config/ai-team/token` (ou `AI_TEAM_TOKEN`); crie com `node .claude/dashboard/auth.mjs token` e reinicie o painel. Para abrir no celular, o caminho recomendado é o **Tailscale Serve** (HTTPS só dentro da sua tailnet, sem abrir porta):

```bash
node .claude/dashboard/auth.mjs token          # uma vez por máquina
node .claude/dashboard/server.mjs              # ou --hub
tailscale serve --bg 4321                      # https://<máquina>.<tailnet>.ts.net/ → 127.0.0.1:4321
```

No celular, com o app do Tailscale ligado, abra o endereço `ts.net`, cole o token e pronto. Ponha esse endereço em `dashboardUrl` do `notify.json` para a notificação abrir o painel. Não use `tailscale funnel` (público na internet). Alternativa com domínio próprio: Cloudflare Tunnel + Cloudflare Access.

## Página Equipe

É a aba "Equipe" do painel; não confundir com a skill `/equipe`, que chama a equipe numa sessão. `dashboard/equipe.html` monta a página no navegador a partir do projeto instalado e é a segunda aba do cabeçalho (o link "Equipe" aparece sempre). Mostra: (1) a **equipe**, lida de `<projeto>/.claude/agents/*.md` (frontmatter `name`, `description`, `model`, `tools`; link para `/agents/<nome>.md`; ponto verde nos agentes rodando agora; "sem frontmatter" quando faltar); (2) **como chamar a equipe**: agente fixo no `settings.json`, ou `/equipe` e `claude --agent tech-lead`, com aviso quando faltam os hooks que mantêm o papel depois da compactação; (3) o **contexto do projeto**, vindo de `.claude/ai-team.conf`, inclusive o time no hub; (4) o **ciclo de uma change**, com a tarefa avulsa. Atualiza por SSE como o painel. Rotas: `/equipe` (HTML), `/api/team` (JSON `{project, agents, context, entry, hasConf}`, só leitura; `entry` traz só `fixedAgent` e booleanos de skill e hooks) e `/agents/<nome>.md` (só `[a-z0-9-]+`). Sem `ai-team.conf` ou sem agentes, a página abre mesmo assim (usa o nome da pasta e avisa que não há agentes).

Chaves do conf expostas (lista fechada em `dashboard/team.mjs`; `GIT_REMOTE`, `TEST_PERSONAS` e o resto não saem): `PROJECT_NAME`, `PROJECT_DESCRIPTION`, `LAYOUT`, `HAS_OPENSPEC`, `CI`, `HUB_TEAM`, `GIT_DEFAULT_BRANCH`, `GIT_WORK_BRANCH`, `GIT_PROTECTED_BRANCHES`, `BACKEND_`/`FRONTEND_` + `DIR`, `STACK`, `BRANCH`, `PROTECTED_BRANCH`, mais `BACKEND_GATE`/`FRONTEND_GATE` (os `*_CMD_LINT/FORMAT/TYPECHECK/TEST/BUILD` unidos por `; `, como o instalador faz) e `DOCS_CONTEXT`, `DOCS_STANDARDS`, `DOCS_ENV`.

### Ciclo por perfil

O trecho "ciclo de uma change" vem de `dashboard/cycle-default.html` (texto genérico: proposta, tasks por seção, gate, revisão, QA, archive). Um perfil troca só esse trecho com `profiles/<perfil>/dashboard/cycle.html`: um fragmento HTML (pode ter `<style>` e `<script>`), que o instalador copia para `.claude/dashboard/` e o servidor insere no lugar do marcador `<!--ai-team:cycle-->` da página. Sem `cycle.html`, vale o padrão. Em projetos com um `equipe.html` antigo de perfil, rode `install.sh --profile <perfil> --force` para trocá-lo pela versão genérica (o instalador não sobrescreve sem `--force`).
