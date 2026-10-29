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
