"""Earthquakes (USGS catalogue, magnitude 6 or more since 1900) and Holocene volcanoes (Smithsonian GVP) of Chile."""

from __future__ import annotations

import json
import urllib.parse

from ..core.mapcfg import CFG
from ..core.source import Source, SourceInfo

_W = CFG["window"]
# Earthquakes: the window widened offshore, since the big subduction quakes start under the sea.
QUAKES = "https://earthquake.usgs.gov/fdsnws/event/1/query?" + urllib.parse.urlencode({
    "format": "geojson", "starttime": "1900-01-01", "minmagnitude": 6,
    "minlatitude": _W[1], "maxlatitude": _W[3], "minlongitude": _W[0] - 3, "maxlongitude": _W[2],
    "orderby": "time-asc",
})
VOLCANOES = ("https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature"
             "&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json"
             "&cql_filter=" + urllib.parse.quote("Country LIKE '%Chile%'"))


class Sismos(Source):
    info = SourceInfo(
        id="usgs_sismos",
        title="Terremotos de magnitud 6 o más desde 1900 (catálogo ComCat del USGS)",
        publisher="U.S. Geological Survey, Earthquake Hazards Program",
        homepage="https://earthquake.usgs.gov/earthquakes/search/",
        license="Dominio público (gobierno de EE.UU.)",
        description="Todos los sismos de magnitud 6 o más registrados desde 1900 en la ventana del mapa, ampliada hacia "
        "el océano porque los grandes terremotos chilenos nacen en la zona de subducción, frente a la costa. Trae el "
        "epicentro, la magnitud, la profundidad y la fecha. Los sismos anteriores a los años 60 tienen magnitudes y "
        "ubicaciones menos precisas.",
        used_for=["Lente de sismos fuertes"],
    )

    def fetch(self, force=False):
        self.download(QUAKES, "sismos.geojson", force=force)

    def process(self):
        fs = json.loads((self.raw_dir / "sismos.geojson").read_text(encoding="utf-8"))["features"]
        quakes = []
        for f in fs:
            p, (lon, lat, depth) = f["properties"], f["geometry"]["coordinates"][:3]
            if p.get("type") != "earthquake" or p.get("mag") is None:
                continue
            quakes.append({"id": f["id"], "mag": p["mag"], "time": p["time"], "place": p.get("place"),
                           "lon": round(lon, 3), "lat": round(lat, 3), "depth_km": depth})
        print(f"    {len(quakes)} sismos M≥6; {sum(1 for q in quakes if q['mag'] >= 7)} de M≥7")
        return {"vintage": "USGS ComCat (fecha en el manifiesto)", "_files": ["sismos.geojson"], "quakes": quakes}


class Volcanes(Source):
    info = SourceInfo(
        id="gvp_volcanes",
        title="Volcanes del Holoceno de Chile (Global Volcanism Program)",
        publisher="Smithsonian Institution, Global Volcanism Program",
        homepage="https://volcano.si.edu/",
        license="Datos públicos del Smithsonian; citar el Global Volcanism Program",
        description="Los volcanes con actividad en los últimos 12 mil años en Chile o en la frontera con Argentina, con su "
        "posición, altura y año de la última erupción conocida.",
        used_for=["Maravillas: volcanes"],
    )

    def fetch(self, force=False):
        self.download(VOLCANOES, "volcanes.geojson", force=force)

    def process(self):
        fs = json.loads((self.raw_dir / "volcanes.geojson").read_text(encoding="utf-8"))["features"]
        out = []
        for f in fs:
            p = f["properties"]
            year = p.get("Last_Eruption_Year")
            out.append({"id": p["Volcano_Number"], "name": p["Volcano_Name"], "lon": p["Longitude"], "lat": p["Latitude"],
                        "elevation_m": p.get("Elevation"), "last_eruption": int(year) if str(year).lstrip("-").isdigit() else None,
                        "type": p.get("Primary_Volcano_Type"), "country": p.get("Country")})
        print(f"    {len(out)} volcanes; {sum(1 for v in out if (v['last_eruption'] or -9999) >= 1900)} con erupción desde 1900")
        return {"vintage": "Smithsonian GVP, Volcanoes of the World (fecha en el manifiesto)", "_files": ["volcanes.geojson"],
                "volcanoes": out}
