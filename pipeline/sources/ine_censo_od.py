"""Censo 2024 microdata (INE): where employed people work (question 44) and how they get there (question 45).

The microdata are Parquet files, so this one source reads them with DuckDB instead of the standard library:
run it with `uv run --with duckdb python -m pipeline process ine_censo_od`. The output is a small aggregate
(comuna of residence × comuna of work, and travel modes per comuna); no person-level row leaves this step.
"""

from __future__ import annotations

import zipfile

from ..core.mapcfg import keep_region
from ..core.source import Source, SourceInfo

URL = "https://storage.googleapis.com/bktdescargascenso2024/viv_hog_per_censo2024.zip"
FILE = "viv_hog_per_censo2024.zip"
MEMBER = "personas_censo2024.parquet"
PLACE = {1: "home", 2: "same", 3: "other", 4: "abroad", 5: "several"}  # p44_lug_trab
MODE = {1: "car", 2: "public", 3: "walk", 4: "bike", 5: "moto", 6: "boat_horse", 7: "other"}  # p45_medio_transporte


class IneCensoOd(Source):
    info = SourceInfo(
        id="ine_censo_od",
        title="Censo 2024: comuna donde trabajan las personas y medio de transporte (microdatos)",
        publisher="Instituto Nacional de Estadísticas (INE)",
        homepage="https://censo2024.ine.gob.cl/ine-publica-base-de-datos-del-censo-de-poblacion-y-vivienda-2024/",
        license="Datos públicos del INE; citar la fuente",
        description="Base de microdatos del Censo 2024 (publicada en diciembre de 2025). De cada persona ocupada se toma "
        "su comuna de residencia, la comuna donde está su trabajo (pregunta 44: en su vivienda, en su comuna, en otra "
        "comuna, en otro país o en varias) y su medio de transporte principal (pregunta 45). Se agregan por comuna; "
        "no sale ningún dato individual. Quien trabaja en varias comunas no tiene un destino único y no entra en los flujos.",
        used_for=["Flujos de viaje al trabajo entre comunas", "Lentes de trabajo en otra comuna y medio de transporte"],
    )

    def fetch(self, force=False):
        self.download(URL, FILE, force=force, expect_binary=True)

    def process(self):
        try:
            import duckdb
        except ImportError as exc:  # the only non-standard dependency of the pipeline, and only here
            raise SystemExit("ine_censo_od needs DuckDB: uv run --with duckdb python -m pipeline process ine_censo_od") from exc
        parquet = self.raw_dir / MEMBER
        if not parquet.exists():
            with zipfile.ZipFile(self.raw_dir / FILE) as z:
                z.extract(MEMBER, self.raw_dir)
        con = duckdb.connect()
        src = f"read_parquet('{parquet}')"
        comunas: dict[str, dict] = {}
        for comuna, place, n in con.execute(
                f"select comuna, p44_lug_trab, count(*) from {src} where p44_lug_trab is not null group by 1, 2").fetchall():
            code = str(comuna).zfill(5)
            if not keep_region(code[:2]):
                continue
            rec = comunas.setdefault(code, {"workers": 0, "place": {}, "mode": {}})
            rec["workers"] += n
            rec["place"][PLACE.get(place, "no_answer")] = n
        for comuna, mode, n in con.execute(
                f"select comuna, p45_medio_transporte, count(*) from {src} where p45_medio_transporte is not null "
                f"group by 1, 2").fetchall():
            code = str(comuna).zfill(5)
            if code in comunas:
                comunas[code]["mode"][MODE.get(mode, "no_answer")] = n
        flows = []
        for o, d, n in con.execute(
                f"select comuna, p44_lug_trab_esp, count(*) from {src} where p44_lug_trab = 3 group by 1, 2").fetchall():
            o, d = str(o).zfill(5), str(d).zfill(5)
            if o in comunas and o != d:
                flows.append([o, d, n])
        flows.sort(key=lambda f: -f[2])
        print(f"    {len(comunas)} comunas, {sum(c['workers'] for c in comunas.values()):,} ocupados, "
              f"{len(flows):,} flujos entre comunas")
        return {"vintage": "Censo 2024, microdatos (INE, diciembre 2025)", "_files": [FILE],
                "comunas": comunas, "flows": flows}
