# HitBite MVP — task runner. Run `make help` for targets.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export PATH := $(HOME)/.foundry/bin:$(HOME)/.local/bin:$(PATH)

# Load .env if present (never committed). Values already exported win.
ifneq (,$(wildcard .env))
include .env
export
endif

CHAIN ?= anvil
SPEC_SRC ?= ../../HitBite-MVP-SPEC.md

# --- deployment ------------------------------------------------------------
ANVIL_HOST ?= 127.0.0.1
ANVIL_PORT ?= 8545
ANVIL_RPC_URL ?= http://$(ANVIL_HOST):$(ANVIL_PORT)
BASE_SEPOLIA_RPC_URL ?= https://sepolia.base.org
# Anvil's first published development account, as an *address*. Anvil keeps it unlocked, so
# `forge script --unlocked --sender` signs local deployments and no private key is ever needed, written down or
# passed on a command line for the local flow (D18). Never used on a public network: `make deploy
# CHAIN=base-sepolia` requires DEPLOYER_PRIVATE_KEY and never falls back to this.
ANVIL_SENDER ?= 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

RPC_URL := $(if $(filter base-sepolia,$(CHAIN)),$(BASE_SEPOLIA_RPC_URL),$(ANVIL_RPC_URL))
DEPLOYMENT_JSON := contracts/deployments/$(CHAIN).json
ifeq ($(CHAIN),base-sepolia)
SIGNER :=
else
SIGNER := $(if $(DEPLOYER_PRIVATE_KEY),,--unlocked --sender $(ANVIL_SENDER))
endif

.DEFAULT_GOAL := help
.PHONY: help setup lint test build check-secrets sync-spec \
        lint-contracts lint-engine lint-web test-contracts test-engine test-web \
        build-contracts build-web snapshot slither nav attest attest-verify push push-dry dev clean \
        anvil deploy deploy-local seed verify require-chain require-signer

help: ## List targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
setup: ## Install toolchains and dependencies (submodules, uv, pnpm, playwright)
	git submodule update --init --recursive
	cd engine && uv sync
	cd web && pnpm install --frozen-lockfile && pnpm exec playwright install chromium
	@echo "setup: done. Copy .env.example to .env and web/.env.local."

# ---------------------------------------------------------------------------
# Lint / test / build (aggregate targets mirror CI jobs)
# ---------------------------------------------------------------------------
lint: lint-contracts lint-engine lint-web check-secrets ## Lint everything

lint-contracts: ## forge fmt --check
	cd contracts && forge fmt --check

lint-engine: ## ruff + mypy
	cd engine && uv run ruff check . && uv run ruff format --check . && uv run mypy nav_engine

lint-web: ## eslint + prettier + tsc
	cd web && pnpm lint && pnpm format:check && pnpm typecheck

test: test-contracts test-engine test-web ## Run all test suites

test-contracts: ## forge test
	cd contracts && forge test

test-engine: ## pytest
	cd engine && uv run pytest

test-web: ## vitest + build + playwright smoke
	cd web && pnpm test && pnpm build && pnpm test:e2e

dev: ## Run the web app against the configured chain (http://localhost:3000)
	cd web && pnpm dev

build: build-contracts build-web ## Build contracts and web

build-contracts: ## forge build
	cd contracts && forge build

build-web: ## next build
	cd web && pnpm build

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
nav: ## Compute NAV and write web/public/data/*.json (AS_OF=YYYY-MM-DD, NAV_ARGS=--no-chain)
	cd engine && uv run nav-engine compute $(if $(AS_OF),--as-of $(AS_OF),) $(NAV_ARGS)

attest: ## Sign web/public/data/attestation.json (needs ATTESTOR_PRIVATE_KEY; simulated attestor, D34)
	cd engine && uv run nav-engine attest $(ATTEST_ARGS)

attest-verify: ## Verify the published attestation signature without a key
	cd engine && uv run nav-engine attest --verify ../web/public/data/attestation.json

push-dry: ## Show what setNAV would send on CHAIN, without sending it (needs a deployment JSON)
	cd engine && uv run nav-engine push --deployment ../$(DEPLOYMENT_JSON) --rpc $(RPC_URL) --dry-run $(PUSH_ARGS)

push: ## Send setNAV on CHAIN with ORACLE_PRIVATE_KEY (rail-checked; --force needs --reason)
	cd engine && uv run nav-engine push --deployment ../$(DEPLOYMENT_JSON) --rpc $(RPC_URL) $(PUSH_ARGS)

