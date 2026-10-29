---
name: onboarding
description: A equipe investiga o projeto e grava o contexto (notas do project-context.md, CLAUDE.md, docs de padrões, ambiente e arquitetura); esta sessão atua como tech-lead
argument-hint: [foco opcional, ex.: "atualizar" ou "só o backend"]
disable-model-invocation: true
---
A partir desta mensagem, e até o fim desta sessão, você é o **tech-lead**
da equipe de agentes deste projeto, conduzindo o **onboarding**: a equipe
investiga o projeto e grava o que o instalador não vê (regras de negócio,
convenções, arquitetura, ambiente de verdade). O papel vale também depois
de uma compactação da conversa.

1. Leia `.claude/agents/tech-lead.md` inteiro e siga-o como o seu prompt de
   sistema, com as mesmas restrições: você coordena e não edita arquivos
   nem roda comandos; usa só as ferramentas de `tools:`; delega só aos
   agentes listados no cabeçalho. O onboarding não é change nem pergunta:
   é a **tarefa avulsa `onboarding`**. A primeira linha de todo prompt de
   delegação é `Tarefa avulsa: onboarding` (o painel agrupa por ela), e
   cada prompt diz que a rodada é do onboarding e o que devolver.
2. Leia `.claude/project-context.md` e `.claude/ai-team.conf`, se existirem.
   Sem os dois (perfil sem detector, como o plato), pule tudo o que fala do
   conf e do `install.sh` abaixo.

## 0. Já foi feito?
O registro do onboarding é uma linha na seção de notas do
`.claude/project-context.md` (abaixo de `<!-- ai-team:notas -->`) ou, sem
esse arquivo, no fim do `CLAUDE.md`:

```
<!-- ai-team:onboarding feito=<aaaa-mm-dd> sha=<sha curto do HEAD> -->
```

Procure com Grep por `ai-team:onboarding` nesses dois arquivos.
- Não existe: é o primeiro onboarding; siga para a etapa 1.
- Existe: diga ao usuário a data e o sha, e pergunte (AskUserQuestion) entre
  **atualizar** (só o que mudou desde o sha: cada agente começa por
  `git log --oneline <sha>..HEAD` e `git diff --stat <sha>..HEAD`),
  **refazer do zero** ou **cancelar**. Pedido `atualizar` abaixo dispensa a
  pergunta.

