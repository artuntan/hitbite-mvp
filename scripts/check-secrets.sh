#!/usr/bin/env bash
# Simple regex secret scan over tracked AND untracked-but-not-ignored files (complements gitleaks in CI).
# --untracked matters: a leak in a brand-new file must fail the gate BEFORE it is ever staged.
# Fails if: a .env file is tracked; a PRIVATE_KEY/mnemonic assignment has a value;
# or a bare 32-byte hex string appears in source/config files (Anvil's public dev keys excepted).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

status=0

# 1. No .env files tracked (only .env.example allowed)
tracked_env=$( { git ls-files; git ls-files --others --exclude-standard; } | grep -E '(^|/)\.env(\..+)?$' | grep -v -E '(^|/)\.env\.example$' || true)
if [[ -n "$tracked_env" ]]; then
  echo "FAIL: .env file(s) tracked:"; echo "$tracked_env"; status=1
fi

# 2. Key/mnemonic assignments with a non-empty value
assign=$(git grep --untracked -n -I -E '(PRIVATE_KEY|PRIVATEKEY|MNEMONIC|SEED_PHRASE|API_KEY|AUTH_TOKEN|SECRET)[A-Z_]*\s*[:=]\s*["'"'"']?(0x)?[0-9a-fA-F]{32,}' -- \
  ':!contracts/lib/**' ':!**/pnpm-lock.yaml' ':!**/uv.lock' ':!scripts/check-secrets.sh' || true)
assign=$(echo "$assign" | grep -v -F -f scripts/anvil-public-keys.txt || true)
if [[ -n "$assign" ]]; then
  echo "FAIL: secret-looking assignment(s):"; echo "$assign"; status=1
fi

# 3. Bare 32-byte hex in source/config (not JSON/MD where tx hashes legitimately appear)
bare=$(git grep --untracked -n -I -E '(^|[^0-9a-fA-F])0x[0-9a-fA-F]{64}([^0-9a-fA-F]|$)' -- \
  '*.ts' '*.tsx' '*.js' '*.mjs' '*.py' '*.sol' '*.sh' '*.yml' '*.yaml' '*.toml' '*.env.example' 'Makefile' \
  ':!contracts/lib/**' ':!scripts/check-secrets.sh' || true)
bare=$(echo "$bare" | grep -v -F -f scripts/anvil-public-keys.txt | grep -v 'allow-secret' || true)
if [[ -n "$bare" ]]; then
  echo "FAIL: bare 32-byte hex literal(s) (add '// allow-secret' only for non-secret hashes):"; echo "$bare"; status=1
fi

if [[ $status -eq 0 ]]; then echo "check-secrets: OK"; fi
exit $status
