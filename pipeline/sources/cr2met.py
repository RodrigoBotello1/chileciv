"""CR2MET v2.5 (Centro de Ciencia del Clima y la Resiliencia, CR2): annual precipitation and rainy days, 1991-2020.

The file is classic NetCDF (CDF-1) with monthly grids of continental Chile at 0.05°. Only the header and the 360
months of the 1991-2020 normal are downloaded, with HTTP range requests, and read with a small NetCDF-3 parser.
"""

from __future__ import annotations

import struct

from ..core.source import Source, SourceInfo

URL = "https://ftp.cr2.cl/download/cr2met/v2.5/pr/CR2MET_pr_v2.5_mon_stats_1960_2021_005deg.nc"
HEADER_BYTES = 16384
YEARS = (1991, 2020)  # the WMO climate normal; the file starts in January 1960
SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8}
FMT = {1: "b", 3: "h", 4: "i", 5: "f", 6: "d"}


def parse_header(b: bytes) -> dict:
    """Dimensions and variables (dims, type, begin offset, attributes) of a CDF-1/CDF-2 file."""
    pos = 0

    def u32():
        nonlocal pos
        v = struct.unpack_from(">I", b, pos)[0]
        pos += 4
        return v

    def name():
        nonlocal pos
        n = u32()
        s = b[pos:pos + n].decode()
        pos += (n + 3) // 4 * 4
        return s

    def atts():
        nonlocal pos
        u32()
        out = {}
        for _ in range(u32()):
            nm, t, cnt = name(), u32(), u32()
            raw = b[pos:pos + SIZES[t] * cnt]
            pos += (SIZES[t] * cnt + 3) // 4 * 4
            out[nm] = raw.decode(errors="ignore") if t == 2 else struct.unpack(">" + FMT[t] * cnt, raw)
        return out

    if b[:3] != b"CDF":
        raise ValueError("not a classic NetCDF file")
    version = b[3]
    pos = 4
    u32()  # numrecs
    u32()
    dims = [(name(), u32()) for _ in range(u32())]
    atts()
    u32()
    variables = {}
    for _ in range(u32()):
        nm = name()
        ids = [u32() for _ in range(u32())]
        a = atts()
        t, vsize = u32(), u32()
        begin = struct.unpack_from(">Q", b, pos)[0] if version == 2 else u32()
        if version == 2:
            pos += 8
        variables[nm] = {"dims": [dims[i] for i in ids], "type": t, "begin": begin, "atts": a}
    return {"dims": dict(dims), "vars": variables}


class Cr2met(Source):
    info = SourceInfo(
        id="cr2met",
        title="CR2MET v2.5: precipitación anual y días con lluvia, normal 1991-2020",
        publisher="Centro de Ciencia del Clima y la Resiliencia (CR2), Universidad de Chile (Boisier et al.)",
        homepage="https://www.cr2.cl/datos-productos-grillados/",
        license="CC BY 4.0",
        description="Precipitación mensual de Chile continental en una grilla de 0.05° (unos 5 km), construida con "
        "estaciones meteorológicas chilenas, el reanálisis ERA5 y datos satelitales. Se usa la normal climática "
        "1991-2020 (la vigente de la OMM, que incluye la megasequía): el promedio de la lluvia de cada año y de los días "
        "con más de 1 mm. Cada hexágono toma la celda bajo su centro.",
        used_for=["Lente de lluvia anual", "Lente de días con lluvia"],
    )

    def fetch(self, force=False):
        head = self.download(URL, "header.bin", force=force, headers={"Range": f"bytes=0-{HEADER_BYTES - 1}"},
                             expect_binary=True)
        h = parse_header(head.read_bytes())
        nlat, nlon = h["dims"]["lat"], h["dims"]["lon"]
        m0, m1 = (YEARS[0] - 1960) * 12, (YEARS[1] - 1960 + 1) * 12
        for var in ("pr", "ndw1"):
            v = h["vars"][var]
            cell = SIZES[v["type"]]
            start = v["begin"] + m0 * nlat * nlon * cell
            end = v["begin"] + m1 * nlat * nlon * cell - 1
            self.download(URL, f"{var}_{YEARS[0]}_{YEARS[1]}.bin", force=force,
                          headers={"Range": f"bytes={start}-{end}"}, expect_binary=True)
        for var in ("lat", "lon"):
            v = h["vars"][var]
            n = h["dims"][var]
            self.download(URL, f"{var}.bin", force=force,
                          headers={"Range": f"bytes={v['begin']}-{v['begin'] + 8 * n - 1}"}, expect_binary=True)

    def process(self):
        h = parse_header((self.raw_dir / "header.bin").read_bytes())
        nlat, nlon = h["dims"]["lat"], h["dims"]["lon"]
        lat = struct.unpack(f">{nlat}d", (self.raw_dir / "lat.bin").read_bytes())
        lon = struct.unpack(f">{nlon}d", (self.raw_dir / "lon.bin").read_bytes())
        months = (YEARS[1] - YEARS[0] + 1) * 12
        n = nlat * nlon
        out = {}
        for var, key, fmt, miss in (("pr", "prec", "f", -9999.0), ("ndw1", "rain_days", "b", -128)):
            raw = (self.raw_dir / f"{var}_{YEARS[0]}_{YEARS[1]}.bin").read_bytes()
            total, bad = [0.0] * n, [False] * n
            for m in range(months):
                vals = struct.unpack_from(f">{n}{fmt}", raw, m * n * SIZES[h["vars"][var]["type"]])
                for k, v in enumerate(vals):
                    if v == miss or v != v:
                        bad[k] = True
                    else:
                        total[k] += v
            years = YEARS[1] - YEARS[0] + 1
            out[key] = [[None if bad[r * nlon + c] else round(total[r * nlon + c] / years, 1) for c in range(nlon)]
                        for r in range(nlat)]
            vals = [v for row in out[key] for v in row if v is not None]
            print(f"    {key}: {nlat}×{nlon}, {min(vals)}…{max(vals)}")
        return {"vintage": f"CR2MET v2.5, normal {YEARS[0]}-{YEARS[1]}", "_files": ["header.bin", "lat.bin", "lon.bin"],
                "lat": [round(v, 4) for v in lat], "lon": [round(v, 4) for v in lon], **out}
