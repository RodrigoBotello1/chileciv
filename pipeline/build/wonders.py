"""Wonders: the best-known monuments, protected areas, universities and tallest buildings of the region.

Every list is chosen by a published rule, never by hand: the Wikidata items of each class whose point falls on one of
the region's hexes, ranked by their number of Wikipedia articles (sitelinks), a measure of how well known a place is;
the buildings are ranked by height. Positions and figures come from Wikidata. The check() follows taiwanciv's.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

from ..core.geo import MapProjection
from ..core.mapcfg import CFG
from ..core.hexgrid import HexGrid
from ..core.store import load_interim, load_interim_payload, write_web

REQUIRES = ["_world", "cl_boundaries", "wikidata_rm"]
PRODUCES = ["wonders.json"]

# rule id, Wikidata list, kind, how many, rule text
RULES = [
    ("protected_area", "protected", "natural", 6,
     "Las 6 áreas protegidas y Santuarios de la Naturaleza de la región con más artículos en Wikipedia."),
    ("historic_monument", "monuments", "monument", 12,
     "Los 12 Monumentos Históricos de Chile (declarados por el Consejo de Monumentos Nacionales) de la región con más "
     "artículos en Wikipedia."),
    ("university", "universities", "university", 8,
     "Las 8 universidades de la región con más artículos en Wikipedia (una por institución)."),
    ("tallest_building", "towers", "landmark", 3,
     "Los 3 rascacielos y torres de la región con más artículos en Wikipedia (la altura de Wikidata no siempre está "
     "bien cargada, así que no ordena)."),
]
RULES = [(r, k, kind, CFG["wonders"].get(r, n), t.replace(f" {n} ", f" {CFG['wonders'].get(r, n)} ", 1))
         for r, k, kind, n, t in RULES]
RULE_NAME = {"protected_area": "Naturaleza", "historic_monument": "Monumento Histórico", "university": "Universidad",
             "tallest_building": "Rascacielos"}


def build() -> None:
    world = load_interim("_world")
    bounds = load_interim("cl_boundaries")
    wd_payload = load_interim_payload("wikidata_rm")
    wd = wd_payload["data"]
    grid, proj, owner = HexGrid(**world["grid"]), MapProjection(**world["projection"]), world["owner"]
    states, counties, county_of = world["states"], world["counties"], world["county"]

    def place(lon, lat):
        x, y = proj(lon, lat)
        cell = grid.cell_at(x, y)
        if cell < 0 or owner[cell] < 0:
            return None  # outside the region (the box also holds La Campana, in Valparaíso)
        k = county_of[cell]
        geoid = counties[k] if k >= 0 else None
        return {"x": round(x, 1), "y": round(y, 1), "cell": cell, "cells": None, "county": geoid, "cbsa": geoid,
                "state": states[owner[cell]]}

    wonders, used_cells = [], Counter()
    for rule, key, kind, n, _ in RULES:
        items = wd.get(key) or []
        rank = 0
        for it in items:
            if rank >= n:
                break
            at = place(it["lon"], it["lat"])
            if at is None or any(w["id"] == f"wd-{it['qid']}" for w in wonders):
                continue
            rank += 1
            metrics = {"links": it["links"]}
            if it.get("area"):
                metrics["area_km2"] = round(it["area"] / 1e6, 1)  # Wikidata normalised value, in m²
            if it.get("students"):
                metrics["enrollment"] = int(it["students"])
            if it.get("height"):
                metrics["height_m"] = round(it["height"], 1)
            used_cells[at["cell"]] += 1
            wonders.append({"id": f"wd-{it['qid']}", "name": it["name"], "short": it["name"], "kind": kind,
                            "rule": rule, "rank": rank, "metrics": metrics, "curated": False, **at})
    doc = {
        "version": 1,
        "vintage": {"landmarks": wd_payload["vintage"]},
        "sources": ["wikidata_rm"],
        "rules": [{"id": r, "name": RULE_NAME[r], "kind": k, "kinds": [k], "text": t} for r, _, k, _, t in RULES],
        "national": {},
        "wonders": wonders,
    }
    write_web("wonders.json", doc)
    print(f"    {len(wonders)} wonders: {dict(Counter(w['rule'] for w in wonders))}")
    for w in wonders:
        print(f"      {w['rule']} #{w['rank']}: {w['name']} ({w['metrics']})")
    shared = [c for c, k in used_cells.items() if k > 1]
    if shared:
        print(f"    {len(shared)} hexes hold more than one wonder")


KINDS = {"natural", "recreation", "coastal", "monument", "university", "landmark"}


def check(web_dir) -> list[tuple[str, str]]:
    path = Path(web_dir) / "wonders.json"
    if not path.exists():
        return [("NOTE", "wonders.json not built (optional)")]
    d = json.loads(path.read_text())
    world = json.loads((Path(web_dir) / "world.json").read_text())
    owner = world.get("owner") or []
    bad = []
    rules = {r["id"]: r for r in d.get("rules") or []}
    for x in d.get("wonders") or []:
        r = rules.get(x.get("rule"))
        if r is None or x.get("kind") not in r["kinds"] or x.get("kind") not in KINDS:
            bad.append(f"{x.get('id')}: unknown rule or kind")
        c = x.get("cell")
        if not isinstance(c, int) or not (0 <= c < len(owner)) or owner[c] < 0:
            bad.append(f"{x.get('id')}: cell is not region land")
    out = [("FAIL", f"wonders.json: {m}") for m in bad[:12]]
    out.append(("PASS", f"wonders.json: {len(d.get('wonders') or [])} wonders"))
    return out
