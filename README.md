# chileciv: la Región Metropolitana de Santiago como mapa de estrategia

Visualizador (no es un juego) que dibuja la **Región Metropolitana de Santiago** como un mapa de estrategia por
turnos, a partir de datos públicos reales: 52 comunas, 6 provincias y hexágonos de 1 km de radio (unos 5,900 dentro de
la región). El relieve y la cobertura del suelo salen de datos satelitales, las comunas muestran rendimientos
(Comida, Producción, Oro, Ciencia, Cultura) calculados con el Censo 2024 y las estadísticas de empresas del SII, y
cada número se puede rastrear hasta su fuente en el **Almanaque** de la app.

Es un sitio estático: módulos ES y Canvas 2D, sin framework ni build. Los datos los genera un pipeline en Python que
usa solo la biblioteca estándar, con descargas públicas que no piden claves.

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

Radio de 1 km (unos 2.6 km² por hexágono). La región cubre unos 5,900 hexágonos.

## Fuentes de datos

| Fuente | Qué es | Qué alimenta |
|---|---|---|
| `cl_boundaries` | Límites comunales (geoBoundaries ADM3, desde la BCN) | Contornos de comunas y provincias |
| `ine_censo2024` | Censo 2024 del INE: población por comuna, sexo y edad | Población, densidad, crecimiento, pirámide de edad |
| `ine_censo_tablas` | Tabulados comunales del Censo 2024 (migración, educación, religión, pueblos indígenas, vivienda, hogar) | Lentes demográficos y Vista de comuna |
| `sii_empresas` | Empresas, ventas y trabajadores por comuna y rubro (SII) | Rendimientos (Comida, Producción, Ciencia, Cultura), Oro, distritos |
| `uf` | Valor de la UF al 31 de diciembre (SII) | Convierte ventas de UF a pesos |
| `srtm15` | Relieve SRTM15+ | Elevación y relieve |
| `worldcover` | Cobertura del suelo ESA WorldCover 10 m (2021) | Terreno: bosque, cultivos, matorral, urbano |
| `natural_earth` | Natural Earth 1:10m y 1:50m | Entorno fuera de la región, lagos y ríos de fondo |
| `cl_rivers` | Ríos de la región (OpenStreetMap) | Ríos del mapa |
| `wikidata_rm` | Monumentos, áreas protegidas, universidades y edificios (Wikidata) | Maravillas |
| `osm_rm_transport` | Autopistas, rutas, ferrocarril, Metro y aeropuertos (OpenStreetMap) | Infraestructura (en construcción, aún sin salida en `web/data`) |

Las licencias y los archivos exactos de cada fuente están en el Almanaque y en `web/data/sources.json`.

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
