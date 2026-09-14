import json
from pathlib import Path

import pytest

from nav_engine.cli import main
from tests.conftest import DATA_DIR, FIXTURES_DIR

FIXTURE_DISTRIBUTIONS = str(FIXTURES_DIR / "distributions_fixture.csv")


def test_compute_end_to_end(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = main(
        [
            "compute",
            "--as-of",
            "2026-09-15",
            "--no-chain",
            "--data-dir",
            str(DATA_DIR),
            "--distributions",
            FIXTURE_DISTRIBUTIONS,
            "--out",
            str(tmp_path),
            "--generated-at",
            "2026-09-15T06:00:00Z",
        ]
    )
    assert code == 0
    out = capsys.readouterr()
    assert "usdc_6dec 994658" in out.out
    assert "warning:" in out.err  # the chain is not configured; this is said out loud
    nav = json.loads((tmp_path / "nav.json").read_text())
    assert nav["nav"]["usdc_6dec"] == 994658
    assert nav["as_of"] == "2026-09-15"
    assert nav["generated_at"] == "2026-09-15T06:00:00Z"
    assert nav["simulated"] is True
    for name in ("holdings.json", "nav_history.json", "scenarios.json"):
        assert (tmp_path / name).is_file()


def test_compute_no_write(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "never"
    code = main(
        [
            "compute",
            "--as-of",
            "2026-09-15",
            "--no-chain",
            "--distributions",
            FIXTURE_DISTRIBUTIONS,
            "--out",
            str(out),
            "--no-write",
        ]
    )
    assert code == 0
    assert not out.exists()
    assert "994658" in capsys.readouterr().out


def test_schemas_command(tmp_path: Path) -> None:
    assert main(["schemas", "--out", str(tmp_path / "schemas")]) == 0
    names = sorted(p.name for p in (tmp_path / "schemas").glob("*.schema.json"))
    assert names == [
        "holdings.schema.json",
        "nav.schema.json",
        "nav_history.schema.json",
        "scenarios.schema.json",
    ]
    nav_schema = json.loads((tmp_path / "schemas" / "nav.schema.json").read_text())
    assert nav_schema["$schema"].startswith("https://json-schema.org/")
    assert nav_schema["properties"]["simulated"]["const"] is True
    assert nav_schema["$defs"]["NavBlock"]["properties"]["per_token_usd"]["type"] == "string"
    assert nav_schema["$defs"]["NavBlock"]["properties"]["usdc_6dec"]["type"] == "integer"
    assert nav_schema["additionalProperties"] is False


def test_bad_as_of_format_exits_non_zero(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main(["compute", "--as-of", "15/09/2026", "--no-chain"])
    assert excinfo.value.code == 2
    assert "YYYY-MM-DD" in capsys.readouterr().err


def test_as_of_before_inception_is_readable_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(["compute", "--as-of", "2026-01-01", "--no-chain", "--out", str(tmp_path)])
    assert code == 2
    err = capsys.readouterr().err
    assert err.startswith("error:")
    assert "before inception" in err
    assert not (tmp_path / "nav.json").exists()


def test_missing_data_dir_is_readable_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(
        ["compute", "--no-chain", "--data-dir", str(tmp_path / "nowhere"), "--out", str(tmp_path)]
    )
    assert code == 2
    assert "portfolio file not found" in capsys.readouterr().err


def test_bad_generated_at_is_readable_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(["compute", "--no-chain", "--out", str(tmp_path), "--generated-at", "yesterday"])
    assert code == 2
    assert "--generated-at" in capsys.readouterr().err


def test_deployment_file_without_rpc_skips_chain(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    deployment = tmp_path / "anvil.json"
    deployment.write_text(
        json.dumps({"chainId": 31337, "addresses": {"HBToken": "0x" + "ab" * 20}})
    )
    code = main(
        [
            "compute",
            "--as-of",
            "2026-09-15",
            "--deployment",
            str(deployment),
            "--distributions",
            FIXTURE_DISTRIBUTIONS,
            "--out",
            str(tmp_path / "out"),
        ]
    )
    assert code == 0
    err = capsys.readouterr().err
    assert "chain skipped" in err and "--rpc" in err
    nav = json.loads((tmp_path / "out" / "nav.json").read_text())
    assert nav["chain"]["token_address"] == "0x" + "ab" * 20
    assert nav["chain"]["chain_id"] == 31337
    assert nav["chain"]["supply_source"] in {"none", "cache"}


def test_unreachable_rpc_never_crashes_compute(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(
        [
            "compute",
            "--as-of",
            "2026-09-15",
            "--rpc",
            "http://127.0.0.1:1",
            "--token",
            "0x" + "ab" * 20,
            "--chain-id",
            "31337",
            "--distributions",
            FIXTURE_DISTRIBUTIONS,
            "--out",
            str(tmp_path / "out"),
        ]
    )
    assert code == 0
    nav = json.loads((tmp_path / "out" / "nav.json").read_text())
    assert nav["nav"]["usdc_6dec"] == 994658
    assert nav["chain"]["supply_source"] in {"none", "cache"}
    assert "RPC read failed" in nav["chain"]["warning"]


def test_no_command_prints_help(capsys: pytest.CaptureFixture[str]) -> None:
    assert main([]) == 0
    assert "compute" in capsys.readouterr().out
