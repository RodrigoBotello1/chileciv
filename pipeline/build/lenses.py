"""Lenses: colour every hex of the region by a comuna indicator (Censo 2024, SII) or by its own land cover.

Comuna values are spread to hexes with the comuna's population (a hex shared by two comunas gets their
population-weighted mean). Population density goes one step further: each comuna's population is spread over its
hexes in proportion to their built-up share (ESA WorldCover), so people sit in the city and not on the Andes.
Land lenses read each hex's own WorldCover shares. Helpers (percentile domain, hex weights, spread) from taiwanciv.
"""

from __future__ import annotations

import math
from collections import Counter

from ..core.geo import MapProjection
from ..core.hexgrid import HexGrid
from ..core.store import load_interim, write_web
from .cities import sii_by_code

REQUIRES = ["_world", "cl_boundaries", "ine_censo2024", "ine_censo_tablas", "sii_empresas", "uf"]
PRODUCES = ["lenses.json"]

GROUPS = [
    {"id": "people", "name": "Personas"},
    {"id": "prosperity", "name": "Prosperidad"},
    {"id": "knowledge", "name": "Conocimiento"},
    {"id": "life", "name": "Vida diaria"},
    {"id": "faith", "name": "Religión"},
    {"id": "land", "name": "Suelo"},
]
DOMAIN_NOTE = " La escala de colores va del percentil 2 al 98 de los hexágonos; los valores fuera de ese rango toman el color del extremo."
SPREAD = " Un hexágono que cruza dos comunas muestra el promedio ponderado por población."
CENSO = "Censo 2024 (INE)"

RAMP = {
    "density": ["#1b1035", "#4b2377", "#9a3b8a", "#e0645e", "#f9b24a", "#fff3a8"],
    "growth": ["#7a1f3d", "#c2525a", "#f0b7a4", "#f7f4ea", "#9ed3c6", "#3f9c9a", "#1b5e6b"],
    "age": ["#00224e", "#35456c", "#666970", "#948e77", "#c8b866", "#fee838"],
    "aging": ["#00224e", "#35456c", "#666970", "#948e77", "#c8b866", "#fee838"],
    "foreign_born": ["#0b0405", "#382a54", "#395d9c", "#3497a9", "#60ceac", "#def5e5"],
    "indigenous": ["#1a0f05", "#4a2c10", "#7d4c1e", "#b0773a", "#d9a866", "#f5dcae"],
    "household": ["#10202a", "#1f4257", "#346683", "#5a8fae", "#93bcd4", "#d6ebf5"],
    "movers": ["#2b0b1e", "#5e1742", "#93275f", "#c84f7c", "#ea8fa8", "#fbd9e1"],
    "sales_pc": ["#3a1c0b", "#7a4413", "#b8781f", "#e3b23c", "#f6e27f", "#fffbe0"],
    "homeownership": ["#1c1a05", "#45410f", "#76701d", "#a8a033", "#d4ce62", "#f8f6c4"],
    "crowding": ["#faebdd", "#f69c73", "#e83f3f", "#a11a5b", "#4c1d4b", "#03051a"],
    "bachelors": ["#08203e", "#0f4c81", "#2a7fc1", "#5fa8e0", "#a6d1f2", "#eaf5ff"],
    "schooling": ["#08203e", "#0f4c81", "#2a7fc1", "#5fa8e0", "#a6d1f2", "#eaf5ff"],
    "broadband": ["#1a0a2e", "#3f1d6b", "#6a3fa0", "#9a72c9", "#c9a9e6", "#f3e8ff"],
    "firewood": ["#1a0505", "#4a0f0f", "#80201a", "#b8452b", "#e07b54", "#f9c9a8"],
    "vacant": ["#121218", "#2c2c3c", "#4b4b66", "#727294", "#a3a3c2", "#e2e2f0"],
    "faith": ["#1a1033", "#3d2466", "#6b3d8f", "#a5649c", "#d99a8f", "#f7dca0"],
    "forest": ["#0b1f0f", "#14401c", "#1f6b2b", "#3a9443", "#7fc07a", "#d5efcd"],
    "farmland": ["#141d05", "#2f4510", "#557019", "#84a02a", "#b8cf55", "#eef7b8"],
    "developed": ["#121218", "#2c2c3c", "#4b4b66", "#727294", "#a3a3c2", "#e2e2f0"],
}
TRADITIONS = [
    ("catholic", "Católica", "#d1495b", ["catolica"]),
    ("evangelical", "Evangélica o protestante", "#3d7ea6", ["evangelica"]),
    ("none", "Ninguna religión", "#9a9aa8", ["ninguna"]),
    ("other", "Otras religiones", "#c9a227", ["judia", "musulmana", "sud", "ortodoxa", "budista", "testigo",
                                              "otros_cristianos", "otras"]),
]
DIGITS = {"pct": 4, "years": 1, "float": 2}


