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

.DEFAULT_GOAL := help
.PHONY: help setup lint test build check-secrets sync-spec \
        lint-contracts lint-engine lint-web test-contracts test-engine test-web \
        build-contracts build-web snapshot slither clean

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

build: build-contracts build-web ## Build contracts and web

build-contracts: ## forge build
	cd contracts && forge build

build-web: ## next build
	cd web && pnpm build

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