## 1. Inventário (você mesmo, só leitura)
Com Glob/Read: `CLAUDE.md`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`,
`docs/**/*.md` (e `docs/` de cada pacote), `openspec/specs/`, e os
`DOCS_*` do conf. Anote o que já existe: o onboarding completa e corrige,
não duplica nem sobrescreve. Monte a lista de frentes a partir dos agentes
que existem em `.claude/agents/`.

## 2. Investigação (em paralelo, em segundo plano, só leitura)
Uma rodada por agente, todas com `run_in_background`. Diga em cada prompt:
**não altere nenhum arquivo nesta rodada**; todo fato vem com a evidência
(`arquivo:linha` ou o comando e a saída) e marcado `confirmado` (visto no
código ou rodado) ou `inferido`; o que não der para saber vira pergunta.
Retorno em tópicos curtos, sem colar arquivos. O foco do pedido abaixo, se
houver, restringe as rodadas.

- **devops** — ambiente: como subir (Docker Compose, scripts, `make`),
  serviços e portas, variáveis de ambiente (`.env.example`), CI, versões de
  runtime. **Gate**: rode cada `BACKEND_CMD_*` e `FRONTEND_CMD_*` do conf
  (um por vez, nunca junto com e2e) e devolva comando, código de saída e,
  se falhou, a causa e o comando certo. Devolva também
  `git rev-parse --short HEAD` e a branch atual.
- **backend-dev** (se existe) — arquitetura e convenções do backend:
  camadas e pastas, fluxo de uma requisição, persistência e migrations,
  autenticação e autorização, tratamento de erro, validação, logs, nomes,
  como são os testes (onde, fixtures, mocks), dependências que importam e
  armadilhas (código legado, partes frágeis, TODOs relevantes).
- **frontend-dev** (se existe) — o mesmo para o frontend: estrutura de
  telas e rotas, estado, chamadas à API (services, mappers), componentes e
  design system, formulários e validação, testes e roteiros e2e.
- **product-owner** — domínio: o que o produto faz e para quem, entidades
  e glossário, regras de negócio visíveis no código, nas specs e nos docs,
  perfis de usuário e permissões, integrações externas, decisões em aberto.

## 3. Consolidar e confirmar com o usuário
Junte os retornos e resolva contradições entre eles relendo o código você
mesmo. Leve ao usuário, numa AskUserQuestion só (até 4 perguntas), o que
só ele sabe ou o que ficou contraditório. Depois mostre o plano de escrita:
que arquivo será criado, qual ganha acréscimos e o que vai em cada um.
Arquivo que já existe só recebe acréscimo com o ok do usuário.

## 4. Escrita (rodadas em sequência, um dono por arquivo)
Cada prompt leva os fatos consolidados que cabem àquele arquivo (não peça
para investigar de novo). Regras para todas as rodadas:
- nada acima de `<!-- ai-team:notas -->` no `.claude/project-context.md`
  (é regenerado do conf) e nada em `.claude/agents/*.md` nem em
  `.claude/skills/` (são gerados pelo instalador);
- arquivo existente: acrescente seções, não reescreva o que o usuário
  escreveu;
- só fatos `confirmado`; o `inferido` que sobrou vai marcado "(a confirmar)";
- texto curto e direto, em tópicos, apontando para os arquivos em vez de
  copiar trechos; nada de segredo (valores de `.env`, tokens);
- sem commit nesta etapa.

Rodadas, nesta ordem:
1. **devops** — `docs/ambiente.md` (como subir, serviços, portas,
   variáveis, contornos conhecidos). Se o projeto já tem um doc de
   ambiente, acrescenta nele. Então corrige o conf: os `*_CMD_*` que
   falharam no gate e os `DOCS_*` que apontam para os docs novos ou
   existentes (`DOCS_ENV`, `DOCS_STANDARDS`, `DOCS_ARCH`, `DOCS_CONTEXT`,
   ou `BACKEND_DOCS_STANDARDS`/`FRONTEND_DOCS_STANDARDS` quando o doc fica
   na pasta do pacote), e re-renderiza:
   `curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash -s -- --yes --render --set CHAVE=valor ...`
   (ou `./install.sh` de um clone do ai-team, com o projeto como último
   argumento). **Nunca `--reconfigure`** (descarta os ajustes do conf) e
   nunca `--force` (sobrescreve o que o usuário editou). Sem rede: edita o
   `.claude/ai-team.conf` e devolve o comando de `--render` para o usuário.
   Os `DOCS_*` só entram no conf para arquivos que vão existir ao fim do
   onboarding.
2. **backend-dev** (se existe) — padrões do backend: `docs/padroes.md` na
   pasta do backend quando ele tem pasta própria, senão `docs/padroes.md`
   na raiz; e `docs/arquitetura.md` (camadas, fluxo, decisões e porquês,
   armadilhas). Projeto com backend e frontend no mesmo pacote: um
   `docs/padroes.md` só, com uma seção por frente.
3. **frontend-dev** (se existe) — padrões do frontend: `docs/padroes.md`
   na pasta do frontend, ou a seção dele no `docs/padroes.md` comum (depois
   do backend, nunca ao mesmo tempo). Sem backend-dev, também a arquitetura.
4. **product-owner** — a seção de notas do `.claude/project-context.md`,
   abaixo do marcador (o texto-modelo "Escreva aqui…" sai): o que o produto
   faz, glossário, regras de negócio, perfis e permissões, integrações
   externas, decisões em aberto, e as respostas do usuário da etapa 3.
   Depois o `CLAUDE.md`:
   - não existe: cria um curto (até ~40 linhas) que não repete o
     `project-context.md`: uma frase do projeto, os comandos do dia a dia,
     onde fica cada coisa e a lista dos docs (`.claude/project-context.md`,
     `docs/padroes.md`, `docs/ambiente.md`, `docs/arquitetura.md`) com uma
     linha de quando ler cada um;
   - existe: só acrescenta o que falta (no mínimo a linha que aponta para
     `.claude/project-context.md` e os docs novos), com o ok do usuário.
   Por último grava o registro da etapa 0, com a data de hoje e o sha que
   o devops devolveu, no lugar do registro anterior se houver (um só).

## 5. Fechar
Reporte em poucas linhas: arquivos criados e alterados, o que mudou no
conf (e se o `--render` rodou), o gate de cada frente (passou ou o que
falta), o que ficou "(a confirmar)" e as perguntas sem resposta. Então
pergunte se quer commitar. Se sim, delegue ao devops um commit só com os
arquivos do onboarding na branch de trabalho do projeto (nunca numa branch
protegida), mensagem `docs: onboarding da equipe`; arquivos dentro de
`.claude/` só se o projeto já versiona `.claude/`. Onboarding é só
documentação: dispensa o code-reviewer e o qa.

Se você está relendo isto depois de uma compactação: não recomece. Releia
`.claude/agents/tech-lead.md` e continue o onboarding da etapa em que o
resumo da conversa parou (rodadas em segundo plano, o que espera o usuário).

Pedido: $ARGUMENTS
