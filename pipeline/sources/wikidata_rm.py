"""Landmarks, protected areas, universities and the tallest buildings of the Santiago Metropolitan Region (Wikidata)."""

from __future__ import annotations

import json
import urllib.parse

from ..core.source import Source, SourceInfo

ENDPOINT = "https://query.wikidata.org/sparql"

# Each query returns items inside the region's bounding box (the wonders builder keeps those on the region's hexes),
# with coordinates and their number of Wikipedia articles (sitelinks), which ranks them. A box search is used instead
# of "located in" (P131+) because the latter times out on the public endpoint. Only the choice of class is fixed here.
BOX = ('SERVICE wikibase:box { ?item wdt:P625 ?coord . '
       'bd:serviceParam wikibase:cornerSouthWest "Point(-71.85 -34.40)"^^geo:wktLiteral . '
       'bd:serviceParam wikibase:cornerNorthEast "Point(-69.65 -32.80)"^^geo:wktLiteral . } ')
_COMMON = (
    "?item wikibase:sitelinks ?links . "
    'OPTIONAL { ?item rdfs:label ?es . FILTER(LANG(?es) = "es") } '
    'OPTIONAL { ?item rdfs:label ?en . FILTER(LANG(?en) = "en") } '
)
QUERIES = {
    "monuments.json": f"SELECT DISTINCT ?item ?es ?en ?coord ?links WHERE {{ {BOX}?item wdt:P1435 wd:Q35863415 . {_COMMON}}}",
    "protected.json": (
        f"SELECT DISTINCT ?item ?es ?en ?coord ?links ?area WHERE {{ {BOX}"
        "{ ?item wdt:P1435 wd:Q35863088 } UNION "
        "{ ?item wdt:P31/wdt:P279? ?cls . VALUES ?cls { wd:Q473972 wd:Q46169 wd:Q179049 } } "
        f"OPTIONAL {{ ?item p:P2046/psn:P2046/wikibase:quantityAmount ?area }} {_COMMON}}}"
    ),
    "universities.json": (
        f"SELECT DISTINCT ?item ?es ?en ?coord ?links ?students WHERE {{ {BOX}"
        "?item wdt:P31/wdt:P279? ?cls . VALUES ?cls { wd:Q3918 wd:Q902104 } "
        f"OPTIONAL {{ ?item wdt:P2196 ?students }} {_COMMON}}}"
    ),
    "towers.json": (
        f"SELECT DISTINCT ?item ?es ?en ?coord ?links ?height WHERE {{ {BOX}"
        "?item wdt:P31/wdt:P279? ?cls . VALUES ?cls { wd:Q41176 wd:Q11303 wd:Q18142 } "
        f"OPTIONAL {{ ?item p:P2048/psn:P2048/wikibase:quantityAmount ?height }} {_COMMON}}}"
    ),
}


def _point(wkt: str) -> tuple[float, float] | None:
    """'Point(-70.6 -33.4)' → (lon, lat)."""
    try:
        lon, lat = wkt[wkt.index("(") + 1: wkt.index(")")].split()
        return round(float(lon), 5), round(float(lat), 5)
    except ValueError:
        return None


class WikidataRm(Source):
    info = SourceInfo(
        id="wikidata_rm",
        title="Monumentos, áreas protegidas, universidades y edificios de la Región Metropolitana (Wikidata)",
        publisher="Wikidata (Wikimedia Foundation), con la declaratoria del Consejo de Monumentos Nacionales",
        homepage="https://www.wikidata.org/",
        license="CC0 1.0 (dominio público)",
        description="Elementos de Wikidata con coordenadas dentro de la región (búsqueda por rectángulo; el mapa deja solo los que caen en sus hexágonos): los Monumentos "
        "Históricos de Chile (P1435), las áreas protegidas y Santuarios de la Naturaleza, las universidades y los "
        "edificios con altura (P2048). Cada uno trae su número de artículos en Wikipedia, que ordena las maravillas "
        "por lo conocidas que son.",
        used_for=["Maravillas: monumentos, naturaleza, universidades y rascacielos"],
    )

    def fetch(self, force=False):
        for rel, q in QUERIES.items():
            url = f"{ENDPOINT}?format=json&query={urllib.parse.quote(q)}"
            self.download(url, rel, force=force)

    def process(self):
        out = {}
        for rel in QUERIES:
            rows = json.loads((self.raw_dir / rel).read_text(encoding="utf-8"))["results"]["bindings"]
            items: dict[str, dict] = {}
            for b in rows:
                qid = b["item"]["value"].rsplit("/", 1)[-1]
                pt = _point(b["coord"]["value"])
                name = (b.get("es") or b.get("en") or {}).get("value")
                if not pt or not name:
                    continue
                rec = items.setdefault(qid, {"qid": qid, "name": name, "name_en": (b.get("en") or {}).get("value"),
                                             "lon": pt[0], "lat": pt[1], "links": int(b["links"]["value"])})
                for k in ("area", "students", "height"):
                    if k in b:
                        try:
                            v = float(b[k]["value"])
                        except ValueError:
                            continue
                        rec[k] = max(rec.get(k) or 0, v)
            out[rel.removesuffix(".json")] = sorted(items.values(), key=lambda r: (-r["links"], r["name"]))
            print(f"    {rel}: {len(items)} items")
        return {"vintage": "Wikidata (consulta SPARQL; fecha en el manifiesto)", "_files": list(QUERIES), **out}