def nice(v: float, up: bool) -> float:
    if v == 0:
        return 0
    mag = 10 ** (math.floor(math.log10(abs(v))) - 1)
    return round((math.ceil if up else math.floor)(v / mag) * mag, 10)


def percentile_domain(values: list, log: bool) -> list[float] | None:
    vals = sorted(v for v in values if v is not None and (v > 0 or not log))
    if not vals:
        return None
    lo, hi = vals[int(0.02 * (len(vals) - 1))], vals[int(0.98 * (len(vals) - 1))]
    lo, hi = nice(lo, False), nice(hi, True)
    return [lo, hi] if hi > lo else [lo, nice(vals[-1], True) if vals[-1] > lo else lo + 1]


def _div(a, b):
    return a / b if a is not None and b else None


def median_age(ages: dict[str, float | None]) -> float | None:
    """Median age from 5-year groups ("0 a 4" … "100 o más"), interpolated inside the median group."""
    groups = []
    for label, n in ages.items():
        if n is None:
            continue
        digits = [int(t) for t in label.replace("o más", "").replace("a", " ").split() if t.isdigit()]
        if not digits:
            continue
        lo = digits[0]
        hi = digits[1] + 1 if len(digits) > 1 else lo + 5
        groups.append((lo, hi, n))
    groups.sort()
    total = sum(n for *_, n in groups)
    if not total:
        return None
    half, acc = total / 2, 0.0
    for lo, hi, n in groups:
        if acc + n >= half and n:
            return round(lo + (half - acc) / n * (hi - lo), 1)
        acc += n
    return None


def comuna_values(codes: list[str], censo: dict, tablas: dict, sii_of: dict, uf: float | None) -> dict[str, list]:
    pop = {c["code"]: c["population"] for c in censo["comunas"]}
    ages = {c["code"]: c["ages"] for c in censo["comunas"]}
    t = tablas
    out: dict[str, list] = {}

    def col(fn):
        return [fn(g) for g in codes]

    out["growth"] = col(lambda g: _div(pop[g], t["censo2017"][g]["pop"]) - 1 if t["censo2017"][g]["pop"] else None)
    out["age"] = col(lambda g: median_age(ages[g]))
    out["aging"] = col(lambda g: t["edad"][g]["indice_envejecimiento"])
    out["foreign_born"] = col(lambda g: _div(t["inmigracion"][g]["total"], pop[g]))
    out["indigenous"] = col(lambda g: _div(t["indigenas"][g]["total"], pop[g]))
    out["household"] = col(lambda g: t["hogares"][g]["personas_por_hogar"])
    out["movers"] = col(lambda g: 1 - _div(t["migracion_interna"][g]["no_migrante"],
                                           t["migracion_interna"][g]["pop"] - (t["migracion_interna"][g]["no_nacian"] or 0)))

    def sales(g):
        rub = (sii_of.get(g) or {}).get("rubros")
        return _div(sum(r.get("ventas_uf") or 0 for r in rub.values()) * uf, pop[g]) if rub and uf else None
    out["sales_pc"] = col(sales)
    out["homeownership"] = col(lambda g: _div((t["tenencia"][g]["propia_pagada"] or 0) + (t["tenencia"][g]["propia_pagandose"] or 0),
                                              t["tenencia"][g]["hogares"]))
    out["crowding"] = col(lambda g: _div((t["hacinamiento"][g]["medio"] or 0) + (t["hacinamiento"][g]["critico"] or 0),
                                         t["hacinamiento"][g]["viviendas"]))
    out["bachelors"] = col(lambda g: _div(t["nivel_educativo"][g]["superior"], t["nivel_educativo"][g]["pop"]))
    out["schooling"] = col(lambda g: t["escolaridad"][g]["anos_18"])
    out["broadband"] = col(lambda g: _div(t["internet_si"][g]["internet_fija"],
                                          (t["internet_si"][g]["internet_fija"] or 0) + (t["internet_no"][g]["internet_fija"] or 0)))
    out["firewood"] = col(lambda g: _div(t["calefaccion"][g]["lena"], t["calefaccion"][g]["hogares"]))
    out["vacant"] = col(lambda g: _div(t["viviendas"][g]["desocupadas"],
                                       (t["viviendas"][g]["ocupadas"] or 0) + (t["viviendas"][g]["desocupadas"] or 0)))

    def faith(g):
        r = t["religion"][g]
        declared = (r["pop15"] or 0) - (r["no_declarada"] or 0)
        return _div(declared - (r["ninguna"] or 0), declared)
    out["faith"] = col(faith)

    def tradition(g):
        r = t["religion"][g]
        counts = [sum(r.get(k) or 0 for k in keys) for _, _, _, keys in TRADITIONS]
        return max(range(len(counts)), key=lambda i: counts[i]) if any(counts) else None
    out["faith_tradition"] = col(tradition)
    return out


