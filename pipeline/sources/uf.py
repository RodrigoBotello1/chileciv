"""Valor de la Unidad de Fomento (UF) al cierre de un año, para pasar las ventas del SII a pesos."""

from __future__ import annotations

import html
import re

from ..core.source import Source, SourceInfo

YEARS = range(2022, 2027)


def dec31(page: str) -> float | None:
    """The 31 December value from the SII's yearly UF table (rows = days, columns = months)."""
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [html.unescape(re.sub("<[^>]+>", "", c)).strip() for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S)]
        if len(cells) == 13 and cells[0] == "31" and cells[12]:
            return float(cells[12].replace(".", "").replace(",", "."))
    return None


class Uf(Source):
    info = SourceInfo(
        id="uf",
        title="Unidad de Fomento al 31 de diciembre",
        publisher="Servicio de Impuestos Internos (SII), valores y fechas",
        homepage="https://www.sii.cl/valores_y_fechas/uf/uf2024.htm",
        license="Datos públicos del SII",
        description="Valor en pesos de la UF el 31 de diciembre de cada año. Pasa las ventas anuales del SII, que vienen "
        "en UF, a pesos del cierre de ese mismo año.",
        used_for=["Oro en pesos"],
    )

    def fetch(self, force=False):
        for y in YEARS:
            self.download(f"https://www.sii.cl/valores_y_fechas/uf/uf{y}.htm", f"uf{y}.htm", force=force)

    def process(self):
        values = {}
        for y in YEARS:
            v = dec31((self.raw_dir / f"uf{y}.htm").read_text(encoding="latin-1"))
            if v:
                values[str(y)] = v
        return {"vintage": "UF al 31 de diciembre (SII)", "_files": [f"uf{y}.htm" for y in YEARS], "values": values}
