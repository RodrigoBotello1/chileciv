"""Cities = the 52 comunas of the Santiago Metropolitan Region, each placed at its most built-up hex.

The comuna plays the role of a US metro area: the census counts people by comuna and the SII counts companies by
comuna. Each city keeps a true position (x, y): the centre of its most built-up hex (the WorldCover share of
built-up land; ties go to the hex nearest the comuna's centroid), so rural comunas sit on their town rather than
in the mountains. Its banner cell is that hex, nudged up to 2 rings away when a bigger comuna already holds it.
Gold is the annual sales of the companies headquartered in the comuna (see yields.py). For the City view each city
also gets its member comuna (itself), a hex footprint, ranks and its 5 nearest peers by population.
"""

from __future__ import annotations

import math

from ..core.geo import MapProjection
from ..core.hexgrid import HexGrid
from ..core.store import load_interim, load_interim_payload, write_web
import unicodedata

from ..core.mapcfg import CFG

from .yields import INDUSTRIES, YIELDS, economy, merge

REQUIRES = ["_world", "cl_boundaries", "ine_censo2024", "ine_censo_tablas", "sii_empresas", "uf"]
PRODUCES = ["cities.json", "nation.json"]

CAPITAL = "13101"  # Santiago, seat of the national government
SII_ALIAS = {"titil": "tiltil", "lacalera": "calera", "marchigue": "marchihue", "coihaique": "coyhaique",
             "aisen": "aysen"}  # the SII spells these comunas differently from the INE


def name_key(name: str) -> str:
    s = unicodedata.normalize("NFD", name.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").replace(" ", "")
    return SII_ALIAS.get(s, s)


GROWTH_YEARS = [2017, 2024]  # 2017 habitual residents vs 2024 census: both count where people usually live (INE note N3)


def growth_of(p2017: float | None, p2024: float | None) -> float | None:
    """Population change between the censuses as a fraction (0.12 = +12%), or None if either is missing."""
    return round(p2024 / p2017 - 1, 4) if p2017 and p2024 else None


def sii_by_code(sii: dict, censo: dict) -> dict[str, dict]:
    """INE comuna code → sii_empresas comuna record (the SII file has names only)."""
    by_name = {name_key(n): rec for n, rec in sii["comunas"].items()}
    out = {c["code"]: by_name.get(name_key(c["name"])) for c in censo["comunas"]}
    missing = [c["name"] for c in censo["comunas"] if out[c["code"]] is None]
    if missing:
        print(f"    no SII record for: {', '.join(missing)}")
    return out


def ring_search(grid: HexGrid, start: int, max_rings: int):
    """Yield (ring, cell) for every cell within `max_rings` steps of `start`, nearest rings first."""
    seen = {start}
    frontier = [start]
    yield 0, start
    for ring in range(1, max_rings + 1):
        nxt = []
        for c in frontier:
            for n in grid.neighbours(c):
                if n not in seen:
                    seen.add(n)
                    nxt.append(n)
                    yield ring, n
        frontier = nxt


def nearest_land(grid: HexGrid, owner: list[int], cell: int, x: float, y: float, state: int, max_rings=8):
    """Nearest Taiwan land cell to (x, y), preferring `state`: the first ring with land, plus one more."""
    found_ring = None
    best = None
    for ring, c in ring_search(grid, cell, max_rings):
        if found_ring is not None and ring > found_ring + 1:
            break
        if owner[c] < 0:
            continue
        found_ring = ring if found_ring is None else found_ring
        cx, cy = grid.center(*grid.col_row(c))
        score = (owner[c] != state, math.hypot(cx - x, cy - y))
        if best is None or score < best[0]:
            best = (score, c)
    return best[1] if best else -1


def free_cell(grid: HexGrid, owner, taken: set, cell: int, x: float, y: float, state: int, max_rings=2):
    """Nearest untaken land cell within `max_rings`, preferring `state`; None if there is none."""
    best = None
    for ring, c in ring_search(grid, cell, max_rings):
        if owner[c] < 0 or c in taken:
            continue
        cx, cy = grid.center(*grid.col_row(c))
        score = (owner[c] != state, math.hypot(cx - x, cy - y))
        if best is None or score < best[0]:
            best = (score, c)
    return best[1] if best else None


def ring_centroid(rings: list[list[tuple[float, float]]]) -> tuple[float, float]:
    """Area-weighted centroid (lon, lat) of a township's largest ring (its main island or main piece)."""
    def area_c(r):
        a = cx = cy = 0.0
        for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]):
            f = x0 * y1 - x1 * y0
            a += f
            cx += (x0 + x1) * f
            cy += (y0 + y1) * f
        return a / 2, cx, cy
    best = max(rings, key=lambda r: abs(area_c(r)[0]))
    a, cx, cy = area_c(best)
    if a == 0:
        return best[0]
    return cx / (6 * a), cy / (6 * a)


