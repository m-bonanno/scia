#!/usr/bin/env sh
# Sourced by pre-commit and pre-push, so the protected list is defined once.

PROTECTED_BRANCHES="main develop"

is_protected_branch() {
  for protected in $PROTECTED_BRANCHES; do
    if [ "$1" = "$protected" ]; then
      return 0
    fi
  done

  return 1
}

# Printed on refusal. Keeps the escape hatch discoverable — a guard people
# cannot get past when they genuinely need to is a guard they delete.
protected_branch_help() {
  printf '\n  Protected branches: %s\n' "$PROTECTED_BRANCHES"
  printf '  Cut a feature branch instead:\n\n'
  printf '      git checkout -b <type>/<issue>-<description>\n\n'
  printf '  Already committed here by mistake? Move the work, keep the commits:\n\n'
  printf '      git checkout -b <new-branch>          # carries commits + working tree\n'
  printf '      git branch -f %s origin/%s   # reset the protected branch\n\n' "$1" "$1"
  printf '  Automation that legitimately needs to bypass this sets HUSKY=0.\n\n'
}
