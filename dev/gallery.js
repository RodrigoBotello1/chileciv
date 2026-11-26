// Art gallery: every piece of tile art side by side, drawn by the REAL art modules (render/art/*, icons.js,
// banners.js), so an artist's change shows up on reload. Open http://127.0.0.1:8765/dev/art.html.
//
// Sections: terrain specimens (cover × relief at four zoom tiers), a synthetic landscape rendered by map.js
// drawStatic (coast, lake, river, borders, cities), city tiles by population, water pieces, the static map layers
// (roads, rail, ports, airports, forts, ranges, wonders, trade) on the landscape, every site glyph, citizen figures,
// every icon, banners.
// Everything here is synthetic except the banners, which use real cities from data/cities.json.
import { prepareWorld, applyLens, terrainColors } from "../js/world.js";
import { resolveTables, COVER } from "../js/terrain.js";
import { STATE_PALETTE } from "../js/color.js";
import { drawStatic } from "../js/render/map.js";
import { drawTerrainGlyphs, GLYPHS_MIN_RPX, terrainArtStats } from "../js/render/art/terrain.js";
import { drawCityTile, cityTileVisible, cityIsDot, cityClass } from "../js/render/art/city.js";
import { drawOceanTexture, drawWaterGlyphs, drawRivers } from "../js/render/art/water.js";
import { lodFor } from "../js/render/art/lod.js";
import { drawIcon, ICON_IDS, ALIASES } from "../js/icons.js";
import { drawBanners } from "../js/render/banners.js";
import { drawPort, drawAirport, drawTradeMarker, MODE_STYLE } from "../js/render/art/improvements.js";
import { drawFort, drawWonder, drawPlaque, WONDER_MOTIFS, MOTIF_LABELS } from "../js/render/art/sites.js";
import { drawCitizen, citizenSVG, CITIZEN_KINDS, CITIZEN_ROWS } from "../js/render/art/people.js";
import { createModel, SITE_RULES } from "../js/ext/layers/model.js";
import { makeLayers } from "../js/ext/layers/layers.js";

const R = 25; // km, as in world.json
const TIERS = [8, 14, 28, 60]; // hex radius in css px: far, mid, near, close
const DPR = Math.min(2, window.devicePixelRatio || 1);
const opts = { outline: false, lodLabels: true };
const LABEL = "600 11px -apple-system, system-ui, sans-serif";
const SERIF = '12px "Palatino Linotype", Palatino, Georgia, serif';
const inkColor = () => getComputedStyle(document.body).getPropertyValue("--ink").trim() || "#efe4c6";
const dimColor = () => getComputedStyle(document.body).getPropertyValue("--ink-dim").trim() || "#b9ab88";

// --- helpers -----------------------------------------------------------------------------------------------------

function makeCanvas(host, cssW, cssH) {
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(cssW * DPR);
  cv.height = Math.ceil(cssH * DPR);
  cv.style.width = `${cssW}px`;
  cv.style.height = `${cssH}px`;
  const wrap = document.createElement("div");
  wrap.className = "scroll";
  wrap.appendChild(cv);
  host.appendChild(wrap);
  const ctx = cv.getContext("2d");
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  return ctx;
}

function section(id, title, text) {
  const s = document.createElement("section");
  s.id = id;
  s.innerHTML = `<h2>${title}</h2>${text ? `<p>${text}</p>` : ""}`;
  document.getElementById("gallery").appendChild(s);
  return s;
}

function tierBlock(host, title, note = "") {
  const d = document.createElement("div");
  d.className = "tier";
  d.innerHTML = `<h3>${title}${note ? `<span class="muted">${note}</span>` : ""}</h3>`;
  host.appendChild(d);
  return d;
}

const tierName = (Rpx) => `${lodFor(Rpx)} · R ${Rpx}px`;

function text(ctx, str, x, y, { font = LABEL, color = inkColor(), align = "center", base = "middle" } = {}) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(str, x, y);
}

/** Put world point (wx, wy) at css (px, py) with `s` css px per km. */
function worldAt(ctx, px, py, wx, wy, s) {
  ctx.setTransform(DPR * s, 0, 0, DPR * s, DPR * (px - wx * s), DPR * (py - wy * s));
}

function hexPathAt(ctx, grid, i, f = 1) {
  const x = grid.cx(i), y = grid.cy(i);
  ctx.beginPath();
  ctx.moveTo(x + grid.corners[0][0] * f, y + grid.corners[0][1] * f);
  for (let k = 1; k < 6; k++) ctx.lineTo(x + grid.corners[k][0] * f, y + grid.corners[k][1] * f);
  ctx.closePath();
}

// A world.json-shaped object for prepareWorld(). cell(c, r) → {owner, water, relief, cover, elev, pct: {..}}.
function synthWorld(cols, rows, cell, { rivers = [], states = 2 } = {}) {
  const n = cols * rows;
  const W = Math.sqrt(3) * R, H = 1.5 * R;
  const keys = ["forest", "crop", "pasture", "grass", "shrub", "wetland", "developed"];
  const world = {
    version: 2, grid: { radius: R, cols, rows }, width: cols * W + W / 2, height: (rows - 1) * H + 2 * R, margin: 0,
    owner: new Array(n), county: new Array(n).fill(-1), elev: new Array(n), water: new Array(n), relief: new Array(n),
    cover: new Array(n), pct: Object.fromEntries(keys.map((k) => [k, new Array(n).fill(0)])),
    tables: resolveTables(null),
    states: [{ fips: "90", abbr: "A", name: "Provincia A" }, { fips: "91", abbr: "B", name: "Provincia B" }].slice(0, states),
    counties: [], rivers,
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const d = cell(c, r);
      world.owner[i] = d.owner ?? 0;
      world.water[i] = d.water ?? 0;
      world.relief[i] = d.water ? 0 : d.relief ?? 0;
      world.cover[i] = d.water ? 0 : d.cover ?? 0;
      world.elev[i] = d.elev ?? 200;
      for (const [k, v] of Object.entries(d.pct || {})) world.pct[k][i] = v;
    }
  }
  return world;
}

