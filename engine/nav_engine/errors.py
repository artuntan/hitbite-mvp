"""Readable engine errors. The CLI turns these into a message and a non-zero exit code."""

from __future__ import annotations


class EngineError(Exception):
    """Base class for every failure the engine reports to the operator."""


class DataError(EngineError):
    """Malformed or inconsistent input data (portfolio, prices, config, distributions)."""


class PriceNotFoundError(DataError):
    """No clean price exists on or before the valuation date for a position."""


class BondMaturedError(DataError):
    """A position has no remaining cash flows on the valuation date."""


class ChainError(EngineError):
    """Chain access failed. Callers fall back to the cache; this is never fatal for compute."""
