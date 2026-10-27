"""Research agent: picks the next route from routes/queue.txt, researches it on the web with Claude
(web search tool), checks the facts, and saves routes/data/<slug>.json. Then build_routes.py renders the page.

Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional).
Run: python tools/research_route.py [--count N]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "routes" / "data"
QUEUE = ROOT / "routes" / "queue.txt"
DONE = ROOT / "routes" / "queue_done.txt"
API = "https://api.anthropic.com/v1/messages"
MODEL = os.environ.get("CLAUDE_MODEL") or "claude-sonnet-5-5"

SCHEMA = {
    "type": "object",
    "properties": {
        "slug": {"type": "string", "description": "lowercase-hyphenated URL slug, e.g. 'eurovelo-6-atlantic-black-sea'"},
        "name": {"type": "string", "description": "Full route name"},
        "short": {"type": "string", "description": "Short name, max 4 words"},
        "start": {"type": "string"}, "end": {"type": "string"},
        "countries": {"type": "array", "items": {"type": "string"}},
        "distance_km": {"type": "integer", "description": "Total length in km, from the sources (round)"},
        "distance_note": {"type": "string", "description": "Human wording of the length as the sources give it, e.g. 'about 3,650 km'"},
        "elevation_gain_m": {"type": ["integer", "null"], "description": "Total climbing in m ONLY if a source states it, else null"},
        "surface_mix": {"type": "object", "properties": {"asphalt": {"type": "integer"}, "gravel": {"type": "integer"}, "technical": {"type": "integer"}},
                        "required": ["asphalt", "gravel", "technical"], "description": "Percentages summing to 100"},
        "surface_is_estimate": {"type": "boolean", "description": "true unless a source states the surface split"},
        "summary": {"type": "string", "description": "1-2 sentences, max 40 words"},
        "facts": {"type": "array", "items": {"type": "string"}, "description": "3-6 facts, each directly supported by the sources"},
        "notes": {"type": "array", "items": {"type": "string"}, "description": "2-4 practical planning notes (water, food, wind, heat, climbing, ferries) specific to this route; no invented numbers"},
        "days_hint": {"type": ["string", "null"], "description": "Typical duration ONLY if a source states it, else null"},
        "waypoints": {"type": "array", "items": {"type": "string"},
                      "description": "8-30 towns/places the route passes, IN ORDER from start to end, each as 'Place, Country' (geocodable), taken from the sources"},
        "osm_relations": {"type": "array", "items": {"type": "integer"},
                          "description": "OpenStreetMap relation id(s) of this route ONLY if you saw them on an openstreetmap.org/relation/<id> link or waymarkedtrails page; else []"},
        "sources": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "url": {"type": "string"}},
                                               "required": ["title", "url"]}, "description": "2-4 sources you actually read; prefer official route sites"},
    },
    "required": ["slug", "name", "short", "start", "end", "countries", "distance_km", "distance_note", "elevation_gain_m",
                 "surface_mix", "surface_is_estimate", "summary", "facts", "notes", "days_hint", "sources"],
}

SYSTEM = (
    "You research bikepacking/cycle-touring routes for factual route-plan pages on bikepackpilot.com. "
    "Use web search to find the official route site and 1-3 other reliable sources (Wikipedia, tourism boards, well-known cycling media). "
    "Every fact must be supported by a source you read. Never invent numbers: if a value (elevation, duration, surface split) is not in a source, "
    "use null or mark it as an estimate. Write in plain, friendly English. Do not mention any product. "
    "When done, call the save_route tool exactly once."
)


def call(messages: list, tools: list) -> dict:
    body = {"model": MODEL, "max_tokens": 6000, "system": SYSTEM, "messages": messages, "tools": tools}
    for attempt in range(4):
        r = requests.post(API, json=body, timeout=600, headers={
            "x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json"})
        if r.status_code in (429, 500, 502, 503, 529):
            time.sleep(20 * (attempt + 1))
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"Claude API {r.status_code}: {r.text[:500]}")
        return r.json()
    raise RuntimeError("Claude API: too many retries")


def research(route_name: str) -> dict:
    tools = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 8},
             {"name": "save_route", "description": "Save the researched route data.", "input_schema": SCHEMA}]
    messages = [{"role": "user", "content": f"Research this route and save it: {route_name}"}]
    for _ in range(6):
        resp = call(messages, tools)
        for block in resp.get("content", []):
            if block.get("type") == "tool_use" and block.get("name") == "save_route":
                return block["input"]
        messages.append({"role": "assistant", "content": resp["content"]})
        if resp.get("stop_reason") == "pause_turn":
            continue
        messages.append({"role": "user", "content": "Please call save_route now with what you found."})
    raise RuntimeError("The agent did not save the route")


def verify(route: dict) -> dict:
    """Second, sceptical pass: drop facts/notes that look invented or unsupported."""
    tools = [{"name": "verdict", "description": "Return the indices to drop.", "input_schema": {
        "type": "object", "properties": {
            "drop_facts": {"type": "array", "items": {"type": "integer"}},
            "drop_notes": {"type": "array", "items": {"type": "integer"}},
            "distance_ok": {"type": "boolean"}, "comment": {"type": "string"}},
        "required": ["drop_facts", "drop_notes", "distance_ok", "comment"]}}]
    prompt = ("Be a strict fact-checker. For this route data, mark any fact or note (0-based index) that is likely wrong, "
              "too specific to be safely true without a source, or contradicts other fields. Check that distance_km is plausible "
              f"for this route.\n\n{json.dumps(route, ensure_ascii=False, indent=1)}")
    messages = [{"role": "user", "content": prompt + "\n\nAnswer by calling the verdict tool."}]
    v = None
    for _ in range(3):
        resp = call(messages, tools)
        v = next((b["input"] for b in resp["content"] if b.get("type") == "tool_use"), None)
        if v:
            break
        messages += [{"role": "assistant", "content": resp["content"]},
                     {"role": "user", "content": "Please call the verdict tool now."}]
    if not v:
        raise RuntimeError("fact-check returned no verdict")
    route["facts"] = [f for i, f in enumerate(route["facts"]) if i not in set(v["drop_facts"])]
    route["notes"] = [n for i, n in enumerate(route["notes"]) if i not in set(v["drop_notes"])]
    if not v["distance_ok"]:
        raise RuntimeError(f"Distance looks wrong: {v['comment']}")
    return route


def validate(r: dict) -> None:
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", r["slug"]) or len(r["slug"]) > 70:
        raise ValueError(f"bad slug {r['slug']}")
    if (DATA / f"{r['slug']}.json").exists():
        raise ValueError(f"route already exists: {r['slug']}")
    if not 20 <= int(r["distance_km"]) <= 20000:
        raise ValueError("distance out of range")
    mix = r["surface_mix"]
    if sum(mix.values()) != 100 or any(v < 0 for v in mix.values()):
        raise ValueError(f"surface mix must sum to 100: {mix}")
    srcs = [s for s in r["sources"] if str(s.get("url", "")).startswith("http")]
    if len(srcs) < 2:
        raise ValueError("need at least 2 sources")
    if len(r["facts"]) < 3 or len(r["notes"]) < 1 or not r["countries"]:
        raise ValueError("too few facts/notes after checking")


def next_routes(n: int) -> list[str]:
    done = set(DONE.read_text().splitlines()) if DONE.exists() else set()
    todo = [l.strip() for l in QUEUE.read_text().splitlines() if l.strip() and not l.startswith("#")]
    return [t for t in todo if t not in done][:n]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=1)
    args = ap.parse_args()
    made, failed = [], []
    for name in next_routes(args.count):
        try:
            r = verify(research(name))
            validate(r)
            rel = [int(x) for x in (r.pop("osm_relations", None) or []) if str(x).isdigit()]
            if rel:
                r["osm"] = {"relations": rel[:5]}
            wps = [w for w in (r.get("waypoints") or []) if isinstance(w, str) and w.strip()]
            if len(wps) >= 3:
                r["waypoints"] = wps[:30]
            else:
                r.pop("waypoints", None)
            (DATA / f"{r['slug']}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
            made.append(r["slug"])
            print(f"::notice title=Nowa trasa::{r['name']} · {r['distance_km']} km · /routes/{r['slug']}/")
        except Exception as e:
            failed.append(name)
            print(f"::warning title=Trasa pominięta: {name}::{type(e).__name__}: {str(e)[:400]}")
        with DONE.open("a") as f:  # nie próbujemy w kółko tej samej trasy
            f.write(name + "\n")
    if not made:
        print("::error title=Brak nowych tras::" + (", ".join(failed) or "kolejka pusta"))
        sys.exit(1)


if __name__ == "__main__":
    main()
