"""WorldClim 2.1 climate normals (1970-2000): annual precipitation and annual mean temperature, 5 arc-minute grid.

The GeoTIFFs are float32, one row per LZW-compressed strip. Only the rows and columns of the map window are decoded,
with a small TIFF-LZW decoder (standard library only).
"""

from __future__ import annotations

import struct
import zipfile

from ..core.mapcfg import CFG
from ..core.source import Source, SourceInfo
from .worldcover import read_ifds

URL = "https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_5m_bio.zip"
FILE = "wc2.1_5m_bio.zip"
LAYERS = {"prec": "wc2.1_5m_bio_12.tif", "temp": "wc2.1_5m_bio_1.tif"}  # BIO12 annual precipitation (mm), BIO1 (°C)
WINDOW = CFG["window"]


def lzw_decode(data: bytes) -> bytes:
    """TIFF LZW (MSB-first codes, 'early change'): 256 = clear, 257 = end of information."""
    out = bytearray()
    table = [bytes([i]) for i in range(256)] + [b"", b""]
    width, bitpos, nbits, prev = 9, 0, len(data) * 8, None
    while bitpos + width <= nbits:
        byte = bitpos >> 3
        chunk = int.from_bytes(data[byte:byte + 4].ljust(4, b"\0"), "big")
        code = (chunk >> (32 - (bitpos & 7) - width)) & ((1 << width) - 1)
        bitpos += width
        if code == 256:
            table = table[:258]
            width, prev = 9, None
            continue
        if code == 257:
            break
        if prev is None:
            entry = table[code]
        elif code < len(table):
            entry = table[code]
            table.append(prev + entry[:1])
        else:
            entry = prev + prev[:1]
            table.append(entry)
        out += entry
        prev = entry
        if len(table) + 1 >= (1 << width) and width < 12:
            width += 1
    return bytes(out)


def read_window(tif: bytes, window) -> dict:
    ifd = read_ifds(tif[:65536])[0]
    w, h = ifd[256], ifd[257]
    if ifd.get(259) != 5 or ifd.get(258) != 32 or ifd.get(339) != 3:
        raise ValueError("expected LZW-compressed float32 strips")
    offs, counts = ifd[273], ifd[279]
    rows_per = ifd.get(278, 1)
    px = 360.0 / w  # global grid: column 0 at 180°W, row 0 at 90°N
    lon0, lat0, lon1, lat1 = window
    c0, c1 = int((lon0 + 180) / px), int((lon1 + 180) / px) + 1
    r0, r1 = int((90 - lat1) / px), int((90 - lat0) / px) + 1
    rows = []
    for r in range(r0, r1):
        strip = r // rows_per
        raw = lzw_decode(tif[offs[strip]: offs[strip] + counts[strip]])
        start = (r - strip * rows_per) * w * 4
        vals = struct.unpack_from(f"<{w}f", raw, start)
        rows.append([None if v < -1e30 else round(v, 1) for v in vals[c0:c1]])
    return {"lon0": -180 + (c0 + 0.5) * px, "lat0": 90 - (r0 + 0.5) * px, "px": px, "rows": rows}


class WorldClim(Source):
    info = SourceInfo(
        id="worldclim",
        title="WorldClim 2.1: precipitación anual y temperatura media (normales 1970-2000)",
        publisher="WorldClim (Fick y Hijmans, 2017)",
        homepage="https://www.worldclim.org/data/worldclim21.html",
        license="Uso libre para investigación y fines no comerciales; citar Fick y Hijmans (2017)",
        description="Climatología mundial interpolada desde estaciones meteorológicas, en una grilla de 5 minutos de arco "
        "(unos 9 km). Se leen la precipitación anual (BIO12) y la temperatura media anual (BIO1). Cada hexágono toma el "
        "valor de la celda bajo su centro, así que en el mapa de la RM (hexágonos de 1 km) se ven bloques.",
        used_for=["Lente de lluvia anual", "Lente de temperatura media"],
    )

    def fetch(self, force=False):
        self.download(URL, FILE, force=force, expect_binary=True)

    def process(self):
        z = zipfile.ZipFile(self.raw_dir / FILE)
        out = {}
        for key, member in LAYERS.items():
            out[key] = read_window(z.read(member), WINDOW)
            vals = [v for r in out[key]["rows"] for v in r if v is not None]
            print(f"    {key}: {len(out[key]['rows'])}×{len(out[key]['rows'][0])} cells, {min(vals)}…{max(vals)}")
        return {"vintage": "WorldClim 2.1, normales 1970-2000, 5 minutos de arco", "_files": [FILE], **out}
