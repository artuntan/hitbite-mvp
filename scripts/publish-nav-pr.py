"""Publish only generated NAV records through a checked PR, without a bypass token."""
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

SNAPSHOTS = {"app/public/data/nav.json", "app/public/data/attestation.json"}


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def validate_changes(paths):
    unexpected = set(paths) - SNAPSHOTS
    if unexpected:
        raise RuntimeError("NAV automation must not commit files other than its two snapshots.")


def checked_run(runs, head, started):
    matches = [r for r in runs if r["headSha"] == head and r["createdAt"] >= started]
    if not matches:
        return None
    latest = max(matches, key=lambda r: r["databaseId"])
    if latest["status"] != "completed":
        return None
    if latest["conclusion"] != "success":
        raise RuntimeError("Snapshot CI did not pass. The PR remains open; main was not changed.")
    return latest["databaseId"]


def main():
    if os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise RuntimeError("NAV publication only runs from main.")
    changed = run("git", "diff", "--name-only", "HEAD").splitlines()
    validate_changes(changed)
    if not changed:
        print("The confirmed snapshots are unchanged; no PR is needed.")
        return
    # Refuse a dirty index or unrelated untracked source as well as tracked edits.
    validate_changes(run("git", "ls-files", "--others", "--exclude-standard").splitlines())
    branch = f"automation/nav-{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}"
    run("git", "switch", "-c", branch)
    run("git", "config", "user.name", "hitbite-nav[bot]")
    run("git", "config", "user.email", "hitbite-nav[bot]@users.noreply.github.com")
    run("git", "add", "--", *sorted(SNAPSHOTS))
    run("git", "commit", "-m", "data: publish confirmed simulated NAV and attestation")
    head = run("git", "rev-parse", "HEAD")
    run("gh", "auth", "setup-git")
    run("git", "push", "--set-upstream", "origin", branch)
    body = Path(os.environ["RUNNER_TEMP"]) / "nav-pr.md"
    body.write_text(
        "Publishes the confirmed Arc Testnet NAV receipt and signed simulated attestation.\n\n"
        "Only the two generated JSON records change. The publishing workflow explicitly "
        "dispatches the normal CI suite and merges this exact commit only after it passes. "
        "Branch protection still applies; a failed or stale publication stays open for review.\n"
    )
    pr = run("gh", "pr", "create", "--base", "main", "--head", branch,
             "--title", "data: publish confirmed simulated NAV", "--body-file", str(body))
    print(f"Opened {pr}", flush=True)
    # GITHUB_TOKEN pushes do not trigger push workflows. Dispatch explicitly;
    # no PAT, pull_request_target, workflow approval or branch bypass is needed.
    started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    run("gh", "workflow", "run", "ci.yml", "--ref", branch)
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        runs = json.loads(run("gh", "run", "list", "--workflow", "ci.yml", "--branch", branch,
                              "--event", "workflow_dispatch", "--limit", "10", "--json",
                              "databaseId,headSha,createdAt,status,conclusion"))
        if checked_run(runs, head, started):
            run("gh", "pr", "merge", pr, "--merge", "--match-head-commit", head, "--delete-branch")
            print("Required CI passed and the snapshot PR merged under branch protection.")
            return
        time.sleep(15)
    raise RuntimeError("Snapshot CI timed out. The PR remains open; main was not changed.")


if __name__ == "__main__":
    main()