def meta(year: int, sii_year: int) -> dict[str, dict]:
    m = {}

    def add(lid, group, name, emoji, unit, fmt, scale, higher_is, source, description, note=None):
        m[lid] = {"group": group, "name": name, "icon": f"l-{lid.replace('_', '-')}", "emoji": emoji, "unit": unit,
                  "format": fmt, "scale": scale, "higher_is": higher_is, "ramp": RAMP.get(lid), "source": source,
                  "description": description, **({"note": note} if note else {})}

    add("density", "people", "Densidad", "👥", "habitantes / km²", "int", "log", "neutral", "ine_censo2024",
        f"Habitantes por km² de tierra. La población de cada comuna ({CENSO}) se reparte entre sus hexágonos según la "
        "proporción de suelo construido de cada uno (ESA WorldCover), con un mínimo para que el campo no quede en cero, y se "
        "divide por la superficie del hexágono.",
        "Reparto aproximado: el Censo cuenta personas por comuna, no por hexágono.")
    add("growth", "people", "Crecimiento 2017-2024", "📈", "cambio de población", "pct", "linear", "neutral", "ine_censo_tablas",
        "Población censada 2024 ÷ población censada 2017 − 1, por comuna (INE)." + SPREAD)
    add("age", "people", "Edad mediana", "🎂", "años", "years", "linear", "neutral", "ine_censo2024",
        f"Edad que divide a la población de la comuna en dos mitades, interpolada dentro de los grupos quinquenales de edad del {CENSO}." + SPREAD)
    add("aging", "people", "Envejecimiento", "👵", "personas de 65 o más por cada 100 menores de 15", "float", "linear", "neutral",
        "ine_censo_tablas", f"Índice de envejecimiento del {CENSO}: población de 65 años o más ÷ población de 0 a 14 años × 100." + SPREAD)
    add("foreign_born", "people", "Inmigrantes", "🌍", "nacidos fuera de Chile", "pct", "linear", "neutral", "ine_censo_tablas",
        f"Inmigrantes internacionales (personas nacidas fuera de Chile) ÷ población censada, {CENSO}." + SPREAD)
    add("indigenous", "people", "Pueblos indígenas", "🪶", "población que se considera de un pueblo originario", "pct", "linear", "neutral",
        "ine_censo_tablas", f"Personas que son o se consideran pertenecientes a un pueblo indígena u originario ÷ población censada, {CENSO}." + SPREAD)
    add("household", "people", "Personas por hogar", "🏡", "personas por hogar", "float", "linear", "neutral", "ine_censo_tablas",
        f"Promedio de personas por hogar, {CENSO}." + SPREAD)
    add("movers", "people", "Llegaron hace poco", "🧳", "vivían en otra comuna hace 5 años", "pct", "linear", "neutral", "ine_censo_tablas",
        f"Personas que hace 5 años vivían en otra comuna o fuera del país ÷ población de 5 años o más, {CENSO}." + SPREAD)
    add("sales_pc", "prosperity", "Ventas por habitante", "💰", "pesos por habitante al año", "usd", "log", "neutral", "sii_empresas",
        f"Ventas anuales {sii_year} de las empresas con casa matriz en la comuna (SII, en pesos) ÷ habitantes." + SPREAD,
        "Las ventas se cuentan en la comuna de la casa matriz: mide dónde están las oficinas, no el ingreso de los vecinos.")
    add("homeownership", "prosperity", "Vivienda propia", "🔑", "hogares en vivienda propia", "pct", "linear", "neutral", "ine_censo_tablas",
        f"Hogares en vivienda propia pagada o pagándose ÷ hogares censados, {CENSO}." + SPREAD)
    add("crowding", "prosperity", "Hacinamiento", "🛏️", "viviendas con hacinamiento medio o crítico", "pct", "linear", "bad",
        "ine_censo_tablas", f"Viviendas con hacinamiento medio o crítico ÷ viviendas particulares ocupadas con moradores presentes, {CENSO}." + SPREAD)
    add("bachelors", "knowledge", "Educación superior", "🎓", "población con educación superior", "pct", "linear", "good", "ine_censo_tablas",
        f"Personas cuyo nivel educativo más alto es la educación superior ÷ población censada, {CENSO}." + SPREAD,
        "Sobre toda la población, niños incluidos: por eso ninguna comuna se acerca al 100%.")
    add("schooling", "knowledge", "Años de escolaridad", "📚", "años, población de 18 o más", "years", "linear", "good", "ine_censo_tablas",
        f"Años de escolaridad promedio de la población de 18 años o más, {CENSO}." + SPREAD)
    add("broadband", "knowledge", "Internet fija", "📡", "hogares con internet fija", "pct", "linear", "good", "ine_censo_tablas",
        f"Hogares que disponen de internet fija ÷ hogares que respondieron, {CENSO}." + SPREAD)
    add("firewood", "life", "Calefacción a leña", "🔥", "hogares que calefaccionan con leña", "pct", "linear", "neutral", "ine_censo_tablas",
        f"Hogares cuya fuente principal de calefacción es la leña ÷ hogares censados, {CENSO}." + SPREAD)
    add("vacant", "life", "Viviendas desocupadas", "🏚️", "viviendas particulares desocupadas", "pct", "linear", "neutral", "ine_censo_tablas",
        f"Viviendas particulares desocupadas (en venta o arriendo, de temporada, abandonadas u otras) ÷ viviendas particulares, {CENSO}." + SPREAD)
    add("faith", "faith", "Con religión", "🕍", "población de 15 o más con alguna religión", "pct", "linear", "neutral", "ine_censo_tablas",
        f"Personas de 15 años o más que declaran una religión o credo ÷ las que respondieron la pregunta, {CENSO}." + SPREAD)
    add("faith_tradition", "faith", "Religión mayoritaria", "⛪", "la religión con más fieles", "category", "linear", "neutral",
        "ine_censo_tablas", f"La religión o credo más declarado por la población de 15 años o más de la comuna, {CENSO}. "
        "'Ninguna religión' cuenta como una opción más.")
    land = ("Proporción del hexágono con {what} según ESA WorldCover 2021 (píxeles de unos 148 m), sobre su suelo que no es agua.")
    add("forest", "land", "Bosque", "🌲", "del suelo del hexágono", "pct", "linear", "neutral", "worldcover", land.format(what="cobertura arbórea"))
    add("farmland", "land", "Cultivos", "🚜", "del suelo del hexágono", "pct", "linear", "neutral", "worldcover", land.format(what="cultivos"))
    add("developed", "land", "Construido", "🏙️", "del suelo del hexágono", "pct", "linear", "neutral", "worldcover", land.format(what="superficie construida"))
    return m