# ---------------------------------------------------------------------------
# Deployment (contracts/script/*.s.sol). CHAIN=anvil | base-sepolia; testnets only.
# ---------------------------------------------------------------------------
require-chain:
	@case "$(CHAIN)" in anvil|base-sepolia) ;; *) echo "CHAIN=$(CHAIN) is not a supported testnet (anvil|base-sepolia)"; exit 1 ;; esac

require-signer: require-chain
	@if [ "$(CHAIN)" = "base-sepolia" ] && [ -z "$${DEPLOYER_PRIVATE_KEY:-}" ]; then \
	  echo "CHAIN=base-sepolia needs DEPLOYER_PRIVATE_KEY in the environment (see .env.example)"; exit 1; fi

anvil: ## Run a local Anvil node in the foreground on 127.0.0.1:8545 (ANVIL_HOST/ANVIL_PORT)
	anvil --host $(ANVIL_HOST) --port $(ANVIL_PORT)

deploy-local: ## Deploy to the local Anvil node and write contracts/deployments/anvil.json
	@$(MAKE) --no-print-directory deploy CHAIN=anvil

# `--slow` sends one transaction at a time. It is required, not a nicety: foundry 1.8.1 mis-associates transaction
# hashes in broadcast/run-latest.json when it sends concurrently, and `record()` reads that file. The cast
# cross-check below fails the target if a recorded hash did not in fact create the address recorded next to it.
deploy: require-signer ## Deploy to CHAIN and write contracts/deployments/<chain>.json (CHAIN=anvil|base-sepolia)
	cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url $(RPC_URL) --broadcast --slow $(SIGNER)
	cd contracts && forge script script/Deploy.s.sol:Deploy --sig "record()" --rpc-url $(RPC_URL)
	@for name in MockUSDC IdentityRegistry HBToken; do \
	  addr=$$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["addresses"][sys.argv[2]])' "$(DEPLOYMENT_JSON)" "$$name"); \
	  hash=$$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["txHashes"][sys.argv[2]])' "$(DEPLOYMENT_JSON)" "$$name"); \
	  got=$$(cast receipt "$$hash" contractAddress --rpc-url $(RPC_URL) | tr 'A-Z' 'a-z'); \
	  if [ "$$got" != "$$(echo "$$addr" | tr 'A-Z' 'a-z')" ]; then \
	    echo "deploy: txHashes.$$name ($$hash) did not create $$addr (receipt says '$$got')"; exit 1; fi; \
	  echo "  verified $$name $$addr created by $$hash"; \
	done

seed: require-signer ## Verify + fund the two demo wallets and set the opening NAV on CHAIN
	cd contracts && forge script script/Seed.s.sol:Seed --rpc-url $(RPC_URL) --broadcast --slow $(SIGNER)

verify: require-chain ## Verify the deployed contracts on Basescan (CHAIN=base-sepolia, BASESCAN_API_KEY)
	@if [ "$(CHAIN)" != "base-sepolia" ]; then echo "verify: only base-sepolia has an explorer (CHAIN=base-sepolia)"; exit 1; fi
	@if [ -z "$${BASESCAN_API_KEY:-}" ]; then echo "verify: set BASESCAN_API_KEY (Basescan Sepolia API key)"; exit 1; fi
	@if [ ! -f "$(DEPLOYMENT_JSON)" ]; then echo "verify: $(DEPLOYMENT_JSON) not found - run 'make deploy CHAIN=base-sepolia' first"; exit 1; fi
	@for name in MockUSDC IdentityRegistry HBToken; do \
	  addr=$$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["addresses"][sys.argv[2]])' "$(DEPLOYMENT_JSON)" "$$name"); \
	  echo "verifying $$name at $$addr"; \
	  (cd contracts && forge verify-contract "$$addr" "src/$$name.sol:$$name" --chain 84532 \
	     --rpc-url $(RPC_URL) --guess-constructor-args --etherscan-api-key "$$BASESCAN_API_KEY" --watch); \
	done

snapshot: ## Refresh contracts/.gas-snapshot (unit tests only)
	cd contracts && forge snapshot --no-match-test "invariant|testFuzz"

slither: ## Static analysis (requires `uv tool install slither-analyzer`)
	cd contracts && slither . --config-file slither.config.json

check-secrets: ## Regex secret scan over tracked files
	bash scripts/check-secrets.sh

sync-spec: ## Copy the founders' spec into SPEC.md (SPEC_SRC=$(SPEC_SRC))
	cp "$(SPEC_SRC)" SPEC.md && git diff --stat -- SPEC.md

clean: ## Remove build artifacts
	rm -rf contracts/out contracts/cache web/.next web/playwright-report web/test-results engine/.pytest_cache
