"""Censo 2024 (INE): the published comuna tables behind the lenses, the City view citizens and population growth.

One source for many small spreadsheets: each table is downloaded as published and read by column name, so a
re-published file with an extra column still works. Also the 2017 census population per comuna (republished by the
INE with the 2024 results), for the 2017-2024 growth.
"""

from __future__ import annotations

from ..core.source import Source, SourceInfo
from ..core.mapcfg import CFG, keep_region
from ._xlsx import sheet_rows

BASE = "https://censo2024.ine.gob.cl/wp-content/uploads"
FILES = {
    "edad": "2025/03/D2_Indice-de-envejecimiento-por-sexo.xlsx",
    "inmigracion": "2025/04/D4_Inmigracion-Internacional.xlsx",
    "migracion_interna": "2025/04/D5_Migracion-interna.xlsx",
    "educacion": "2025/06/P7_Educacion.xlsx",
    "religion": "2025/06/P6_Religion-o-credo.xlsx",
    "indigenas": "2025/06/P2_Pueblos-indigenas.xlsx",
    "viviendas": "2025/03/V1_Viviendas-y-hogares-censados.xlsx",
    "hacinamiento": "2025/05/V3_N-de-dormitorios-hacinamiento-y-viv-con-mas-de-un-hogar.xlsx",
    "hogar": "2025/05/H1_Servicios-basicos-hogar-y-tenencia-vivienda.xlsx",
    "censo2017": "2025/04/Poblacion-censada-y-residentes-habituales-Censo-2017.xlsx",
}

# (output key, file, sheet, row filter {column: value} or None, {output field: column name})
TABLES = [
    ("edad", "edad", "2", {"Sexo": "Total Comuna"},
     {"pop": "Población censada", "a0_14": "0-14", "a15_64": "15-64", "a65": "65 años o más",
      "indice_envejecimiento": "Índice de envejecimiento"}),
    ("migracion_interna", "migracion_interna", "2", None,
     {"pop": "Población censada", "no_migrante": "No migrante interno comunal",
      "no_nacian": "Aún no nacían (menores de 5 años)"}),
    ("nivel_educativo", "educacion", "2", None,
     {"pop": "Población censada", "nunca": "Nunca asistió", "diferencial": "Diferencial", "parvularia": "Parvularia",
      "basica": "Básica", "media": "Media", "superior": "Superior", "no_declarado": "Nivel educativo no declarado"}),
    ("escolaridad", "educacion", "4", {"Sexo": "Total Comuna"},
     {"anos": "Años de escolaridad promedio", "anos_18": "Años de escolaridad promedio para la población de 18 años o más"}),
    ("religion", "religion", "2", None,
     {"pop15": "Población de 15 años o más", "catolica": "Católica", "evangelica": "Evangélica o protestante",
      "judia": "Judía", "musulmana": "Musulmana", "sud": "Iglesia de Jesucristo de los Santos de los Últimos Días",
      "ortodoxa": "Católica Ortodoxa", "budista": "Budista", "testigo": "Testigo de Jehová",
      "otros_cristianos": "Otros cristianos y tradiciones relacionadas con Cristo",
      "otras": "Otras religiones o credos", "ninguna": "Ninguna", "no_declarada": "Religión o credo no declarado"}),
    ("indigenas", "indigenas", "2", None,
     {"total": "Población que es o se considera perteneciente a un pueblo indígena u originario", "mapuche": "Mapuche",
      "aymara": "Aymara", "diaguita": "Diaguita", "quechua": "Quechua"}),
    ("viviendas", "viviendas", "2", None,
     {"total": "Viviendas censadas", "ocupadas": "Viviendas particulares ocupadas",
      "desocupadas": "Viviendas particulares desocupadas", "colectivas": "Viviendas colectivas"}),
    ("hogares", "viviendas", "6", None, {"hogares": "Hogares censados", "personas_por_hogar": "Promedio de personas por hogar"}),
    ("hacinamiento", "hacinamiento", "4", None,
     {"viviendas": "Viviendas particulares ocupadas con moradores presentes", "sin": "Viviendas sin hacinamiento /A",
      "medio": "Viviendas con hacinamiento medio /A", "critico": "Viviendas con hacinamiento crítico /A"}),
    ("calefaccion", "hogar", "4", None,
     {"hogares": "Hogares censados", "gas": "Gas", "parafina": "Parafina o petróleo", "lena": "Leña", "pellet": "Pellet",
      "carbon": "Carbón", "electricidad": "Electricidad",
      "no_usa": "No utiliza fuente de energía o combustible para calefaccionar"}),
    ("internet_si", "hogar", "6", {"Disponibilidad de equipo o servicio": "Sí"},
     {"internet_fija": "Internet fija", "computador": "Computador (escritorio, portátil)"}),
    ("internet_no", "hogar", "6", {"Disponibilidad de equipo o servicio": "No"},
     {"internet_fija": "Internet fija", "computador": "Computador (escritorio, portátil)"}),
    ("tenencia", "hogar", "8", None,
     {"hogares": "Hogares censados", "propia_pagada": "Propia pagada", "propia_pagandose": "Propia pagándose",
      "arrendada_con": "Arrendada con contrato", "arrendada_sin": "Arrendada sin contrato"}),
    ("censo2017", "censo2017", "2", None, {"pop": "Población censada", "residentes": "Residentes habituales"}),
]


