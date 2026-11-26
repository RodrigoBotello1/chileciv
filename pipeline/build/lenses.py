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

REQUIRES = ["_world", "cl_boundaries", "ine_censo2024", "ine_censo_tablas", "sii_empresas", "uf", "worldclim", "usgs_sismos", "wikidata_rm"]
PRODUCES = ["lenses.json"]

GROUPS = [
    {"id": "people", "name": "Personas"},
    {"id": "prosperity", "name": "Prosperidad"},
    {"id": "knowledge", "name": "Conocimiento"},
    {"id": "life", "name": "Vida diaria"},
    {"id": "faith", "name": "Religión"},
    {"id": "nature", "name": "Clima y tierra"},
    {"id": "curious", "name": "Datos curiosos"},
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
    "rain": ["#5a3a1a", "#a8743a", "#e3c27a", "#c9e3c0", "#5fb3c9", "#1f5fa6", "#0b2a66"],
    "temperature": ["#2b3a8f", "#4a7fc1", "#9cc7e0", "#f2efd4", "#f4b06a", "#d9583b", "#8f1d1d"],
    "daylight_dec": ["#1b1035", "#3d2466", "#7a3f7a", "#c96a5a", "#f2a65a", "#fde68a"],
    "daylight_jun": ["#0b1026", "#1d2b5a", "#35508f", "#5f86c0", "#9cc0e3", "#e3f0fb"],
    "sea_km": ["#0b2a66", "#1f5fa6", "#5fb3c9", "#c9e3c0", "#e3c27a", "#a8743a"],
    "ski_km": ["#e8eef2", "#a9cfe3", "#5f9fc9", "#356fa0", "#1f4370", "#0d1f3d"],
    "quakes": ["#14161f", "#2e2a4a", "#5b3466", "#93405f", "#cf6a4a", "#f4b860"],
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


def _km(lon1, lat1, lon2, lat2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(a))


def _year(ms: int) -> int:
    import datetime
    return (datetime.datetime(1970, 1, 1) + datetime.timedelta(milliseconds=ms)).year


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

    out["growth"] = col(lambda g: _div(pop[g], t["censo2017"][g]["residentes"]) - 1 if t["censo2017"][g].get("residentes") else None)
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
        "Población censada 2024 ÷ residentes habituales del Censo 2017 − 1, por comuna (INE). Se compara con los residentes habituales de 2017 porque el Censo 2024 cuenta a las personas donde viven habitualmente (nota técnica N3 del INE)." + SPREAD)
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
    add("rain", "nature", "Lluvia anual", "🌧️", "mm al año", "int", "log", "neutral", "worldclim",
        "Precipitación anual promedio 1970-2000 (WorldClim 2.1, variable BIO12), en la celda de 5 minutos de arco (unos 9 km) "
        "bajo el centro de cada hexágono.", "Climatología interpolada desde estaciones; donde hay pocas (altiplano, campos de hielo) es aproximada.")
    add("temperature", "nature", "Temperatura media", "🌡️", "°C, promedio anual", "float", "linear", "neutral", "worldclim",
        "Temperatura media anual 1970-2000 (WorldClim 2.1, variable BIO1), en la celda de unos 9 km bajo el centro de cada hexágono.")
    add("quakes", "nature", "Terremotos", "🌋", "sismos de magnitud 7 o más a menos de 100 km, desde 1900", "int", "linear", "bad",
        "usgs_sismos", "Número de sismos de magnitud 7 o más desde 1900 cuyo epicentro está a menos de 100 km del centro del "
        "hexágono (catálogo ComCat del USGS).", "Cuenta epicentros, no daños: un terremoto se siente mucho más allá de 100 km.")
    add("daylight_dec", "curious", "Luz el 21 de diciembre", "☀️", "horas de sol en el día más largo", "float", "linear", "neutral",
        "worldclim", "Horas entre la salida y la puesta del sol el 21 de diciembre (solsticio de verano), calculadas con la "
        "latitud del centro del hexágono y la declinación solar de ese día, contando la refracción atmosférica. Es "
        "astronomía, no medición: no considera montañas que tapen el sol.")
    add("daylight_jun", "curious", "Luz el 21 de junio", "🌙", "horas de sol en el día más corto", "float", "linear", "neutral",
        "worldclim", "Horas de sol el 21 de junio (solsticio de invierno), con el mismo cálculo astronómico que el lente del "
        "21 de diciembre.")
    add("sea_km", "curious", "Distancia al mar", "🏖️", "km hasta el océano Pacífico", "int", "linear", "neutral", "world",
        "Distancia aproximada desde el centro del hexágono hasta el hexágono de mar más cercano, contada en pasos de "
        "hexágono (cada paso mide lo que separa dos centros vecinos). Los lagos no cuentan como mar.")
    add("ski_km", "curious", "Distancia a la nieve", "🎿", "km en línea recta al centro de ski más cercano", "int", "linear", "neutral",
        "wikidata_rm", "Distancia en línea recta desde el centro del hexágono hasta el centro de ski más cercano registrado "
        "en Wikidata: {ski}.", "Wikidata no tiene todos los centros de ski del sur.")
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
    clim = load_interim("worldclim")
    quakes = load_interim("usgs_sismos")["quakes"]
    lenses = []
    for lid, m in meta(censo["year"], sii["year"]).items():
        m = dict(m)
        if lid == "density":
            values = density
        elif lid in ("rain", "temperature"):
            g = clim["prec" if lid == "rain" else "temp"]
            values = []
            for i in range(len(samples)):
                if owner[i] < 0:
                    values.append(None)
                    continue
                lon, lat = proj.inverse(*grid.center(*grid.col_row(i)))
                r, c = round((g["lat0"] - lat) / g["px"]), round((lon - g["lon0"]) / g["px"])
                v = g["rows"][r][c] if 0 <= r < len(g["rows"]) and 0 <= c < len(g["rows"][0]) else None
                values.append(None if v is None else (int(round(v)) if lid == "rain" else round(v, 1)))
            if lid == "rain":
                m["domain"] = percentile_domain([v if v else None for v in values], True)
                m["description"] += DOMAIN_NOTE
        elif lid in ("daylight_dec", "daylight_jun"):
            decl = math.radians(-23.44 if lid == "daylight_dec" else 23.44)
            h0 = math.radians(-0.833)  # sun's upper limb at the horizon, with refraction
            values = []
            for i in range(len(samples)):
                if owner[i] < 0:
                    values.append(None)
                    continue
                lat = math.radians(proj.inverse(*grid.center(*grid.col_row(i)))[1])
                c = (math.sin(h0) - math.sin(lat) * math.sin(decl)) / (math.cos(lat) * math.cos(decl))
                values.append(round(2 * math.degrees(math.acos(max(-1.0, min(1.0, c)))) / 15, 2))
        elif lid == "sea_km":
            step_km = math.sqrt(3) * proj.km(grid.radius)  # centre-to-centre distance of neighbouring hexes
            dist = [None] * len(samples)
            frontier = [i for i, wv in enumerate(world["water"]) if wv in (1, 2)]  # ocean and coast, not lakes
            for i in frontier:
                dist[i] = 0
            while frontier:
                nxt = []
                for i in frontier:
                    for j in grid.neighbours(i):
                        if dist[j] is None:
                            dist[j] = dist[i] + 1
                            nxt.append(j)
                frontier = nxt
            values = [None if owner[i] < 0 or dist[i] is None else int(round(dist[i] * step_km)) for i in range(len(samples))]
        elif lid == "ski_km":
            ski = load_interim("wikidata_rm").get("ski") or []
            m["description"] = m["description"].replace("{ski}", ", ".join(sorted({s["name"] for s in ski})) or "ninguno")
            values = []
            for i in range(len(samples)):
                if owner[i] < 0 or not ski:
                    values.append(None)
                    continue
                lon, lat = proj.inverse(*grid.center(*grid.col_row(i)))
                values.append(int(round(min(_km(lon, lat, s["lon"], s["lat"]) for s in ski))))
        elif lid == "quakes":
            strong = [q for q in quakes if q["mag"] >= 7]
            values = []
            for i in range(len(samples)):
                if owner[i] < 0:
                    values.append(None)
                    continue
                lon, lat = proj.inverse(*grid.center(*grid.col_row(i)))
                values.append(sum(1 for q in strong if _km(lon, lat, q["lon"], q["lat"]) < 100))
            top = sorted(strong, key=lambda q: -q["mag"])[:5]
            bounds = load_interim("cl_boundaries")
            centres = []
            for cty in bounds["counties"]:
                pts = [p for r in cty["rings"] for p in r]
                centres.append((cty["name"], sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
            def near(q):  # the comuna whose centre is closest to the epicentre (USGS names places in English)
                return min(centres, key=lambda c: _km(q["lon"], q["lat"], c[1], c[2]))[0]
            m["description"] += " Los más fuertes en la ventana del mapa: " + "; ".join(
                f"magnitud {q['mag']:.1f} en {_year(q['time'])}, cerca de {near(q)}" for q in top) + "."
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
