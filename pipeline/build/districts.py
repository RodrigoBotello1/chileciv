"""Distritos: la especialización industrial real de cada comuna como distritos de juego de estrategia.

La fuente es el SII (`sii_empresas`): trabajadores dependientes ponderados por meses trabajados y remuneraciones, por
comuna y sección de actividad (CIIU4.CL A a U), asignados a la comuna de la **casa matriz** de la empresa. No son
personas que viven ni que trabajan en la comuna: las comunas de oficinas (Las Condes, Santiago, Providencia) muestran
trabajadores de faenas mineras o de obras que están en otro lugar. Los distritos describen dónde tienen su sede las
empresas. Las 18 secciones de `yields.INDUSTRIES` hacen de "industrias" (el campo `naics` de la salida lleva esas claves).

Cada distrito del original se conserva solo donde una o más secciones completas lo representan; no hay especialidades
(`sub` vacío salvo en los distritos de dos secciones, donde es la sección más fuerte), ni variación anual (`oty_pct`
null) ni nivel de comuna dentro de la comuna (`counties` null). Aeródromo y Campamento no tienen sección propia y se
omiten; la minería y la construcción no forman distrito (no hay un distrito para ellas y, por la casa matriz, harían
"industrial" a las comunas de oficinas), pero sí aparecen en `top`.

Cociente de localización (LQ) = (trabajadores de la comuna en las secciones del distrito ÷ trabajadores de la comuna en
todas las secciones) ÷ (la misma razón en la región, que es la suma de las 52 comunas). Sueldo medio = remuneraciones
anuales ÷ trabajadores, en pesos (UF al 31 de diciembre del año de los datos).

La regla (publicada en el archivo como `rule`):
* Un distrito **aparece** cuando su LQ es al menos MIN_LQ, suma al menos MIN_JOBS trabajadores y al menos MIN_SHARE de
  los trabajadores de la comuna.
* Se ordenan por fuerza = trabajadores sobre la norma regional (emp - emp / LQ); se guardan hasta MAX_PER_CITY.
  El Puerto además exige un hexágono de la comuna sobre agua o junto a ella, o sobre un río dibujado.
* El tipo de comuna (`badge`) sale del distrito más fuerte, salvo que otro distrito listado sea extremo (LQ >= BADGE_LQ
  y >= BADGE_SHARE de los trabajadores de la comuna): entonces gana el más fuerte de ellos. Una Plaza de gobierno en la
  capital (cities.json `capital`) se llama "Capital". Sin distrito no hay tipo.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..core.hexgrid import HexGrid
from ..core.paths import WEB_DATA
from ..core.store import load_interim, write_web
from .cities import sii_by_code
from .yields import INDUSTRIES

REQUIRES = ["_world", "cl_boundaries", "ine_censo2024", "sii_empresas", "uf", "cities.json", "world.json"]
PRODUCES = ["districts.json"]

MIN_LQ = 1.25
MIN_JOBS = 1_000    # trabajadores de las secciones del distrito en conjunto
MIN_SHARE = 0.01    # y al menos este porcentaje de los trabajadores de la comuna
MAX_PER_CITY = 5
TOP_INDUSTRIES = 8
MIN_CELL = 300      # filas de `top`: una sección con menos trabajadores es ruido
BADGE_LQ = 6.0
BADGE_SHARE = 0.03
BASIS = "sii"

RULE_TEXT = (
    f"Los distritos se eligen con los trabajadores que las empresas declaran al SII por sección de actividad "
    f"(dependientes, ponderados por los meses trabajados). Ojo: el SII asigna todos los trabajadores de una empresa a la "
    f"comuna de su casa matriz. Por eso las comunas de oficinas (Las Condes, Santiago, Providencia) muestran trabajadores "
    f"de minería o construcción que trabajan en otra parte: los distritos describen dónde tienen su sede las empresas, "
    f"no dónde trabaja la gente. "
    f"El cociente de localización es la proporción de trabajadores de la comuna en las secciones del distrito ÷ la misma "
    f"proporción en toda la región (la suma de las 52 comunas). Un distrito aparece cuando su cociente es al menos "
    f"{MIN_LQ:g}, suma al menos {MIN_JOBS:,} trabajadores y al menos {MIN_SHARE:.0%} de los de la comuna. "
    f"Los distritos se ordenan por los trabajadores sobre la norma regional (trabajadores − trabajadores ÷ cociente) y "
    f"cada comuna tiene hasta {MAX_PER_CITY}. El Puerto exige además un hexágono de la comuna junto al agua o con un río. "
    f"El tipo de comuna lleva el nombre del distrito más fuerte; si otro distrito tiene un cociente de al menos "
    f"{BADGE_LQ:g} y reúne al menos {BADGE_SHARE:.0%} de los trabajadores de la comuna, gana el más fuerte de ellos. "
    f"Una Plaza de gobierno en la capital se llama \"Capital\". Hay 18 secciones y no hay especialidades más finas; la "
    f"minería y la construcción no forman distrito. El sueldo medio son las remuneraciones anuales ÷ trabajadores."
)
NOTE = (
    "Los trabajadores se cuentan en la comuna de la casa matriz de cada empresa (SII), no donde viven ni donde trabajan: "
    "las comunas de oficinas suman trabajadores de faenas y obras de otras comunas o regiones. "
    "No hay Aeródromo ni Campamento: el SII no tiene una sección propia para ellos."
)
COUNTY_NOTE = "El SII no se usa por debajo de la comuna: no hay distritos dentro de una comuna."


def _d(id, name, color, sections, badge, description, caveat=None, sub=None):
    """Un distrito: `sections` = claves de `yields.INDUSTRIES` que suma (campo `naics` del contrato)."""
    return {
        "id": id, "name": name, "icon": "d-" + id.replace("_", "-"), "color": color, "naics": sections, "own": [],
        "sub": sub or {}, "badge": {"id": badge[0], "label": badge[1], "labels": {}},
        "description": description, "caveat": caveat,
    }


# Ids, iconos y colores del original, en su orden, para los distritos que una sección completa representa.
CATALOG = [
    _d("campus", "Campus", "#4a7bd0", ["professional", "information"], ("scientific", "Ciudad del conocimiento"),
       "Conocimiento y tecnología: actividades profesionales, científicas y técnicas (consultoría, ingeniería, derecho, "
       "contabilidad, I+D) e información y comunicaciones (software, telecomunicaciones, edición).",
       "No incluye universidades: la enseñanza es otra sección y no se puede separar la educación superior.",
       {"professional": "Servicios profesionales y técnicos", "information": "Información y comunicaciones"}),
    _d("commercial_hub", "Centro comercial", "#d0a23a", ["finance"], ("commercial", "Ciudad financiera"),
       "Actividades financieras y de seguros: bancos, corredores de bolsa, seguros y AFP."),
    _d("industrial_zone", "Zona industrial", "#c2643a", ["manufacturing"], ("industrial", "Ciudad industrial"),
       "Industria manufacturera.",
       "No incluye minería: por la casa matriz, las oficinas de las mineras harían industriales a las comunas de oficinas."),
    _d("harbor", "Puerto", "#2f8fb0", ["transportation"], ("maritime", "Ciudad de transporte"),
       "Transporte y almacenamiento: camiones, bodegas, logística, transporte de pasajeros, aéreo y correo.",
       "Es la sección completa: no separa puertos (la región no tiene mar, y los aeropuertos y las bodegas también la "
       "elevan). Solo aparece en comunas junto al agua o con un río."),
    _d("theater_square", "Plaza de teatro", "#a15bc4", ["arts"], ("cultural", "Ciudad cultural"),
       "Actividades artísticas, de entretenimiento y recreativas: artes escénicas, museos, deporte, juegos y recreación.",
       "La edición y la radiodifusión son parte de información y comunicaciones, y van en el Campus."),
    _d("entertainment_complex", "Complejo de ocio", "#d0508a", ["accommodation"], ("entertainment", "Ciudad de ocio"),
       "Alojamiento y servicios de comida: hoteles, restaurantes, cafés y banquetería.",
       "Es la suma de alojamiento y comida: la cifra no separa hoteles de restaurantes."),
    _d("government_plaza", "Plaza de gobierno", "#8a9a5b", ["public_admin"], ("governmental", "Ciudad de gobierno"),
       "Administración pública y defensa: ministerios, servicios públicos, municipios, Fuerzas Armadas y seguridad social.",
       "Cada comuna tiene su municipio; los colegios y hospitales públicos están en enseñanza y salud."),
    _d("aqueduct", "Acueducto y represa", "#3aa0a0", ["utilities"], ("utility", "Ciudad de servicios básicos"),
       "Electricidad, gas, agua y gestión de desechos: generación y distribución eléctrica, gas, agua potable, "
       "alcantarillado y residuos.",
       "Incluye la gestión de desechos y el reciclaje: no separa el agua potable."),
]
BY_ID = {d["id"]: d for d in CATALOG}
IDS = [d["id"] for d in CATALOG]
CAPITAL_LABEL = "Capital"


def _r(x, nd=3):
    return None if x is None else round(x, nd)


def lq(emp, total, nat_emp, nat_total):
    if emp is None or not total or not nat_emp or not nat_total:
        return None
    return (emp / total) / (nat_emp / nat_total)


def excess(emp, q) -> float:
    """People above the national norm: emp - emp / LQ (0 when LQ <= 1)."""
    return emp * (1 - 1 / q) if emp and q and q > 1 else 0.0


def badge_district(dists: list[dict]) -> dict | None:
    """The district the city type is named after: the strongest, unless a listed district is extreme."""
    if not dists:
        return None
    extreme = [d for d in dists if d["lq"] is not None and d["lq"] >= BADGE_LQ and (d["share"] or 0) >= BADGE_SHARE]
    return max(extreme, key=lambda d: d["strength"]) if extreme else dists[0]


def badge_for(best: dict | None, capital: bool = False) -> dict | None:
    if not best:
        return None
    d = BY_ID[best["id"]]
    label = CAPITAL_LABEL if capital and d["id"] == "government_plaza" else d["badge"]["label"]
    return {"id": d["badge"]["id"], "label": label, "district": d["id"],
            "text": f"{d['name']}: {best['lq']:.1f} veces la proporción regional de trabajadores", "basis": BASIS}


def wet_cities(cities: list[dict], world_i: dict, world: dict) -> set[str]:
    """Ids of cities with a footprint hex on or next to water, or on a mapped river."""
    grid = HexGrid(**world_i["grid"])
    water = world_i["water"]
    river_cells = set()
    for r in world.get("rivers") or []:
        pts = r.get("pts") or []
        for i in range(0, len(pts) - 2, 2):
            x0, y0, x1, y1 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
            n = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 / 4))
            for k in range(n + 1):
                c = grid.cell_at(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n)
                if c is not None and 0 <= c < len(water):
                    river_cells.add(c)
    out = set()
    for c in cities:
        cells = c.get("footprint") or ([c["cell"]] if c.get("cell") is not None else [])
        for cell in cells:
            if cell in river_cells or any(water[n] > 0 for n in [cell, *grid.neighbours(cell)]):
                out.add(c["id"])
                break
    return out


def jobs_of(rec: dict | None) -> dict | None:
    """Per industry key: {emp, pay_uf} (workers and annual pay in UF) from an sii_empresas comuna record."""
    rubros = (rec or {}).get("rubros")
    if not rubros:
        return None
    out = {}
    for key, (letters, _) in INDUSTRIES.items():
        rs = [rubros.get(l) or {} for l in letters]
        out[key] = {"emp": sum(r.get("trabajadores") or 0 for r in rs), "pay_uf": sum(r.get("renta_uf") or 0 for r in rs)}
    return out


def pay_clp(emp: float, pay_uf: float, uf: float) -> int | None:
    """Average MONTHLY pay in pesos: the year's taxable pay the companies report (SII, UF) ÷ full-year-equivalent
    workers (weighted by months worked) ÷ 12, at the UF of 31 December."""
    return round(pay_uf / emp * uf / 12) if emp > 0 and pay_uf > 0 else None


def build() -> None:
    world_i = load_interim("_world")
    censo = load_interim("ine_censo2024")
    sii = load_interim("sii_empresas")
    year = sii["year"]
    uf = load_interim("uf")["values"].get(str(year))
    if not uf:
        raise ValueError(f"uf.json has no value for {year}")
    cities = json.loads((WEB_DATA / "cities.json").read_text())
    world = json.loads((WEB_DATA / "world.json").read_text())
    wet = wet_cities(cities, world_i, world)
    sii_of = sii_by_code(sii, censo)

    rows = {c["id"]: jobs_of(sii_of.get(c["id"])) for c in cities}
    keys = list(INDUSTRIES)
    nation = {k: {"emp": sum(r[k]["emp"] for r in rows.values() if r), "pay_uf": sum(r[k]["pay_uf"] for r in rows.values() if r)}
              for k in keys}
    nat_total = sum(v["emp"] for v in nation.values())
    nat_pay = pay_clp(nat_total, sum(v["pay_uf"] for v in nation.values()), uf)

    def dsum(r, sections):
        return sum(r[s]["emp"] for s in sections)

    industries = {k: {"title": INDUSTRIES[k][1], "us_emp": round(nation[k]["emp"])} for k in keys}
    out_cities: dict[str, dict | None] = {}
    for c in cities:
        r = rows[c["id"]]
        total = sum(v["emp"] for v in r.values()) if r else 0
        if not r or total <= 0:
            out_cities[c["id"]] = None
            continue
        dists = []
        for d in CATALOG:
            if d["id"] == "harbor" and c["id"] not in wet:
                continue
            emp = dsum(r, d["naics"])
            dlq = lq(emp, total, dsum(nation, d["naics"]), nat_total)
            if emp < MIN_JOBS or emp / total < MIN_SHARE or dlq is None or dlq < MIN_LQ:
                continue
            sub = sub_lq = sub_emp = None
            if len(d["naics"]) > 1:
                cand = [(lq(r[s]["emp"], total, nation[s]["emp"], nat_total), s) for s in d["naics"] if r[s]["emp"] >= MIN_JOBS]
                cand = [(q, s) for q, s in cand if q and q > 1]
                if cand:
                    sub_lq, sub = max(cand)
                    sub_emp = round(r[sub]["emp"])
                    sub_lq = _r(sub_lq, 2)
            dists.append({
                "id": d["id"], "lq": _r(dlq, 2), "emp": round(emp), "share": _r(emp / total, 4),
                "avg_pay": pay_clp(emp, sum(r[s]["pay_uf"] for s in d["naics"]), uf),
                "sub": sub, "sub_lq": sub_lq, "sub_emp": sub_emp, "sub_lower_bound": False if sub else None,
                "via": "broad", "strength": round(excess(emp, dlq)), "suppressed": 0, "lower_bound": False,
            })
        dists.sort(key=lambda x: -x["strength"])
        dists = dists[:MAX_PER_CITY]
        top = []
        for k in keys:
            if r[k]["emp"] < MIN_CELL:
                continue
            q = lq(r[k]["emp"], total, nation[k]["emp"], nat_total)
            if q is not None:
                top.append({"naics": k, "emp": round(r[k]["emp"]), "lq": _r(q, 2), "avg_pay": pay_clp(r[k]["emp"], r[k]["pay_uf"], uf),
                            "oty_pct": None, "suppressed": 0, "lower_bound": False})
        top.sort(key=lambda x: -x["lq"])
        out_cities[c["id"]] = {
            "emp": round(total), "avg_pay": pay_clp(total, sum(v["pay_uf"] for v in r.values()), uf),
            "counties": None, "top": top[:TOP_INDUSTRIES], "districts": dists,
            "badge": badge_for(badge_district(dists), bool(c.get("capital"))),
        }

    doc = {
        "version": 1,
        "vintage": f"SII, empresas por comuna y sección, año comercial {year} (trabajadores en la comuna de la casa matriz)",
        "year": year,
        "sources": ["sii_empresas"],
        "rule": {"min_lq": MIN_LQ, "min_jobs": MIN_JOBS, "min_cell": MIN_CELL, "min_share": MIN_SHARE,
                 "specialty_lq": None, "specialty_jobs": None, "specialty_share": None,
                 "max_per_city": MAX_PER_CITY, "harbor_needs_water": True, "badge_lq": BADGE_LQ,
                 "badge_share": BADGE_SHARE, "college_share": None, "text": RULE_TEXT,
                 "county_note": COUNTY_NOTE},
        "note": NOTE,
        "catalog": [dict(d, naics=list(d["naics"])) for d in CATALOG],
        "industries": industries,
        "national": {"emp": round(nat_total), "avg_pay": nat_pay},
        "cities": out_cities,
        "counties": None,
    }
    write_web("districts.json", doc)


# ---------------------------------------------------------------------------------------------- check


def check(web_dir: Path) -> list[tuple[str, str]]:
    web_dir = Path(web_dir)
    p = web_dir / "districts.json"
    if not p.exists():
        return [("NOTE", "districts.json: missing (optional, skipped)")]
    out: list[tuple[str, str]] = []
    bad = lambda m: out.append(("FAIL", f"districts.json: {m}"))  # noqa: E731
    try:
        doc = json.loads(p.read_text())
    except ValueError as exc:
        return [("FAIL", f"districts.json: invalid JSON ({exc})")]
    if not isinstance(doc, dict):
        return [("FAIL", "districts.json: top level is not an object")]
    for k in ("version", "vintage", "year", "sources", "rule", "catalog", "industries", "national", "cities", "counties"):
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
            out.append(("WARN", f"districts.json: sources missing from sources.json: {sorted(set(doc['sources']) - known)}"))
    if doc["version"] != 1:
        bad(f"version {doc['version']!r} != 1")
    if not isinstance(doc["sources"], list) or not doc["sources"]:
        bad("sources must be a non-empty list")
    if not isinstance(doc["rule"], dict) or not isinstance(doc["rule"].get("text"), str):
        bad("rule.text missing")
    rule = doc["rule"] if isinstance(doc["rule"], dict) else {}
    cat = doc["catalog"]
    ids = [d.get("id") for d in cat] if isinstance(cat, list) else []
    if ids != IDS:
        bad(f"catalog ids {ids} != {IDS}")
    industries = doc["industries"] if isinstance(doc["industries"], dict) else {}
    sections = {}
    for d in cat if isinstance(cat, list) else []:
        for k in ("name", "icon", "color", "naics", "own", "sub", "badge", "description"):
            if k not in d:
                bad(f"catalog {d.get('id')}: missing {k!r}")
        sections[d.get("id")] = d.get("naics") or []
        for s in d.get("naics") or []:
            if s not in industries:
                bad(f"catalog {d.get('id')}: section {s!r} not in industries")
    cities_path = web_dir / "cities.json"
    city_ids = None
    if cities_path.exists():
        try:
            city_ids = {c.get("id") for c in json.loads(cities_path.read_text()) if isinstance(c, dict)}
        except (ValueError, TypeError, AttributeError):
            city_ids = None
    cities = doc["cities"] if isinstance(doc["cities"], dict) else {}
    if city_ids is not None:
        missing = city_ids - set(cities)
        extra = set(cities) - city_ids
        if missing:
            bad(f"{len(missing)} cities.json ids missing, e.g. {sorted(missing)[:3]}")
        if extra:
            bad(f"{len(extra)} ids not in cities.json, e.g. {sorted(extra)[:3]}")
    n_null = n_badge = 0
    counts = {i: 0 for i in IDS}
    for cid, row in cities.items():
        if row is None:
            n_null += 1
            continue
        if not isinstance(row.get("emp"), (int, float)) or row["emp"] <= 0:
            bad(f"city {cid}: emp must be a positive number")
        dl = row.get("districts")
        if not isinstance(dl, list) or len(dl) > MAX_PER_CITY:
            bad(f"city {cid}: districts must be a list of at most {MAX_PER_CITY}")
            continue
        for d in dl:
            if d.get("id") not in counts:
                bad(f"city {cid}: unknown district {d.get('id')!r}")
                continue
            counts[d["id"]] += 1
            if d.get("emp") is None or d["emp"] <= 0:
                bad(f"city {cid}: district {d['id']} without jobs")
            elif d["emp"] < (rule.get("min_jobs") or 0) or d.get("lq") is None or d["lq"] < (rule.get("min_lq") or 0) - 0.005:
                bad(f"city {cid}: district {d['id']} does not pass the published rule")
            if d.get("lower_bound") != (d.get("suppressed", 0) > 0):
                bad(f"city {cid}: district {d['id']} lower_bound disagrees with suppressed")
        for t in row.get("top") or []:
            if t.get("naics") not in industries:
                bad(f"city {cid}: top industry {t.get('naics')!r} not in industries")
            elif (t.get("emp") or 0) < (rule.get("min_cell") or 0):
                bad(f"city {cid}: top industry {t.get('naics')!r} is under the minimum cell size")
        b = row.get("badge")
        if b is not None:
            n_badge += 1
            if not dl or b.get("district") not in {d.get("id") for d in dl}:
                bad(f"city {cid}: badge does not name one of its districts")
        elif dl:
            bad(f"city {cid}: districts but no badge")
    if any(lv == "FAIL" for lv, _ in out):
        return out
    out.append(("PASS", f"districts.json: {len(cities)} cities ({n_null} without SII data), {n_badge} with a "
                        f"city type, no sub-comuna rows"))
    out.append(("NOTE", "districts.json: cities per district: " + ", ".join(f"{k} {v}" for k, v in counts.items())))
    return out