def _num(v: str) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _code_col(header: list[str]) -> int:
    return next(i for i, h in enumerate(header) if h.strip().lower() in ("código comuna", "codigo comuna"))


class IneCensoTablas(Source):
    info = SourceInfo(
        id="ine_censo_tablas",
        title="Censo 2024: tabulados comunales (edad, migración, educación, religión, pueblos indígenas, vivienda y hogar)",
        publisher="Instituto Nacional de Estadísticas (INE)",
        homepage="https://censo2024.ine.gob.cl/resultados/",
        license="Datos públicos del INE; citar la fuente",
        description="Los tabulados por comuna que el INE publicó con los resultados del Censo 2024 (marzo a junio de "
        "2025): grupos de edad e índice de envejecimiento, inmigrantes internacionales por país de nacimiento, comuna de "
        "residencia hace 5 años, nivel educativo y años de escolaridad, religión o credo (15 años o más), pueblos "
        "indígenas, viviendas y hogares, hacinamiento, calefacción, equipamiento del hogar y tenencia de la vivienda. "
        "Incluye la población censada de 2017 por comuna, para el crecimiento 2017-2024.",
        used_for=["Lentes de la región", "Habitantes de la vista de comuna", "Crecimiento 2017-2024"],
    )

    def fetch(self, force=False):
        for path in FILES.values():
            self.download(f"{BASE}/{path}", path.rsplit("/", 1)[-1], force=force, expect_binary=True)

    def _rows(self, key: str, sheet: str) -> tuple[list[str], list[list[str]]]:
        rows = sheet_rows(self.raw_dir / FILES[key].rsplit("/", 1)[-1], sheet)
        hi = next(i for i, r in enumerate(rows) if any(h.strip().lower() in ("código comuna", "codigo comuna") for h in r))
        return rows[hi], rows[hi + 1:]

    def process(self):
        out: dict[str, dict[str, dict]] = {}
        for key, file, sheet, flt, cols in TABLES:
            header, rows = self._rows(file, sheet)
            idx = {h: i for i, h in enumerate(header)}
            cc = _code_col(header)
            table = {}
            for r in rows:
                if len(r) <= cc or not r[cc].isdigit() or len(r[cc]) < 4 or not keep_region(r[0]):
                    continue
                if flt and any(r[idx[c]] != v for c, v in flt.items()):
                    continue
                table[r[cc].zfill(5)] = {k: _num(r[idx[c]]) if idx.get(c) is not None and idx[c] < len(r) else None
                                for k, c in cols.items()}
            expected = 52 if CFG["regions"] == {"13"} else 346
            if len(table) < expected - 1:  # a table may leave out the Antarctic comuna
                raise ValueError(f"{key}: expected {expected} comunas, got {len(table)}")
            out[key] = table
        # Immigrants by country of birth (long format): total and the countries, per comuna.
        header, rows = self._rows("inmigracion", "4")
        idx = {h: i for i, h in enumerate(header)}
        cc, pc, vc = _code_col(header), idx["País o continente de nacimiento"], idx["Inmigrantes internacionales"]
        imm: dict[str, dict] = {}
        for r in rows:
            if len(r) <= vc or not r[cc].isdigit() or len(r[cc]) < 4 or not keep_region(r[0]):
                continue
            rec = imm.setdefault(r[cc].zfill(5), {"total": None, "paises": {}})
            if r[pc].startswith("Total"):
                rec["total"] = _num(r[vc])
            else:
                rec["paises"][r[pc]] = _num(r[vc])
        out["inmigracion"] = imm
        return {"vintage": "Censo 2024, tabulados comunales (INE, 2025); Censo 2017", "year": 2024,
                "_files": [p.rsplit("/", 1)[-1] for p in FILES.values()], "tablas": out}
