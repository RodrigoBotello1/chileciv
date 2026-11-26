"""Censo de Población y Vivienda 2024 (INE): población censada por comuna, sexo y grupo de edad."""

from __future__ import annotations

from ..core.source import Source, SourceInfo
from ..core.mapcfg import CFG, keep_region
from ._xlsx import sheet_rows

URL = "https://censo2024.ine.gob.cl/wp-content/uploads/2025/03/D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx"
FILE = "D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx"


def _int(v: str) -> int | None:
    try:
        return int(float(v))
    except ValueError:
        return None


class IneCenso2024(Source):
    info = SourceInfo(
        id="ine_censo2024",
        title="Censo de Población y Vivienda 2024: población censada por sexo y edad",
        publisher="Instituto Nacional de Estadísticas (INE)",
        homepage="https://censo2024.ine.gob.cl/resultados/",
        license="Datos públicos del INE; citar la fuente",
        description="Primeros resultados del Censo 2024 (27 de marzo de 2025): población censada por comuna, con "
        "hombres, mujeres y grupos de edad quinquenales. Da los códigos y nombres oficiales de las 52 comunas y 6 "
        "provincias de la Región Metropolitana, y la población de cada una.",
        used_for=["Población de comunas y provincias", "Pirámide de edades", "Códigos oficiales de comuna"],
    )

    def fetch(self, force=False):
        self.download(URL, FILE, force=force)

    def process(self):
        path = self.raw_dir / FILE
        comunas = {}
        for r in sheet_rows(path, "2"):
            if len(r) >= 9 and r[4].isdigit() and len(r[4]) >= 4 and r[4] != "0" and keep_region(r[0]):
                comunas[r[4].zfill(5)] = {
                    "code": r[4].zfill(5), "name": r[5], "prov_code": r[2].zfill(3), "prov_name": r[3],
                    "reg_code": r[0].zfill(2), "reg_name": r[1],
                    "population": _int(r[6]), "men": _int(r[7]), "women": _int(r[8]), "ages": {},
                }
        header = None
        for r in sheet_rows(path, "4"):
            if header is None and "Código comuna" in r:
                header = r
                continue
            if header and len(r) > 6 and r[4].zfill(5) in comunas:
                age = r[header.index("Grupos de edad")]
                if age.startswith("Total"):
                    continue
                comunas[r[4].zfill(5)]["ages"][age] = _int(r[header.index("Población censada")])
        expected = 52 if CFG["regions"] == {"13"} else 346
        if len(comunas) != expected:
            raise ValueError(f"expected {expected} comunas, got {len(comunas)}")
        return {
            "vintage": "Censo 2024, primeros resultados (INE, marzo 2025)",
            "year": 2024,
            "_files": [FILE],
            "comunas": sorted(comunas.values(), key=lambda c: c["code"]),
        }
