"""Commuting: where the employed people of each comuna work (Censo 2024, question 44), for the map's flow arrows.

For every comuna on the map: its employed residents, the share who work at home, in their own comuna, in another
comuna, in several or abroad, their main travel modes, its top destinations among the map's comunas (with the share
of its employed residents that goes to each), and how many workers arrive from other comunas.
"""

from __future__ import annotations

from collections import defaultdict

from ..core.store import load_interim, write_web

REQUIRES = ["ine_censo_od", "cities.json"]
PRODUCES = ["commute.json"]

TOP_OUT = 8  # destinations kept per comuna
TOP_IN = 5  # origins kept per comuna
MIN_SHARE = 0.005  # a destination must take at least 0.5% of the comuna's employed residents
MODES = [("public", "Transporte público"), ("car", "Auto"), ("walk", "Caminando"), ("bike", "Bicicleta"),
         ("moto", "Moto"), ("boat_horse", "Caballo, lancha o bote"), ("other", "Otro")]


def build() -> None:
    import json
    from ..core.paths import WEB_DATA

    od = load_interim("ine_censo_od")
    cities = json.loads((WEB_DATA / "cities.json").read_text())
    on_map = {c["id"] for c in cities}
    out: dict[str, list] = defaultdict(list)
    inbound: dict[str, list] = defaultdict(list)
    for o, d, n in od["flows"]:
        if o in on_map and d in on_map:
            out[o].append((d, n))
            inbound[d].append((o, n))
    comunas = {}
    for code, rec in od["comunas"].items():
        if code not in on_map:
            continue
        w = rec["workers"] or 0
        place = rec["place"]
        moved = sum(n for k, n in rec["mode"].items() if k != "no_answer")
        dests = sorted(out[code], key=lambda x: -x[1])
        top = [[d, n, round(n / w, 4)] for d, n in dests if w and n / w >= MIN_SHARE][:TOP_OUT]
        ins = sorted(inbound[code], key=lambda x: -x[1])
        comunas[code] = {
            "workers": w,
            "share": {k: round(place.get(k, 0) / w, 4) if w else None
                      for k in ("home", "same", "other", "several", "abroad")},
            "modes": {k: round(rec["mode"].get(k, 0) / moved, 4) if moved else None for k, _ in MODES},
            "out_other": place.get("other", 0),
            "in_other": sum(n for _, n in ins),
            "top": top,
            "top_in": [[o, n] for o, n in ins[:TOP_IN]],
        }
    total = sum(c["workers"] for c in comunas.values())
    other = sum(c["out_other"] for c in comunas.values())
    write_web("commute.json", {
        "version": 1,
        "vintage": od.get("vintage") or "Censo 2024, microdatos (INE)",
        "sources": ["ine_censo_od"],
        "rule": ("Personas ocupadas según la comuna donde viven y la comuna donde está su trabajo (Censo 2024, pregunta 44). "
                 f"Para cada comuna se muestran hasta {TOP_OUT} comunas de destino que reciben al menos el "
                 f"{MIN_SHARE:.1%} de sus ocupados; el porcentaje es sobre todos los ocupados que viven en la comuna. "
                 "Quien trabaja en varias comunas o fuera del mapa no aparece en las flechas."),
        "modes": [{"id": k, "name": n} for k, n in MODES],
        "national": {"workers": total, "share_other": round(other / total, 4) if total else None},
        "comunas": comunas,
    })
    big = max(comunas.items(), key=lambda kv: kv[1]["in_other"])
    print(f"    {len(comunas)} comunas; {other / total:.1%} of the employed work in another comuna; "
          f"most workers arriving: {big[0]} ({big[1]['in_other']:,})")
