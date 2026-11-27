"""PIB regional nominal (Banco Central de Chile, Base de Datos Estadísticos), for each region's share of national GDP.

The BDE web table (cuadro CCNN2018_PIB_REGIONAL_N) is served as HTML; the series of the requested years are read
from it. Values are billions of pesos (miles de millones), current prices.
"""

from __future__ import annotations

import html
import re

from ..core.source import Source, SourceInfo

YEARS = (2019, 2025)
URL = ("https://si3.bcentral.cl/Siete/ES/Siete/Cuadro/CAP_CCNN/MN_CCNN76/CCNN2018_PIB_REGIONAL_N"
       f"?cbFechaInicio={YEARS[0]}&cbFechaTermino={YEARS[1]}&cbFrecuencia=ANNUAL&cbCalculo=NONE&cbFechaBase=")
FILE = "pib_regional_nominal.html"


def _num(s: str) -> float | None:
    s = s.replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return None


class BcchPibRegional(Source):
    info = SourceInfo(
        id="bcch_pib_regional",
        title="Producto interno bruto por región, nominal (Banco Central de Chile)",
        publisher="Banco Central de Chile, Base de Datos Estadísticos (cuentas nacionales regionales)",
        homepage="https://si3.bcentral.cl/Siete/ES/Siete/Cuadro/CAP_CCNN/MN_CCNN76/CCNN2018_PIB_REGIONAL_N",
        license="Datos públicos del Banco Central de Chile",
        description="PIB de cada región a precios corrientes, en miles de millones de pesos, de las cuentas nacionales "
        "regionales (referencia 2018). Da el aporte de cada región al PIB de Chile. Una parte del PIB no se asigna a ninguna "
        "región (extrarregional: por ejemplo, la producción en el mar) y queda fuera de las sumas por región. No existe PIB "
        "por comuna.",
        used_for=["PIB regional y su aporte al PIB de Chile (mapa de Chile)"],
    )

    def fetch(self, force=False):
        self.download(URL, FILE, force=force)

    def process(self):
        s = (self.raw_dir / FILE).read_text(encoding="utf-8", errors="ignore")
        rows = []
        for r in re.findall(r"<tr[^>]*>(.*?)</tr>", s, re.S):
            cells = [html.unescape(re.sub("<[^>]+>", "", c)).strip() for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S)]
            if len(cells) > 2:
                rows.append(cells[1:])
        header = rows[0]
        years = [int(y) for y in header[1:] if y.isdigit()]
        series = {r[0]: dict(zip(years, (_num(v) for v in r[1:]))) for r in rows[1:]}
        year = max(y for y in years if series.get("Producto Interno Bruto", {}).get(y))
        print(f"    {len(series)} series, latest year {year}: PIB {series['Producto Interno Bruto'][year]:,.0f} miles de millones")
        return {"vintage": f"Banco Central de Chile, PIB regional nominal {year}", "year": year, "unit": 1e9,
                "_files": [FILE], "series": series}
