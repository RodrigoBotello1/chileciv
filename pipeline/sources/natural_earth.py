from ..core.geo import bbox_intersects, geojson_lines, geojson_rings, load_geojson
from ..core.source import Source, SourceInfo

# Pinned to a release tag so the content (and sha256) cannot change under the same URL.
TAG = "v5.1.2"
BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{TAG}/geojson"
BBOX = (-72.5, -35.0, -69.0, -32.2)  # lon0, lat0, lon1, lat1: the map window plus a margin


class NaturalEarth(Source):
    info = SourceInfo(
        id="natural_earth",
        title="Natural Earth 1:10m (países y lagos) y 1:50m (ríos)",
        publisher="Natural Earth",
        homepage="https://www.naturalearthdata.com/",
        license="Public domain",
        description="El resto de Chile y Argentina dentro de la ventana del mapa (fuera de la región, se ve con niebla), "
        f"la costa del Pacífico y los lagos y embalses grandes. Archivos fijados a la versión {TAG} de natural-earth-vector.",
        used_for=["Tierra fuera de la región (resto de Chile y Argentina)", "Costa", "Lagos"],
    )

    FILES = ["ne_10m_admin_0_countries", "ne_10m_lakes", "ne_50m_rivers_lake_centerlines"]

    def _path(self, name):
        return f"{TAG}/{name}.geojson"

    def fetch(self, force=False):
        for name in self.FILES:
            self.download(f"{BASE}/{name}.geojson", self._path(name), force=force)

    def _features(self, name):
        return load_geojson(self.raw_dir / self._path(name))

    def process(self):
        # Every country with land in the window (Chile outside the region, Argentina), keeping only its rings there,
        # so land outside the region is land rather than sea. The comuna outlines decide the region's own land.
        countries = []
        for f in self._features("ne_10m_admin_0_countries"):
            rings = [r for r in geojson_rings(f["geometry"]) if bbox_intersects(r, BBOX)]
            if rings:
                countries.append({"name": f["properties"]["ADMIN"], "rings": rings})
        lakes = []
        for f in self._features("ne_10m_lakes"):
            rings = geojson_rings(f["geometry"])
            if rings and bbox_intersects(rings[0], BBOX):
                lakes.append({"name": f["properties"].get("name"), "rings": rings})
        rivers = []
        for f in self._features("ne_50m_rivers_lake_centerlines"):
            p = f["properties"]
            for line in geojson_lines(f["geometry"]):
                if bbox_intersects(line, BBOX):
                    rivers.append(
                        {"name": p.get("name"), "rank": p.get("scalerank", 10), "featurecla": p.get("featurecla"), "line": line}
                    )
        return {
            "vintage": f"Natural Earth {TAG} (1:10m y 1:50m)",
            "_files": [self._path(n) for n in self.FILES],
            "countries": countries,
            "lakes": lakes,
            "rivers": rivers,
        }

