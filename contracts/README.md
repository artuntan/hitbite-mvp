# contracts/

Foundry project for the HitBite testnet MVP: `IdentityRegistry`, `HBToken` (`hbTRS`) and `MockUSDC`.

Testnet only. Never configured for a mainnet.

```bash
forge build          # compile (solc 0.8.26, OpenZeppelin v5.7.0)
forge test           # unit, fuzz and invariant tests
forge fmt --check    # formatting
forge snapshot       # gas snapshot (.gas-snapshot)
```

Roles, addresses, deployment and verification instructions are added in Phases 1–3.