const PCT_KEY = { 1: "forest", 2: "forest", 3: "forest", 4: "shrub", 5: "grass", 6: "pasture", 7: "crop", 8: "wetland", 9: "developed" };
const RELIEF_ELEV = [250, 650, 1900, 3200];

// --- 1. terrain specimens --------------------------------------------------------------------------------------

function renderTerrain() {
  const sec = section("terrain", "Terreno: cobertura × relieve",
    "Cada hexágono: primero el color base de world.js y luego el patrón de <code>drawTerrainGlyphs()</code> en <code>render/art/terrain.js</code>." +
    "Cada columna es una cobertura de world.json (la última es tierra fuera de la región, dibujada como niebla de guerra); cada fila es un relieve," +
    "más llanura y lomaje con 35% de bosque. El sombreado de hexágonos está apagado para que todas las muestras tengan la misma luz.");
  const covers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, "foreign"];
  const rowsSpec = [
    { name: "Llanura", relief: 0 }, { name: "Lomaje", relief: 1 }, { name: "Montaña", relief: 2 }, { name: "Alta montaña", relief: 3 },
    { name: "Llanura, 35% bosque", relief: 0, forest: 35 }, { name: "Lomaje, 35% bosque", relief: 1, forest: 35 },
  ];
  const tables = resolveTables(null);
  const coverName = (c) => (c === "foreign" ? "Fuera de la región" : tables.cover.find((t) => t.id === c)?.name ?? `Cobertura ${c}`);
  const world = synthWorld(covers.length, rowsSpec.length, (c, r) => {
    const cv = covers[c], rs = rowsSpec[r];
    if (cv === "foreign") return { owner: -2, cover: 0, relief: rs.relief, elev: RELIEF_ELEV[rs.relief] };
    const pct = {};
    if (PCT_KEY[cv]) pct[PCT_KEY[cv]] = rs.forest ? 55 : 85;
    if (rs.forest && PCT_KEY[cv] !== "forest") pct.forest = rs.forest;
    if (rs.forest && PCT_KEY[cv] === "forest") pct.forest = 90;
    return { owner: 0, cover: cv, relief: rs.relief, elev: RELIEF_ELEV[rs.relief], pct };
  });
  const w = prepareWorld(world, []);
  w.shadeK.fill(0); // even lighting for specimens
  w.terrainColors = terrainColors(w);
  applyLens(w, null);
  const { grid } = w;

  for (const Rpx of TIERS) {
    const s = Rpx / R;
    const colW = Math.max(Math.sqrt(3) * Rpx + 26, 92), rowH = Math.max(2 * Rpx + 26, 44);
    const left = 120, top = 40;
    const cssW = left + colW * covers.length + 10, cssH = top + rowH * rowsSpec.length + 8;
    const ctx = makeCanvas(tierBlock(sec, tierName(Rpx), Rpx <= GLYPHS_MIN_RPX ? "glyphs are off at this size (flat colour only)" : ""), cssW, cssH);
    covers.forEach((cv, c) => {
      const name = coverName(cv);
      const words = name.split(" ");
      const half = Math.ceil(words.length / 2);
      const lines = words.length > 1 && name.length > 12 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : [name];
      lines.forEach((ln, k) => text(ctx, ln, left + colW * (c + 0.5), 12 + k * 13, { font: "600 11px -apple-system, system-ui, sans-serif" }));
    });
    rowsSpec.forEach((rs, r) => {
      text(ctx, rs.name, 8, top + rowH * (r + 0.5), { align: "left", color: dimColor() });
      covers.forEach((_, c) => {
        const i = r * grid.cols + c;
        const px = left + colW * (c + 0.5), py = top + rowH * (r + 0.5);
        worldAt(ctx, px, py, grid.cx(i), grid.cy(i), s);
        hexPathAt(ctx, grid, i);
        ctx.fillStyle = w.colors[i];
        ctx.fill();
        if (opts.outline || Rpx > 11) {
          ctx.strokeStyle = opts.outline ? "rgba(255,240,200,.5)" : "rgba(0,0,0,.14)";
          ctx.lineWidth = 1 / s;
          ctx.stroke();
        }
        if (Rpx > GLYPHS_MIN_RPX) drawTerrainGlyphs(ctx, [i], w, { Rpx, s, lod: lodFor(Rpx) });
      });
    });
  }
}

// --- 2. landscape scene (map.js drawStatic on a synthetic world) ----------------------------------------------------

