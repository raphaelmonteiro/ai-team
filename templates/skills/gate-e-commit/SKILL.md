---
name: gate-e-commit
description: Protocolo de gate, commit, marcadores do tasks.md e push do {{PROJECT_NAME}}. Carregado pelos agentes que commitam código (devops, backend-dev, frontend-dev); vale para toda task, correção de achado e tarefa avulsa.
user-invocable: false
---

# Gate, commit e push

Protocolo único das frentes que commitam código. O que é próprio da sua
função (camadas, testes, contrato) está no seu agente; aqui fica só o
caminho de uma alteração até o push. Onde o código é editado e como a
change chega à branch de trabalho está na skill `worktree`: os commits
vão para `change/<id>`, no worktree da change.

## Frentes
{{#if HAS_BACKEND}}
- **Backend** (seções `0. Infra`{{#if SAME_DIR}}{{#if HAS_FRONTEND}}, `1. Backend` e `2. Frontend`, mesmo pacote{{else}} e `1. Backend`{{/if}}{{else}} e `1. Backend`{{/if}}): `{{BACKEND_DIR}}/`, branch de
  trabalho `{{BACKEND_BRANCH}}`{{#if BACKEND_PROTECTED_BRANCH}}, protegida `{{BACKEND_PROTECTED_BRANCH}}`{{/if}}.
  Gate: {{#if BACKEND_GATE}}`{{BACKEND_GATE}}`{{else}}nenhum comando detectado (ver abaixo){{/if}}.{{#if BACKEND_CMD_E2E}}
  E2E: `{{BACKEND_CMD_E2E}}`.{{/if}}
{{/if}}
{{#if HAS_FRONTEND}}
{{#unless SAME_DIR}}
- **Frontend** (seção `2. Frontend`): `{{FRONTEND_DIR}}/`, branch de
  trabalho `{{FRONTEND_BRANCH}}`{{#if FRONTEND_PROTECTED_BRANCH}}, protegida `{{FRONTEND_PROTECTED_BRANCH}}`{{/if}}.
  Gate: {{#if FRONTEND_GATE}}`{{FRONTEND_GATE}}`{{else}}nenhum comando detectado (ver abaixo){{/if}}.{{#if FRONTEND_CMD_E2E}}
  E2E (roteiros): `{{FRONTEND_CMD_E2E}}`.{{/if}}
{{/unless}}
{{/if}}

Sem gate detectado: use os comandos de `.claude/project-context.md`; se
também estiverem vazios, defina lint/teste/build com a change, registre-os
no `design.md` e em `.claude/ai-team.conf`.

## Durante a seção
- O gate roda dentro do worktree da change.
- Gate rápido antes do `[x]` de cada task e de cada commit intermediário:
  todos os comandos com código 0.
- E2E só filtrado pela suíte ou roteiros da change, nunca o completo
  durante o desenvolvimento, em pilha própria e nunca em paralelo com o
  gate.
- Checagem vermelha: a task fica `[ ]` e você reporta a falha. Não
  desligue regra, não use `eslint-disable`/`noqa`/`@ts-ignore`, não
  acrescente `ignore` nem relaxe limite sem registrar a exceção, com
  justificativa, no `design.md` da change.

## Commit
- Só os arquivos da task, adicionados pelo caminho (`git add <arquivo>`);
  nunca `git add -A`/`.`/`-u`, nunca `--no-verify`.
- Não deixe alteração sua sem commit: o code-reviewer revisa só os
  commits registrados.

## Fechamento da seção
Rode o gate rápido e o e2e filtrado da change e grave no fim da sua seção
do `tasks.md`:

```
<!-- commits: <sha> <sha> -->
<!-- gate: <sha> <comando>=0 <comando>=0 ... -->
<!-- e2e: FILTER=<suíte ou roteiros da change> -->
```

No `gate`, um par `nome=código` por comando do gate da frente (ex.:
`lint=0 typecheck=0 test=0 build=0 e2e=0`), com o sha do último commit.
Sem e2e na seção, omita a linha `e2e`.

## Push
Ao gravar o gate de fechamento, do worktree: `git push -u origin change/<id>`.
A branch de trabalho só recebe push na integração (skill `worktree`).
- Nunca na branch protegida; nunca `--force` em branch compartilhada.
- `--force-with-lease` só na `change/<id>`, após rebase.
- Antes do primeiro push de um branch novo, confira que não há `.env` nem
  segredos nos commits.

## Achados do code-reviewer
- Bloqueante `R<k>` endereçado a você: corrija só o que o achado pede, em
  commit novo, e grave o gate de novo, com o mesmo `FILTER`.
- "Corrigir antes do arquivamento": commit novo, gate filtrado e
  `<!-- aplicados: R<k> <sha> -->` na sua seção; não há nova rodada.

## Tarefa avulsa
Sem change nem `tasks.md`: vale tudo acima, menos os marcadores. Devolva
no retorno os shas e a linha do gate (`<sha> lint=0 test=0 ...`).
