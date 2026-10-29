#!/usr/bin/env bash
# ai-team — um worktree por change (ou tarefa avulsa).
#
#   wt.sh abrir <id> <frente>      cria ou reusa a branch change/<id> e o worktree;
#                                  imprime a pasta da frente dentro do worktree
#   wt.sh onde <id>                worktrees da change, um por linha: <pasta> <branch>
#   wt.sh integrar <id> <frente>   merge --no-ff de change/<id> na branch de trabalho,
#                                  no checkout principal; imprime o sha do merge
#   wt.sh fechar <id>              remove os worktrees e apaga as branches da change
#                                  que já foram integradas; as outras ficam
#
# <frente>: backend (seções 0 e 1) ou frontend (seção 2). Lê .claude/ai-team.conf.
# Os worktrees ficam em .claude/worktrees/: <id>/ para o repositório da raiz e
# <id>-<pasta>/ para pacote com git próprio.
set -euo pipefail

PROJ="$(cd "$(dirname "$0")/../../.." && pwd -P)"
CONF="$PROJ/.claude/ai-team.conf"
WT="$PROJ/.claude/worktrees"
die() { echo "wt: $*" >&2; exit 1; }
[[ -f "$CONF" ]] || die "não achei $CONF"
# shellcheck disable=SC1090
. "$CONF"

CMD="${1:-}"; ID="${2:-}"; FRENTE="${3:-}"
[[ "$ID" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "uso: wt.sh abrir|onde|integrar|fechar <id> [backend|frontend] (id em kebab-case)"
BR="change/$ID"

root_is_repo() { [[ "$(git -C "$PROJ" rev-parse --show-toplevel 2>/dev/null)" == "$PROJ" ]]; }

frente() { # define REPO (checkout principal), WORK (branch de trabalho), ROOT (worktree) e CODE (pasta da frente)
  local P has dir own br
  case "$1" in
    backend|infra) P=BACKEND ;;
    frontend)      P=FRONTEND ;;
    *) die "frente inválida: '$1' (backend ou frontend)" ;;
  esac
  has="HAS_$P"; dir="${P}_DIR"; own="${P}_OWN_REPO"; br="${P}_BRANCH"
  [[ "${!has:-0}" == 1 ]] || die "o projeto não tem $1"
  local d="${!dir:-.}"
  if [[ "${!own:-0}" == 1 ]]; then
    REPO="$PROJ/$d"; ROOT="$WT/$ID-$(basename "$d")"; CODE="$ROOT"
  else
    root_is_repo || die "$PROJ não é a raiz de um repositório git"
    REPO="$PROJ"; ROOT="$WT/$ID"
    if [[ "$d" == . ]]; then CODE="$ROOT"; else CODE="$ROOT/$d"; fi
  fi
  WORK="${!br:-}"
  [[ -n "$WORK" ]] || WORK="$(git -C "$REPO" branch --show-current)"
  [[ -n "$WORK" ]] || die "branch de trabalho de $1 desconhecida (preencha ${P}_BRANCH no conf)"
}

repos() { # repositórios onde uma change pode ter worktree
  root_is_repo && echo "$PROJ"
  local P own dir
  for P in BACKEND FRONTEND; do
    own="${P}_OWN_REPO"; dir="${P}_DIR"
    [[ "${!own:-0}" == 1 ]] && echo "$PROJ/${!dir}"
  done
  return 0
}

worktree_of() { # repo → pasta do worktree que tem a branch da change (vazio se não há)
  git -C "$1" worktree list --porcelain | awk -v b="branch refs/heads/$BR" '/^worktree /{p=substr($0,10)} $0==b{print p}'
}

ignore_worktrees() { # .claude/worktrees/ fora do git da raiz, sem tocar no .gitignore
  root_is_repo || return 0
  local ex; ex="$(git -C "$PROJ" rev-parse --git-path info/exclude)"
  [[ "$ex" = /* ]] || ex="$PROJ/$ex"
  grep -qxF '.claude/worktrees/' "$ex" 2>/dev/null || { mkdir -p "$(dirname "$ex")"; echo '.claude/worktrees/' >> "$ex"; }
}

case "$CMD" in
  abrir)
    frente "$FRENTE"
    have="$(worktree_of "$REPO")"
    if [[ -z "$have" ]]; then
      ignore_worktrees
      mkdir -p "$WT"
      if git -C "$REPO" show-ref --verify --quiet "refs/heads/$BR"; then
        git -C "$REPO" worktree add -q "$ROOT" "$BR"
      else
        git -C "$REPO" worktree add -q -b "$BR" "$ROOT" "$WORK"
      fi
      # .env e afins não são versionados: o worktree nasce com a cópia do checkout principal
      for f in .env .env.local .env.development.local .env.test.local; do
        [[ -f "$REPO/$f" && ! -e "$ROOT/$f" ]] && cp "$REPO/$f" "$ROOT/$f"
      done
      echo "wt: criado $BR a partir de $WORK; instale as dependências antes do primeiro gate" >&2
    elif [[ "$have" != "$ROOT" ]]; then
      ROOT="$have"; [[ "$CODE" == "$WT/$ID"* ]] && CODE="$have${CODE#"$WT/$ID"}"
    fi
    echo "$CODE"
    ;;
  onde)
    while read -r r; do
      w="$(worktree_of "$r")"; [[ -n "$w" ]] && echo "$w $BR"
    done < <(repos)
    ;;
  integrar)
    frente "$FRENTE"
    git -C "$REPO" show-ref --verify --quiet "refs/heads/$BR" || die "branch $BR não existe em $REPO"
    cur="$(git -C "$REPO" branch --show-current)"
    [[ "$cur" == "$WORK" ]] || die "o checkout principal de $REPO está em '$cur', não em '$WORK'; não integrei (devolva ao tech-lead)"
    if ! out="$(git -C "$REPO" merge -q --no-ff --no-edit -m "Merge $BR" "$BR" 2>&1)"; then
      git -C "$REPO" merge --abort 2>/dev/null || true
      echo "$out" >&2
      if grep -q CONFLICT <<< "$out"; then why="conflito"; else why="o merge falhou (saída do git acima)"; fi
      die "$why ao integrar $BR em $WORK; nada foi integrado (devolva ao tech-lead)"
    fi
    git -C "$REPO" rev-parse --short HEAD
    ;;
  fechar)
    while read -r r; do
      w="$(worktree_of "$r")"
      if git -C "$r" show-ref --verify --quiet "refs/heads/$BR" && ! git -C "$r" merge-base --is-ancestor "$BR" HEAD; then
        echo "wt: $BR em $r ainda não foi integrada; worktree e branch mantidos" >&2
        continue
      fi
      if [[ -n "$w" ]]; then
        [[ -z "$(git -C "$w" status --porcelain)" ]] || die "$w tem alterações sem commit; não removi"
        git -C "$r" worktree remove "$w"
        echo "wt: removido $w" >&2
      fi
      if git -C "$r" show-ref --verify --quiet "refs/heads/$BR"; then
        git -C "$r" branch -q -d "$BR" && echo "wt: apagada $BR em $r" >&2
      fi
    done < <(repos)
    rmdir "$WT" 2>/dev/null || true
    ;;
  *) die "comando desconhecido: '$CMD' (abrir, onde, integrar, fechar)" ;;
esac