function sceneWorld() {
  const cols = 26, rows = 16;
  const cityCells = new Map([[11 * cols + 8, 5.2e6], [8 * cols + 14, 3.1e5], [12 * cols + 19, 6.3e6], [4 * cols + 9, 7e4]]);
  const lake = new Set([6 * cols + 10, 6 * cols + 11, 7 * cols + 10, 5 * cols + 11]);
  const urban = new Set([10 * cols + 8, 11 * cols + 7, 11 * cols + 9, 12 * cols + 8, 12 * cols + 7, 11 * cols + 19, 12 * cols + 20]);
  const world = synthWorld(cols, rows, (c, r) => {
    const i = r * cols + c;
    if (c <= 3) return { owner: -1, water: 1, elev: -3600 + c * 900 };
    if (c === 4 || (c === 5 && (r < 4 || r > 13))) return { owner: -1, water: 2, elev: -60 };
    if (r <= 1) return { owner: -2, cover: 0, relief: c > 20 ? 2 : 0, elev: c > 20 ? 1800 : 300 };
    if (lake.has(i)) return { owner: 0, water: 3, elev: -20 };
    const owner = c < 16 ? 0 : 1;
    const base = { owner, relief: 0, elev: 200 + c * 40 };
    if (urban.has(i)) return { ...base, cover: COVER.URBAN, pct: { developed: 70, grass: 20 } };
    if (cityCells.has(i)) return { ...base, cover: COVER.URBAN, pct: { developed: 80 } };
    if (c <= 6) return { ...base, cover: COVER.WETLAND, pct: { wetland: 70, forest: 20 } };
    if (c <= 8) return { ...base, cover: COVER.CROP, pct: { crop: 80 } };
    if (c === 9) return { ...base, cover: COVER.PASTURE, pct: { pasture: 70, forest: 20 } };
    if (c <= 11) return { ...base, cover: r % 3 ? COVER.DECIDUOUS : COVER.MIXED, pct: { forest: 85 } };
    if (c <= 13) return { ...base, cover: COVER.GRASS, pct: { grass: 80 } };
    if (c <= 15) return { ...base, cover: COVER.SCRUB, pct: { shrub: 80 }, elev: 900 };
    if (c <= 17) return { ...base, cover: r % 4 ? COVER.SCRUB : COVER.BARREN, pct: { shrub: 50 }, relief: r % 2, elev: 1200 };
    if (c <= 21) return { ...base, cover: COVER.EVERGREEN, pct: { forest: 85 }, relief: c >= 20 ? 1 : 0, elev: 1400 + (c - 18) * 200 };
    if (c <= 23) return { ...base, cover: COVER.EVERGREEN, pct: { forest: 50 }, relief: 2, elev: 2300 };
    return { ...base, cover: r < 8 ? COVER.ICE : COVER.BARREN, relief: 3, elev: 3400 };
  });
  const g = { W: Math.sqrt(3) * R, H: 1.5 * R };
  const at = (c, r) => [g.W * (c + 0.5 * (r & 1)), g.H * r];
  world.rivers = [
    { name: "Río grande", rank: 2, pts: [...at(22.6, 2), ...at(20, 4.2), ...at(17, 5.6), ...at(14, 6.4), ...at(11.5, 6.4)] },
    { name: "Tramo bajo", rank: 3, pts: [...at(10, 7.4), ...at(8.4, 8.8), ...at(6.5, 9.4), ...at(4.6, 9.8)] },
    { name: "Estero", rank: 6, pts: [...at(16.4, 12.6), ...at(14, 11), ...at(13, 8.6)] },
  ];
  const cities = [...cityCells].map(([cell, population], k) => ({
    id: `9000${k}`, name: ["Puerto", "Villa", "Capital", "Pinar"][k], cell, population, capital: k === 2,
  }));
  const w = prepareWorld(world, cities);
  applyLens(w, null);
  return w;
}

function renderScene() {
  const sec = section("scene", "Paisaje",
    "Un mapa sintético que <code>render/map.js drawStatic()</code> dibuja igual que el mapa real: océano, costa, lagos," +
    "ríos, dos provincias con sus bandas de borde, tierra fuera de la región al norte, periferia y cuatro comunas (una es la capital). La niebla de borde está apagada.");
  const w = sceneWorld();
  const W = w.raw.width, H = w.raw.height;
  for (const Rpx of TIERS) {
    const s = Rpx / R;
    // The close tier shows the middle of the scene only.
    const crop = Rpx >= 44 ? { x0: W * 0.18, y0: H * 0.18, x1: W * 0.68, y1: H * 0.92 } : { x0: 0, y0: 0, x1: W, y1: H };
    const cssW = Math.ceil((crop.x1 - crop.x0) * s), cssH = Math.ceil((crop.y1 - crop.y0) * s);
    const ctx = makeCanvas(tierBlock(sec, tierName(Rpx), Rpx >= 44 ? "Recorte central" : ""), cssW, cssH);
    drawStatic(ctx, { ...crop, s, dpr: DPR, cssW, cssH }, w, { lens: null, showResources: false, edgeFog: false, labels: true });
    if (opts.outline) {
      ctx.setTransform(DPR * s, 0, 0, DPR * s, -crop.x0 * DPR * s, -crop.y0 * DPR * s);
      ctx.beginPath();
      for (let i = 0; i < w.grid.size; i++) {
        const x = w.grid.cx(i), y = w.grid.cy(i);
        ctx.moveTo(x + w.grid.corners[0][0], y + w.grid.corners[0][1]);
        for (let k = 1; k < 6; k++) ctx.lineTo(x + w.grid.corners[k][0], y + w.grid.corners[k][1]);
        ctx.closePath();
      }
      ctx.strokeStyle = "rgba(255,240,200,.35)";
      ctx.lineWidth = 1 / s;
      ctx.stroke();
    }
  }
}

// --- 3. city tiles ------------------------------------------------------------------------------------------------

