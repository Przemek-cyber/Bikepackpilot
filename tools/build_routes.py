"""Builds static route-plan pages for bikepackpilot.com from routes/data/*.json.

Output: routes/<slug>/index.html, routes/index.html, sitemap.xml, robots.txt.
The riding-day estimate uses the same model as the app (app.js: segmentDays / computeStageDays).
Run: python tools/build_routes.py
"""
from __future__ import annotations

import datetime as dt
import html
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "routes" / "data"
SITE = "https://bikepackpilot.com"
BUY_URL = "https://przemek.lemonsqueezy.com/checkout/buy/0c0586a4-a00a-45ca-9407-99d445aee50e"

# --- same model as app.js ---
SEGMENT = 50
BASE_PACE = 110
SURFACE_MOD = {"asphalt": 0, "gravel": -0.175, "technical": -0.3}
SURFACE_LABEL = {"asphalt": "Asphalt", "gravel": "Gravel", "technical": "Technical gravel"}
SCENARIOS = {
    "good": {"label": "Good conditions", "desc": "no wind, no rain, mild temperature", "wind": 0, "rain": 0},
    "tough": {"label": "Tough conditions", "desc": "moderate headwind and light rain on every segment", "wind": -0.2, "rain": -0.1},
}


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def segments(route: dict) -> list[dict]:
    dist = route["distance_km"]
    n = math.ceil(dist / SEGMENT)
    mix = route["surface_mix"]
    counts = {k: 0 for k in mix}
    out = []
    for i in range(n):
        start = i * SEGMENT
        length = min(SEGMENT, dist - start)
        # distribute surfaces evenly along the route according to the mix
        surface = max(mix, key=lambda k: (mix[k] / 100) * (i + 1) - counts[k])
        counts[surface] += 1
        elev = (route.get("elevation_gain_m") or 0) * length / dist
        out.append({"from": start, "to": start + length, "length": length, "surface": surface, "elev": elev})
    return out


def seg_days(seg: dict, sc: dict) -> float:
    elev_penalty_km = -1 * math.floor(seg["elev"] / 500) * 10
    elev_fraction = elev_penalty_km / BASE_PACE
    pace = BASE_PACE * max(0.15, 1 + SURFACE_MOD[seg["surface"]] + sc["wind"] + sc["rain"] + elev_fraction)
    return seg["length"] / pace


def plan(route: dict) -> dict:
    segs = segments(route)
    res = {}
    for key, sc in SCENARIOS.items():
        days = [seg_days(s, sc) for s in segs]
        res[key] = {"days": sum(days), "per_seg": days}
    return {"segments": segs, "scenarios": res}


CSS_LINK = '<link rel="stylesheet" href="/routes/routes.css">'
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600;700&display=swap">')
LOGO = ('<svg class="mark" viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M12 68 L36 40 L48 54 L62 30 L88 68" '
        'stroke="#C97A2B" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="62" cy="30" r="6" fill="#6FA98F"/></svg>')


def head(title: str, desc: str, path: str, extra: str = "") -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{SITE}{path}">
<meta property="og:type" content="article">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{SITE}{path}">
<meta property="og:image" content="{SITE}/icons/icon-512.png">
<meta name="theme-color" content="#182420">
<link rel="icon" href="/icons/icon-192.png">
{FONTS}
{CSS_LINK}
{extra}
</head>
<body>
<header class="top"><a class="brand" href="/">{LOGO}<span>BikepackPilot</span></a>
<nav class="topnav"><a href="/routes/">Route plans</a><a class="top-cta" href="/app/">Open the app</a></nav></header>
<main>
"""


FOOT = f"""</main>
<footer class="foot">
<p><a href="/">BikepackPilot</a> · <a href="/routes/">All route plans</a> · <a href="/app/">Open the app</a> · <a href="{BUY_URL}" rel="nofollow">Get access</a></p>
<p class="muted">Estimates use BikepackPilot's planning model with the assumptions shown on each page. Route facts come from the linked sources; always check current conditions before you ride.</p>
</footer>
</body>
</html>
"""


def cta(route: dict | None = None) -> str:
    what = f"your own {esc(route['short'])} plan" if route else "your own route"
    return f"""<section class="cta">
