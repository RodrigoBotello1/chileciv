# chileciv: Chile como mapa de estrategia

Visualizador (no es un juego) que dibuja **Chile continental** como un mapa de estrategia por turnos, a partir de datos
públicos reales: 343 comunas, 16 regiones y unos 11,800 hexágonos de 5 km de radio, de Arica a Magallanes (Rapa Nui,
Juan Fernández y la Antártica quedan fuera). El relieve, la cobertura del suelo y el clima salen de datos satelitales y
científicos; las comunas muestran población, educación, trabajo, vivienda y economía del Censo 2024, el SII, el DEMRE y
el Banco Central; y cada número se puede rastrear hasta su fuente en la **Guía** de la app.

Sitio publicado: https://rodrigobotello1.github.io/chileciv/

Es un sitio estático: módulos ES y Canvas 2D, sin framework ni build. Los datos los genera un pipeline en Python que
usa solo la biblioteca estándar (salvo los microdatos del Censo, en Parquet, que se leen con DuckDB:
`uv run --with duckdb python -m pipeline process ine_censo_od`).

## Créditos

- [usaciv](https://karpathy.ai/usaciv) de Andrej Karpathy (MIT): la idea, el motor del mapa y la interfaz.
- [taiwanciv](https://github.com/i-am-alvin/taiwanciv) de i-am-alvin (MIT): el port a Taiwán sobre el que se
  construyó este.
- El arte es original, dibujado en código. Este proyecto no está afiliado a ninguna editorial de videojuegos.

## Cómo correrlo

Requiere [uv](https://docs.astral.sh/uv/). Desde la raíz del repo:

```
uv run python -m pipeline serve   # sirve web/ en http://127.0.0.1:8765
uv run python -m pipeline all     # descarga, procesa y construye todo desde las fuentes, y corre el check
uv run python -m pipeline check   # solo la validación de calidad de web/data
uv run python -m pipeline list    # fuentes y constructores registrados
```

`web/data/` ya trae los datos construidos, así que `serve` basta para ver el mapa.

## Tamaño del hexágono

Radio de 5 km (unos 65 km² por hexágono). Chile continental cubre unos 11,800 hexágonos. La configuración de una versión de la Región Metropolitana con hexágonos de 1 km sigue en `pipeline/core/mapcfg.py` (`CHILECIV_MAP=rm`), pero no se publica.

## Fuentes de datos

| Fuente | Qué es | Qué alimenta |
|---|---|---|
| `bcch_pib_regional` | Producto interno bruto por región, nominal (Banco Central de Chile) | PIB regional y su aporte al PIB de Chile (mapa de Chile) |
| `cl_boundaries` | Límites comunales de Chile (BCN) | Comuna y región de cada hexágono, Bordes de región |
| `cl_rivers` | Ríos (relaciones waterway=river de OpenStreetMap) | Ríos |
| `cr2met` | CR2MET v2.5: precipitación anual y días con lluvia, normal 1991-2020 | Lente de lluvia anual, Lente de días con lluvia |
| `demre_paes` | PAES regular: puntajes por establecimiento, Admisión 2026 (DEMRE) | Lentes de puntaje PAES y brecha entre colegios, Bloque PAES de la vista de comuna |
| `gvp_volcanes` | Volcanes del Holoceno de Chile (Global Volcanism Program) | Maravillas: volcanes |
| `ine_censo2024` | Censo de Población y Vivienda 2024: población censada por sexo y edad | Población de comunas y provincias, Pirámide de edades, Códigos oficiales de comuna |
| `ine_censo_od` | Censo 2024: comuna donde trabajan las personas y medio de transporte (microdatos) | Flujos de viaje al trabajo entre comunas, Lentes de trabajo en otra comuna y medio de transporte, Nivel educativo de los adultos (CINE 2011), Ocupados por comuna |
| `ine_censo_tablas` | Censo 2024: tabulados comunales (edad, migración, educación, religión, pueblos indígenas, vivienda y hogar) | Lentes de la región, Habitantes de la vista de comuna, Crecimiento 2017-2024 |
| `natural_earth` | Natural Earth 1:10m (países y lagos) y 1:50m (ríos) | Tierra fuera de la región (resto de Chile y Argentina), Costa, Lagos |
| `ne_roads_cl` | Rutas y ferrocarriles de Chile (Natural Earth 1:10m) | Rutas en el mapa de Chile, Ferrocarril en el mapa de Chile |
| `osm_rm_transport` | Autopistas, rutas principales, ferrocarril, Metro y aeropuertos (OpenStreetMap) | Autopistas y rutas en el mapa, Ferrocarril y Metro en el mapa, Posición de los aeropuertos |
| `sii_empresas` | Estadísticas de empresas por comuna y rubro económico | Oro (ventas), Trabajadores por rubro (comida, producción, ciencia, cultura) |
| `srtm15` | SRTM15+ global relief model (V2) | Relief (hills, mountains, peaks), Hill-shading, Ocean depth |
| `uf` | Unidad de Fomento al 31 de diciembre | Oro en pesos |
| `usgs_sismos` | Terremotos de magnitud 6 o más desde 1900 (catálogo ComCat del USGS) | Lente de sismos fuertes |
| `wikidata_rm` | Monumentos, áreas protegidas, universidades, edificios, centrales, minas y centros de ski (Wikidata) | Maravillas: monumentos, naturaleza, universidades y rascacielos, Recursos: centrales eléctricas y minas |
| `worldclim` | WorldClim 2.1: precipitación anual y temperatura media (normales 1970-2000) | Lente de lluvia anual, Lente de temperatura media |
| `worldcover` | ESA WorldCover 10 m 2021 v200 | Hex land cover (biomes), Forest / cropland / built-up shares of each hex |

## Límites que conviene saber

- **Las empresas se cuentan en la comuna de su casa matriz.** El SII asigna cada empresa a su domicilio tributario, no
  a donde trabaja su gente. Por eso, por ejemplo, Las Condes muestra empleo minero: son oficinas centrales de mineras
  cuyas faenas están en otras regiones.
- **Chile no tiene PIB por comuna.** "Oro" son las ventas anuales del SII convertidas a pesos, no valor agregado, y
  tiene el mismo sesgo de casa matriz.
- **Los datos son por comuna, no por hexágono.** Cada valor comunal se reparte entre los hexágonos de la comuna
  (la población, ponderada por la tierra que cubre cada hexágono). Un hexágono que cruza dos comunas muestra un
  promedio, y dentro de una comuna no hay variación real.
- **Sin ingreso, arriendo ni valor de vivienda por comuna** en una base común: esos campos quedan en `null`, no en cero.

## Estructura

- `pipeline/`: fuentes (`sources/`), constructores (`build/`) y `check.py`, la validación de `web/data`.
- `web/`: el sitio estático.
- `docs/`: [contratos de datos](docs/DATA_CONTRACTS.md), [glosario y estilo en español](docs/TRADUCCION.md).

## Licencia

MIT, ver [LICENSE](LICENSE). Los datos conservan las licencias de sus fuentes.