function renderCities() {
  const sec = section("cities", "Hexágonos de comuna",
    "<code>render/art/city.js drawCityTile()</code> dibuja sobre pasto, por tramo de población, más la capital." +
    "Al alejar, la comuna pasa a ser un punto (<code>cityIsDot</code>) o se oculta (<code>cityTileVisible</code>).");
  // One population per size class (render/art/city.js cityClass), labelled with the class.
  const pops = [8e4, 2.5e5, 8e5, 3e6, 2e7];
  const specs = pops.map((p, k) => ({ id: `c${k}`, name: `${p}`, population: p, capital: false, label: `${cityClass(p).id} · ${fmtPop(p)}` }));
  specs.push({ id: "cap", name: "Capital", population: 2.4e6, capital: true, label: "Capital (2.4 M)" });
  const grass = "rgb(150,170,92)";
  for (const Rpx of TIERS) {
    const s = Rpx / R;
    const colW = Math.max(Math.sqrt(3) * Rpx + 40, 110), rowH = Math.max(2 * Rpx + 34, 60);
    const cssW = colW * specs.length + 10, cssH = rowH + 26;
    const ctx = makeCanvas(tierBlock(sec, tierName(Rpx)), cssW, cssH);
    specs.forEach((city, k) => {
      const px = colW * (k + 0.5), py = 22 + rowH / 2;
      text(ctx, city.label, px, 10, { color: dimColor() });
      // A plain land hex under the city (world units around (0, 0)).
      worldAt(ctx, px, py, 0, 0, s);
      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        const a = ((60 * j - 30) * Math.PI) / 180;
        const x = R * Math.cos(a), y = R * Math.sin(a);
        j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = grass;
      ctx.fill();
      ctx.strokeStyle = opts.outline ? "rgba(255,240,200,.5)" : "rgba(0,0,0,.2)";
      ctx.lineWidth = 1 / s;
      ctx.stroke();
      if (!cityTileVisible(city, Rpx)) {
        text(ctx, "oculta", px, py, { color: "rgba(30,20,10,.7)" });
        return;
      }
      worldAt(ctx, px, py, 0, 0, s);
      drawCityTile(ctx, city, 0, 0, R, { Rpx, s, lod: lodFor(Rpx), stateColor: STATE_PALETTE[k % STATE_PALETTE.length], seed: 1000 + k * 37 });
      if (opts.lodLabels) text(ctx, cityIsDot(city, Rpx) ? "punto" : "hex", px, py + rowH / 2 - 2, { color: dimColor(), font: "10px -apple-system, system-ui, sans-serif" });
    });
  }
}

const fmtPop = (p) => `${(p / 1e6).toFixed(p < 1e6 ? 2 : 1)} M`;

// --- 4. water ----------------------------------------------------------------------------------------------------

function renderWater() {
  const sec = section("water", "Agua",
    "Hexágonos de agua (mar profundo, océano, costa, lago), con la textura de ondas de <code>drawWaterGlyphs()</code> en <code>render/art/water.js</code>," +
    "y los ríos dibujados sobre tierra por orden (1 = el mayor). La espuma de la costa se ve en el paisaje de arriba.");
  const kinds = [
    { name: "Mar profundo", water: 1, elev: -4000 }, { name: "Océano", water: 1, elev: -900 },
    { name: "Costa", water: 2, elev: -60 }, { name: "Lago", water: 3, elev: -20 }, { name: "Tierra", water: 0, elev: 200 },
  ];
  const world = synthWorld(kinds.length, 1, (c) => {
    const k = kinds[c];
    return k.water ? { owner: -1, water: k.water, elev: k.elev } : { owner: 0, cover: COVER.GRASS, elev: k.elev, pct: { grass: 80 } };
  }, { states: 1 });
  const w = prepareWorld(world, []);
  w.shadeK.fill(0);
  w.terrainColors = terrainColors(w);
  applyLens(w, null);
  const { grid } = w;
  for (const Rpx of TIERS) {
    const s = Rpx / R;
    const colW = Math.max(Math.sqrt(3) * Rpx + 30, 100), rowH = Math.max(2 * Rpx + 26, 50);
    const riverW = Math.max(240, 8 * Rpx);
    const cssW = colW * kinds.length + riverW + 30, cssH = rowH + 26;
    const ctx = makeCanvas(tierBlock(sec, tierName(Rpx)), cssW, cssH);
    kinds.forEach((k, c) => {
      const px = colW * (c + 0.5), py = 22 + rowH / 2;
      text(ctx, k.name, px, 10, { color: dimColor() });
      const i = c;
      worldAt(ctx, px, py, grid.cx(i), grid.cy(i), s);
      hexPathAt(ctx, grid, i);
      ctx.fillStyle = w.colors[i];
      ctx.fill();
      if (k.water) {
        ctx.save();
        ctx.clip();
        // The texture is screen-space: give it a viewport whose origin puts this hex where it is on the canvas.
        const vp = { x0: grid.cx(i) - px / s, y0: grid.cy(i) - py / s, s, dpr: DPR };
        drawOceanTexture(ctx, vp);
        ctx.restore();
        worldAt(ctx, px, py, grid.cx(i), grid.cy(i), s);
        drawWaterGlyphs(ctx, [i], w, { Rpx, s, lod: lodFor(Rpx) });
      }
      if (opts.outline) {
        worldAt(ctx, px, py, grid.cx(i), grid.cy(i), s);
        hexPathAt(ctx, grid, i);
        ctx.strokeStyle = "rgba(255,240,200,.5)";
        ctx.lineWidth = 1 / s;
        ctx.stroke();
      }
    });
    // Rivers by rank on a land strip.
    const x0 = colW * kinds.length + 20, y0 = 22, h = rowH;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = w.colors[kinds.length - 1];
    ctx.fillRect(x0, y0, riverW, h);
    text(ctx, "Ríos, orden 1 · 3 · 5 · 8", x0 + riverW / 2, 10, { color: dimColor() });
    const ranks = [1, 3, 5, 8];
    const fake = {
      raw: {
        rivers: ranks.map((rank, k) => {
          const ry = (y0 + (h * (k + 0.6)) / (ranks.length + 0.2)) / s;
          const pts = [];
          for (let t = 0; t <= 12; t++) pts.push((x0 + 6 + (t / 12) * (riverW - 12)) / s, ry + Math.sin(t * 0.9 + k) * (h * 0.06) / s);
          return { name: `Orden ${rank}`, rank, pts };
        }),
      },
    };
    ctx.setTransform(DPR * s, 0, 0, DPR * s, 0, 0);
    drawRivers(ctx, fake, { s, Rpx, lod: lodFor(Rpx), lens: false });
  }
}

