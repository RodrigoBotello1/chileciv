"""OpenStreetMap extracts for the Santiago Metropolitan Region through the Overpass API: autopistas, main roads,
railways, the Metro and airports.

The manifest records the mirror that answered. The window is the map's (cl_boundaries.BBOX plus the margin); it also
holds roads of the neighbouring regions, which the infrastructure builder drops (no link may end on foreign land).
"""

from __future__ import annotations

import http.client
import json
import math
import urllib.error
import urllib.parse
from collections import Counter, defaultdict

from ..core import fetch
from ..core.source import Source, SourceInfo

BBOX = "-34.60,-72.00,-32.60,-69.45"  # south, west, north, east: the map window plus its margin
MIRRORS = [
    "https://maps.mail.ru/osm/tools/overpass/api",
    "https://overpass.private.coffee/api",
    "https://overpass.kumi.systems/api",
    "https://overpass-api.de/api",
]
PASSES = 2  # times the mirror list is walked before giving up
MIN_STEP = 0.0003  # degrees (~30 m): line points closer than this to the last kept point are dropped

LICENSE = "Open Database License (ODbL) 1.0, © OpenStreetMap contributors"


def overpass(source: Source, query: str, rel_path: str, force: bool = False) -> None:
    """Download one Overpass query to data/raw/<id>/<rel_path>, trying each mirror in turn."""
    if (source.raw_dir / rel_path).exists() and not force:
        return
    data = urllib.parse.quote(query)
    if fetch.OFFLINE:
        source.download(f"{MIRRORS[0]}/interpreter?data={data}", rel_path)  # raises OfflineError
        return
    last: Exception | None = None
    for _ in range(PASSES):
        for base in MIRRORS:
            try:
                if not fetch.url_exists(f"{base}/status", timeout=20):
                    raise RuntimeError("status page did not answer")
                source.download(f"{base}/interpreter?data={data}", rel_path, force=force, expect_binary=True)
                doc = json.loads((source.raw_dir / rel_path).read_text(encoding="utf-8"))
                if doc.get("remark") or not doc.get("elements"):
                    raise ValueError(doc.get("remark") or "no elements")
                return
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, ValueError,
                    KeyError, RuntimeError) as exc:
                print(f"      {base}: {exc}")
                source.discard(rel_path)
                last = exc
    raise RuntimeError(f"no Overpass mirror answered: {last}")


def _load(source: Source, rel_path: str) -> tuple[list[dict], str]:
    doc = json.loads((source.raw_dir / rel_path).read_text(encoding="utf-8"))
    return doc["elements"], doc.get("osm3s", {}).get("timestamp_osm_base", "")


def _point(el: dict) -> tuple[float, float] | None:
    c = el if "lat" in el else el.get("center")
    return (round(c["lon"], 5), round(c["lat"], 5)) if c else None


