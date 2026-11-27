# Traducción de la interfaz al español

La web (`web/`) viene de taiwanciv, que es usaciv de Andrej Karpathy portado a Taiwán con toda la interfaz en chino.
chileciv muestra la **Región Metropolitana de Santiago** y la interfaz va en **español de Chile, neutro**.

Referencias para entender cada texto:

- Versión en inglés de usaciv (mismo código, textos originales): `../ref-usa/src/usaciv/web/` en el scratchpad de la sesión
  (ruta absoluta en el encargo de cada agente). Cuando el chino sea ambiguo, el inglés manda.
- Datos reales que la interfaz muestra: `web/data/*.json` (solo lectura).

## Equivalencias del mapa

| usaciv (EE.UU.) | taiwanciv | chileciv |
|---|---|---|
| state | 縣市 | **provincia** (6: Santiago, Cordillera, Chacabuco, Maipo, Melipilla, Talagante) |
| county | 鄉鎮市區 | **comuna** (52) |
| city / metro | 縣市 | **comuna** (cada comuna es una "ciudad" del mapa) |
| nation / United States | 臺灣 / 全國 | **Región Metropolitana**, "la región", "toda la región" |
| capital (Washington) | 臺北市 | **Santiago** (comuna 13101) |
| USD | NT$ (TWD) | **pesos chilenos** ($, CLP). `format.js` ya formatea |

## Glosario de la interfaz

| Inglés | Chino | Español |
|---|---|---|
| Food / Production / Gold / Science / Culture | 糧食 / 生產 / 金 / 科學 / 文化 | Comida / Producción / Oro / Ciencia / Cultura |
| Yields | 產出 | Rendimientos |
| Almanac | 資料年鑑 | Guía |
| Lens / Lenses | 濾鏡 | Lente / Lentes |
| Advisors | 顧問團 | Consejeros |
| City View | 城市檢視 | Vista de comuna |
| Terrain | 地形 | Terreno |
| Wonders | 奇觀 | Maravillas |
| Resources | 資源 | Recursos |
| Trade routes | 貿易路線 | Rutas comerciales |
| Tile improvements / roads / railroads | 道路、鐵路 | Caminos, autopistas, ferrocarril, Metro |
| Explorer | 探索 | Explorador |
| Share | 分享 | Compartir |
| Search | 搜尋 | Buscar |
| Districts | 城區 | Distritos |
| Citizens | 市民 | Habitantes |
| hex | 六角格 | hexágono |
| foreign land | 境外 | fuera de la región |

## Reglas de estilo (obligatorias)

1. Español neutro de Chile, **sin voseo**: "haz clic", "busca", "elige" (nunca "hacé", "buscá").
2. **Sin guion largo** (—). Usar coma, dos puntos o paréntesis.
3. **Sin comillas latinas** (« »). Usar comillas rectas "así" (en JS, escapadas o con otras comillas).
4. Números con **punto decimal y coma de miles, estilo EE.UU.** (1,234.5). Usar los helpers de `format.js`;
   reemplazar `toLocaleString("zh-TW")` por `toLocaleString("en-US")`. No usar 萬/億: `compact()` ya da "mil", "M",
   "mil M" y "billones".
5. Frases cortas y directas. Nada de "Taiwán", "縣市", "鄉鎮": todo pasa a provincia, comuna y región.
6. Comentarios del código: los que estén en chino se traducen al inglés (el código está comentado en inglés).

## Qué no tocar

- La lógica, los contratos de datos (`docs/DATA_CONTRACTS.md`) y los nombres de campos o ids. Solo textos.
- `web/data/`. Nada de commits: el agente principal revisa y commitea.

## Lógica propia de Taiwán

Si un archivo tiene lógica pensada para Taiwán (normalizar 台 a 臺, el motivo de templo, Kinmen, Penghu, códigos
COUNTYCODE de 5 dígitos o TOWNCODE de 8), dejarla neutra para Chile: códigos de provincia de 3 dígitos (`131`),
de comuna de 5 (`13101`). Si cambiarla no es obvio, no inventar: dejarla y anotarla en el informe.

## Verificación

Después de editar cada archivo JS: `node --check <archivo>`. Al final, ningún carácter chino en los archivos asignados:
`grep -nP '[\x{4e00}-\x{9fff}]' <archivos>` debe salir vacío.
