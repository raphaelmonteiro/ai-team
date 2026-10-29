---
name: worktree
description: Um worktree por change no {{PROJECT_NAME}}: onde o código da change é editado, onde ficam os artefatos do OpenSpec, como integrar na branch de trabalho e fechar. Carregado pelos agentes que commitam código (devops, backend-dev, frontend-dev).
user-invocable: false
---

# Worktree da change

Toda change tem a branch `change/<id>` e um worktree próprio em
`.claude/worktrees/`. O checkout principal fica na branch de trabalho,
livre para o usuário e para a integração. Tarefa avulsa segue o mesmo
caminho, com o slug no lugar do id.

Script: `.claude/skills/worktree/wt.sh` (rode da raiz do projeto).

## Abrir, em toda rodada
```
.claude/skills/worktree/wt.sh abrir <id> <frente>
```
`<frente>` é `backend` (seções `0. Infra` e `1. Backend`) ou `frontend`
(seção `2. Frontend`). O script cria a branch a partir da branch de
trabalho da frente na primeira vez e depois só devolve o mesmo worktree.
Ele imprime a pasta da frente dentro do worktree: é ali que você trabalha
o que, no checkout principal, seria {{#if HAS_BACKEND}}`{{BACKEND_DIR}}/`{{/if}}{{#if HAS_FRONTEND}}{{#unless SAME_DIR}} ou `{{FRONTEND_DIR}}/`{{/unless}}{{/if}}.

- Código: leia, edite e commite **só no worktree**. Read/Edit/Write com o
  caminho absoluto que o script imprimiu; no Bash, `cd <pasta> && ...` em
  cada comando, inclusive o gate.
- Worktree novo: o script copia `.env*` do checkout principal; instale as
  dependências da stack antes do primeiro gate.
- Nunca troque de branch dentro do worktree nem trabalhe no worktree de
  outra change.

## Artefatos ficam no checkout principal
`openspec/changes/<id>/` (`tasks.md`, `design.md`, relatórios) e
`.claude/project-context.md` são lidos e escritos **no checkout
principal**, nunca na cópia que existe dentro do worktree: é lá que o
tech-lead e o painel leem. Não commite `openspec/` na `change/<id>`.

## Ambiente
Banco e serviços da pilha principal podem ser usados. O que roda código da
change (dev server, worker, e2e) sobe do worktree; se outra change estiver
rodando, use porta própria{{#if HAS_DOCKER}} e, para containers da change,
`COMPOSE_PROJECT_NAME={{PROJECT_NAME}}-<id>`{{/if}}. Ao devolver, derrube o que
subiu.

## Integrar, só quando o tech-lead mandar
Depois de revisão aprovada (e QA, quando houver), o tech-lead pede a cada
dev a integração da sua frente:

1. `.claude/skills/worktree/wt.sh integrar <id> <frente>`: `merge --no-ff`
   de `change/<id>` na branch de trabalho, no checkout principal; imprime
   o sha do merge. Se o checkout principal não está na branch de trabalho
   ou há conflito, o script não integra: devolva a mensagem ao tech-lead.
2. Rode o gate no checkout principal. Vermelho: não faça push, não desfaça
   o merge; devolva a saída ao tech-lead.
3. Verde: `git push origin <branch de trabalho>`.
4. `.claude/skills/worktree/wt.sh fechar <id>`: remove os worktrees e
   apaga as branches locais da change já integradas; as frentes ainda não
   integradas ficam.

Devolva o sha do merge e a linha do gate.

## Proibido
`git worktree remove --force`, apagar pasta de `.claude/worktrees/` à mão,
`git worktree prune` com worktree de outra change, integrar sem o pedido
do tech-lead.