<h2>Plan {what} in minutes</h2>
<p>Enter your real distance, set surface, heat, wind and rain for each 50 km segment and get realistic riding days – plus a gear list that adapts to your conditions, water and food nearby and a safety check-in. Works offline, in English, Polish, German and Spanish.</p>
<div class="cta-row"><a class="btn" href="{BUY_URL}" rel="nofollow">Get BikepackPilot</a><a class="btn ghost" href="/app/">Already have access? Open the app</a></div>
</section>"""


def route_page(route: dict, others: list[dict]) -> str:
    p = plan(route)
    good, tough = p["scenarios"]["good"]["days"], p["scenarios"]["tough"]["days"]
    dist = route["distance_km"]
    path = f"/routes/{route['slug']}/"
    title = f"{route['name']}: bikepacking plan, stages & riding days | BikepackPilot"
    desc = (f"How many days to bikepack {route['short']}? {dist:,} km from {route['start']} to {route['end']} – "
            f"about {math.ceil(good)}–{math.ceil(tough)} riding days, split into 50 km segments, with water, food and gear tips.")
    mix = route["surface_mix"]
    mix_txt = ", ".join(f"{v}% {SURFACE_LABEL[k].lower()}" for k, v in mix.items() if v)
    mix_note = " (estimated mix for this plan)" if route.get("surface_is_estimate") else ""
    elev = route.get("elevation_gain_m")
    facts_rows = [
        ("Distance", route.get("distance_note") or f"{dist:,} km"),
        ("Start", route["start"]), ("Finish", route["end"]),
        ("Countries", ", ".join(route["countries"])),
        ("Surface", mix_txt + mix_note),
    ]
    if elev:
        facts_rows.append(("Total climbing", f"about {elev:,} m"))
    if route.get("days_hint"):
        facts_rows.append(("Typical duration (sources)", route["days_hint"]))
    facts_tbl = "".join(f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in facts_rows)
    seg_rows = "".join(
        f"<tr><td>{s['from']:,}–{s['to']:,} km</td><td>{SURFACE_LABEL[s['surface']]}</td>"
        + (f"<td>{s['elev']:.0f} m</td>" if elev else "")
        + f"<td>{p['scenarios']['good']['per_seg'][i]:.2f}</td><td>{p['scenarios']['tough']['per_seg'][i]:.2f}</td></tr>"
        for i, s in enumerate(p["segments"]))
    elev_th = "<th>Climbing</th>" if elev else ""
    sources = "".join(f'<li><a href="{esc(s["url"])}" rel="nofollow noopener" target="_blank">{esc(s["title"])}</a></li>' for s in route["sources"])
    facts = "".join(f"<li>{esc(f)}</li>" for f in route["facts"])
    notes = "".join(f"<li>{esc(n)}</li>" for n in route["notes"])
    more = "".join(f'<li><a href="/routes/{o["slug"]}/">{esc(o["name"])}</a> <span class="muted">· {o["distance_km"]:,} km</span></li>'
                   for o in others if o["slug"] != route["slug"])
    faq = [
        (f"How many days does it take to bikepack {route['short']}?",
         f"With BikepackPilot's default pace of {BASE_PACE} km per day on asphalt, the {dist:,} km route takes about {good:.1f} riding days in good conditions "
         f"and about {tough:.1f} days with moderate headwind and light rain, using the surface mix shown on this page. Rest days are not included."),
        (f"How long is {route['short']}?", f"{route.get('distance_note') or f'{dist:,} km'}, from {route['start']} to {route['end']}."),
        (f"What surface is {route['short']}?", f"For this plan we assume {mix_txt}{mix_note}. In BikepackPilot you set the surface for each 50 km segment yourself."),
    ]
    faq_html = "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in faq)
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "Article", "headline": f"{route['name']}: bikepacking plan, stages & riding days", "description": desc,
             "mainEntityOfPage": f"{SITE}{path}", "dateModified": dt.date.today().isoformat(),
             "author": {"@type": "Organization", "name": "BikepackPilot"}, "publisher": {"@type": "Organization", "name": "BikepackPilot"}},
            {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Route plans", "item": f"{SITE}/routes/"},
                {"@type": "ListItem", "position": 2, "name": route["name"], "item": f"{SITE}{path}"}]},
        ]}
    extra = f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'
    return head(title, desc, path, extra) + f"""
