#!/usr/bin/env bash
# ai-team — template renderer.
#
#   lib/render.sh <template> [conf]      → stdout
#
# Variables come from the environment (install.sh exports ai-team.conf) or from
# the conf file given as 2nd argument. Supported syntax:
#
#   {{NAME}}                       replaced by the value (empty if unset)
#   {{#if NAME}} … {{/if}}         only when NAME is "true"
#   {{#unless NAME}} … {{/unless}} only when NAME is false
#   {{else}}                       inside if/unless
#
# True = non-empty and other than 0, false, no. Blocks nest and can open
# and close mid-line or on different lines. A directive alone on its
# line leaves no empty line in the output.
set -euo pipefail

TPL="${1:?usage: lib/render.sh <template> [conf]}"
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
# evaluates tokens i..j
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
      if (!endk) { printf "render: {{#%s %s}} not closed in %s\n", ttype[k], tval[k], tpl > "/dev/stderr"; errors++; endk = j + 1 }
      keep = truthy(val(tval[k])); if (ttype[k] == "unless") keep = !keep
      if (keep) out = out eval(k + 1, (elsek ? elsek : endk) - 1)
      else if (elsek) out = out eval(elsek + 1, endk - 1)
      else if (lstart[k] && !alone[k] && endk < j && ttype[endk + 1] == "text" && substr(tval[endk + 1], 1, 1) == "\n")
        tval[endk + 1] = substr(tval[endk + 1], 2)   # false block that started the line: leaves no empty line
      k = endk + 1; continue
    }
    printf "render: {{%s}} outside a block in %s\n", ttype[k], tpl > "/dev/stderr"; errors++
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
    # line start: the text before the tag ends a line, or the tag opens the file
    # or follows a directive that was alone on its line (not one closed mid-line)
    if (pre ~ /^[ \t]*$/) ls = (n == 0 || alone[n]); else ls = (pre ~ /\n[ \t]*$/)
    # directive alone on its line: the whole line goes away
    al = 0
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
