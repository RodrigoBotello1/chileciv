"""Estadísticas de empresas del SII por comuna y rubro económico: empresas, ventas y trabajadores."""

from __future__ import annotations

import io
import zipfile

from ..core.source import Source, SourceInfo

URL = "https://www.sii.cl/sobre_el_sii/empresas/EMPRESAS.zip"
FILE = "EMPRESAS.zip"
MEMBER = "PUB_COMURUBR.txt"
REGION = "Región Metropolitana de Santiago"


def _num(v: str) -> float | None:
    v = v.strip()
    if not v:
        return None
    try:
        return float(v.replace(",", "."))
    except ValueError:
        return None


class SiiEmpresas(Source):
    info = SourceInfo(
        id="sii_empresas",
        title="Estadísticas de empresas por comuna y rubro económico",
        publisher="Servicio de Impuestos Internos (SII)",
        homepage="https://www.sii.cl/sobre_el_sii/estadisticas_de_empresas.html",
        license="Datos públicos del SII; citar la fuente",
        description="Número de empresas, ventas anuales (UF) y trabajadores dependientes informados por las empresas, "
        "por comuna del domicilio o casa matriz y por rubro económico (CIIU4.CL), del último año comercial completo. "
        "Ojo: toda la actividad de una empresa se asigna a la comuna de su casa matriz, así que las comunas donde se "
        "concentran las oficinas (Las Condes, Santiago, Providencia) aparecen con trabajadores y ventas de faenas "
        "que están en otras partes del país, como la minería.",
        used_for=["Oro (ventas)", "Trabajadores por rubro (comida, producción, ciencia, cultura)"],
    )

    def fetch(self, force=False):
        self.download(URL, FILE, force=force, expect_binary=True)

    def process(self):
        with zipfile.ZipFile(self.raw_dir / FILE) as z:
            text = io.TextIOWrapper(z.open(MEMBER), encoding="utf-8-sig")
            header = next(text).rstrip("\n").split("\t")
            col = {name: k for k, name in enumerate(header)}
            rows = [line.rstrip("\n").split("\t") for line in text]
        year_col = col["Año Comercial"]
        years = sorted({int(r[year_col]) for r in rows if r[year_col].isdigit()})
        # The latest year is filled in during the following year: use the last one whose RM total is
        # at least 90% of the year before (a complete year), so a partial year never shows up.
        def rm_total(y):
            return sum(_num(r[col["Número de empresas"]]) or 0 for r in rows
                       if r[year_col] == str(y) and r[col["Región del domicilio o casa matriz"]] == REGION)
        year = next(y for y in reversed(years) if rm_total(y) >= 0.9 * rm_total(y - 1))
        comunas: dict[str, dict] = {}
        for r in rows:
            if r[year_col] != str(year) or r[col["Región del domicilio o casa matriz"]] != REGION:
                continue
            name = r[col["Comuna del domicilio o casa matriz"]]
            rubro = r[col["Rubro económico"]]
            letter = rubro.split(" - ")[0].strip() if " - " in rubro else "?"
            rec = comunas.setdefault(name, {"name": name, "rubros": {}})
            rec["rubros"][letter] = {
                "empresas": _num(r[col["Número de empresas"]]),
                "ventas_uf": _num(r[col["Ventas anuales en UF"]]),
                "trabajadores": _num(r[col["Trabajadores ponderados por meses trabajados"]]),
                "renta_uf": _num(r[col["Renta neta informada en UF"]]),
            }
        print(f"    {len(comunas)} comunas de la RM, año comercial {year}")
        return {
            "vintage": f"SII, estadísticas de empresas, año comercial {year}",
            "year": year,
            "_files": [FILE],
            "comunas": comunas,
        }