<nav class="crumbs"><a href="/routes/">Route plans</a> › {esc(route['short'])}</nav>
<article>
<h1>{esc(route['name'])}: bikepacking plan &amp; riding days</h1>
<p class="lead">{esc(route['summary'])}</p>

<section class="estimate">
<div class="card"><span class="k">{SCENARIOS['good']['label']}</span><span class="v">{good:.1f}</span><span class="u">riding days</span><span class="d">{SCENARIOS['good']['desc']}</span></div>
<div class="card warn"><span class="k">{SCENARIOS['tough']['label']}</span><span class="v">{tough:.1f}</span><span class="u">riding days</span><span class="d">{SCENARIOS['tough']['desc']}</span></div>
</section>
<p class="muted small">Estimate from BikepackPilot's model: base pace {BASE_PACE} km/day on asphalt, adjusted per 50 km segment for surface{', climbing' if elev else ''}, wind and rain. Rest days not included. Your own numbers will differ – that's what the app is for.</p>

<h2>Key facts</h2>
<table class="facts">{facts_tbl}</table>

<h2>About the route</h2>
<ul class="list">{facts}</ul>

<h2>Planning notes</h2>
<ul class="list">{notes}</ul>

{cta(route)}

<h2>The route in 50 km segments</h2>
<details class="segs"><summary>Show all {len(p['segments'])} segments</summary>
<div class="scroll"><table class="segtable"><thead><tr><th>Segment</th><th>Surface</th>{elev_th}<th>Days (good)</th><th>Days (tough)</th></tr></thead>
<tbody>{seg_rows}</tbody></table></div></details>

<h2>FAQ</h2>
<div class="faq">{faq_html}</div>

<h2>Sources</h2>
<ol class="sources">{sources}</ol>

<h2>More route plans</h2>
<ul class="more">{more}</ul>
</article>
""" + FOOT


def hub(routes: list[dict]) -> str:
    cards = ""
    for r in routes:
        p = plan(r)
        g = p["scenarios"]["good"]["days"]
        cards += (f'<a class="rcard" href="/routes/{r["slug"]}/"><h3>{esc(r["name"])}</h3>'
                  f'<p>{esc(r["summary"])}</p><span class="meta">{r["distance_km"]:,} km · ≈{g:.0f}+ riding days · {esc(", ".join(r["countries"]))}</span></a>')
    title = "Bikepacking route plans: stages, riding days & gear | BikepackPilot"
    desc = "Bikepacking plans for famous routes – Tour Divide, EuroVelo, Green Velo, Hebridean Way and more: realistic riding days, 50 km segments, water and gear tips."
    return head(title, desc, "/routes/") + f"""
