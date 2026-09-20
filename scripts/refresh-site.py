"""Trigger the dedicated Vercel hook without putting its secret URL in argv/logs."""
import json
import os
import time
import urllib.request
from pathlib import Path


def main():
    hook = os.environ["VERCEL_DEPLOY_HOOK"]
    live = os.environ["NEXT_PUBLIC_APP_URL"].rstrip("/")
    expected = json.loads(Path("app/public/data/nav.json").read_text())["publication"]["transaction_hash"]
    request = urllib.request.Request(hook, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError("Deploy hook request failed.")
    print("Requested deployment of the confirmed NAV snapshot.")
    deadline = time.monotonic() + 420
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(live + "/data/nav.json", timeout=20) as response:
                result = json.load(response)
            if result.get("publication", {}).get("transaction_hash") == expected:
                print("Live site serves the newly confirmed NAV snapshot.")
                return
        except (OSError, ValueError):
            pass
        time.sleep(15)
    raise RuntimeError("The deployment did not serve the confirmed NAV before the deadline.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Site refresh failed. Inspect the Vercel deployment; no hook URL is printed.")
        raise SystemExit(1) from None
