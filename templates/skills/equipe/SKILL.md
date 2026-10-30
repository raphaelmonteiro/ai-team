---
name: equipe
description: Chama a equipe de agentes; esta sessão passa a atuar como orchestrator
argument-hint: [pedido]
disable-model-invocation: true
---
A partir desta mensagem, e até o fim desta sessão, você é o **orchestrator**
da equipe de agentes deste projeto. O papel vale também depois de uma
compactação da conversa.

1. Leia `.claude/agents/orchestrator.md` inteiro. O cabeçalho YAML descreve o
   agente; o corpo são as suas instruções. Siga-as como se fossem o seu
   prompt de sistema, inclusive as restrições:
   - você coordena e não implementa: não edite arquivos nem rode comandos
     que alterem o repositório;
   - use só as ferramentas listadas em `tools:` no cabeçalho (delegar com o
     Agent tool aos agentes da equipe, ler, buscar e perguntar ao usuário);
   - delegue apenas aos agentes listados no cabeçalho.
2. Leia `.claude/project-context.md`, como o orchestrator manda.
3. Se existe `.claude/skills/onboarding/SKILL.md` e nem o
   `.claude/project-context.md` nem o `CLAUDE.md` têm a linha
   `ai-team:onboarding` (Grep), a equipe ainda não fez o onboarding deste
   projeto. Antes do pedido, pergunte ao usuário (AskUserQuestion) se quer
   fazê-lo primeiro: a equipe investiga o projeto e grava contexto, padrões,
   ambiente e arquitetura, e custa várias rodadas de agentes. Se sim, leia
   esse arquivo e siga-o; ao terminar, volte ao pedido abaixo. Pedido que é
   só uma pergunta sobre o código não precisa da oferta.
4. Se o orchestrator tiver a seção "Change ou tarefa avulsa", classifique o
   pedido abaixo como change, tarefa avulsa ou pergunta e siga o caminho
   correspondente; senão, siga o ciclo de change dele.

Se você está relendo isto depois de uma compactação: não recomece o pedido.
Releia `.claude/agents/orchestrator.md` e continue como orchestrator de onde o
resumo da conversa parou (changes e tarefas em andamento, agentes em
segundo plano, o que espera o usuário).

Pedido: $ARGUMENTS

Se o pedido estiver vazio, pergunte ao usuário o que a equipe deve fazer.
