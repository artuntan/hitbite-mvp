#!/usr/bin/env python3
"""Scan git-visible working files without printing potential secret values."""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gitleaks", action="store_true", help="Also require a redacted gitleaks scan")
    args = parser.parse_args()
    root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
    names = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
    ).decode().split("\0")
    files = [root / name for name in sorted(set(names)) if name and (root / name).is_file()]
    failures = []
    assignments = re.compile(
        r"(?:PRIVATE_KEY|PRIVATEKEY|MNEMONIC|SEED_PHRASE|API_KEY|AUTH_TOKEN|SECRET)"
        r"[A-Z_]*\s*[:=]\s*[\"']?(?:0x)?[a-fA-F0-9]{32,}"
    )
    literal_key = re.compile(r"(?<![a-fA-F0-9])0x[a-fA-F0-9]{64}(?![a-fA-F0-9])")
    source_extensions = {".ts", ".tsx", ".js", ".mjs", ".py", ".sol", ".sh", ".yml", ".yaml", ".toml"}
    for path in files:
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            failures.append(f"{relative}: symlinks must be reviewed before inclusion")
            continue
        if path.name.startswith(".env") and path.name != ".env.example":
            failures.append(f"{relative}: environment files must not be tracked")
        if path.suffix in {".key", ".pem"}:
            failures.append(f"{relative}: key files must not be tracked")
        if relative.startswith("contracts/lib/") or path.name == "pnpm-lock.yaml":
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(content.splitlines(), 1):
            if assignments.search(line) or (
                (path.suffix in source_extensions or path.name == ".env.example") and literal_key.search(line)
            ):
                failures.append(f"{relative}:{number}: potential secret (value withheld)")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    if args.gitleaks:
        if not shutil.which("gitleaks"):
            print("gitleaks is required for --gitleaks; install the pinned CI version.", file=sys.stderr)
            return 1
        # Scan the current candidate tree, including new files, without traversing
        # ignored .env, .context, dependency caches or the preserved v1 history.
        with tempfile.TemporaryDirectory(prefix="hitbite-secret-scan-") as directory:
            for path in files:
                target = Path(directory) / path.relative_to(root)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
            report = Path(directory) / "scan-report.json"
            result = subprocess.run(
                ["gitleaks", "dir", "--redact=100", "--no-banner", "--report-format", "json",
                 "--report-path", str(report), directory], check=False
            )
            if result.returncode:
                if report.exists():
                    for finding in json.loads(report.read_text()):
                        print(f"{finding['File']}:{finding['StartLine']}: {finding['RuleID']} (value withheld)", file=sys.stderr)
                return result.returncode
    print("Secret checks passed for git-visible working files; no values printed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
