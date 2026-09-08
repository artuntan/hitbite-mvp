# nav-engine

Python 3.11 engine that computes the HitBite fund NAV, produces the signed attestation and pushes NAV to the on-chain oracle. Managed with [uv](https://docs.astral.sh/uv/).

All portfolio, price and distribution data is **simulated** for the testnet MVP; nothing here reflects real holdings.

```sh
uv sync                                     # create .venv and install locked deps
uv run pytest                               # tests
uv run ruff check . && uv run ruff format --check . && uv run mypy nav_engine   # lint, format, types
uv run nav-engine --version
```
