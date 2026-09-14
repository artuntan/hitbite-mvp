"""Minimal embedded HBToken ABI: only what the engine reads.

Kept in sync by hand with ``contracts/src/interfaces/IHBToken.sol``. Signatures:

- ``function totalSupply() view returns (uint256)``
- ``function nav() view returns (uint256)``
- ``function decimals() view returns (uint8)``
- ``event CouponDistributed(uint256 indexed distributionId, uint256 usdcAmount, uint256 usdcAllocated,
  uint256 couponIndex, uint256 totalSupply)``
- ``event NAVUpdated(uint256 oldNav, uint256 newNav, uint256 reportedAUM, uint256 timestamp)``
"""

from __future__ import annotations

from typing import Any

HBTOKEN_MIN_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "totalSupply",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "nav",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "decimals",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint8"}],
    },
    {
        "type": "event",
        "name": "CouponDistributed",
        "anonymous": False,
        "inputs": [
            {"name": "distributionId", "type": "uint256", "indexed": True},
            {"name": "usdcAmount", "type": "uint256", "indexed": False},
            {"name": "usdcAllocated", "type": "uint256", "indexed": False},
            {"name": "couponIndex", "type": "uint256", "indexed": False},
            {"name": "totalSupply", "type": "uint256", "indexed": False},
        ],
    },
    {
        "type": "event",
        "name": "NAVUpdated",
        "anonymous": False,
        "inputs": [
            {"name": "oldNav", "type": "uint256", "indexed": False},
            {"name": "newNav", "type": "uint256", "indexed": False},
            {"name": "reportedAUM", "type": "uint256", "indexed": False},
            {"name": "timestamp", "type": "uint256", "indexed": False},
        ],
    },
]

COUPON_DISTRIBUTED_SIGNATURE = "CouponDistributed(uint256,uint256,uint256,uint256,uint256)"
NAV_UPDATED_SIGNATURE = "NAVUpdated(uint256,uint256,uint256,uint256)"