// --- 5. icons ------------------------------------------------------------------------------------------------------

function renderIcons() {
  const ids = ICON_IDS.filter((id) => !(id in ALIASES)).sort();
  const sec = section("icons", `Íconos (${ids.length})`,
    "Cada ícono de <code>icons.js</code>, dibujado con <code>drawIcon()</code> como en el mapa: sellos redondos de 14, 20 y 32 px, más la forma simple de 32 px." +
    "Sin alias.");
  const cellW = 150, cellH = 64, perRow = Math.max(1, Math.floor((Math.min(window.innerWidth, 1800) - 60) / cellW));
  const rows = Math.ceil(ids.length / perRow);
  const ctx = makeCanvas(sec, cellW * perRow + 10, rows * cellH + 10);
  ids.forEach((id, k) => {
    const x = (k % perRow) * cellW + 8, y = Math.floor(k / perRow) * cellH + 6;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    let cx = x + 10;
    for (const size of [14, 20, 32]) {
      drawIcon(ctx, id, cx, y + 22, size);
      cx += size + 8;
    }
    drawIcon(ctx, id, cx + 12, y + 22, 32, { medallion: false, color: "#f8f0d8" });
    text(ctx, id, x + cellW / 2 - 8, y + 50, { color: dimColor(), font: "10.5px ui-monospace, Menlo, monospace" });
  });
  // Resource medallions with the value-pip ring (map.js passes 1–5 pips from the site's size within its type).
  const pipIds = ["r-nuclear", "r-wind", "r-solar", "r-coal_mine", "r-oil"].filter((id) => ICON_IDS.includes(id));
  if (pipIds.length) {
    const c2 = makeCanvas(tierBlock(sec, "Puntos de valor (1–5), 24 px"), 5 * 44 * pipIds.length / 2 + 40, 6 + 40 * Math.ceil(pipIds.length / 2));
    c2.setTransform(DPR, 0, 0, DPR, 0, 0);
    pipIds.forEach((id, k) => {
      for (let p = 1; p <= 5; p++) drawIcon(c2, id, 24 + ((k % 2) * 5 + p - 1) * 44, 24 + Math.floor(k / 2) * 40, 24, { pips: p });
    });
  }
}

// --- 6. banners ----------------------------------------------------------------------------------------------------

async function renderBanners() {
  const sec = section("banners", "Banderas de comuna",
    "<code>render/banners.js drawBanners()</code> con comunas reales: nombre corto y largo, con y sin cifra de crecimiento," +
    "la capital y la comuna seleccionada; primero como se ve alejado (placa) y luego acercado (con la fila de rendimientos).");
  let cities, nation;
  try {
    [cities, nation] = await Promise.all(["cities", "nation"].map((n) => fetch(`../data/${n}.json`).then((r) => {
      if (!r.ok) throw new Error(`data/${n}.json: HTTP ${r.status}`);
      return r.json();
    })));
  } catch (err) {
    sec.insertAdjacentHTML("beforeend", `<p class="err">No se pudieron cargar los datos de las banderas de comuna（${err.message}）。</p>`);
    return;
  }
  const big = cities.filter((c) => c.population >= 1e5 && c.cell != null);
  const byLen = [...big].sort((a, b) => a.name.length - b.name.length);
  const pick = [
    { c: byLen[0], note: "Nombre corto" },
    { c: byLen[byLen.length - 1], note: "Nombre largo" },
    { c: big.find((c) => Number.isFinite(c.growth) && c.growth > 0.05) || big[3], note: "Crecimiento rápido" },
    { c: big.find((c) => Number.isFinite(c.growth) && c.growth < 0) || big[5], note: "Población en baja" },
    { c: { ...big[1], id: `${big[1].id}-nogrowth`, growth: null }, note: "Sin dato de crecimiento" },
    { c: cities.find((c) => c.capital) || cities.find((c) => c.id === "13101"), note: "Capital" },
    { c: big[0], note: "Seleccionada", selected: true },
  ].filter((p) => p.c);
  for (const Rpx of [6, 16, 30]) {
    const colW = Rpx > 24 ? 300 : Rpx < 8 ? 200 : 250, rowH = Rpx > 24 ? 92 : 70;
    const perRow = Math.max(1, Math.floor((Math.min(window.innerWidth, 1800) - 60) / colW));
    const rows = Math.ceil(pick.length / perRow);
    const cssW = colW * Math.min(perRow, pick.length) + 10, cssH = rows * rowH + 10;
    const ctx = makeCanvas(tierBlock(sec, Rpx > 24 ? "Acercado (R 30px)" : Rpx < 8 ? "Vista regional (R 6px, placa reducida)" : "Alejado (R 16px)"), cssW, cssH);
    // A fake world/camera: city k sits at "cell" k, whose centre is where its banner should stand.
    const pos = pick.map((p, k) => [colW * ((k % perRow) + 0.5), Math.floor(k / perRow) * rowH + rowH - 18]);
    const list = pick.map((p, k) => ({ ...p.c, cell: k, population: Math.max(p.c.population, 1e5) }));
    const w = {
      grid: { R: Rpx, cx: (i) => pos[i][0], cy: (i) => pos[i][1] },
      raw: { owner: pick.map((_, k) => k % STATE_PALETTE.length) },
      stateColor: STATE_PALETTE, dim: null,
    };
    const cam = { scale: 1, w: cssW, h: cssH, toScreen: (x, y) => [x, y] };
    const selected = list.find((c, k) => pick[k].selected) || null;
    const order = [...list].sort((a, b) => b.population - a.population);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBanners(ctx, cam, w, { cities: order, selectedCity: selected }, nation.yields, nation);
    pick.forEach((p, k) => {
      text(ctx, p.note, pos[k][0], pos[k][1] + 6, { color: dimColor(), font: "10.5px -apple-system, system-ui, sans-serif" });
    });
  }
}

