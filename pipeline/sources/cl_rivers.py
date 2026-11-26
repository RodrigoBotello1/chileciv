"""Named rivers of the Santiago Metropolitan Region from OpenStreetMap (river relations with their geometry, via the Overpass API)."""

from __future__ import annotations

import json
import math
import urllib.parse

from ..core.source import Source, SourceInfo

ENDPOINT = "https://overpass.private.coffee/api/interpreter"
from ..core.mapcfg import CFG

_W = CFG["window"]
BBOX = (_W[1], _W[0], _W[3], _W[2])  # south, west, north, east: the map bbox plus its margin
QUERY = (
    "[out:json][timeout:300];"
    f'relation["waterway"="river"]["name"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});'
    "out geom;"
)
FILE = "rivers_relations.json"
MIN_KM = 10.0  # rivers shorter than this (main stem) are left off the map
# rank like Natural Earth's scalerank (lower = bigger): by main-stem length in km
RANKS = [(200, 1), (120, 2), (80, 3), (50, 4), (30, 5), (20, 6), (MIN_KM, 7)]


def length_km(line: list[tuple[float, float]]) -> float:
    total = 0.0
    for (lo1, la1), (lo2, la2) in zip(line, line[1:]):
        x = math.radians(lo2 - lo1) * math.cos(math.radians((la1 + la2) / 2))
        y = math.radians(la2 - la1)
        total += 6371.0088 * math.hypot(x, y)
    return total


class ClRivers(Source):
    info = SourceInfo(
        id="cl_rivers",
        title="Ríos (relaciones waterway=river de OpenStreetMap)",
        publisher="OpenStreetMap contributors, via the Overpass API",
        homepage="https://www.openstreetmap.org/",
        license="Open Database License (ODbL) 1.0. © OpenStreetMap contributors",
        description=f"Toda relación de río con nombre (waterway=river) en la ventana del mapa, solo el cauce principal. "
        f"Se omiten los ríos de menos de {MIN_KM:g} km; el resto se ordena por largo (rango 1 ≥ 200 km, como el Maipo) "
        "y se dibuja más delgado mientras más corto.",
        used_for=["Ríos"],
    )

    def fetch(self, force=False):
        url = f"{ENDPOINT}?data={urllib.parse.quote(QUERY)}"
        self.download(url, FILE, force=force)

    def process(self):
        data = json.loads((self.raw_dir / FILE).read_text(encoding="utf-8"))
        rivers = []
        for rel in data.get("elements", []):
            name = rel.get("tags", {}).get("name")
            lines = []
            for m in rel.get("members", []):
                if m.get("type") != "way" or m.get("role", "") not in ("", "main_stream") or not m.get("geometry"):
                    continue
                lines.append([(round(g["lon"], 5), round(g["lat"], 5)) for g in m["geometry"]])
            if not lines:
                continue
            total = sum(length_km(l) for l in lines)
            if total < MIN_KM:
                continue
            rank = next(r for km, r in RANKS if total >= km)
            for line in lines:
                rivers.append({"name": name, "rank": rank, "featurecla": "River", "km": round(total, 1), "line": line})
        names = {r["name"] for r in rivers}
        print(f"    {len(names)} rivers ≥ {MIN_KM:g} km, {len(rivers)} pieces")
        return {
            "vintage": "OpenStreetMap via Overpass (retrieved with the raw file; see manifest)",
            "_files": [FILE],
            "rivers": rivers,
        }
