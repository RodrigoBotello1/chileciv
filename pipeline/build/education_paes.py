"""PAES por comuna para la vista de comuna: rindentes y puntaje medio por tipo de colegio (DEMRE, Admisión 2026).

Las cifras son por la comuna del establecimiento, no por donde viven los estudiantes. Los tipos de colegio son
público (municipal y servicio local de educación juntos), particular subvencionado y particular pagado.
"""

from __future__ import annotations

import json

from ..core.paths import WEB_DATA
from ..core.store import load_interim, load_interim_payload, write_web

REQUIRES = ["demre_paes", "cities.json"]
PRODUCES = ["paes.json"]


def _merge(rec: dict, keys: tuple[str, ...]) -> dict | None:
    parts = [rec[k] for k in keys if k in rec]
    n = sum(p["n"] for p in parts)
    return {"n": n, "mean": round(sum(p["n"] * p["mean"] for p in parts) / n, 1)} if n else None


def _shape(rec: dict) -> dict:
    out = {"n": rec["all"]["n"], "mean": round(rec["all"]["mean"], 1), "by_dep": {}}
    for key, parts in (("publico", ("municipal", "slep")), ("subvencionado", ("subvencionado",)), ("pagado", ("pagado",))):
        d = _merge(rec, parts)
        if d:
            out["by_dep"][key] = d
    return out


def build() -> None:
    paes = load_interim("demre_paes")
    vintage = load_interim_payload("demre_paes")["vintage"]
    on_map = {c["id"] for c in json.loads((WEB_DATA / "cities.json").read_text())}
    comunas = {c: _shape(r) for c, r in paes["comunas"].items() if c in on_map}
    write_web("paes.json", {
        "version": 1,
        "vintage": vintage,
        "sources": ["demre_paes"],
        "rule": paes["rule"],
        "national": _shape(paes["national"]),
        "comunas": comunas,
    })
    print(f"    {len(comunas)} comunas; {sum(c['n'] for c in comunas.values()):,} rindentes")