FOOTPRINT_MAJORITY = 4  # of a cell's 7 township samples
PEERS = 5
RANK_KEYS = ["population", "gdp", "gdp_per_capita", "growth"] + [y["key"] for y in YIELDS]


def footprints(world: dict, members: dict[str, list[str]]) -> dict[str, set[int]]:
    """City id → land cells where at least FOOTPRINT_MAJORITY of the 7 township samples are member townships."""
    city_of = {g: code for code, geoids in members.items() for g in geoids}
    by_index = [city_of.get(g) for g in world["counties"]]
    out: dict[str, set[int]] = {}
    for cell, s in enumerate(world["county_samples"]):
        if not s or world["owner"][cell] < 0:
            continue
        votes: dict[str, int] = {}
        for k in s:
            code = by_index[k] if k >= 0 else None
            if code:
                votes[code] = votes.get(code, 0) + 1
        for code, n in votes.items():
            if n >= FOOTPRINT_MAJORITY:
                out.setdefault(code, set()).add(cell)
    return out


def add_ranks(cities: list[dict]) -> None:
    """ranks: 1 = highest among all cities, null where the value is null (cities are sorted by population,
    so ties keep population order). peers: the PEERS cities closest in population (by ratio)."""
    def value(c, key):
        if key == "gdp_per_capita":
            return c["gdp"] / c["population"] if c.get("gdp") is not None and c.get("population") else None
        if key in ("population", "gdp", "growth"):
            return c.get(key)
        return c["yields"].get(key)

    for c in cities:
        c["ranks"] = {}
    for key in RANK_KEYS:
        have = [c for c in cities if value(c, key) is not None]
        have.sort(key=lambda c: -value(c, key))
        for r, c in enumerate(have, 1):
            c["ranks"][key] = r
        for c in cities:
            c["ranks"].setdefault(key, None)
    for i, c in enumerate(cities):
        lp = math.log(c["population"])
        near = sorted((abs(math.log(o["population"]) - lp), j) for j, o in enumerate(cities) if j != i)
        c["peers"] = [cities[j]["id"] for _, j in near[:PEERS]]


