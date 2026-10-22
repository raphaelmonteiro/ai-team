#!/usr/bin/env bash
# ai-team — renderizador de templates.
#
#   lib/render.sh <template> [conf]      → stdout
#
# Variáveis vêm do ambiente (o install.sh exporta o ai-team.conf) ou do
# arquivo conf passado como 2º argumento. Sintaxe suportada:
#
#   {{NOME}}                       substitui pelo valor (vazio se não existir)
#   {{#if NOME}} … {{/if}}         só quando NOME é "verdadeiro"
#   {{#unless NOME}} … {{/unless}} só quando NOME é falso
#   {{else}}                       dentro de if/unless
#
# Verdadeiro = não vazio e diferente de 0, false, no. Blocos aninham e
# podem abrir e fechar no meio de uma linha ou em linhas diferentes. Uma
# diretiva sozinha na linha não deixa linha vazia na saída.
set -euo pipefail

TPL="${1:?uso: lib/render.sh <template> [conf]}"
if [[ -n "${2:-}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$2"
  set +a
fi

awk -v tpl="$TPL" '
function truthy(v) { return (v != "" && v != "0" && v != "false" && v != "no") }
function val(name) { return (name in ENVIRON) ? ENVIRON[name] : "" }
function subst(s,   out, name) {
  out = ""
  while (match(s, /\{\{[A-Z][A-Z0-9_]*\}\}/)) {
    name = substr(s, RSTART + 2, RLENGTH - 4)
    out = out substr(s, 1, RSTART - 1) val(name)
    s = substr(s, RSTART + RLENGTH)
  }
  return out s
}
# avalia os tokens i..j
function eval(i, j,   out, k, m, depth, elsek, endk, keep) {
  out = ""; k = i
  while (k <= j) {
    if (ttype[k] == "text") { out = out subst(tval[k]); k++; continue }
    if (ttype[k] == "if" || ttype[k] == "unless") {
      depth = 1; elsek = 0; endk = 0
      for (m = k + 1; m <= j; m++) {
        if (ttype[m] == "if" || ttype[m] == "unless") depth++
        else if (ttype[m] == "end") { depth--; if (depth == 0) { endk = m; break } }
        else if (ttype[m] == "else" && depth == 1 && !elsek) elsek = m
      }
      if (!endk) { printf "render: {{#%s %s}} sem fecho em %s\n", ttype[k], tval[k], tpl > "/dev/stderr"; errors++; endk = j + 1 }
      keep = truthy(val(tval[k])); if (ttype[k] == "unless") keep = !keep
      if (keep) out = out eval(k + 1, (elsek ? elsek : endk) - 1)
      else if (elsek) out = out eval(elsek + 1, endk - 1)
      else if (lstart[k] && !alone[k] && endk < j && ttype[endk + 1] == "text" && substr(tval[endk + 1], 1, 1) == "\n")
        tval[endk + 1] = substr(tval[endk + 1], 2)   # bloco falso que começava a linha: não deixa linha vazia
      k = endk + 1; continue
    }
    printf "render: {{%s}} fora de bloco em %s\n", ttype[k], tpl > "/dev/stderr"; errors++
    k++
  }
  return out
}
{ text = text $0 "\n" }
END {
  n = 0; s = text
  while (match(s, /\{\{(#(if|unless) +[A-Z][A-Z0-9_]*|else|\/if|\/unless)\}\}/)) {
    pre = substr(s, 1, RSTART - 1)
    tag = substr(s, RSTART + 2, RLENGTH - 4)
    post = substr(s, RSTART + RLENGTH)
    # diretiva sozinha na linha: some com a linha inteira
    ls = (pre ~ /(^|\n)[ \t]*$/); al = 0
    if (ls && post ~ /^[ \t]*(\n|$)/) {
      al = 1
      sub(/[ \t]*$/, "", pre)
      sub(/^[ \t]*\n?/, "", post)
    }
    n++; ttype[n] = "text"; tval[n] = pre
    n++; lstart[n] = ls; alone[n] = al
    if (tag ~ /^#if /)          { ttype[n] = "if";     tval[n] = tag; sub(/^#if +/, "", tval[n]) }
    else if (tag ~ /^#unless /) { ttype[n] = "unless"; tval[n] = tag; sub(/^#unless +/, "", tval[n]) }
    else if (tag == "else")     { ttype[n] = "else" }
    else                        { ttype[n] = "end" }
    s = post
  }
  n++; ttype[n] = "text"; tval[n] = s
  printf "%s", eval(1, n)
  if (errors) exit 1
}
' "$TPL"
