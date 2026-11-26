"""Límites de las comunas de la Región Metropolitana (geoBoundaries, a partir de la BCN) con sus códigos del INE."""

from __future__ import annotations

import json
import unicodedata

from ..core.source import Source, SourceInfo
from ._xlsx import sheet_rows
from .ine_censo2024 import FILE as CENSO_FILE, REGION, URL as CENSO_URL

GB = (
    "https://www.geoboundaries.org/data/snapshots/1c423398df24ddf6e730b116567d2181c9782778d0459c3f3b76ca2f9f12b6bc/"
    "gbOpen/CHL/ADM3/geoBoundaries-CHL-ADM3.geojson"
)
GB_FILE = "geoBoundaries-CHL-ADM3.geojson"

# The map window (lon0, lat0, lon1, lat1): the region plus a margin. Rings outside it are dropped.
BBOX = (-71.85, -34.40, -69.65, -32.80)

# Short ids for the six provincias (the role a US state abbreviation plays). Only labels, no data.
ABBR = {"131": "STG", "132": "CRD", "133": "CHB", "134": "MAI", "135": "MEL", "136": "TAL"}


def key(name: str) -> str:
    """Join key for comuna names: lower case, no accents, no spaces (geoBoundaries has no INE codes)."""
    s = unicodedata.normalize("NFD", name.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn").replace(" ", "")


def rings(geom: dict) -> list[list[tuple[float, float]]]:
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return [[(round(x, 5), round(y, 5)) for x, y, *_ in ring] for poly in polys for ring in poly]


class ClBoundaries(Source):
    info = SourceInfo(
        id="cl_boundaries",
        title="Límites comunales de Chile (geoBoundaries ADM3)",
        publisher="geoBoundaries (William & Mary geoLab), a partir de la Biblioteca del Congreso Nacional (BCN) y OCHA",
        homepage="https://www.geoboundaries.org/countryDownloads.html",
        license="CC BY 3.0 IGO",
        description="Contornos de las 52 comunas de la Región Metropolitana. geoBoundaries no trae los códigos del "
        "INE, así que cada contorno se une a su comuna del Censo 2024 por nombre (sin tildes ni mayúsculas): las 52 "
        "calzan una a una. La provincia de cada comuna sale del código del INE, y su contorno es la unión de sus "
        "comunas. Deciden a qué comuna y provincia pertenece cada hexágono.",
        used_for=["Comuna y provincia de cada hexágono", "Bordes de provincia"],
    )

    def fetch(self, force=False):
        self.download(GB, GB_FILE, force=force)
        self.download(CENSO_URL, CENSO_FILE, force=force)

    def process(self):
        official = {}
        for r in sheet_rows(self.raw_dir / CENSO_FILE, "2"):
            if len(r) >= 6 and r[0] == REGION:
                official[key(r[5])] = {"code": r[4], "name": r[5], "prov_code": r[2], "prov_name": r[3]}
        features = json.loads((self.raw_dir / GB_FILE).read_text(encoding="utf-8"))["features"]
        counties, by_prov = [], {}
        for f in features:
            o = official.get(key(f["properties"]["shapeName"]))
            if not o:
                continue
            rs = rings(f["geometry"])
            counties.append({"geoid": o["code"], "state_fips": o["prov_code"], "name": o["name"], "name_en": o["name"], "rings": rs})
            by_prov.setdefault(o["prov_code"], {"name": o["prov_name"], "rings": []})["rings"].extend(rs)
        if len(counties) != 52 or len({c["geoid"] for c in counties}) != 52:
            raise ValueError(f"expected 52 distinct comunas, matched {len(counties)}")
        states = [
            {"fips": code, "abbr": ABBR[code], "name": p["name"], "name_en": p["name"], "rings": p["rings"]}
            for code, p in sorted(by_prov.items())
        ]
        return {
            "vintage": "geoBoundaries gbOpen CHL ADM3 (2020, BCN); códigos INE del Censo 2024",
            "_files": [GB_FILE, CENSO_FILE],
            "bbox": BBOX,
            "states": states,
            "counties": sorted(counties, key=lambda c: c["geoid"]),
        }
