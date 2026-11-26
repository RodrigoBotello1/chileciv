"""Límites de las comunas de la Región Metropolitana (geoBoundaries, a partir de la BCN) con sus códigos del INE."""

from __future__ import annotations

import json
import unicodedata

from ..core.source import Source, SourceInfo
from ._xlsx import sheet_rows
from ..core.mapcfg import CFG, keep_region
from .ine_censo2024 import FILE as CENSO_FILE, URL as CENSO_URL

GB = (
    "https://www.geoboundaries.org/data/snapshots/1c423398df24ddf6e730b116567d2181c9782778d0459c3f3b76ca2f9f12b6bc/"
    "gbOpen/CHL/ADM3/geoBoundaries-CHL-ADM3.geojson"
)
GB_FILE = "geoBoundaries-CHL-ADM3.geojson"
# National map: geoBoundaries 2020 lacks Pozo Almonte, so Chile uses the BCN comunas as packaged in fcortes/Chile-GeoJSON
# (all 346, with the INE code in cod_comuna; coarser, fine for 5 km hexes). Pinned to a commit.
BCN = "https://raw.githubusercontent.com/fcortes/Chile-GeoJSON/76a5c884ce0adf68c483785e72873ff8692c97db/comunas.geojson"
BCN_FILE = "bcn-comunas.geojson"

# The map's bbox (lon0, lat0, lon1, lat1), core/mapcfg.py. Rings outside it are dropped (islands far offshore).
BBOX = CFG["bbox"]

# Short ids for the provincias of the RM and for the 16 regions (ISO 3166-2:CL), the role a US state abbreviation
# plays. Only labels, no data.
ABBR = {"131": "STG", "132": "CRD", "133": "CHB", "134": "MAI", "135": "MEL", "136": "TAL",
        "15": "AP", "01": "TA", "02": "AN", "03": "AT", "04": "CO", "05": "VS", "13": "RM", "06": "LI", "07": "ML",
        "16": "NB", "08": "BI", "09": "AR", "14": "LR", "10": "LL", "11": "AI", "12": "MA"}
STATE_LEVEL = CFG["state_level"]  # "provincia" (RM) or "region" (Chile)


def key(name: str) -> str:
    """Join key for comuna names: lower case, no accents, no spaces (geoBoundaries has no INE codes)."""
    s = unicodedata.normalize("NFD", name.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn").replace(" ", "")


def in_bbox(ring) -> bool:
    x0, y0, x1, y1 = BBOX
    return any(x0 <= lon <= x1 and y0 <= lat <= y1 for lon, lat in ring)


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
        if CFG["regions"] is None:
            self.download(BCN, BCN_FILE, force=force)
            return
        self.download(GB, GB_FILE, force=force)
        self.download(CENSO_URL, CENSO_FILE, force=force)

    def process(self):
        official = {}
        for r in sheet_rows(self.raw_dir / CENSO_FILE, "2"):
            if len(r) >= 6 and r[4].isdigit() and len(r[4]) >= 4 and keep_region(r[0]):
                if STATE_LEVEL == "region":
                    st_code, st_name = r[0].zfill(2), r[1]
                else:
                    st_code, st_name = r[2].zfill(3), r[3]
                official[key(r[5])] = {"code": r[4].zfill(5), "name": r[5], "prov_code": st_code, "prov_name": st_name}
        national = CFG["regions"] is None
        if national:
            features = json.loads((self.raw_dir / BCN_FILE).read_text(encoding="utf-8"))["features"]
            by_ine = {o["code"]: o for o in official.values()}
        else:
            features = json.loads((self.raw_dir / GB_FILE).read_text(encoding="utf-8"))["features"]
        by_code, by_prov = {}, {}
        for f in features:
            if national:
                o = by_ine.get(str(f["properties"]["cod_comuna"]).zfill(5))
            else:
                o = official.get(key(f["properties"]["shapeName"]))
            if not o:
                continue
            rs = [r for r in rings(f["geometry"]) if in_bbox(r)]
            if not rs:
                continue  # wholly outside the map (Rapa Nui, Juan Fernández)
            by_code.setdefault(o["code"], {"geoid": o["code"], "state_fips": o["prov_code"], "name": o["name"],
                                           "name_en": o["name"], "rings": []})["rings"].extend(rs)
            by_prov.setdefault(o["prov_code"], {"name": o["prov_name"], "rings": []})["rings"].extend(rs)
        counties = list(by_code.values())  # a comuna split over several features (islands) is one comuna
        missing = sorted(o["name"] for o in official.values() if o["code"] not in {c["geoid"] for c in counties})
        print(f"    {len(counties)} comunas on the map; without an outline in the map: {missing}")
        states = [
            {"fips": code, "abbr": ABBR[code], "name": p["name"], "name_en": p["name"], "rings": p["rings"]}
            for code, p in sorted(by_prov.items())
        ]
        return {
            "vintage": ("BCN, comunas (vía fcortes/Chile-GeoJSON)" if national else "geoBoundaries gbOpen CHL ADM3 (2020, BCN)")
            + "; códigos INE del Censo 2024",
            "_files": [BCN_FILE if national else GB_FILE, CENSO_FILE],
            "bbox": BBOX,
            "states": states,
            "counties": sorted(counties, key=lambda c: c["geoid"]),
        }