// --- 7. map layers (tile improvements, wonders, trade) ---------------------------------------------------------------

// Synthetic map-layer data on the landscape scene, drawn through the real layer factories (ext/layers/layers.js), so the
// gallery shows exactly what the app draws: roads, rail (shifted beside a road where they share links), ports,
// airports, a park with protected land, the three wonder kinds and trade arcs. The Taiwan build has no military layer
// (docs/PORTING.md), so the scene has none either.
function sceneLayerData(w) {
  const { grid } = w;
  const cols = grid.cols;
  const at = (r, c) => r * cols + c;
  const walk = (start, dirs) => {
    const cells = [start];
    for (const d of dirs) cells.push(grid.neighbour(cells[cells.length - 1], d));
    return cells.filter((c) => c >= 0);
  };
  const links = (cells, cls, name) => cells.slice(1).map((b, k) => {
    const a = cells[k];
    return a < b ? [a, b, cls, name] : [b, a, cls, name];
  });
  const roads = [
    ...links(walk(at(11, 5), Array(18).fill(0)), 0, "Ruta 5"),
    ...links(walk(at(11, 8), [5, 5, 4, 5, 5, 4, 5]), 0, "Costanera Norte"),
    ...links(walk(at(14, 6), [0, 0, 5, 0, 0, 0, 1, 0, 0, 0, 0, 5, 0, 0]), 1, "Ruta 68"),
  ];
  const rail = [
    ...links(walk(at(9, 5), [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 5, 5, 0, 0]), 0),
    ...links(walk(at(11, 12), [0, 0, 0, 0]), 0),
    ...links(walk(at(8, 14), [1, 1, 0, 1, 1]), 1),
  ];
  const site = (cell, o) => ({ cell, x: grid.cx(cell), y: grid.cy(cell), state: "90", county: null, cbsa: null, ...o });
  const infrastructure = {
    roads, rail,
    ports: [
      site(at(11, 5), { id: "p1", name: "Puerto Norte", type: "coastal", rank: 1, tons: 1.6e8, year: 2025 }),
      site(at(8, 10), { id: "p2", name: "Puerto Chico", type: "coastal", rank: 6, tons: 9e6, year: 2025 }),
      site(at(6, 14), { id: "p3", name: "Puerto Oeste", type: "coastal", rank: 3, tons: 3e7, year: 2025 }),
    ],
    airports: [
      site(at(12, 9), { id: "AAA", name: "Aeropuerto Internacional", hub: "L", enplanements: 3e7, year: 2025 }),
      site(at(8, 15), { id: "BBB", name: "Aeropuerto Villa", hub: "M", enplanements: 5e6, year: 2025 }),
      site(at(4, 10), { id: "CCC", name: "Aeropuerto Pinar", hub: "N", enplanements: 4e4, year: 2025 }),
      site(at(13, 22), { id: "DDD", name: "Aeródromo Isla", hub: "S", enplanements: 3e5, year: 2025 }),
    ],
  };
  const wonders = {
    rules: [], wonders: [
      site(at(3, 23), { id: "np-X", name: "Parque Nacional Cumbre Nevada", short: "Cumbre Nevada", kind: "natural", rule: "national_park", rank: 1,
        metrics: {}, cells: [at(2, 23), at(3, 22), at(3, 23), at(4, 23), at(3, 24)] }),
      site(at(12, 19), { id: "univ-1", name: "Universidad de la Capital", short: "U. Capital", kind: "university", rule: "research_university", rank: 4, metrics: {} }),
      site(at(9, 12), { id: "boch-X", name: "Puerta Antigua", short: "Puerta Antigua", kind: "landmark", rule: "landmark", rank: 2, metrics: {}, curated: true }),
    ],
  };
  const trade = {
    zones: [], routes: [
      // Synthetic survey: truck freight in thousand tonnes, no money (trade.json value_musd is null)
      { a: "1", b: "2", rank: 1, value_musd: null, tons_k: 28000, top_mode: "truck", path: [at(11, 8), at(12, 19)] },
      { a: "3", b: "2", rank: 2, value_musd: null, tons_k: 14000, top_mode: "truck", path: [at(4, 9), at(12, 19)] },
      { a: "4", b: "1", rank: 3, value_musd: null, tons_k: 9000, top_mode: "truck", path: [at(8, 14), at(13, 6)] },
      { a: "5", b: "6", rank: 4, value_musd: null, tons_k: 10000, top_mode: "truck", path: [at(3, 12), at(14, 22)] },
    ],
  };
  return { infrastructure, military: null, wonders, trade };
}

