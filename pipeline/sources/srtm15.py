"""SRTM15+ land elevation and sea depth (15 arc-seconds, ~460 m) via NOAA ERDDAP."""

from __future__ import annotations

import csv

from ..core.source import Source, SourceInfo

from ..core.mapcfg import CFG

_W = CFG["window"]  # lon0, lat0, lon1, lat1: the map bbox plus its margin
LAT, LON = (_W[1], _W[3]), (_W[0], _W[2])
STRIDE = CFG["srtm_stride"]
URL = (
    "https://coastwatch.pfeg.noaa.gov/erddap/griddap/srtm15plus.csv"
    f"?z%5B({LAT[0]}):{STRIDE}:({LAT[1]})%5D%5B({LON[0]}):{STRIDE}:({LON[1]})%5D"
)
FILE = f"srtm15plus_lat{LAT[0]}_{LAT[1]}_lon{LON[0]}_{LON[1]}_s{STRIDE}.csv"


class Srtm15(Source):
    info = SourceInfo(
        id="srtm15",
        title="SRTM15+ global relief model (V2)",
        publisher="Scripps Institution of Oceanography; served by NOAA NMFS SWFSC ERDDAP",
        homepage="https://topex.ucsd.edu/WWW_html/srtm15_plus.html",
        license="Public domain (U.S. Government-supported research data; cite Tozer et al. 2019)",
        description="Land elevation and ocean depth on a 15 arc-second grid (about 460 m), for every point in "
        "the map window. Each hex's relief (flat, hills, mountains, peaks) comes from the mean and spread of the "
        "roughly 10-15 land samples inside each 1 km hex; sea hexes take the mean depth.",
        used_for=["Relief (hills, mountains, peaks)", "Hill-shading", "Ocean depth"],
    )

    def fetch(self, force=False):
        self.download(URL, FILE, force=force)

    def process(self):
        lats: dict[float, int] = {}
        lons: dict[float, int] = {}
        cells: list[tuple[float, float, int]] = []
        with open(self.raw_dir / FILE, newline="") as f:
            rows = csv.reader(f)
            next(rows)  # header
            next(rows)  # units
            for la, lo, z in rows:
                if z == "NaN":
                    continue
                la, lo = round(float(la), 5), round(float(lo), 5)
                lats.setdefault(la, 0)
                lons.setdefault(lo, 0)
                cells.append((la, lo, int(round(float(z)))))
        lat_list, lon_list = sorted(lats), sorted(lons)
        li = {v: k for k, v in enumerate(lat_list)}
        oi = {v: k for k, v in enumerate(lon_list)}
        grid: list[list[int | None]] = [[None] * len(lon_list) for _ in lat_list]
        for la, lo, z in cells:
            grid[li[la]][oi[lo]] = z
        return {
            "vintage": "SRTM15+ V2, 15 arc-second grid",
            "_files": [FILE],
            # A regular lat/lon grid: row r is latitude lat0 + r*dlat (south to north), column c is lon0 + c*dlon.
            "lat0": lat_list[0], "dlat": (lat_list[-1] - lat_list[0]) / (len(lat_list) - 1),
            "lon0": lon_list[0], "dlon": (lon_list[-1] - lon_list[0]) / (len(lon_list) - 1),
            "alt": grid,
        }
