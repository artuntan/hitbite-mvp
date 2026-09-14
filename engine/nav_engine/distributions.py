"""``distributions.csv``: load, merge chain events by ``distribution_id`` and write back."""

from __future__ import annotations

import csv
from collections.abc import Iterable
from pathlib import Path

from pydantic import ValidationError

from nav_engine.errors import DataError
from nav_engine.money import fmt_plain, fmt_unit
from nav_engine.schemas import DistributionRow

DISTRIBUTIONS_COLUMNS = [
    "date",
    "distribution_id",
    "usdc_amount",
    "total_supply_tokens",
    "usdc_per_token",
    "tx_hash",
    "source",
]


def load_distributions(path: Path, *, missing_ok: bool = False) -> list[DistributionRow]:
    """Read distribution rows. Only ``date``, ``distribution_id`` and ``usdc_per_token`` are required."""
    if not path.is_file():
        if missing_ok:
            return []
        raise DataError(f"distributions file not found: {path}")
    rows: list[DistributionRow] = []
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            return rows
        missing = {"date", "distribution_id", "usdc_per_token"} - set(reader.fieldnames)
        if missing:
            raise DataError(f"{path}: missing columns {sorted(missing)}")
        for lineno, raw in enumerate(reader, start=2):
            if not any((v or "").strip() for v in raw.values()):
                continue
            try:
                rows.append(DistributionRow.model_validate(raw))
            except ValidationError as exc:
                detail = "; ".join(
                    f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()
                )
                raise DataError(f"{path} line {lineno}: {detail}") from exc
    ids = [r.distribution_id for r in rows]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise DataError(f"{path}: duplicate distribution_id {dupes}")
    return sorted(rows, key=lambda r: (r.date, r.distribution_id))


def merge_distributions(
    existing: Iterable[DistributionRow], incoming: Iterable[DistributionRow]
) -> list[DistributionRow]:
    """Upsert ``incoming`` over ``existing`` by ``distribution_id``; sorted by (date, id)."""
    by_id = {row.distribution_id: row for row in existing}
    for row in incoming:
        by_id[row.distribution_id] = row
    return sorted(by_id.values(), key=lambda r: (r.date, r.distribution_id))


def write_distributions(path: Path, rows: Iterable[DistributionRow]) -> None:
    """Write the full-column CSV deterministically (idempotent for identical rows)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(DISTRIBUTIONS_COLUMNS)
        for row in sorted(rows, key=lambda r: (r.date, r.distribution_id)):
            writer.writerow(
                [
                    row.date.isoformat(),
                    row.distribution_id,
                    fmt_unit(row.usdc_amount) if row.usdc_amount is not None else "",
                    fmt_plain(row.total_supply_tokens)
                    if row.total_supply_tokens is not None
                    else "",
                    fmt_unit(row.usdc_per_token),
                    row.tx_hash or "",
                    row.source,
                ]
            )
