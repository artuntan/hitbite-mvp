#!/usr/bin/env bash
# Fail if any contract in contracts/src/ drops below 100% on lines, statements, branches or
# functions.
#
# The README tells a reviewer that coverage on src/ is 100% across all four measures. A claim in a
# README that nothing enforces is a claim that quietly stops being true. This is what enforces it.
#
# Only src/ is checked. Test helpers and the invariant handler are deliberately not at 100% — they
# contain branches that exist to bound a fuzzer, not to be exercised — so the aggregate "Total" row
# is meaningless here and must never be quoted as src coverage.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/contracts"

export PATH="$HOME/.foundry/bin:$PATH"

report=$(forge coverage --no-match-coverage script --report summary 2>/dev/null)

# Rows look like:  | src/HBToken.sol | 100.00% (144/144) | 100.00% (191/191) | ... |
src_rows=$(echo "$report" | grep -E '^\| src/' || true)

if [[ -z "$src_rows" ]]; then
  echo "check-coverage: FAIL — no src/ rows in the coverage report. Did forge coverage run?"
  echo "$report" | tail -20
  exit 1
fi

status=0
while IFS= read -r row; do
  file=$(echo "$row" | awk -F'|' '{gsub(/ /,"",$2); print $2}')
  # Columns 3..6 are lines, statements, branches, functions.
  for col in 3 4 5 6; do
    pct=$(echo "$row" | awk -F'|' -v c="$col" '{print $c}' | grep -oE '^[[:space:]]*[0-9.]+%' | tr -d ' %')
    case $col in
      3) label=lines ;;
      4) label=statements ;;
      5) label=branches ;;
      *) label=functions ;;
    esac
    if [[ -z "$pct" ]]; then
      echo "check-coverage: FAIL — could not read $label for $file"
      status=1
    elif [[ "$pct" != "100.00" ]]; then
      echo "check-coverage: FAIL — $file $label at ${pct}%, expected 100.00%"
      status=1
    fi
  done
done <<< "$src_rows"

if [[ $status -eq 0 ]]; then
  count=$(echo "$src_rows" | wc -l | tr -d ' ')
  echo "check-coverage: OK — $count file(s) in src/ at 100% lines, statements, branches and functions"
fi
exit $status
