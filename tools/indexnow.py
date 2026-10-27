"""Notify Bing (and other IndexNow search engines) about new or changed pages.

Usage:
  python tools/indexnow.py --all                 # every URL from sitemap.xml
  python tools/indexnow.py --since <git-commit>  # only pages changed since that commit
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
HOST = "bikepackpilot.com"
KEY = "9bf5d1a9391155bffb2fb57545f46b72"


def sitemap_urls() -> list[str]:
    return re.findall(r"<loc>(.*?)</loc>", (ROOT / "sitemap.xml").read_text(encoding="utf-8"))


def changed_urls(since: str) -> list[str]:
    out = subprocess.run(["git", "diff", "--name-only", since, "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.split()
    urls = set()
    for f in out:
        if f.endswith("index.html") and not f.startswith("app/"):
            path = "/" + f[: -len("index.html")]
            urls.add(f"https://{HOST}{path}")
    known = set(sitemap_urls())
    return sorted(u for u in urls if u in known)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--since")
    a = ap.parse_args()
    urls = sitemap_urls() if a.all else changed_urls(a.since) if a.since else []
    if not urls:
        print("IndexNow: nothing to submit")
        return
    r = requests.post("https://api.indexnow.org/indexnow", timeout=60, json={
        "host": HOST, "key": KEY, "keyLocation": f"https://{HOST}/{KEY}.txt", "urlList": urls[:10000]})
    print(f"::notice title=IndexNow::{len(urls)} URL(s) → HTTP {r.status_code}")
    if r.status_code >= 400 and r.status_code != 422:
        print(f"::warning title=IndexNow::{r.text[:300]}")
        sys.exit(0)


if __name__ == "__main__":
    main()