def stitch(ways: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """Join ways that share an end point into longer lines (either direction). OSM cuts a road into many short
    ways; a builder that straightens a line hex by hex needs the long line."""
    ends = defaultdict(list)
    for k, w in enumerate(ways):
        ends[w[0]].append(k)
        ends[w[-1]].append(k)
    used = [False] * len(ways)

    def grow(line: list[tuple[float, float]]) -> list[tuple[float, float]]:
        while True:
            nxt = next((k for k in ends[line[-1]] if not used[k]), None)
            if nxt is None:
                return line
            used[nxt] = True
            w = ways[nxt]
            line.extend(w[1:] if w[0] == line[-1] else w[-2::-1])

    out = []
    for k, w in enumerate(ways):
        if used[k]:
            continue
        used[k] = True
        line = grow(list(w))
        line.reverse()
        out.append(grow(line))
    return out


def thin(line: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out = [line[0]]
    for p in line[1:-1]:
        if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) >= MIN_STEP:
            out.append(p)
    out.append(line[-1])
    return out


def _geometry(el: dict) -> list[tuple[float, float]]:
    return [(p["lon"], p["lat"]) for p in el.get("geometry") or [] if p]


def _lines(ways: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    return [[(round(x, 5), round(y, 5)) for x, y in thin(ln)] for ln in stitch([w for w in ways if len(w) >= 2])]


class OsmRmTransport(Source):
    info = SourceInfo(
        id="osm_rm_transport",
        title="Autopistas, rutas principales, ferrocarril, Metro y aeropuertos (OpenStreetMap)",
        publisher="OpenStreetMap contributors, via the Overpass API",
        homepage="https://www.openstreetmap.org/",
        license=LICENSE,
        description="Trazado de las autopistas (highway=motorway y trunk), las rutas principales (highway=primary), el "
        "ferrocarril (railway=rail: EFE y el tren a Nos y Rancagua), el Metro de Santiago (railway=subway) y el tren "
        "ligero, tal como están en OpenStreetMap. También el punto central de los aeródromos con código IATA. Caminos y "
        "vías son dibujo del mapa entre centros de hexágono, no estadísticas: OSM no trae flujos de tránsito.",
        used_for=["Autopistas y rutas en el mapa", "Ferrocarril y Metro en el mapa", "Posición de los aeropuertos"],
    )

    QUERIES = {
        "expressways.json": f'[out:json][timeout:120];way["highway"~"^(motorway|trunk)$"]({BBOX});out tags geom;',
        "primary.json": f'[out:json][timeout:120];way["highway"="primary"]({BBOX});out tags geom;',
        "rail.json": f'[out:json][timeout:120];way["railway"="rail"]({BBOX});out tags geom;',
        "metro.json": f'[out:json][timeout:120];way["railway"~"^(subway|light_rail)$"]({BBOX});out tags geom;',
        "sites.json": f'[out:json][timeout:120];nwr["aeroway"="aerodrome"]["iata"]({BBOX});out tags center;',
    }

    def fetch(self, force=False):
        for rel, query in self.QUERIES.items():
            overpass(self, query, rel, force)

    def process(self):
        stamps = []
        # Roads: one feature per (class, ref or name), its ways stitched into long lines.
        groups: dict[tuple, list] = defaultdict(list)
        names: dict[tuple, Counter] = defaultdict(Counter)
        for rel in ("expressways.json", "primary.json"):
            els, stamp = _load(self, rel)
            stamps.append(stamp)
            for el in els:
                t = el.get("tags", {})
                geom = _geometry(el)
                if len(geom) < 2:
                    continue
                ref = (t.get("ref") or "").split(";")[0].strip() or None
                key = (t["highway"], ref, None if ref else t.get("name"))
                groups[key].append(geom)
                if t.get("name"):
                    names[key][t["name"]] += len(geom)
        roads = []
        for (highway, ref, name), ways in sorted(groups.items(), key=lambda kv: tuple(str(v) for v in kv[0])):
            common = names[(highway, ref, name)].most_common(1)
            roads.append({"highway": highway, "ref": ref, "name": common[0][0] if common else name,
                          "lines": _lines(ways)})

        # Rail: running lines only (no yards, sidings, spurs or crossovers). Grouped by kind: the Metro (subway and
        # light rail) and the railway. Chilean OSM rarely tags usage=main/branch, so all running railway is one tier.
        rgroups: dict[str, list] = defaultdict(list)
        for rel, kind in (("rail.json", "rail"), ("metro.json", "metro")):
            els, stamp = _load(self, rel)
            stamps.append(stamp)
            for el in els:
                t = el.get("tags", {})
                geom = _geometry(el)
                if len(geom) < 2 or t.get("service") or t.get("usage") in ("industrial", "military", "tourism"):
                    continue
                rgroups[kind].append(geom)
        usage_seen = Counter({k: len(v) for k, v in rgroups.items()})
        rail = [{"usage": kind, "highspeed": False, "lines": _lines(ways)} for kind, ways in sorted(rgroups.items())]

        els, stamp = _load(self, "sites.json")
        stamps.append(stamp)
        airports, harbours = [], []
        for el in els:
            t = el.get("tags", {})
            pt = _point(el)
            if pt is None:
                continue
            rec = {"osm": f"{el['type']}/{el['id']}", "name": t.get("name"), "name_en": t.get("name:en"),
                   "lon": pt[0], "lat": pt[1]}
            if t.get("aeroway") == "aerodrome" and t.get("iata"):
                airports.append({**rec, "iata": t["iata"], "icao": t.get("icao")})
        day = max(s for s in stamps if s)[:10] if any(stamps) else "?"
        print(f"    {len(roads)} road routes ({sum(len(r['lines']) for r in roads)} lines), {len(rail)} rail lines "
              f"({sum(len(r['lines']) for r in rail)} lines; usage tags {dict(usage_seen)}), {len(airports)} IATA "
              f"aerodromes in the window")
        return {
            "vintage": f"OpenStreetMap, {day}",
            "_files": list(self.QUERIES),
            "roads": roads,
            "rail": rail,
            "airports": airports,
            "harbours": harbours,
        }
