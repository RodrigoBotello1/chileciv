"""Compare: one table of comuna indicators for the side-by-side comparison screen.

Every value comes from the same formulas as the lenses (lenses.comuna_values), at the comuna level instead of spread
over hexes, plus population, area, density, growth and PAES (when the DEMRE source is built). Each metric carries its
label, unit, format and whether higher is better, so the screen can colour the best and the worst.
"""

from __future__ import annotations

import json

from ..core.geo import MapProjection
from ..core.paths import WEB_DATA
from ..core.store import load_interim, write_web
from .cities import sii_by_code
from .lenses import comuna_values, meta

REQUIRES = ["_world", "cl_boundaries", "ine_censo2024", "ine_censo_tablas", "ine_censo_od", "sii_empresas", "uf",
            "cities.json", "lenses.json"]
PRODUCES = ["compare.json"]

GROUPS = [("people", "Personas"), ("knowledge", "Educación"), ("life", "Trabajo y vida diaria"),
          ("prosperity", "Vivienda y economía"), ("faith", "Religión")]
SKIP = {"faith_tradition", "paes", "paes_gap"}  # a category; the PAES average rows (each test is shown instead)


def area_km2(rings, proj) -> float:
    """Planar area of an outline in the map's equal-area projection (outer rings minus holes, by orientation)."""
    total = 0.0
    for r in rings:
        pts = [proj(lon, lat) for lon, lat in r]
        total += sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1])) / 2
    return abs(total) / proj.scale ** 2


def build() -> None:
    world = load_interim("_world")
    bounds = load_interim("cl_boundaries")
    censo = load_interim("ine_censo2024")
    tablas = load_interim("ine_censo_tablas")["tablas"]
    sii = load_interim("sii_empresas")
    uf = load_interim("uf")["values"].get(str(sii["year"]))
    od = load_interim("ine_censo_od")
    proj = MapProjection(**world["projection"])
    cities = {c["id"]: c for c in json.loads((WEB_DATA / "cities.json").read_text())}
    codes = [c["geoid"] for c in bounds["counties"] if c["geoid"] in cities]
    rings = {c["geoid"]: c["rings"] for c in bounds["counties"]}
    tv = comuna_values(codes, censo, tablas, sii_by_code(sii, censo), uf, od)
    m = meta(censo["year"], sii["year"])

    metrics, cols = [], {}

    def add_metric(mid, group, label, unit, fmt, higher_is, source, values):
        metrics.append({"id": mid, "group": group, "label": label, "unit": unit, "format": fmt, "higher_is": higher_is,
                        "source": source})
        cols[mid] = values

    pops = [cities[g]["population"] for g in codes]
    areas = [area_km2(rings[g], proj) for g in codes]
    add_metric("population", "people", "Población", "habitantes", "int", "neutral", "ine_censo2024", pops)
    add_metric("area", "people", "Superficie", "km²", "int", "neutral", "cl_boundaries", [round(a) for a in areas])
    add_metric("density", "people", "Densidad", "habitantes por km²", "int", "neutral", "ine_censo2024",
               [round(p / a) if a else None for p, a in zip(pops, areas)])
    for lid, info in m.items():
        if lid in SKIP or lid not in tv:
            continue
        group = info["group"] if info["group"] in dict(GROUPS) else "life"
        add_metric(lid, group, info["name"], info["unit"], info["format"], info["higher_is"], info["source"], tv[lid])
    try:
        paes = load_interim("demre_paes")
    except FileNotFoundError:
        paes = None
    if paes and isinstance(paes.get("tests"), dict):
        rows = paes["tests"]
        for tid, label in (("lectora", "PAES Competencia Lectora"), ("m1", "PAES Matemática 1"), ("m2", "PAES Matemática 2"),
                           ("historia", "PAES Historia y Ciencias Sociales"), ("ciencias", "PAES Ciencias")):
            def val(g, t=tid):
                rec = (rows.get(g) or {}).get(t) or {}
                return rec.get("mean") if (rec.get("n") or 0) >= 30 else None  # fewer than 30 test takers: too noisy
            add_metric(f"paes_{tid}", "knowledge", label, "puntaje promedio, colegios de la comuna (Admisión 2026)", "int",
                       "good", "demre_paes", [val(g) for g in codes])

    def rnd(v, fmt):
        if v is None:
            return None
        return round(v, 4) if fmt == "pct" else round(v, 2) if fmt in ("float", "years") else round(v)

    fmts = {mm["id"]: mm["format"] for mm in metrics}
    write_web("compare.json", {
        "version": 1,
        "vintage": "Censo 2024 (INE); empresas del SII; ver cada métrica",
        "groups": [{"id": g, "name": n} for g, n in GROUPS if any(mm["group"] == g for mm in metrics)],
        "metrics": metrics,
        "comunas": {g: [rnd(cols[mm["id"]][k], fmts[mm["id"]]) for mm in metrics] for k, g in enumerate(codes)},
    })
    print(f"    {len(codes)} comunas × {len(metrics)} metrics")
