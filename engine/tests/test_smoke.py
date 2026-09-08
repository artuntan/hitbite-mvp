from importlib.metadata import version

import pytest

from nav_engine import __version__
from nav_engine.cli import main


def test_version_matches_package_metadata() -> None:
    assert __version__ == "0.1.0"
    assert version("nav-engine") == __version__


def test_cli_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main(["--version"])
    assert excinfo.value.code == 0
    assert capsys.readouterr().out.strip() == f"nav-engine {__version__}"
