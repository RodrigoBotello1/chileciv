"""Natural Earth 1:10m roads and railroads of Chile, for the national map (usaciv's road source, adapted).

At 5 km hexes the Metro and the urban autopistas of the RM map do not fit; Natural Earth's line work (Ruta 5, the
main national routes, the railways) is the right scale and does not depend on the Overpass servers. The output has
the same shape as osm_rm_transport, so the infrastructure builder reads either.
"""

from __future__ import annotations

from ..core.geo import bbox_intersects, geojson_lines, load_geojson
from ..core.mapcfg import CFG
from ..core.source import Source, SourceInfo

TAG = "v5.1.2"
BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{TAG}/geojson"
_W = CFG["window"]
BBOX = (_W[0], _W[1], _W[2], _W[3])
# Natural Earth road type → the OSM highway tag the infrastructure builder classes (0 = motorway/trunk, 1 = primary)
HIGHWAY_OF = {"Major Highway": "motorway", "Beltway": "motorway", "Secondary Highway": "primary", "Road": "primary",
              "Unknown": "primary"}  # outside North America Natural Earth leaves most roads untyped


class NeRoadsCl(Source):
    info = SourceInfo(
        id="ne_roads_cl",
        title="Rutas y ferrocarriles de Chile (Natural Earth 1:10m)",
        publisher="Natural Earth",
        homepage="https://www.naturalearthdata.com/",
        license="Dominio público",
        description="Las carreteras principales (como la Ruta 5) y secundarias de Chile, y las líneas de ferrocarril, en "
        "trazado 1:10m. Es dibujo del mapa entre centros de hexágono, no estadística: el trazado es aproximado y no trae "
        f"flujos de tránsito. Archivos fijados a la versión {TAG} de natural-earth-vector.",
        used_for=["Rutas en el mapa de Chile", "Ferrocarril en el mapa de Chile"],
    )

    FILES = ["ne_10m_roads", "ne_10m_railroads"]

    def _path(self, name):
        return f"{TAG}/{name}.geojson"

    def fetch(self, force=False):
        for name in self.FILES:
            self.download(f"{BASE}/{name}.geojson", self._path(name), force=force)

    def process(self):
        roads, rail = [], []
        for f in load_geojson(self.raw_dir / self._path("ne_10m_roads")):
            p = f["properties"]
            highway = HIGHWAY_OF.get(p.get("type"))
            if highway is None:  # ferries; no country field outside North America: the builder clips to Chile
                continue
            lines = [ln for ln in geojson_lines(f["geometry"]) if bbox_intersects(ln, BBOX)]
            if not lines:
                continue
            name = str(p.get("name") or "").strip() or None
            ref = name if name and name.replace("-", "").replace(" ", "").isalnum() and any(ch.isdigit() for ch in name) else None
            roads.append({"highway": highway, "ref": ref, "name": None if ref else name,
                          "lines": [[(round(x, 4), round(y, 4)) for x, y in ln] for ln in lines]})
        for f in load_geojson(self.raw_dir / self._path("ne_10m_railroads")):
            lines = [ln for ln in geojson_lines(f["geometry"]) if bbox_intersects(ln, BBOX)]
            if lines:  # no country field: the builder drops links on land outside Chile
                rail.append({"usage": "rail", "highspeed": False,
                             "lines": [[(round(x, 4), round(y, 4)) for x, y in ln] for ln in lines]})
        print(f"    {len(roads)} road features, {len(rail)} rail features in the window")
        return {"vintage": f"Natural Earth {TAG} (1:10m)", "_files": [self._path(n) for n in self.FILES],
                "roads": roads, "rail": rail, "airports": []}
