"""Fail-closed checks for the protected-branch NAV publisher."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "publisher", Path(__file__).resolve().parents[2] / "scripts/publish-nav-pr.py"
)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublisherTests(unittest.TestCase):
    def test_snapshot_scope_excludes_source_and_workflows(self):
        publisher.validate_changes(list(publisher.SNAPSHOTS))
        for path in [".github/workflows/ci.yml", "app/src/app/api/verify/route.ts", ".env"]:
            with self.assertRaises(RuntimeError):
                publisher.validate_changes([*publisher.SNAPSHOTS, path])

    def test_only_fresh_success_for_exact_commit_can_merge(self):
        run = {"databaseId": 7, "headSha": "expected", "createdAt": "2026-09-20T15:00:00Z",
               "status": "completed", "conclusion": "success"}
        started = "2026-09-20T14:59:59Z"
        self.assertEqual(publisher.checked_run([run], "expected", started), 7)
        self.assertIsNone(publisher.checked_run([run], "different", started))
        self.assertIsNone(publisher.checked_run([run], "expected", "2026-09-20T15:01:00Z"))
        self.assertIsNone(publisher.checked_run([{**run, "status": "in_progress"}], "expected", started))
        for conclusion in ["failure", "cancelled", "skipped", "timed_out", "neutral"]:
            with self.assertRaises(RuntimeError):
                publisher.checked_run([{**run, "conclusion": conclusion}], "expected", started)


if __name__ == "__main__":
    unittest.main()
