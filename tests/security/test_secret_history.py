"""Exercise real gitleaks history scanning without storing any real credential."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCANNER = Path(__file__).resolve().parents[2] / "scripts/check-secrets.py"


@unittest.skipUnless(shutil.which("gitleaks"), "gitleaks is installed in the secret-check CI job")
class HistoryTests(unittest.TestCase):
    def test_deleted_secret_fails_without_disclosing_value(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, "GIT_AUTHOR_NAME": "Scanner test", "GIT_AUTHOR_EMAIL": "test@example.invalid",
                   "GIT_COMMITTER_NAME": "Scanner test", "GIT_COMMITTER_EMAIL": "test@example.invalid"}

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=directory, env=env, text=True).strip()

            git("init", "--quiet")
            git("commit", "--allow-empty", "--quiet", "-m", "clean baseline")
            base = git("rev-parse", "HEAD")
            # Deliberately fake provider-pattern fixture, never an active token.
            fake = "ghp_" + "AbCd1234" * 4 + "EfGh"
            path = Path(directory) / "config.txt"
            path.write_text("token=" + fake + "\n")
            git("add", "config.txt")
            git("commit", "--quiet", "-m", "accidental fixture")
            git("rm", "--quiet", "config.txt")
            git("commit", "--quiet", "-m", "delete fixture")
            clean = subprocess.run(["python3", str(SCANNER), "--gitleaks"], cwd=directory,
                                   text=True, capture_output=True)
            self.assertEqual(clean.returncode, 0, clean.stderr)
            history = subprocess.run(["python3", str(SCANNER), "--gitleaks", "--history-base", base],
                                     cwd=directory, text=True, capture_output=True)
            self.assertNotEqual(history.returncode, 0)
            self.assertIn("github-pat", history.stdout + history.stderr)
            self.assertNotIn(fake, history.stdout + history.stderr)


if __name__ == "__main__":
    unittest.main()