def build() -> None:
    world = load_interim("_world")
    censo = load_interim("ine_censo2024")
    tablas = load_interim("ine_censo_tablas")["tablas"]
    sii = load_interim("sii_empresas")
    uf = load_interim("uf")["values"].get(str(sii["year"]))
    proj, grid = MapProjection(**world["projection"]), HexGrid(**world["grid"])
    owner, samples, codes = world["owner"], world["county_samples"], world["counties"]
    dev = world["pct"]["developed"]
    pop = {c["code"]: c["population"] for c in censo["comunas"]}
    popk = [pop.get(g) for g in codes]

    # Hex weights: each comuna's population spread over the sample points that fall in it (7 per hex).
    hits = Counter(k for s in samples for k in s if k >= 0)
    weights = [[] for _ in samples]
    for i, s in enumerate(samples):
        if s and owner[i] >= 0:
            weights[i] = [(k, popk[k] * h / hits[k]) for k, h in Counter(x for x in s if x >= 0).items() if popk[k]]

    def spread(tvals: list, digits: int) -> list:
        out = [None] * len(samples)
        for i, parts in enumerate(weights):
            vals = [(tvals[k], p) for k, p in parts if tvals[k] is not None]
            wsum = sum(p for _, p in vals)
            if wsum:
                out[i] = round(sum(v * p for v, p in vals) / wsum, digits)
        return out

    # Density: comuna population spread by built-up share (minimum weight 2) over its sample points.
    hex_km2 = 1.5 * math.sqrt(3) * proj.km(grid.radius) ** 2
    built_hits: Counter = Counter()
    for i, s in enumerate(samples):
        if s and owner[i] >= 0:
            for k in s:
                if k >= 0:
                    built_hits[k] += max(dev[i], 2)
    density = [None] * len(samples)
    for i, s in enumerate(samples):
        if s and owner[i] >= 0:
            people = sum(popk[k] * max(dev[i], 2) / built_hits[k] for k in s if k >= 0 and popk[k])
            land = sum(1 for k in s if k >= 0) or 1
            density[i] = int(round(people / (hex_km2 * land / len(s))))

    tv = comuna_values(codes, censo, tablas, sii_by_code(sii, censo), uf)
    lenses = []
    for lid, m in meta(censo["year"], sii["year"]).items():
        m = dict(m)
        if lid == "density":
            values = density
        elif lid in ("forest", "farmland", "developed"):
            key = {"forest": "forest", "farmland": "crop", "developed": "developed"}[lid]
            values = [round(world["pct"][key][i] / 100, 4) if owner[i] >= 0 and world["cover"][i] else None
                      for i in range(len(samples))]
        elif lid == "faith_tradition":
            # Each hex: the tradition of the comuna with the most people in it.
            values = []
            for parts in weights:
                best = max(parts, key=lambda kp: kp[1], default=None)
                values.append(tv["faith_tradition"][best[0]] if best else None)
            cats = [{"id": cid, "name": name, "color": color} for cid, name, color, _ in TRADITIONS]
            m.update(categories=cats, ramp=[c["color"] for c in cats], domain=[0, len(cats) - 1])
        elif m["format"] == "usd":
            values = [None if x is None else int(round(x)) for x in spread(tv[lid], 0)]
        else:
            values = spread(tv[lid], DIGITS[m["format"]])
        if "domain" not in m:
            m["domain"] = percentile_domain(values, m["scale"] == "log")
            m["description"] += DOMAIN_NOTE
        if lid == "growth" and m["domain"]:
            r = max(abs(m["domain"][0]), abs(m["domain"][1]))
            m["domain"] = [-r, r]  # centred on zero: pale = no change
        lenses.append({"id": lid, **m, "values": values})
        n = sum(1 for x in values if x is not None)
        print(f"    {lid:16s} hexes {n}  domain {m['domain']}")
    groups = [g for g in GROUPS if any(l["group"] == g["id"] for l in lenses)]
    write_web("lenses.json", {"vintage": f"Censo 2024 (INE); empresas del SII {sii['year']}; ESA WorldCover 2021",
                              "groups": groups, "lenses": lenses})
