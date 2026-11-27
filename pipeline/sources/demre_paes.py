"""PAES results by school (DEMRE, Admisión 2026): competence scores per student, aggregated by the school's comuna.

DEMRE publishes per-student open data (Archivo C, "Rendición") in its transparency portal,
https://portal-transparencia.demre.cl/portal-base-datos (linked from https://demre.cl/portales/portal-bases-datos).
The portal hands out a download link only through a reCAPTCHA-protected search that expires after an hour, so there is
no stable URL that `self.download` could fetch. Download "Proceso de Admisión 2026 > Rendición > Archivo C" in a
browser (a .rar), and save it as data/raw/demre_paes/rendicion_2026.rar (data/chile/raw/demre_paes/ for the Chile map);
`fetch` checks it is there. `process` reads the CSV inside with the standard library (macOS `tar -xf` / bsdtar opens the
.rar; it is extracted once next to it). No student-level row leaves this step: only counts and means per comuna.

Rule (documented in the output's "rule"): students of the current graduating cohort (SITUACION_EGRESO 1 or 2:
"Promoción del Año", Chilean school), who took Competencia Lectora and Competencia Matemática 1 in the regular
test (both scores above 0) and whose school has a dependencia group (GRUPO_DEPENDENCIA 1 to 4). The student's score is
(Lectora + M1) / 2; the comuna is the school's (CODIGO_COMUNA), not where the student lives.
"""

from __future__ import annotations

import csv
import shutil
import subprocess

from ..core.mapcfg import keep_region
from ..core.source import Source, SourceInfo

ARCHIVE = "rendicion_2026.rar"
CSV_NAME = "ArchivoC_Adm2026REG.csv"
DEP = {"1": "pagado", "2": "subvencionado", "3": "municipal", "4": "slep"}
COHORT = {"1", "2"}  # SITUACION_EGRESO: Promoción del Año, nacional (alumno regular, validación de estudios)
RULE = ("Estudiantes de la promoción del año (egresados de enseñanza media de ese año, en colegios de Chile) que rindieron "
        "Competencia Lectora y Competencia Matemática 1 en la PAES regular. Puntaje del estudiante = (Lectora + M1) / 2. "
        "La comuna es la del establecimiento de egreso, no la de residencia.")


class DemrePaes(Source):
    info = SourceInfo(
        id="demre_paes",
        title="PAES regular: puntajes por establecimiento, Admisión 2026 (DEMRE)",
        publisher="Departamento de Evaluación, Medición y Registro Educacional (DEMRE), Universidad de Chile",
        homepage="https://demre.cl/portales/portal-bases-datos",
        license="Datos abiertos del DEMRE; ver condiciones de uso en https://demre.cl/portales/condiciones-uso-informacion-datos-abiertos",
        description="Base de datos de Rendición (Archivo C) del Proceso de Admisión 2026: un registro por persona con el "
        "establecimiento de egreso (RBD, comuna y grupo de dependencia) y los puntajes de la PAES regular rendida en "
        "noviembre y diciembre de 2025. Se agregan por comuna del establecimiento y tipo de colegio; no sale ningún "
        "dato individual.",
        used_for=["Lentes de puntaje PAES y brecha entre colegios", "Bloque PAES de la vista de comuna"],
    )

    def fetch(self, force=False):
        if not (self.raw_dir / ARCHIVE).exists() and not (self.raw_dir / CSV_NAME).exists():
            raise SystemExit(
                f"demre_paes: falta {self.raw_dir / ARCHIVE}. El portal del DEMRE entrega el archivo con un enlace que "
                "expira y exige reCAPTCHA: descárgalo a mano en https://portal-transparencia.demre.cl/portal-base-datos "
                "(Proceso de Admisión 2026, tipo Rendición, 'Archivo C') y guárdalo con ese nombre.")
        print(f"    {ARCHIVE} ya está en {self.raw_dir}")

    def _csv(self):
        path = self.raw_dir / CSV_NAME
        if not path.exists():
            subprocess.run(["tar", "-xf", str(self.raw_dir / ARCHIVE), "-C", str(self.raw_dir)], check=True)
            found = next(self.raw_dir.rglob(CSV_NAME))
            shutil.move(found, path)
        return path

    def process(self):
        def new():
            return {"n": 0, "sum": 0.0}

        def add(rec, dep, score):
            for key in ("all", dep):
                rec[key]["n"] += 1
                rec[key]["sum"] += score

        def fin(rec):
            return {k: {"n": v["n"], "mean": round(v["sum"] / v["n"], 2) if v["n"] else None} for k, v in rec.items() if v["n"]}

        blank = lambda: {k: new() for k in ("all", *DEP.values())}  # noqa: E731
        nation, regions, comunas = blank(), {}, {}
        # Each test on its own (every student who took it, any cohort filter as above): comuna → test → {n, sum}
        TESTS = {"lectora": "CLEC_REG_ACTUAL", "m1": "MATE1_REG_ACTUAL", "m2": "MATE2_REG_ACTUAL",
                 "historia": "HCSOC_REG_ACTUAL", "ciencias": "CIEN_REG_ACTUAL"}
        tests_c: dict[str, dict] = {}
        tests_n = {t: new() for t in TESTS}
        kept = 0
        with open(self._csv(), encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f, delimiter=";"):
                dep = DEP.get(row["GRUPO_DEPENDENCIA"])
                if dep is None or row["SITUACION_EGRESO"] not in COHORT:
                    continue
                try:
                    cl, m1 = float(row["CLEC_REG_ACTUAL"]), float(row["MATE1_REG_ACTUAL"])
                except ValueError:
                    continue
                code, region = row["CODIGO_COMUNA"].strip().zfill(5), row["CODIGO_REGION"].strip().zfill(2)
                if row["CODIGO_COMUNA"].strip():
                    for t, col in TESTS.items():
                        try:
                            v = float(row[col])
                        except ValueError:
                            continue
                        if v > 0:
                            tests_n[t]["n"] += 1
                            tests_n[t]["sum"] += v
                            if keep_region(code[:2]):
                                acc = tests_c.setdefault(code, {k: new() for k in TESTS})[t]
                                acc["n"] += 1
                                acc["sum"] += v
                if cl <= 0 or m1 <= 0 or not row["CODIGO_COMUNA"].strip():
                    continue
                score = (cl + m1) / 2
                add(nation, dep, score)
                add(regions.setdefault(region, blank()), dep, score)
                if keep_region(code[:2]):
                    add(comunas.setdefault(code, blank()), dep, score)
                    kept += 1
        print(f"    {nation['all']['n']:,} estudiantes en el país, {kept:,} en este mapa, {len(comunas)} comunas")
        return {"vintage": "PAES regular, Admisión 2026 (DEMRE; prueba rendida en noviembre y diciembre de 2025)",
                "_files": [ARCHIVE], "rule": RULE, "national": fin(nation),
                "regions": {r: fin(v) for r, v in sorted(regions.items())},
                "comunas": {c: fin(v) for c, v in sorted(comunas.items())},
                "tests_national": fin(tests_n),
                "tests": {c: fin(v) for c, v in sorted(tests_c.items())}}
