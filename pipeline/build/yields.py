"""The game-concept → real-data mapping, in one place.

Each yield is defined once here and exported to the browser, so the UI and the Almanac always describe exactly
what was computed. Gold is the annual sales of the companies headquartered in each comuna (SII, converted from UF
to pesos at the 31 December value of the same year); the other yields count the workers those companies report,
by economic sector. Chile has no official GDP by comuna, and the SII assigns a company's whole activity to the comuna
of its head office: that caveat is written into every description.

Industry keys are the original's (NAICS-like) keys so the frontend's icons and colours carry over. The SII's
sectors (CIIU4.CL sections A to U) map onto 18 of those keys.
"""

from __future__ import annotations

# key → (SII sector letters, label shown in the UI)
INDUSTRIES = {
    "agriculture": (["A"], "Agricultura, ganadería, silvicultura y pesca"),
    "mining": (["B"], "Minería"),
    "manufacturing": (["C"], "Industria manufacturera"),
    "utilities": (["D", "E"], "Electricidad, gas, agua y gestión de desechos"),
    "construction": (["F"], "Construcción"),
    "retail": (["G"], "Comercio"),
    "transportation": (["H"], "Transporte y almacenamiento"),
    "accommodation": (["I"], "Alojamiento y servicios de comida"),
    "information": (["J"], "Información y comunicaciones"),
    "finance": (["K"], "Actividades financieras y de seguros"),
    "real_estate": (["L"], "Actividades inmobiliarias"),
    "professional": (["M"], "Actividades profesionales, científicas y técnicas"),
    "admin": (["N"], "Servicios administrativos y de apoyo"),
    "public_admin": (["O"], "Administración pública y defensa"),
    "education": (["P"], "Enseñanza"),
    "health": (["Q"], "Salud y asistencia social"),
    "arts": (["R"], "Actividades artísticas, de entretenimiento y recreativas"),
    "other": (["S", "T", "U"], "Otras actividades de servicios"),
}

SII_SRC = ("SII, estadísticas de empresas por comuna y rubro: trabajadores dependientes ponderados por meses "
           "trabajados, en la comuna de la casa matriz de la empresa (no donde viven ni donde trabajan las personas)")

YIELDS = [
    {
        "key": "food",
        "icon": "y-food",
        "emoji": "🌾",
        "label": "Comida",
        "color": "#7fbf3f",
        "unit": "workers",
        "industries": ["agriculture"],
        "description": f"Trabajadores de agricultura, ganadería, silvicultura y pesca ({SII_SRC}).",
    },
    {
        "key": "production",
        "icon": "y-production",
        "emoji": "⚙️",
        "label": "Producción",
        "color": "#d9823b",
        "unit": "workers",
        "industries": ["manufacturing", "construction", "mining"],
        "description": f"Trabajadores de la industria manufacturera, la construcción y la minería ({SII_SRC}).",
    },
    {
        "key": "gold",
        "icon": "y-gold",
        "emoji": "💰",
        "label": "Oro",
        "color": "#f2c94c",
        "unit": "usd",
        "industries": [],
        "description": "Ventas anuales de las empresas con casa matriz en la comuna (SII), pasadas de UF a pesos con el "
        "valor de la UF al 31 de diciembre del mismo año. Chile no tiene PIB por comuna y esta es la cifra pública más "
        "cercana, con dos límites: son ventas y no valor agregado, y toda la actividad de una empresa queda en la "
        "comuna de su casa matriz (por eso Las Condes suma ventas de faenas mineras del norte).",
    },
    {
        "key": "science",
        "icon": "y-science",
        "emoji": "🔬",
        "label": "Ciencia",
        "color": "#4fa3e0",
        "unit": "workers",
        "industries": ["professional", "information"],
        "description": f"Trabajadores de actividades profesionales, científicas y técnicas, y de información y "
        f"comunicaciones ({SII_SRC}).",
    },
    {
        "key": "culture",
        "icon": "y-culture",
        "emoji": "🎭",
        "label": "Cultura",
        "color": "#b07ce0",
        "unit": "workers",
        "industries": ["arts"],
        "description": f"Trabajadores de actividades artísticas, de entretenimiento y recreativas ({SII_SRC}).",
    },
]


def industries(sii: dict | None) -> dict[str, int | None]:
    """Workers per industry key from an sii_empresas comuna record; None where the comuna has no record."""
    rubros = (sii or {}).get("rubros")
    out = {}
    for key, (letters, _) in INDUSTRIES.items():
        if not rubros:
            out[key] = None
            continue
        out[key] = int(round(sum((rubros.get(l) or {}).get("trabajadores") or 0 for l in letters)))
    return out


def sales_clp(sii: dict | None, uf: float | None) -> float | None:
    rubros = (sii or {}).get("rubros")
    if not rubros or not uf:
        return None
    return round(sum(r.get("ventas_uf") or 0 for r in rubros.values()) * uf)


def economy(population: int | None, sii: dict | None, uf: float | None, year: int | None) -> dict:
    """Yields + economic profile of one area (a comuna, a provincia or the region)."""
    jobs = industries(sii)
    gdp = sales_clp(sii, uf)
    yields = {}
    for y in YIELDS:
        if y["key"] == "gold":
            yields["gold"] = gdp
        else:
            vals = [jobs[k] for k in y["industries"]]
            yields[y["key"]] = None if any(v is None for v in vals) else sum(vals)
    employed = None if any(v is None for v in jobs.values()) else sum(jobs.values())
    return {
        "population": population,
        "yields": yields,
        "jobs": jobs,
        "employed": employed,
        # No public median income, rent or home value by comuna on a common basis yet: left null.
        "median_income": None,
        "median_rent": None,
        "home_value": None,
        "unemployment": None,
        "rent_burden": None,
        "gdp": gdp,
        "gdp_year": year if gdp is not None else None,
        "gdp_by_industry": None,
        "gdp_undisclosed": None,
        "gdp_estimated": None,
    }


def merge(records: list[dict | None]) -> dict | None:
    """Sum several sii_empresas comuna records (a provincia or the region)."""
    recs = [r for r in records if r]
    if not recs:
        return None
    out: dict[str, dict] = {}
    for r in recs:
        for letter, v in r["rubros"].items():
            acc = out.setdefault(letter, {"empresas": 0, "ventas_uf": 0, "trabajadores": 0, "renta_uf": 0})
            for k in acc:
                acc[k] += v.get(k) or 0
    return {"rubros": out}
