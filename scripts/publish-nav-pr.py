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


def own_pr_run(candidate, number, head, branch, repository):
    return (
        candidate.get("event") == "pull_request"
        and candidate.get("head_sha") == head
        and candidate.get("head_branch") == branch
        and candidate.get("head_repository", {}).get("full_name") == repository
        and candidate.get("actor", {}).get("login") == "github-actions[bot]"
        and any(pr.get("number") == number for pr in candidate.get("pull_requests", []))
    )


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
        "starts the normal PR CI suite and merges this exact commit only after it passes. "
        "Branch protection still applies; a failed or stale publication stays open for review.\n"
    )
    started = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pr = run("gh", "pr", "create", "--base", "main", "--head", branch,
             "--title", "data: publish confirmed simulated NAV", "--body-file", str(body))
    print(f"Opened {pr}", flush=True)
    number = json.loads(run("gh", "pr", "view", pr, "--json", "number"))["number"]
    repository = os.environ["GITHUB_REPOSITORY"]
    approved = set()
    # GitHub creates approval-required PR runs for GITHUB_TOKEN-created PRs.
    # Approve only this job's own two-file snapshot PR, never an external PR.
    # A separately dispatched head run does not satisfy that PR's check suite.
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        response = json.loads(run("gh", "api", f"repos/{repository}/actions/workflows/ci.yml/runs"
                                  f"?event=pull_request&head_sha={head}&per_page=10"))
        runs = []
        for candidate in response["workflow_runs"]:
            if not own_pr_run(candidate, number, head, branch, repository):
                continue
            if candidate["conclusion"] == "action_required":
                if candidate["id"] not in approved:
                    current = json.loads(run("gh", "api", f"repos/{repository}/pulls/{number}"))
                    if (current["head"]["sha"] != head or current["head"]["repo"]["full_name"] != repository
                            or current["base"]["ref"] != "main"):
                        raise RuntimeError("Snapshot PR changed before CI approval.")
                    files = json.loads(run("gh", "api", f"repos/{repository}/pulls/{number}/files"))
                    validate_changes([f["filename"] for f in files])
                    run("gh", "api", "--method", "POST",
                        f"repos/{repository}/actions/runs/{candidate['id']}/approve")
                    approved.add(candidate["id"])
                continue
            runs.append({"databaseId": candidate["id"], "headSha": candidate["head_sha"],
                         "createdAt": candidate["created_at"], "status": candidate["status"],
                         "conclusion": candidate["conclusion"]})
        if checked_run(runs, head, started):
            state = json.loads(run("gh", "pr", "view", pr, "--json", "mergeStateStatus,headRefOid"))
            if state["headRefOid"] != head:
                raise RuntimeError("Snapshot PR changed after CI.")
            if state["mergeStateStatus"] == "CLEAN":
                run("gh", "pr", "merge", pr, "--merge", "--match-head-commit", head, "--delete-branch")
                print("Required CI passed and the snapshot PR merged under branch protection.")
                return
        time.sleep(15)
    raise RuntimeError("Snapshot CI timed out. The PR remains open; main was not changed.")


if __name__ == "__main__":
    main()