def build() -> None:
    world = load_interim("_world")
    bounds = load_interim("cl_boundaries")
    censo = load_interim("ine_censo2024")
    sii = load_interim("sii_empresas")
    uf = load_interim("uf")["values"].get(str(sii["year"]))
    proj = MapProjection(**world["projection"])
    grid = HexGrid(**world["grid"])
    owner = world["owner"]
    developed = world["pct"]["developed"]
    county_of = world["county"]
    pop = {c["code"]: c["population"] for c in censo["comunas"]}
    reg_name = {c["code"]: c.get("reg_name") for c in censo["comunas"]}
    pop17 = {code: rec["residentes"] for code, rec in load_interim("ine_censo_tablas")["tablas"]["censo2017"].items()}
    sii_of = sii_by_code(sii, censo)
    state_index = {fips: i for i, fips in enumerate(world["states"])}
    abbr = {s["fips"]: s["abbr"] for s in bounds["states"]}
    county_index = {g: k for k, g in enumerate(world["counties"])}

    cities = []
    for t in bounds["counties"]:
        code = t["geoid"]
        lon, lat = ring_centroid(t["rings"])
        gx, gy = proj(lon, lat)
        own = [i for i, k in enumerate(county_of) if k == county_index[code] and owner[i] >= 0]
        if own:
            def score(i):
                cx, cy = grid.center(*grid.col_row(i))
                return (-developed[i], math.hypot(cx - gx, cy - gy))
            best = min(own, key=score)
            x, y = grid.center(*grid.col_row(best))
        else:
            x, y = gx, gy
        econ = economy(pop[code], sii_of[code], uf, sii["year"])
        cities.append({
            "id": code,
            "name": t["name"],
            "full": f"Comuna de {t['name']}" + (f", {reg_name.get(t['geoid'])}" if CFG["state_level"] == "region" and reg_name.get(t['geoid']) else ""),
            "name_en": t["name"],
            "seat": t["name"],
            "states": [abbr[t["state_fips"]]],
            "metro": True,
            "capital": code == CAPITAL,
            "x": round(x, 1),
            "y": round(y, 1),
            "cell": grid.cell_at(x, y),
            **econ,
            "growth": growth_of(pop17.get(code), pop[code]),
            "growth_years": GROWTH_YEARS,
            "counties": [code],
            "pop_series": {"2017": int(pop17[code]) if pop17.get(code) else None, "2024": pop[code]},
        })
    cities.sort(key=lambda c: -c["population"])
    state_of = {t["geoid"]: t["state_fips"] for t in bounds["counties"]}

    taken: set[int] = set()
    snapped, moved, shared = [], [], []
    for c in cities:
        state = state_index[state_of[c["id"]]]
        cell = c["cell"]
        if cell < 0 or owner[cell] != state:
            cell = nearest_land(grid, owner, max(cell, 0), c["x"], c["y"], state)
            snapped.append(c["name"])
        if cell in taken:
            alt = free_cell(grid, owner, taken, cell, c["x"], c["y"], state)
            if alt is None:
                shared.append(c["name"])
            else:
                cell = alt
                moved.append(c["name"])
        taken.add(cell)
        c["cell"] = cell

    feet = footprints(world, {c["id"]: c["counties"] for c in cities})
    own_only = []
    for c in cities:
        cells = feet.get(c["id"], set())
        if c["cell"] not in cells:
            if not cells:
                own_only.append(c["name"])
            cells = cells | {c["cell"]}
        c["footprint"] = sorted(cells)
    add_ranks(cities)

    print(f"    {len(cities)} comunas, placed at their most built-up hex")
    for label, items in (
        ("snapped onto their own land", snapped),
        ("moved to a free neighbouring cell", moved),
        ("still sharing a cell", shared),
        ("with a one-hex footprint", own_only),
    ):
        if items:
            print(f"    {len(items)} {label}: {', '.join(items)}")

    region = economy(sum(pop.values()), merge(list(sii_of.values())), uf, sii["year"])
    p17 = sum(pop17.values())
    region["growth"] = growth_of(p17, region["population"])
    region["growth_years"] = GROWTH_YEARS
    region["pop_series"] = {"2017": int(p17), "2024": region["population"]}
    write_web("cities.json", cities)
    write_web(
        "nation.json",
        {
            "vintage": f"Censo 2024 (INE); empresas del SII, año comercial {sii['year']}",
            "year": censo["year"],
            "gdp_vintage": f"Ventas anuales del SII, año comercial {sii['year']}, en pesos (UF al 31-12-{sii['year']})",
            "nation": region,
            "yields": YIELDS,
            "industries": {k: label for k, (_, label) in INDUSTRIES.items()},
            "gdp_industries": {},
            "income_year": None,
            "currency": "CLP",
            "country": {"name": CFG["name"], "name_en": CFG["name_en"], "abbr": CFG["abbr"]},
        },
    )