<h1>Bikepacking route plans</h1>
<p class="lead">How many days does a famous route really take? Each plan splits the route into 50 km segments and estimates realistic riding days for good and tough conditions – the same way BikepackPilot plans your own trip.</p>
<div class="grid">{cards}</div>
{cta()}
""" + FOOT


def landing(routes: list[dict]) -> str:
    title = "BikepackPilot – plan self-supported bikepacking trips in realistic riding days"
    desc = ("Offline bikepacking planner: split your route into 50 km segments, set surface, heat, wind and rain, "
            "get realistic riding days, a gear list that adapts to conditions, and water, food and repair nearby.")
    feats = [
        ("set-surface-heat-wind-rain.jpg", "Real conditions, segment by segment",
         "Enter your route distance from a map or GPX. It splits into 50 km segments – set surface, heat, wind and rain for each."),
        ("realistic-riding-days.jpg", "Riding days you can trust",
         "BikepackPilot turns those conditions into realistic riding days, not just kilometres – so your plan survives the headwind."),
        ("gear-adapts-to-conditions.jpg", "A gear list that adapts",
         "Hot day or rough surface? The packing list changes with the conditions you entered. Plus water, food, bike repair and lodging nearby."),
    ]
    feat_html = "".join(f'<div class="feat"><img src="/img/{img}" alt="{esc(h)}" loading="lazy" width="420"><h3>{esc(h)}</h3><p>{esc(t)}</p></div>'
                        for img, h, t in feats)
    cards = ""
    for r in routes[:6]:
        g = plan(r)["scenarios"]["good"]["days"]
        cards += (f'<a class="rcard" href="/routes/{r["slug"]}/"><h3>{esc(r["name"])}</h3>'
                  f'<span class="meta">{r["distance_km"]:,} km · ≈{g:.0f}+ riding days</span></a>')
    ld = {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": "BikepackPilot",
          "applicationCategory": "TravelApplication", "operatingSystem": "Web, Android, iOS (installable web app)",
          "description": desc, "url": SITE + "/", "inLanguage": ["en", "pl", "de", "es"]}
    extra = (f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'
             "<script>(function(){var q=new URLSearchParams(location.search);"
             "if(q.get('license')||matchMedia('(display-mode: standalone)').matches){location.replace('/app/'+location.search);}"
             "if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){"
             "if(new URL(r.scope).pathname==='/'){r.update();}});});}})();</script>")
    return head(title, desc, "/", extra) + f"""
<section class="hero">
<h1>Plan your bikepacking trip in realistic riding days</h1>
<p class="lead">BikepackPilot is an offline planner for self-supported trips. Split your route into 50 km segments, set the conditions you expect, and see how many days it really takes – with a gear list that adapts and water, food and repair nearby.</p>
<div class="cta-row"><a class="btn" href="{BUY_URL}" rel="nofollow">Get BikepackPilot</a><a class="btn ghost" href="/app/">Already have access? Open the app</a></div>
<p class="muted small">Works offline · installs like an app · English, Polish, German, Spanish · your data stays on your device</p>
</section>
<section class="feats">{feat_html}</section>
<h2>Route plans</h2>
<p>How many days does a famous route really take? Plans for well-known routes, built with the same model as the app.</p>
<div class="grid">{cards}</div>
<p><a href="/routes/">All route plans →</a></p>
{cta()}
""" + FOOT


def main() -> None:
    routes = sorted((json.loads(f.read_text()) for f in DATA.glob("*.json")), key=lambda r: r["name"])
    for r in routes:
        out = ROOT / "routes" / r["slug"] / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(route_page(r, routes), encoding="utf-8")
    (ROOT / "routes" / "index.html").write_text(hub(routes), encoding="utf-8")
    (ROOT / "index.html").write_text(landing(routes), encoding="utf-8")
    today = dt.date.today().isoformat()
    urls = [f"{SITE}/", f"{SITE}/routes/"]  # /app/ is the paid app – not indexed + [f"{SITE}/routes/{r['slug']}/" for r in routes]
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>\n" for u in urls) + "</urlset>\n", encoding="utf-8")
    (ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n", encoding="utf-8")
    lines = ["# BikepackPilot", "", "> Offline web app for planning self-supported bikepacking trips: splits a route into 50 km segments, "
             "adjusts for surface, heat, wind and rain, calculates realistic riding days, adapts the gear list and finds water, food, repair and lodging nearby.",
             "", "## Route plans", ""] + [f"- [{r['name']}]({SITE}/routes/{r['slug']}/): {r['distance_km']:,} km, {r['start']} → {r['end']}" for r in routes]
    (ROOT / "llms.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Built {len(routes)} route pages")


if __name__ == "__main__":
    main()
