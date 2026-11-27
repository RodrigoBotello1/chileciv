"""Habitantes: la mezcla de personas de cada comuna para las figuras de la vista de ciudad.

Tres filas tienen fuente chilena, todas del Censo 2024 del INE (ine_censo2024, ine_censo_tablas):

* age: población por tramo de edad (los 18 tramos quinquenales del censo), agrupada en cuatro categorías: niñez (0 a 14),
  jóvenes (15 a 34), adultos (35 a 64) y mayores (65 o más). La edad mediana se interpola dentro del tramo quinquenal
  que contiene a la persona del medio (aproximada: el censo publica tramos, no años simples). `pyramid` guarda los 18
  tramos separados en hombres y mujeres (en el orden de `age_bands`), para la pirámide de edades.
* education: nivel educacional más alto aprobado. La tabla del censo cubre a toda la población (incluye a niños y
  jóvenes que aún estudian), no solo a los adultos: por eso "hasta básica" sobrerrepresenta a quienes están en edad
  escolar. El total de la fila excluye a quienes no declararon el nivel. `bachelors_plus` (la cifra del encabezado) se
  calcula solo sobre la población de 15 años o más (población menos el tramo 0 a 14), porque el nivel superior solo
  lo alcanzan adultos; incluye educación superior incompleta, que la tabla no separa.
* nativity: país de nacimiento. Nacidos en Chile = población menos inmigrantes; los inmigrantes (personas nacidas en
  otro país, tabla de inmigración del censo) se agrupan en Venezuela, otros de América Latina y el Caribe, y el
  resto del mundo (incluye país no declarado). No es el mismo concepto que `born_in_state` del original: aquí no se
  separa a los chilenos que nacieron en otra comuna.

Las otras dos filas del original son nulas en todas las comunas y no tienen entrada en `groups` (la vista de ciudad
omite un tipo de fila que no existe): `workforce` (el empleo por rama de la fuente SII cuenta a los trabajadores en la
comuna de la casa matriz de la empresa, no donde viven las personas, y no es una ocupación; presentarlo como
ocupación de los habitantes confundiría) y `commute` (no hay una tabla de viajes al trabajo por comuna en los datos).

Las cifras de figuras (`figures`) usan el método del mayor resto. `specialists` lista las categorías cuya proporción es
al menos SPECIALIST_HIGH veces o a lo sumo SPECIALIST_LOW veces la proporción de la región (nacional = suma de las 52
comunas de la Región Metropolitana).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from ..core.paths import WEB_DATA
from ..core.store import load_interim, write_web

REQUIRES = ["ine_censo2024", "ine_censo_tablas", "ine_censo_od", "cities.json"]
PRODUCES = ["citizens.json"]

FIGURES = {"age": 10}
SPECIALIST_HIGH = 1.5
SPECIALIST_LOW = 0.67
MIN_SHARE = 0.01
MIN_COUNT = 500  # una categoría con menos personas que esto en la comuna nunca es especialidad
MAX_HIGH, MAX_LOW = 4, 2
NO_SOURCE = ["workforce", "commute"]  # filas del original sin fuente adecuada: nulas en todas partes

AGE_BANDS = ["0 a 4", "5 a 9", "10 a 14", "15 a 19", "20 a 24", "25 a 29", "30 a 34", "35 a 39", "40 a 44",
             "45 a 49", "50 a 54", "55 a 59", "60 a 64", "65 a 69", "70 a 74", "75 a 79", "80 a 84", "85 o más"]
LATAM = ["Argentina", "Bolivia (Estado Plurinacional de)", "Colombia", "Haití", "Perú",
         "Otros países de América del Sur", "Otros países de América Central y El Caribe"]
VENEZUELA = "Venezuela (República Bolivariana de)"


def _g(key, label, short, icon, lines):
    return {"key": key, "label": label, "short": short, "icon": icon, "lines": lines}


GROUPS = {
    "age": [
        _g("child", "Niñez (0 a 14 años)", "0 a 14", "c-child", "Censo 2024, tramos de edad 0 a 4, 5 a 9 y 10 a 14"),
        _g("young", "Jóvenes (15 a 34 años)", "15 a 34", "c-young", "Censo 2024, tramos de edad 15 a 19 hasta 30 a 34"),
        _g("midlife", "Adultos (35 a 64 años)", "35 a 64", "c-midlife", "Censo 2024, tramos de edad 35 a 39 hasta 60 a 64"),
        _g("elder", "Mayores (65 años o más)", "65 o más", "c-elder", "Censo 2024, tramos de edad 65 a 69 hasta 85 o más"),
    ],
    "education": [
        _g("hasta_basica", "Sin estudios o hasta educación básica", "hasta básica", "c-edu0",
           "Censo 2024 (microdatos), personas de 25 años o más, CINE 2011: nunca cursó, primera infancia, primaria y "
           "secundaria baja, educación especial"),
        _g("media", "Educación media completa", "media", "c-edu1",
           "Censo 2024 (microdatos), 25 años o más, CINE 24 y 25: secundaria científico-humanista o técnico-profesional"),
        _g("tecnica", "Técnico de nivel superior", "técnico", "c-edu2",
           "Censo 2024 (microdatos), 25 años o más, CINE 35: terciaria de ciclo corto (técnico de nivel superior)"),
        _g("universitaria", "Título universitario o profesional", "universitario", "c-edu3",
           "Censo 2024 (microdatos), 25 años o más, CINE 46: grado de educación terciaria o equivalente"),
        _g("postgrado", "Magíster o doctorado", "magíster o doctorado", "c-edu4",
           "Censo 2024 (microdatos), 25 años o más, CINE 56 y 64: maestría, especialización o doctorado"),
    ],
    "nativity": [
        _g("born_in_chile", "Nacidos en Chile", "Chile", "c-local", "Población total menos personas nacidas en otro país"),
        _g("venezuela", "Nacidos en Venezuela", "Venezuela", "c-immigrant", "Censo 2024, país de nacimiento: Venezuela"),
        _g("latam", "Nacidos en otro país de América Latina y el Caribe", "otra América Latina", "c-abroad",
           "Censo 2024, país de nacimiento: Argentina, Bolivia, Colombia, Haití, Perú y el resto de América del Sur, Central y el Caribe"),
        _g("world", "Nacidos en el resto del mundo", "resto del mundo", "c-newcomer",
           "Censo 2024, país de nacimiento: América del Norte, Europa, Asia, África, Oceanía y no declarado"),
    ],
}
ROW_LABELS = {
    "age": "Población por tramo de edad",
    "education": "Nivel educativo más alto de las personas de 25 años o más (sin los que no respondieron)",
    "nativity": "País de nacimiento de los habitantes",
}


def largest_remainder(values: dict[str, float], n: int) -> dict[str, int]:
    """Integer counts summing exactly to n, proportional to `values` (Hamilton's method).

    Ties in the remainders go to the larger value, then to the earlier key, so the result is deterministic.
    Negative values count as 0. All-zero input → all zeros.
    """
    keys = list(values)
    vals = [max(0.0, float(values[k] or 0)) for k in keys]
    total = sum(vals)
    if total <= 0 or n <= 0:
        return {k: 0 for k in keys}
    quotas = [v * n / total for v in vals]
    base = [math.floor(q) for q in quotas]
    left = n - sum(base)
    order = sorted(range(len(keys)), key=lambda i: (-(quotas[i] - base[i]), -vals[i], i))
    for i in order[:left]:
        base[i] += 1
    return dict(zip(keys, base))


def age_median(ages: dict) -> float | None:
    """Edad mediana interpolada dentro del tramo quinquenal que contiene a la persona del medio."""
    vals = [ages[b] for b in AGE_BANDS]
    total = sum(vals)
    if total <= 0:
        return None
    half, acc = total / 2, 0
    for i, v in enumerate(vals[:-1]):
        if acc + v >= half:
            return round(i * 5 + (half - acc) / v * 5, 1) if v else float(i * 5)
        acc += v
    return None


def counts_of(name: str, c: dict, t: dict) -> dict[str, float]:
    """Conteos de cada categoría de una fila para una comuna (c: registro de ine_censo2024, t: tablas por tabla)."""
    if name == "age":
        a = c["ages"]
        band = lambda lo, hi: sum(a[b] for b in AGE_BANDS[lo:hi])  # noqa: E731
        return {"child": band(0, 3), "young": band(3, 7), "midlife": band(7, 13), "elder": band(13, 18)}
    if name == "education":
        e = t.get("cine25") or {}
        g = lambda *codes: sum(e.get(str(k), 0) for k in codes)  # noqa: E731  CINE 2011 codes 1..12 of the microdata
        return {"hasta_basica": g(1, 2, 3, 4, 5, 12), "media": g(6, 7), "tecnica": g(8), "universitaria": g(9),
                "postgrado": g(10, 11)}
    p = t["inmigracion"]["paises"]
    latam = sum(p[k] for k in LATAM)
    ven = p[VENEZUELA]
    world = t["inmigracion"]["total"] - latam - ven
    return {"born_in_chile": c["population"] - t["inmigracion"]["total"], "venezuela": ven, "latam": latam, "world": world}


def add(a: dict[str, float], b: dict[str, float]) -> dict[str, float]:
    return {k: a.get(k, 0) + b[k] for k in b}


def row(name: str, counts: dict[str, float], extra: dict) -> dict | None:
    total = sum(counts.values())
    if total <= 0:
        return None
    counts = {k: round(v) for k, v in counts.items()}
    total = round(total)
    out = {"total": total, "counts": counts, "shares": {k: round(v / total, 3) for k, v in counts.items()}}
    if name in FIGURES:
        out["figures"] = largest_remainder(counts, FIGURES[name])
    if name == "age":
        out["median"] = extra.get("median")
        out["pyramid"] = extra.get("pyramid")
    if name == "education":
        out["bachelors_plus"] = extra.get("bachelors_plus")
        out["doctorate"] = extra.get("doctorate")
    if name == "nativity":
        out["foreign_born"] = round(1 - counts["born_in_chile"] / total, 4)
        out["born_in_chile"] = round(counts["born_in_chile"] / total, 4)
        out["top_countries"] = extra.get("top_countries", [])
    return out


def top_countries(paises: dict, n: int = 5) -> list[dict]:
    named = [(k, v) for k, v in paises.items() if not k.startswith(("Otros", "América del Norte", "Europa", "Asia", "África", "Oceanía", "País"))]
    named.sort(key=lambda kv: -kv[1])
    return [{"country": k.replace(" (Estado Plurinacional de)", "").replace(" (República Bolivariana de)", ""), "count": round(v)}
            for k, v in named[:n]]


def build_rows(records: list[tuple[dict, dict]]) -> dict:
    """Una fila completa para el conjunto de comunas `records` (una comuna, o toda la región)."""
    acc = {name: {} for name in GROUPS}
    ages = dict.fromkeys(AGE_BANDS, 0)
    men, women = [0] * len(AGE_BANDS), [0] * len(AGE_BANDS)
    pop = a0_14 = superior = doctorate = 0
    paises: dict[str, float] = {}
    for c, t in records:
        for name in GROUPS:
            acc[name] = add(acc[name], counts_of(name, c, t))
        for i, b in enumerate(AGE_BANDS):
            ages[b] += c["ages"][b]
            men[i] += c["ages_by_sex"][b][0]
            women[i] += c["ages_by_sex"][b][1]
        pop += c["population"]
        a0_14 += t["edad"]["a0_14"]
        e = t.get("cine25") or {}
        superior += sum(e.get(str(k), 0) for k in (9, 10, 11))
        doctorate += e.get("11", 0)
        for k, v in t["inmigracion"]["paises"].items():
            paises[k] = paises.get(k, 0) + v
    extras = {
        "age": {"median": age_median(ages), "pyramid": {"men": men, "women": women}},
        "education": {"bachelors_plus": round(superior / max(1, sum(acc["education"].values())), 4)
                      if sum(acc["education"].values()) else None,
                      "doctorate": doctorate},
        "nativity": {"top_countries": top_countries(paises)},
    }
    parts = {name: row(name, acc[name], extras[name]) for name in GROUPS}
    for name in NO_SOURCE:
        parts[name] = None
    return parts


def specialists(r: dict, nat: dict) -> list[dict]:
    hi, lo = [], []
    for name in GROUPS:
        a, b = r.get(name), nat.get(name)
        if not a or not b:
            continue
        for k, n in a["counts"].items():
            s, ns = n / a["total"], b["counts"][k] / b["total"]
            if n < MIN_COUNT or not ns or (s < MIN_SHARE and ns < MIN_SHARE):
                continue
            ratio = s / ns
            item = {"row": name, "key": k, "share": round(s, 3), "national": round(ns, 3), "ratio": round(ratio, 2)}
            if ratio >= SPECIALIST_HIGH:
                hi.append(item)
            elif ratio <= SPECIALIST_LOW:
                lo.append(item)
    hi.sort(key=lambda x: -x["ratio"])
    lo.sort(key=lambda x: x["ratio"])
    return hi[:MAX_HIGH] + lo[:MAX_LOW]


def rule_text() -> str:
    return (
        f"Las figuras se redondean con el método del mayor resto, así cada fila suma el total de figuras. Una categoría se "
        f"marca como especialidad si su proporción es al menos {SPECIALIST_HIGH:g} veces la de la región, o a lo sumo "
        f"{SPECIALIST_LOW:g} veces (se omiten las categorías bajo {MIN_SHARE:.0%} tanto en la comuna como en la región, y las que "
        f"tienen menos de {MIN_COUNT:,} personas en la comuna). Se listan hasta {MAX_HIGH} categorías altas y {MAX_LOW} bajas. "
        "Todo viene del Censo 2024 del INE. La región es la suma de las 52 comunas de la Región Metropolitana. "
        "La edad mediana es aproximada: se interpola dentro de tramos de cinco años. "
        "El nivel educacional cubre a toda la población, incluidos niños y jóvenes que aún estudian, por eso \"hasta básica\" "
        "pesa más de lo que pesaría entre adultos; el porcentaje con educación superior del encabezado se calcula sobre las "
        "personas de 15 años o más e incluye la educación superior incompleta. "
        "El país de nacimiento separa a los nacidos en el extranjero por origen; no distingue a los chilenos nacidos en otra comuna. "
        "No hay fila de ocupación: el empleo por rama del SII se cuenta en la comuna de la casa matriz de cada empresa, no en la de "
        "residencia de los trabajadores, así que no describe a los habitantes. No hay fila de traslado al trabajo: los datos "
        "no traen una tabla de viajes por comuna."
    )


def build() -> None:
    censo = load_interim("ine_censo2024")
    tablas = load_interim("ine_censo_tablas")["tablas"]
    cities = json.loads((WEB_DATA / "cities.json").read_text())
    by_code = {c["code"]: c for c in censo["comunas"]}
    od = load_interim("ine_censo_od")["comunas"]

    def rec(code):
        t = {name: tab.get(code) for name, tab in tablas.items()}
        t["cine25"] = (od.get(code) or {}).get("cine25")
        if code not in by_code or any(t.get(k) is None for k in ("edad", "nivel_educativo", "inmigracion")):
            return None
        return by_code[code], t

    all_recs = [r for r in (rec(c["code"]) for c in censo["comunas"]) if r]
    national = build_rows(all_recs)
    national["specialists"] = []
    out = {}
    for city in cities:
        r = rec(city["id"])
        if r is None:
            out[city["id"]] = None
            continue
        parts = build_rows([r])
        parts["specialists"] = specialists(parts, national)
        parts["reliable"] = True
        out[city["id"]] = parts

    doc = {
        "version": 1,
        "vintage": f"Censo de Población y Vivienda {censo['year']} (INE)",
        "year": censo["year"],
        "sources": ["ine_censo2024", "ine_censo_tablas"],
        "figures": dict(FIGURES),
        "age_bands": AGE_BANDS,
        "rows": dict(ROW_LABELS),
        "groups": GROUPS,
        "units": {name: 1 for name in GROUPS},
        "rule": {
            "specialist_high": SPECIALIST_HIGH, "specialist_low": SPECIALIST_LOW, "min_share": MIN_SHARE,
            "min_count": MIN_COUNT, "max_high": MAX_HIGH, "max_low": MAX_LOW, "text": rule_text(),
        },
        "national": national,
        "cities": out,
    }
    write_web("citizens.json", doc)


# ---------------------------------------------------------------------------------------------- check


def _check_row(cid: str, r: dict, units: dict, bad) -> None:
    for name in list(GROUPS) + NO_SOURCE:
        if name not in r:
            bad(f"{cid}: missing row {name!r}")
    for name in NO_SOURCE:
        if r.get(name) is not None:
            bad(f"{cid}: {name} has no source in this build and must be null")
    for name in GROUPS:
        v = r.get(name)
        if v is None:
            continue
        keys = [g["key"] for g in GROUPS[name]]
        if list(v.get("counts", {})) != keys or list(v.get("shares", {})) != keys:
            bad(f"{cid}: {name} categories differ from groups")
            continue
        if any(x is None or x < 0 for x in v["counts"].values()):
            bad(f"{cid}: {name} has negative or null counts")
        # Each published figure (the categories and the total) is rounded on its own to `unit`, so the sum may
        # be off by half a unit per figure.
        unit = units.get(name) or 1
        tol = max(2, 0.001 * v["total"]) if unit == 1 else unit / 2 * (len(keys) + 1)
        if abs(sum(v["counts"].values()) - v["total"]) > tol:
            bad(f"{cid}: {name} counts sum {sum(v['counts'].values())} != total {v['total']}")
        if name in FIGURES:
            f = v.get("figures") or {}
            if list(f) != keys or sum(f.values()) != FIGURES[name]:
                bad(f"{cid}: {name} figures must cover every category and sum to {FIGURES[name]}")


def check(web_dir: Path) -> list[tuple[str, str]]:
    web_dir = Path(web_dir)
    p = web_dir / "citizens.json"
    if not p.exists():
        return [("NOTE", "citizens.json: missing (optional, skipped)")]
    out: list[tuple[str, str]] = []
    bad = lambda m: out.append(("FAIL", f"citizens.json: {m}"))  # noqa: E731
    try:
        doc = json.loads(p.read_text())
    except ValueError as exc:
        return [("FAIL", f"citizens.json: invalid JSON ({exc})")]
    if not isinstance(doc, dict):
        return [("FAIL", "citizens.json: top level is not an object")]
    for k in ("version", "vintage", "year", "sources", "figures", "groups", "national", "cities"):
        if k not in doc:
            bad(f"missing key {k!r}")
    if out:
        return out
    sp = web_dir / "sources.json"
    if sp.exists() and isinstance(doc["sources"], list):
        try:
            known = {x.get("id") for x in json.loads(sp.read_text()) if isinstance(x, dict)}
        except (ValueError, AttributeError):
            known = None
        if known is not None and set(doc["sources"]) - known:
            out.append(("WARN", f"citizens.json: sources missing from sources.json: {sorted(set(doc['sources']) - known)}"))
    if doc["version"] != 1:
        bad(f"version {doc['version']!r} != 1")
    if doc["figures"] != FIGURES:
        bad(f"figures {doc['figures']} != {FIGURES}")
    if set(doc["groups"]) != set(GROUPS):
        bad(f"groups rows {sorted(doc['groups'])} differ from {sorted(GROUPS)}")
    for name, gs in GROUPS.items():
        got = [g.get("key") for g in doc["groups"].get(name, [])]
        if got != [g["key"] for g in gs]:
            bad(f"groups.{name} keys {got} differ from the contract")
        for g in doc["groups"].get(name, []):
            if not g.get("label") or not g.get("lines"):
                bad(f"groups.{name}.{g.get('key')}: label and lines are required")
    units = doc.get("units") if isinstance(doc.get("units"), dict) else {}
    if not isinstance(doc["national"], dict):
        bad("national row missing")
    else:
        _check_row("national", doc["national"], units, bad)
    cities = doc["cities"] if isinstance(doc["cities"], dict) else {}
    cp = web_dir / "cities.json"
    if cp.exists():
        try:
            ids = {c.get("id") for c in json.loads(cp.read_text()) if isinstance(c, dict)}
        except (ValueError, TypeError, AttributeError):
            ids = None
        if ids is not None:
            if ids - set(cities):
                bad(f"{len(ids - set(cities))} cities.json ids missing, e.g. {sorted(ids - set(cities))[:3]}")
            if set(cities) - ids:
                bad(f"{len(set(cities) - ids)} ids not in cities.json")
    min_count = (doc.get("rule") or {}).get("min_count") or 0
    n_null = 0
    row_null = {name: 0 for name in GROUPS}
    for cid, r in cities.items():
        if r is None:
            n_null += 1
            continue
        _check_row(cid, r, units, bad)
        for name in GROUPS:
            if r.get(name) is None:
                row_null[name] += 1
        if not isinstance(r.get("reliable"), bool):
            bad(f"{cid}: reliable must be a boolean")
        for s in r.get("specialists") or []:
            n = ((r.get(s.get("row")) or {}).get("counts") or {}).get(s.get("key"))
            if n is None or n < min_count:
                bad(f"{cid}: specialist {s.get('row')}.{s.get('key')} has fewer than {min_count} people")
    if any(lv == "FAIL" for lv, _ in out[:50]):
        return out[:50]
    out.append(("PASS", f"citizens.json: {len(cities)} cities, {n_null} with no citizen rows at all"))
    out.append(("NOTE", "citizens.json: cities without a row: "
                + ", ".join(f"{k} {v}" for k, v in row_null.items())
                + "; " + " and ".join(NO_SOURCE) + " have no source (null everywhere)"))
    return out
