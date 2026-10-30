# Contexto do projeto — {{PROJECT_NAME}}

<!-- gerado pelo ai-team a partir de .claude/ai-team.conf; para mudar algo acima
     do marcador "ai-team:notas", edite o .conf e rode install.sh --render.
     O que estiver abaixo do marcador é seu e é preservado. -->

{{#if PROJECT_DESCRIPTION}}
{{PROJECT_DESCRIPTION}}

{{/if}}
## Organização
- Layout: {{LAYOUT}}{{#if SAME_DIR}} (backend e frontend no mesmo pacote){{/if}}
{{#if HAS_BACKEND}}
- Backend: `{{BACKEND_DIR}}/` — {{BACKEND_STACK}}
{{/if}}
{{#if HAS_FRONTEND}}
{{#unless SAME_DIR}}
- Frontend: `{{FRONTEND_DIR}}/` — {{FRONTEND_STACK}}
{{/unless}}
{{/if}}
{{#if OTHER_PKGS}}
- Outros pacotes: {{OTHER_PKGS}}
{{/if}}
{{#if HAS_OPENSPEC}}
- Specs e changes: `openspec/` (OpenSpec)
{{else}}
- OpenSpec ainda não inicializado (`openspec init` cria `openspec/`)
{{/if}}

## Git
- Branch padrão: `{{GIT_DEFAULT_BRANCH}}`{{#if GIT_REMOTE}} · remoto: {{GIT_REMOTE}}{{/if}}
{{#if HAS_BACKEND}}
- Backend: commits na branch `{{BACKEND_BRANCH}}`{{#if BACKEND_OWN_REPO}} (repositório próprio em `{{BACKEND_DIR}}/`){{/if}}{{#if BACKEND_PROTECTED_BRANCH}}; **nunca** commitar nem fazer push na `{{BACKEND_PROTECTED_BRANCH}}`{{/if}}
{{/if}}
{{#if HAS_FRONTEND}}
{{#unless SAME_DIR}}
- Frontend: commits na branch `{{FRONTEND_BRANCH}}`{{#if FRONTEND_OWN_REPO}} (repositório próprio em `{{FRONTEND_DIR}}/`){{/if}}{{#if FRONTEND_PROTECTED_BRANCH}}; **nunca** commitar nem fazer push na `{{FRONTEND_PROTECTED_BRANCH}}`{{/if}}
{{/unless}}
{{/if}}
- Nunca `--force` em branch compartilhada; `--force-with-lease` só em branch próprio de change, após rebase.

{{#if HAS_BACKEND}}
## Backend (`{{BACKEND_DIR}}/`)
- Stack: {{BACKEND_STACK}}
{{#if BACKEND_SRC_DIR}}
- Código em `{{BACKEND_SRC_DIR}}/`{{#if BACKEND_TEST_DIR}}; testes em `{{BACKEND_TEST_DIR}}/`{{/if}}
{{/if}}
- Gate rápido (todos com código 0, antes de marcar task e em cada commit):
{{#if BACKEND_CMD_LINT}}
  - lint: `{{BACKEND_CMD_LINT}}`
{{/if}}
{{#if BACKEND_CMD_FORMAT}}
  - formatação: `{{BACKEND_CMD_FORMAT}}`
{{/if}}
{{#if BACKEND_CMD_TYPECHECK}}
  - tipos: `{{BACKEND_CMD_TYPECHECK}}`
{{/if}}
{{#if BACKEND_CMD_TEST}}
  - testes: `{{BACKEND_CMD_TEST}}`
{{/if}}
{{#if BACKEND_CMD_BUILD}}
  - build: `{{BACKEND_CMD_BUILD}}`
{{/if}}
{{#unless BACKEND_GATE}}
  - (nenhum comando detectado; preencha `BACKEND_CMD_*` no `.claude/ai-team.conf`)
{{/unless}}
{{#if BACKEND_CMD_E2E}}
- e2e / integração (não faz parte do gate rápido): `{{BACKEND_CMD_E2E}}`
{{/if}}
{{#if BACKEND_CMD_DEV}}
- Subir localmente: `{{BACKEND_CMD_DEV}}`
{{/if}}
{{#if BACKEND_DOCS}}
- Documentos do pacote: {{BACKEND_DOCS}}
{{/if}}

{{/if}}
{{#if HAS_FRONTEND}}
{{#unless SAME_DIR}}
## Frontend (`{{FRONTEND_DIR}}/`)
- Stack: {{FRONTEND_STACK}}
{{#if FRONTEND_SRC_DIR}}
- Código em `{{FRONTEND_SRC_DIR}}/`{{#if FRONTEND_TEST_DIR}}; testes em `{{FRONTEND_TEST_DIR}}/`{{/if}}
{{/if}}
- Gate rápido (todos com código 0, antes de marcar task e em cada commit):
{{#if FRONTEND_CMD_LINT}}
  - lint: `{{FRONTEND_CMD_LINT}}`
{{/if}}
{{#if FRONTEND_CMD_FORMAT}}
  - formatação: `{{FRONTEND_CMD_FORMAT}}`
{{/if}}
{{#if FRONTEND_CMD_TYPECHECK}}
  - tipos: `{{FRONTEND_CMD_TYPECHECK}}`
{{/if}}
{{#if FRONTEND_CMD_TEST}}
  - testes: `{{FRONTEND_CMD_TEST}}`
{{/if}}
{{#if FRONTEND_CMD_BUILD}}
  - build: `{{FRONTEND_CMD_BUILD}}`
{{/if}}
{{#unless FRONTEND_GATE}}
  - (nenhum comando detectado; preencha `FRONTEND_CMD_*` no `.claude/ai-team.conf`)
{{/unless}}
{{#if FRONTEND_CMD_E2E}}
- Roteiros de navegador / e2e (fora do gate rápido): `{{FRONTEND_CMD_E2E}}`
{{/if}}
{{#if FRONTEND_CMD_DEV}}
- Subir localmente: `{{FRONTEND_CMD_DEV}}`
{{/if}}
{{#if FRONTEND_DOCS}}
- Documentos do pacote: {{FRONTEND_DOCS}}
{{/if}}

{{/unless}}
{{/if}}
## Documentos de referência (ordem de leitura)
{{#if DOCS_CONTEXT}}
- Contexto para agentes: {{DOCS_CONTEXT}}
{{/if}}
{{#if DOCS_STANDARDS}}
- Padrões e convenções (régua da revisão de código): {{DOCS_STANDARDS}}
{{/if}}
{{#if BACKEND_DOCS_STANDARDS}}
- Padrões do backend: {{BACKEND_DOCS_STANDARDS}} (em `{{BACKEND_DIR}}/`)
{{/if}}
{{#if FRONTEND_DOCS_STANDARDS}}
- Padrões do frontend: {{FRONTEND_DOCS_STANDARDS}} (em `{{FRONTEND_DIR}}/`)
{{/if}}
{{#if DOCS_ENV}}
- Ambiente local (fatos confirmados, portas, contornos): {{DOCS_ENV}}
{{/if}}
{{#if DOCS_ARCH}}
- Arquitetura e decisões: {{DOCS_ARCH}}
{{/if}}
{{#if DOCS_README}}
- {{DOCS_README}}
{{/if}}
{{#if DOCS_OTHER}}
- Outros: {{DOCS_OTHER}}
{{/if}}
{{#unless DOCS_STANDARDS}}
{{#unless BACKEND_DOCS_STANDARDS}}
- **Não há documento de padrões.** O reviewer usa como régua o `design.md` da change, as convenções visíveis no código existente e as regras gerais (duplicação, camadas, nomes, tamanho). Vale criar `docs/padroes.md` e apontar em `DOCS_STANDARDS`.
{{/unless}}
{{/unless}}

## Infra local
{{#if DOCKER_COMPOSE_FILE}}
- Docker Compose: `{{DOCKER_COMPOSE_FILE}}`
{{/if}}
{{#if DOCKERFILES}}
- Dockerfiles: {{DOCKERFILES}}
{{/if}}
{{#if HAS_MAKEFILE}}
- Makefile na raiz, alvos: {{MAKE_TARGETS}}
{{/if}}
{{#if CI}}
- CI / hooks: {{CI}}
{{/if}}
{{#unless HAS_DOCKER}}
{{#unless HAS_MAKEFILE}}
- Nada detectado (sem Docker Compose nem Makefile na raiz).
{{/unless}}
{{/unless}}

{{#if TEST_PERSONAS}}
## Personas de teste
{{TEST_PERSONAS}}

{{/if}}
## Proibições de ambiente (valem para todos os agentes)
- `kill`/`pkill` dentro de container; parar ou remover a pilha de outro agente.
- `docker compose down -v`, reset de banco ou apagar volumes da pilha principal sem autorização.
- Deixar processo em segundo plano (dev server, `tail -f`) ao devolver.
- `find /` e buscas fora das pastas do projeto.
- Rodar o gate em paralelo com e2e.
{{#if BACKEND_PROTECTED_BRANCH}}
- Commit ou push na `{{BACKEND_PROTECTED_BRANCH}}`{{#if BACKEND_OWN_REPO}} de `{{BACKEND_DIR}}/`{{/if}}.
{{/if}}
{{#if FRONTEND_PROTECTED_BRANCH}}
{{#unless SAME_DIR}}
- Commit ou push na `{{FRONTEND_PROTECTED_BRANCH}}`{{#if FRONTEND_OWN_REPO}} de `{{FRONTEND_DIR}}/`{{/if}}.
{{/unless}}
{{/if}}

<!-- ai-team:notas -->
## Notas do projeto
(Escreva aqui o que o detector não vê: regras de negócio, integrações externas,
personas, decisões em aberto. Esta seção é preservada ao re-renderizar.)
