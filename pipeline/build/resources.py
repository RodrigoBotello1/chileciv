"""Resources: power plants (with their capacity) and the best-known mines, from Wikidata.

Every site is chosen by a published rule: power plants above a capacity threshold (Wikidata P2109, normalised to
watts), typed by their Wikidata class; mines with at least two Wikipedia articles, typed by their product (P1056).
The summary only adds up the mapped sites, never a region's total capacity.
"""

from __future__ import annotations

from ..core.geo import MapProjection
from ..core.hexgrid import HexGrid
from ..core.mapcfg import MAP
from ..core.store import load_interim, load_interim_payload, write_web

REQUIRES = ["_world", "cl_boundaries", "wikidata_rm"]
PRODUCES = ["resources.json"]

PLANT_MIN_MW = 10 if MAP == "rm" else 100
MINE_MIN_LINKS = 2
SRC = "wikidata_rm"
PLACED = " Posición y potencia según Wikidata; las centrales sin potencia cargada no aparecen."


def _t(id, name, category, emoji, color, unit, description, icon=None):
    return {"id": id, "name": name, "category": category, "emoji": emoji, "icon": icon or f"r-{id}", "color": color,
            "unit": unit, "description": description, "source": SRC}


TYPES = [
    _t("hydro", "Central hidroeléctrica", "energy", "💧", "#3fa7d6", "MW",
       f"Centrales hidroeléctricas (de embalse o de pasada) de {PLANT_MIN_MW} MW o más." + PLACED),
    _t("gas_plant", "Central a gas", "energy", "⚡", "#f08a24", "MW",
       f"Centrales a gas o de ciclo combinado de {PLANT_MIN_MW} MW o más." + PLACED),
    _t("coal_plant", "Central a carbón", "energy", "🏭", "#5a5a5a", "MW",
       f"Centrales a carbón de {PLANT_MIN_MW} MW o más." + PLACED),
    _t("thermal", "Central termoeléctrica", "energy", "🔥", "#b5653a", "MW",
       f"Otras centrales térmicas (diésel, combustibles fósiles sin detalle) de {PLANT_MIN_MW} MW o más." + PLACED,
       icon="r-gas_plant"),
    _t("wind", "Parque eólico", "energy", "🌬️", "#9fd8cb", "MW",
       f"Parques eólicos de {PLANT_MIN_MW} MW o más." + PLACED),
    _t("solar", "Planta solar", "energy", "☀️", "#ffc93c", "MW",
       f"Plantas solares (fotovoltaicas o de concentración) de {PLANT_MIN_MW} MW o más." + PLACED),
    _t("copper", "Mina de cobre", "mineral", "🟠", "#c46a3a", "artículos en Wikipedia",
       f"Minas de cobre con al menos {MINE_MIN_LINKS} artículos en Wikipedia (Wikidata, producto P1056). El valor es el "
       "número de artículos, una medida de lo conocida que es la mina, no de su producción."),
    _t("gold", "Mina de oro y plata", "mineral", "🟡", "#d4af37", "artículos en Wikipedia",
       f"Minas de oro o plata con al menos {MINE_MIN_LINKS} artículos en Wikipedia. El valor es el número de artículos."),
    _t("mine", "Otra mina", "mineral", "⛏️", "#8a7f72", "artículos en Wikipedia",
       f"Otras minas (hierro, litio, yodo, carbón u otro producto, o sin producto en Wikidata) con al menos "
       f"{MINE_MIN_LINKS} artículos en Wikipedia. El valor es el número de artículos.", icon="r-iron"),
]
RANK = {t["id"]: i for i, t in enumerate(TYPES)}
SUMMARY_NOTE = ("Solo suma los sitios marcados en el mapa (cada tipo tiene un umbral, ver su descripción), no la capacidad "
                "instalada total del país o de cada zona.")


def plant_type(classes: list[str]) -> str | None:
    text = " ".join(classes or []).lower()
    for keys, t in ((("hidro", "presa"), "hydro"), (("eólic", "eolic"), "wind"), (("solar", "fotovolt"), "solar"),
                    (("carbón", "carbon"), "coal_plant"), (("gas", "ciclo combinado"), "gas_plant"),
                    (("termo", "fósil", "fosil", "diésel", "diesel", "térmica"), "thermal")):
        if any(k in text for k in keys):
            return t
    return None


def mine_type(products: list[str]) -> str:
    text = " ".join(products or []).lower()
    if "cobre" in text:
        return "copper"
    if "oro" in text or "plata" in text:
        return "gold"
    return "mine"


def build() -> None:
    world = load_interim("_world")
    bounds = load_interim("cl_boundaries")
    wd = load_interim_payload(SRC)["data"]
    grid, proj, owner = HexGrid(**world["grid"]), MapProjection(**world["projection"]), world["owner"]
    abbr = {s["fips"]: s["abbr"] for s in bounds["states"]}
    states, counties, county_of = world["states"], world["counties"], world["county"]

    def place(lon, lat):
        x, y = proj(lon, lat)
        cell = grid.cell_at(x, y)
        if cell < 0 or owner[cell] < 0:
            return None
        k = county_of[cell]
        return {"x": round(x, 1), "y": round(y, 1), "cell": cell, "state": abbr.get(states[owner[cell]]),
                "cbsa": counties[k] if k >= 0 else None}

    items = []
    for p in wd.get("plants") or []:
        t, mw = plant_type(p.get("clss")), (p.get("mw") or 0) / 1e6
        if t is None or mw < PLANT_MIN_MW:
            continue
        at = place(p["lon"], p["lat"])
        if at:
            items.append({"type": t, "name": p["name"], "value": round(mw, 1),
                          "detail": ", ".join(p.get("clss") or []), **at})
    for m in wd.get("mines") or []:
        if m["links"] < MINE_MIN_LINKS:
            continue
        at = place(m["lon"], m["lat"])
        if at:
            items.append({"type": mine_type(m.get("products")), "name": m["name"], "value": m["links"],
                          "detail": ", ".join(m.get("products") or []) or None, **at})
    items.sort(key=lambda i: (RANK[i["type"]], -(i["value"] or 0)))

    def summarise(rows):
        out = {}
        for t in TYPES:
            sel = [r for r in rows if r["type"] == t["id"]]
            out[t["id"]] = {"count": len(sel), "value": round(sum(r["value"] or 0 for r in sel), 1), "unit": t["unit"]}
        return out

    by_state: dict[str, dict] = {}
    for st in sorted({i["state"] for i in items if i["state"]}):
        rows = [i for i in items if i["state"] == st]
        by_state[st] = {k: v for k, v in summarise(rows).items() if v["count"]}
    write_web("resources.json", {"types": TYPES, "items": items,
                                 "summary": {"note": SUMMARY_NOTE, "national": summarise(items), "states": by_state}})
    counts = {t["id"]: sum(1 for i in items if i["type"] == t["id"]) for t in TYPES}
    print(f"    {len(items)} sites: {counts}")
    for i in items[:12]:
        print(f"      {i['type']}: {i['name']} ({i['value']})")
