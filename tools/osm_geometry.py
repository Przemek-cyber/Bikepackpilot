"""Route geometry from OpenStreetMap (© OpenStreetMap contributors, ODbL) for the route-plan maps.

  python tools/osm_geometry.py --discover "<overpass filter>"   # list candidate relations (prints ::notice)
  python tools/osm_geometry.py                                    # build routes/geo/<slug>.json for routes with "osm"

Route JSON field:  "osm": {"relations": [123, 456], "bbox": [south, west, north, east] (optional)}
Output: compact GeoJSON MultiLineString (simplified), plus start/end and length.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "routes" / "data"
GEO = ROOT / "routes" / "geo"
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = {"User-Agent": "bikepackpilot.com route maps (github.com/Przemek-cyber/Bikepackpilot)"}


def overpass(q: str) -> dict:
    last = ""
    for attempt in range(6):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            r = requests.post(url, data={"data": q}, headers=UA, timeout=300)
            if r.status_code == 200:
                return r.json()
            last = f"{r.status_code} {r.text[:200]}"
        except requests.RequestException as e:
            last = str(e)[:200]
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {last}")


def discover(flt: str) -> None:
    res = overpass(f"[out:json][timeout:120];relation{flt};out tags;")
    for el in res.get("elements", [])[:25]:
        t = el.get("tags", {})
        info = {k: t.get(k) for k in ("name", "name:en", "ref", "network", "type", "route", "distance") if t.get(k)}
        print(f"::notice title=Relacja {el['id']}::{json.dumps(info, ensure_ascii=False)}")
    if not res.get("elements"):
        print(f"::warning title=Brak relacji::{flt}")


def hav(a, b) -> float:
    (lat1, lon1), (lat2, lon2) = a, b
    p = math.pi / 180
    h = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def build(route: dict) -> dict | None:
    osm = route.get("osm") or {}
    ids = osm.get("relations") or []
    if not ids:
        return None
    q = "[out:json][timeout:280];(" + "".join(f"relation({i});" for i in ids) + ")->.r;(.r;.r>>;)->.all;way.all;out geom;"
    res = overpass(q)
    bbox = osm.get("bbox")
    lines, total = [], 0.0
    for el in res.get("elements", []):
        pts = [(round(g["lat"], 4), round(g["lon"], 4)) for g in el.get("geometry", [])]
        if bbox:
            s, w, n, e = bbox
            pts = [p for p in pts if s <= p[0] <= n and w <= p[1] <= e]
        if len(pts) < 2:
            continue
        total += sum(hav(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        lines.append(pts)
    if not lines:
        raise RuntimeError("no geometry")
    step = max(0.05, total / 6000)  # ~6000 points max
    simple = []
    for pts in lines:
        keep, acc = [pts[0]], 0.0
        for a, b in zip(pts, pts[1:]):
            acc += hav(a, b)
            if acc >= step:
                keep.append(b)
                acc = 0.0
        if keep[-1] != pts[-1]:
            keep.append(pts[-1])
        if len(keep) >= 2:
            simple.append([[lon, lat] for lat, lon in keep])
    ratio = total / route["distance_km"]
    lats = [c[1] for l in simple for c in l]
    lons = [c[0] for l in simple for c in l]
    return {"type": "Feature", "properties": {"osm_km": round(total), "ratio": round(ratio, 2), "relations": ids,
                                              "bounds": [[min(lats), min(lons)], [max(lats), max(lons)]]},
            "geometry": {"type": "MultiLineString", "coordinates": simple}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--discover", action="append")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if a.discover:
        for flt in a.discover:
            discover(flt)
            time.sleep(5)
        return
    GEO.mkdir(parents=True, exist_ok=True)
    for f in sorted(DATA.glob("*.json")):
        r = json.loads(f.read_text())
        out = GEO / f"{r['slug']}.json"
        if not r.get("osm") or (out.exists() and not a.force):
            continue
        try:
            g = build(r)
            if not 0.5 <= g["properties"]["ratio"] <= 2.6:
                print(f"::warning title=Mapa pominięta: {r['short']}::OSM {g['properties']['osm_km']} km vs {r['distance_km']} km")
                continue
            out.write_text(json.dumps(g, separators=(",", ":")), encoding="utf-8")
            print(f"::notice title=Mapa: {r['short']}::{g['properties']['osm_km']} km z OSM, {sum(len(l) for l in g['geometry']['coordinates'])} punktów")
        except Exception as e:
            print(f"::warning title=Mapa nieudana: {r['short']}::{type(e).__name__}: {str(e)[:300]}")
        time.sleep(10)


if __name__ == "__main__":
    main()