function renderLayers() {
  const sec = section("layers", "Capas del mapa",
    "Capas estáticas del mapa (<code>ext/layers/layers.js</code>, sobre <code>render/art/improvements.js</code> y " +
    "<code>render/art/sites.js</code>) dibujadas sobre el paisaje sintético, con datos ficticios: autopistas (Ruta 5, Costanera Norte), una ruta" +
    "secundaria (Ruta 68, dibujada como camino de tierra desde R 18px), ferrocarril (línea principal y ramal; al compartir tramo con un camino va al lado), puertos," +
    "aeropuertos, un parque nacional con su área protegida, tres tipos de maravillas con placas (desde R 30px) y cuatro arcos de carga por carretera (ponderados por toneladas)." +
    "Caminos, ferrocarril, puertos y aeropuertos aparecen desde R 10px. chileciv no tiene capa militar.");
  const w = sceneWorld();
  const model = createModel(w);
  for (const [name, data] of Object.entries(sceneLayerData(w))) model.setData(name, data);
  const on = { roads: true, rail: true, hubs: true, military: false, wonders: true, trade: true };
  const layers = makeLayers(model, on);
  const W = w.raw.width, H = w.raw.height;
  for (const Rpx of TIERS) {
    const s = Rpx / R;
    const crop = Rpx >= 44 ? { x0: W * 0.12, y0: H * 0.3, x1: W * 0.62, y1: H * 0.98 } : { x0: 0, y0: 0, x1: W, y1: H };
    const cssW = Math.ceil((crop.x1 - crop.x0) * s), cssH = Math.ceil((crop.y1 - crop.y0) * s);
    const ctx = makeCanvas(tierBlock(sec, tierName(Rpx), Rpx >= 44 ? "Recorte central" : ""), cssW, cssH);
    const T = {};
    drawStatic(ctx, { ...crop, s, dpr: DPR, cssW, cssH }, w, { lens: null, showResources: false, edgeFog: false, labels: true, layers, timings: T });
    const ms = Object.entries(T).filter(([k]) => k.startsWith("layer:")).map(([k, v]) => `${k.slice(6)} ${v.toFixed(1)}`).join(" · ");
    ctx.canvas.title = `Tiempo por capa en ms (primer dibujo, incluye sprites): ${ms}`;
  }
}

function renderSites() {
  const sec = section("sites", "Íconos de lugares",
    "Cada ícono de lugar en los cuatro niveles de zoom, al tamaño real del mapa (<code>ext/layers/model.js SITE_RULES</code>):" +
    "maravillas por categoría y motivo (el motivo de cada una se fija por id, ver <code>WONDER_MOTIF_BY_ID</code>; estrella dorada = las tres primeras de la regla), puertos por tramo de carga," +
    "aeropuertos por tramo de pasajeros, marcadores de rutas comerciales y placas. chileciv no tiene capa militar, así que no se listan fuertes.");
  const grass = "rgb(150,170,92)";
  const groups = [
    { name: "Maravillas", items: [
      // every motif once, under the kind that uses it on the map (ext/layers/model.js WONDER_MOTIF_BY_ID)
      ...Object.entries(WONDER_MOTIFS).flatMap(([k, motifs]) =>
        motifs.filter((mo) => k !== "natural" || !["obelisk"].includes(mo)).filter((mo) => k !== "landmark" || !["dam", "obelisk"].includes(mo))
          .map((mo, j) => ({ label: MOTIF_LABELS[mo] || mo, kind: "wonder", w: k, motif: mo, rank: j === 0 ? 1 : 9 }))),
    ] },
    { name: "Puertos y aeropuertos", items: [
      ...[0, 1, 2].map((t) => ({ label: `Puerto, tramo ${t}`, kind: "port", tier: t, type: "coastal" })),
      ...["L", "M", "S", "N"].map((h, t) => ({ label: `Aeropuerto ${h}`, kind: "airport", tier: t })),
      ...["cart", "boat", "rail", "plane", "barrel"].map((mk) => ({ label: `Marcador ${mk}`, kind: "marker", mk })),
    ] },
  ];
  for (const Rpx of TIERS) {
    const block = tierBlock(sec, tierName(Rpx));
    for (const grp of groups) {
      const colW = Math.max(Math.sqrt(3) * Rpx + 26, 84), rowH = Math.max(2.2 * Rpx + 30, 62);
      const perRow = Math.max(1, Math.floor((Math.min(window.innerWidth, 1800) - 60) / colW));
      const rows = Math.ceil(grp.items.length / perRow);
      const ctx = makeCanvas(block, colW * Math.min(perRow, grp.items.length) + 10, rows * rowH + 8);
      const s = Rpx / R;
      grp.items.forEach((it, k) => {
        const px = colW * ((k % perRow) + 0.5), py = Math.floor(k / perRow) * rowH + rowH / 2 + 2;
        worldAt(ctx, px, py, 0, 0, s);
        ctx.beginPath();
        for (let j = 0; j < 6; j++) {
          const a = ((60 * j - 30) * Math.PI) / 180;
          j ? ctx.lineTo(R * Math.cos(a), R * Math.sin(a)) : ctx.moveTo(R * Math.cos(a), R * Math.sin(a));
        }
        ctx.closePath();
        ctx.fillStyle = grass;
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.2)";
        ctx.lineWidth = 1 / s;
        ctx.stroke();
        let px2 = 0;
        if (it.kind === "fort") {
          px2 = SITE_RULES.fort.size(it.tier, Rpx);
          drawFort(ctx, it.f, 0, 0, px2 / s, { tier: it.tier, joint: it.joint, muted: it.muted, coastal: it.coastal !== false, airfield: !!it.airfield });
        } else if (it.kind === "wonder") {
          px2 = SITE_RULES.wonder.size(it.rank, Rpx);
          drawWonder(ctx, it.w, 0, 0, px2 / s, { motif: it.motif, rank: it.rank });
        } else if (it.kind === "port") {
          px2 = SITE_RULES.port.size(it.tier, Rpx);
          drawPort(ctx, 0, 0, px2 / s, { tier: it.tier, type: it.type });
        } else if (it.kind === "airport") {
          px2 = SITE_RULES.airport.size(it.tier, Rpx);
          drawAirport(ctx, 0, 0, px2 / s, { tier: it.tier });
        } else {
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          drawTradeMarker(ctx, it.mk, px, py, 16, MODE_STYLE[{ cart: "truck", boat: "water", rail: "rail", plane: "air", barrel: "pipeline" }[it.mk]].color);
        }
        text(ctx, it.label, px, py + rowH / 2 - 7, { color: dimColor(), font: "10px -apple-system, system-ui, sans-serif" });
      });
    }
  }
  // plaques
  const ctx = makeCanvas(tierBlock(sec, "Placa", "drawPlaque, escala 1 y 1.2"), 640, 60);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawPlaque(ctx, "Río Clarillo", 110, 8, { kind: "natural" });
  drawPlaque(ctx, "Universidad de Chile", 290, 8, { kind: "university", scale: 1.2 });
  drawPlaque(ctx, "Gran Torre Costanera", 480, 8, { kind: "landmark" });
}

