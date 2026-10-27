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
    for attempt in range(3):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            r = requests.post(url, data={"data": q}, headers=UA, timeout=660)
            if r.status_code == 200:
                return r.json()
            last = f"{r.status_code} {r.text[:200]}"
        except requests.RequestException as e:
            last = str(e)[:200]
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {last}")


def discover(flt: str) -> None:
    res = overpass(f"[out:json][timeout:180];relation{flt};out tags;")
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


def stitch(lines: list[list[tuple]]) -> list[list[tuple]]:
    """Join OSM ways that share endpoints into long polylines (fewer lines, fewer points)."""
    from collections import defaultdict
    ends = defaultdict(set)
    for i, l in enumerate(lines):
        ends[l[0]].add(i)
        ends[l[-1]].add(i)
    used = [False] * len(lines)
    out = []

    def grow(cur: list) -> list:
        while True:
            tip = cur[-1]
            j = next((k for k in ends[tip] if not used[k]), None)
            if j is None:
                return cur
            used[j] = True
            seg = lines[j] if lines[j][0] == tip else lines[j][::-1]
            cur.extend(seg[1:])

    for i in range(len(lines)):
        if used[i]:
            continue
        used[i] = True
        cur = grow(list(lines[i]))
        cur = grow(cur[::-1])
        out.append(cur)
    return out


def build(route: dict) -> dict | None:
    osm = route.get("osm") or {}
    ids = osm.get("relations") or []
    if not ids:
        return None
    q = "[out:json][timeout:600];(" + "".join(f"relation({i});" for i in ids) + ")->.r;(.r;.r>>;)->.all;way.all;out geom;"
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
    lines = stitch(lines)
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


def geocode(place: str) -> tuple[float, float]:
    r = requests.get("https://nominatim.openstreetmap.org/search", params={"q": place, "format": "json", "limit": 1},
                     headers=UA, timeout=60)
    time.sleep(1.2)  # Nominatim: max 1 request per second
    js = r.json() if r.status_code == 200 else []
    if not js:
        raise RuntimeError(f"place not found: {place}")
    return float(js[0]["lat"]), float(js[0]["lon"])


def brouter_leg(a: tuple, b: tuple) -> list[tuple] | None:
    """Bike route between two points (BRouter, trekking profile); None if it fails (e.g. a ferry)."""
    url = f"https://brouter.de/brouter?lonlats={a[1]},{a[0]}|{b[1]},{b[0]}&profile=trekking&alternativeidx=0&format=geojson"
    for attempt in range(3):
        try:
            r = requests.get(url, headers=UA, timeout=180)
            if r.status_code == 200:
                coords = r.json()["features"][0]["geometry"]["coordinates"]
                return [(round(c[1], 4), round(c[0], 4)) for c in coords]
        except (requests.RequestException, ValueError, KeyError, IndexError):
            pass
        time.sleep(10 * (attempt + 1))
    return None


def build_from_waypoints(route: dict) -> dict:
    """Approximate line through the route's main towns, routed for bikes; legs that can't be routed
    (ferries, missing roads) are drawn as straight dashed lines."""
    names, pts = [], []
    for n in route["waypoints"]:
        try:
            pts.append(geocode(n))
            names.append(n)
        except RuntimeError as e:
            print(f"::warning title=Pominięty punkt::{e}")
    if len(pts) < 2:
        raise RuntimeError("too few places found")
    routed, straight, total = [], [], 0.0
    for a, b in zip(pts, pts[1:]):
        leg = brouter_leg(a, b)
        direct = hav(a, b)
        if leg and len(leg) >= 2:
            km = sum(hav(leg[i], leg[i + 1]) for i in range(len(leg) - 1))
            if km <= max(direct * 3.5, direct + 40):  # sanity: no absurd detours
                routed.append(leg)
                total += km
                time.sleep(2)
                continue
        straight.append([a, b])
        total += direct
        time.sleep(2)
    step = max(0.05, total / 6000)
    lines = []
    for pts_ in stitch(routed):
        keep, acc = [pts_[0]], 0.0
        for x, y in zip(pts_, pts_[1:]):
            acc += hav(x, y)
            if acc >= step:
                keep.append(y)
                acc = 0.0
        if keep[-1] != pts_[-1]:
            keep.append(pts_[-1])
        lines.append([[lon, lat] for lat, lon in keep])
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    for l in lines:
        lats += [c[1] for c in l]
        lons += [c[0] for c in l]
    return {"type": "FeatureCollection", "properties": {"source": "waypoints", "osm_km": round(total),
                                                       "ratio": round(total / route["distance_km"], 2),
                                                       "bounds": [[min(lats), min(lons)], [max(lats), max(lons)]]},
            "features": [
                {"type": "Feature", "properties": {"kind": "route"}, "geometry": {"type": "MultiLineString", "coordinates": lines}},
                {"type": "Feature", "properties": {"kind": "gap"},
                 "geometry": {"type": "MultiLineString", "coordinates": [[[a[1], a[0]], [b[1], b[0]]] for a, b in straight]}},
            ] + [{"type": "Feature", "properties": {"kind": "stop", "name": n.split(",")[0]},
                  "geometry": {"type": "Point", "coordinates": [p[1], p[0]]}} for n, p in zip(names, pts)]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--discover", action="append")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if a.discover:
        for flt in a.discover:
            try:
                discover(flt)
            except Exception as e:
                print(f"::warning title=Wyszukiwanie nieudane::{flt} — {str(e)[:200]}")
            time.sleep(5)
        return
    GEO.mkdir(parents=True, exist_ok=True)
    for f in sorted(DATA.glob("*.json")):
        r = json.loads(f.read_text())
        out = GEO / f"{r['slug']}.json"
        if not (r.get("osm") or r.get("waypoints")) or (out.exists() and not a.force):
            continue
        try:
            g = build(r) if r.get("osm") else build_from_waypoints(r)
            if not 0.5 <= g["properties"]["ratio"] <= 2.6:
                print(f"::warning title=Mapa pominięta: {r['short']}::OSM {g['properties']['osm_km']} km vs {r['distance_km']} km")
                continue
            out.write_text(json.dumps(g, separators=(",", ":")), encoding="utf-8")
            print(f"::notice title=Mapa: {r['short']}::{g['properties']['osm_km']} km ({g['properties'].get('source', 'osm')})")
        except Exception as e:
            print(f"::warning title=Mapa nieudana: {r['short']}::{type(e).__name__}: {str(e)[:300]}")
        time.sleep(10)


if __name__ == "__main__":
    main()