function renderCitizens() {
  const sec = section("citizens", "Habitantes",
    "<code>render/art/people.js</code>: cada tipo de habitante de citizens.json, en filas, dibujado por <code>drawCitizen()</code> en canvas a " +
    "16, 24, 40 y 64 px (todas las figuras con un mismo tono de piel neutro), luego cinco variantes (solo cambian el pelo y el tono de la ropa), gris (<code>dim</code>) y fondo de disco; la última fila es la versión HTML " +
    "(<code>citizenSVG()</code>), a 28 px.");
  for (const [row, kinds] of Object.entries(CITIZEN_ROWS)) {
    const block = tierBlock(sec, row);
    const sizes = [16, 24, 40, 64];
    const colW = 210, rowH = 86;
    const perRow = Math.max(1, Math.floor((Math.min(window.innerWidth, 1800) - 60) / colW));
    const rows = Math.ceil(kinds.length / perRow);
    const ctx = makeCanvas(block, colW * Math.min(perRow, kinds.length) + 10, rows * rowH + 6);
    kinds.forEach((kind, k) => {
      const x0 = (k % perRow) * colW + 8, y0 = Math.floor(k / perRow) * rowH + 4;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      let x = x0;
      for (const sz of sizes) {
        drawCitizen(ctx, kind, x + sz / 2, y0 + 66 - sz / 2, sz);
        x += sz + 4;
      }
      text(ctx, CITIZEN_KINDS[kind].label, x0, y0 + 76, { color: dimColor(), align: "left", font: "10.5px -apple-system, system-ui, sans-serif" });
    });
    // variants, dim and disk
    const c2 = makeCanvas(block, kinds.length * 7 * 30 + 20, 40);
    c2.setTransform(DPR, 0, 0, DPR, 0, 0);
    kinds.forEach((kind, k) => {
      const bx = 12 + k * 7 * 30;
      for (let v = 0; v < 5; v++) drawCitizen(c2, kind, bx + v * 26, 20, 26, { variant: v });
      drawCitizen(c2, kind, bx + 5 * 26 + 4, 20, 26, { variant: 1, dim: true });
      drawCitizen(c2, kind, bx + 6 * 26 + 8, 20, 26, { variant: 2, disk: "#2c3a4a" });
    });
    const html = document.createElement("div");
    html.className = "scroll";
    html.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px";
    html.innerHTML = kinds.map((kind, k) => citizenSVG(kind, { size: 28, title: CITIZEN_KINDS[kind].label })).join("");
    block.appendChild(html);
  }
}

// --- go ------------------------------------------------------------------------------------------------------------

async function renderAll() {
  const main = document.getElementById("gallery");
  main.innerHTML = '<p class="muted" id="status">Dibujando…</p>';
  const t0 = performance.now();
  const steps = [renderTerrain, renderScene, renderCities, renderWater, renderLayers, renderSites, renderCitizens, renderIcons, renderBanners];
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      console.error(err);
      main.insertAdjacentHTML("beforeend", `<p class="err">${step.name} falló: ${String(err.message || err)}</p>`);
    }
  }
  const st = document.getElementById("status");
  const ts = terrainArtStats();
  const mb = ((ts.pixels || 0) * 4) / 1e6;
  if (st) st.textContent = `Dibujo en ${Math.round(performance.now() - t0)} ms · razón de píxeles ${DPR} · sprites de terreno: ${ts.count ?? "?"} (${mb.toFixed(1)} MB, dibujo ${Math.round(ts.painted || 0)} ms). Tras editar render/art/*.js o icons.js, pulsa "Recargar arte".`;
}

const bind = (id, fn) => document.getElementById(id)?.addEventListener("change", (e) => fn(e.target.checked));
bind("opt-outline", (v) => { opts.outline = v; renderAll(); });
bind("opt-light", (v) => { document.body.classList.toggle("light", v); renderAll(); });
bind("opt-lod", (v) => { opts.lodLabels = v; renderAll(); });
document.getElementById("btn-reload")?.addEventListener("click", () => location.reload());
renderAll();
