// The trailer's storyboard: shots, camera moves and the words on screen. Every number shown comes from web/data at
// render time (see `facts` below); nothing here is hard-coded data.
//
// To re-render with the site's name, edit CONFIG and press Render again.
export const CONFIG = {
  title: "chileciv",
  subtitle: "La Región Metropolitana como mapa de estrategia",
  url: "", // shown big on the end card ("" shows the cta line instead; there is no public site yet)
  cta: "Sobre usaciv de Andrej Karpathy", // shown on the end card instead while url is empty ("" hides the line)
  credit: "Datos públicos: INE, SII, ESA, OpenStreetMap, Wikidata", // the end card's line above the url/cta
};

import {
  titleCard, endCard, caption, chip, lensLegend, cityPanel, pulseRing, vignette, darken,
  win, smooth, easeInOut, lerp, clamp01,
} from "./overlays.js";
import { badgeOf } from "../../js/ext/cityView/districts.js";
import { compact, int, money, pct } from "../../js/format.js";

export const FPS = 30;
export const W = 1920, H = 1080;
export const FADE = 0.45; // crossfade between shots, s

// --- number formatting ------------------------------------------------------------------------------------------
// Money is Chilean pesos and counts follow the site's own helpers (js/format.js): "mil", "M", "mil M", "billones".
export const people = (v) => (v >= 1e3 ? compact(v) : int(v));
export const signedPct = (x) => `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(0)}%`;
/** "1 de cada 4 personas" from a share. */
export function oneIn(share) {
  if (!(share > 0)) return "nadie";
  if (share >= 0.3) return `${Math.round(share * 10)} de cada 10 personas`;
  return `1 de cada ${Math.round(1 / share)} personas`;
}
// drops asides in parentheses: "Censo 2024 (INE)" → "Censo 2024"
export const stripParen = (s) => String(s || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
// Short on-screen names for a few sources (the full titles are in sources.json and the app's Almanac); the year,
// when the title has one, is read from the title.
const SHORT = { srtm15: "SRTM15+", worldcover: "ESA WorldCover", worldclim: "WorldClim 2.1", cr2met: "CR2MET 1991-2020", usgs_sismos: "USGS", gvp_volcanes: "Smithsonian" };
export function srcLabel(s) {
  if (!s) return "";
  if (!SHORT[s.id]) return stripParen(s.title);
  const y = /\b(19|20)\d\d\b/.exec(s.title) || /\b(19|20)\d\d\b/.exec(s.vintage || "");
  return SHORT[s.id] + (y ? ` ${y[0]}` : "");
}

// --- camera -----------------------------------------------------------------------------------------------------
/** Interpolate two camera keys: position linearly, zoom geometrically (so a zoom feels even). */
export function camAt(a, b, k) {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), rpx: Math.exp(lerp(Math.log(a.rpx), Math.log(b.rpx), k)) };
}
/** A zoom between two keys that keeps the ground under the moving point steady (no swing): the position follows
 *  1/zoom, not time. */
export function camZoom(a, b, k) {
  const rpx = Math.exp(lerp(Math.log(a.rpx), Math.log(b.rpx), k));
  const u = Math.abs(1 / b.rpx - 1 / a.rpx) < 1e-9 ? k : (1 / rpx - 1 / a.rpx) / (1 / b.rpx - 1 / a.rpx);
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), rpx };
}
/** A flight between two far-apart keys: it rises (zooms out by up to 1 + h) mid-way, so the ground never streaks. */
export function camFly(a, b, k, h = 4) {
  const c = camAt(a, b, k);
  return { ...c, rpx: c.rpx / (1 + h * Math.sin(Math.PI * k)) };
}
/** Slow-in, mostly constant speed, slow-out: for drifts that should never look parked. */
/** Quintic smootherstep: an even softer start and stop than smooth(). */
export const smoother = (k) => { k = clamp01(k); return k * k * k * (k * (6 * k - 15) + 10); };
export const glide = (k) => 0.35 * clamp01(k) + 0.65 * smooth(k);
/** Gentle start, peak speed early, then a long settle to rest (quartic ease-out of k^1.3). */
export const easeOutQ = (k) => 1 - (1 - clamp01(k) ** 1.3) ** 4;

/** Everything the storyboard reads from the data, gathered once (so the words are checkable in one place). */
export function gatherFacts(stage) {
  const { data, w } = stage;
  const g = w.grid;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < g.size; i++) {
    if (w.raw.owner[i] < 0) continue;
    const x = g.cx(i), y = g.cy(i);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const land = { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  // whole-map zoom: the land fills the 1280×720 css frame with a little margin
  const css = { w: W / stage.dpr, h: H / stage.dpr };
  const homeRpx = Math.min((css.w * 0.94) / (x1 - x0 + 2 * g.R), (css.h * 0.9) / (y1 - y0 + 2 * g.R)) * g.R;
  const src = new Map(data.sources.map((s) => [s.id, s]));
  const city = (name) => data.cities.find((c) => c.name === name && c.metro);
  return { land, homeRpx, src, city, css };
}

/**
 * Build the shot list. Each shot: {id, t0, t1, render(sec) → [{view, alpha}] (map layers to blend, in order),
 * overlay(ctx, sec, frame)} where sec is the shot's local time and frame = {toScreen(x, y) → output px}.
 *
 * The story (ids are what score.js looks for, so they stay): title (the whole region, the Andes to the east) →
 * terrain (the Andes front above Peñalolén) → cities (Santiago and La Moneda) → lenses (density, growth,
 * foreign-born) → improvements (Las Condes and the Gran Torre Costanera, wonders layer) → city (across the Maipo
 * valley farmland into Melipilla's City View) → trade (the high Andes, El Morado; no trade data in this build) → end.
 */
export function buildStoryboard(stage, cfg = CONFIG) {
  const { data } = stage;
  const F = gatherFacts(stage);
  const { land, homeRpx, src } = F;
  const shots = [];
  const shot = (s) => { shots.push(s); return s; };
  const WIDE = { banners: false, resources: false, labels: false }; // whole-map look: no banners or province names

  // Transitions (`trans` on the incoming shot): "dip" = through dark (only out of the title), "punch" = a quick
  // zoom-through cut between places far apart, "cut" = the camera carries on from the previous shot's last frame
  // (one continuous move across the shot boundary). Times are absolute seconds.
  const T_TERRAIN = 3.1, T_STGO = 5.8, T_LENS = 9.8, T_IMP = 15.3, T_CITY = 19.9, T_AND = 24.6, T_END = 27.4, T_OUT = 30;

  // Real places, looked up by name in the data so the camera follows the data if it is rebuilt.
  const wonderByName = (name) => data.wonders.wonders.find((w) => w.name === name);
  const moneda = wonderByName("Palacio de La Moneda");
  const costanera = wonderByName("Gran Torre Costanera");
  const morado = wonderByName("El Morado");
  const need = { moneda, costanera, morado };
  for (const [k, v] of Object.entries(need)) if (!v) throw new Error(`storyboard: wonders.json has no ${k}`);

  // 1. Title over the whole region, slow push-in. The map is already half lit on frame 0. ------------------------
  shot({
    id: "title", t0: 0, t1: T_TERRAIN + 0.2,
    render: (t) => [{ view: { ...camAt({ x: land.cx, y: land.cy, rpx: homeRpx * 0.98 }, { x: land.cx + 40, y: land.cy - 10, rpx: homeRpx * 1.1 }, t / 3.3), ...WIDE } }],
    overlay(ctx, t) {
      darken(ctx, W, H, 0.42);
      vignette(ctx, W, H, 0.85);
      titleCard(ctx, W, H, cfg, win(t, -0.5, T_TERRAIN + 0.15, 0.9, 0.4), clamp01((t + 0.4) / 1.6));
    },
  });

  // 2. Terrain: the front of the Andes east of Santiago (Peñalolén and Las Condes at their foot), a slow drift and
  // push, ~150-200 px/s.
  const dem = src.get("srtm15"), cover = src.get("worldcover");
  const TERRAIN_T = T_STGO - T_TERRAIN;
  shot({
    id: "terrain", t0: T_TERRAIN, trans: "dip", t1: T_STGO,
    render: (t) => [{ view: camAt({ x: 3800, y: 2330, rpx: 30 }, { x: 3690, y: 2500, rpx: 37 }, glide(t / (TERRAIN_T + 0.2))) }],
    overlay(ctx, t) {
      caption(ctx, W, H, {
        kicker: "Terreno",
        title: "Cada hexágono viene de datos reales",
        sub: "Altura y cobertura del suelo dibujan todo el mapa",
        source: [dem, cover].filter(Boolean).map(srcLabel).join(" · "),
      }, win(t, 0.45, TERRAIN_T + 0.05, 0.45, 0.3), clamp01((t - 0.45) / 0.6));
    },
  });

  // 3. Cities: in from the southwest into central Santiago, ending on La Moneda right of centre. -----------------
  const stgo = F.city("Santiago");
  const STGO_T = T_LENS - T_STGO;
  const stgoEnd = { x: moneda.x - 60, y: moneda.y + 10, rpx: 62 };
  // a slow westward drift (map units/s) under the whole Santiago move, so the camera never parks before the pull-out
  const STGO_DRIFT = -24;
  const stgoCam = (t) => { const c = camAt({ x: stgo.x - 380, y: stgo.y + 300, rpx: 28 }, stgoEnd, smooth(t / STGO_T)); return { ...c, x: c.x + STGO_DRIFT * (t - STGO_T) }; };
  shot({
    id: "cities", t0: T_STGO, trans: "punch", t1: T_LENS,
    render: (t) => [{ view: stgoCam(t) }],
    overlay(ctx, t, frame) {
      const a = win(t, 1.3, STGO_T - 0.05, 0.5, 0.4);
      const [sx, sy] = frame.toScreen(moneda.x, moneda.y);
      pulseRing(ctx, sx, sy, frame.cam.scale * stage.R * 1.5 * 2.2, a, t);
      caption(ctx, W, H, {
        kicker: "Comuna",
        title: stgo.name,
        sub: `La Moneda, ${people(stgo.population)} habitantes · ventas ${money(stgo.gdp)}`,
        source: `Población: ${stripParen(String(data.nation.vintage).split(";")[0])} · ${stripParen(data.nation.gdp_vintage)}`,
      }, a, clamp01((t - 1.3) / 0.6));
    },
  });

  // 4. Lenses: pull out of Santiago to the whole region as the density lens washes in, then two more lenses while
  // the camera drifts west to east. ----------------------------------------------------------------------------
  const LENSES = ["density", "growth", "foreign_born"].map((id) => stage.lensById.get(id)).filter(Boolean);
  const nLens = data.lenses.lenses.length;
  const lensFmt = stage.formatLensTick;
  const legendOf = (l) => ({ name: l.name, unit: l.unit, icon: l.icon, ramp: l.ramp, lo: lensFmt(l, 0, 0), hi: lensFmt(l, 1, 4) });
  // the two big comunas (100,000+ people) that grew most, read from the data for the growth lens's caption
  const [y0, y1] = (data.cities.find((c) => c.growth_years)?.growth_years) || [2017, 2024];
  const growers = data.cities.filter((c) => c.population >= 1e5 && Number.isFinite(c.growth)).sort((a, b) => b.growth - a.growth).slice(0, 2);
  const growthSub = growers.length === 2
    ? `${growers[0].name} (${signedPct(growers[0].growth)}) y ${growers[1].name} (${signedPct(growers[1].growth)}) crecieron más entre ${y0} y ${y1}`
    : `Cambio de población entre ${y0} y ${y1}`;
  const lensSub = (l) => (l.id === "growth" ? growthSub : l.id === "density" ? "Habitantes por km² en cada hexágono" : l.id === "foreign_born" ? "Nacidos fuera de Chile, por comuna" : l.unit);
  const LENS_T = T_IMP - T_LENS, ZO = 1.0, LD = (LENS_T - ZO) / LENSES.length, LK = 0.4;
  const lensA = { x: land.cx - 150, y: land.cy + 20, rpx: homeRpx * 1.04 };
  const lensB = { x: land.cx + 150, y: land.cy, rpx: homeRpx * 1.14 };
  // the pull-out starts with Santiago's drift and hands it over to the zoom
  const lensCam = (t) => {
    if (t >= ZO) return camAt(lensA, lensB, clamp01((t - ZO) / (LENS_T - ZO)));
    const c = camZoom(stgoEnd, lensA, smooth(t / ZO));
    return { ...c, x: c.x + STGO_DRIFT * t * (1 - smooth(t / ZO)) };
  };
  // which lens is up at shot time t, and how far the change to the next one has got (0..1)
  const lensAt = (t) => {
    const u = Math.max(0, t - ZO);
    const i = Math.min(LENSES.length - 1, Math.floor(u / LD));
    const k = i < LENSES.length - 1 ? smooth((u - (i + 1) * LD + LK) / LK) : 0;
    return { i, k };
  };
  shot({
    id: "lenses", t0: T_LENS, trans: "cut", t1: T_IMP,
    // musical cues (shot-local seconds, read by score.js): each new lens
    cues: LENSES.map((l, i) => (i === 0 ? 0.1 : ZO + i * LD - LK / 2)),
    render(t) {
      const cam = lensCam(t);
      if (t < ZO) {
        return [
          { view: { ...cam } },
          { view: { ...cam, lens: LENSES[0].id, ...WIDE }, alpha: smooth((t - 0.1) / (ZO - 0.2)) },
        ];
      }
      const { i, k } = lensAt(t);
      const out = [{ view: { ...cam, lens: LENSES[i].id, ...WIDE } }];
      if (k > 0) out.push({ view: { ...cam, lens: LENSES[i + 1].id, ...WIDE }, alpha: k });
      return out;
    },
    overlay(ctx, t) {
      vignette(ctx, W, H, 0.5 * smooth(t / ZO)); // carried on (fading) by the next shot
      const { i, k } = lensAt(t);
      const whole = win(t, 0.55, LENS_T - 0.05, 0.4, 0.3);
      lensLegend(ctx, W, H, legendOf(LENSES[i]), whole, k > 0 ? legendOf(LENSES[i + 1]) : null, k);
      const cur = LENSES[k > 0.5 ? i + 1 : i];
      const s = src.get(cur.source);
      caption(ctx, W, H, {
        kicker: "Lentes",
        title: `${nLens} lentes`,
        sub: lensSub(cur),
        source: `${cur.name}: ${s ? srcLabel(s) : cur.source}`,
      }, whole, clamp01((t - 0.55) / 0.6));
    },
  });

  // 5. Map layers: dive from the whole region into Las Condes and the Gran Torre Costanera; the wonders layer comes
  // in, then two chips. (This build has no roads, rail, ports or military layers: infrastructure.json is not built.)
  const lasCondes = F.city("Las Condes");
  const won = data.wonders.wonders;
  const nOf = (kind) => won.filter((x) => x.kind === kind).length;
  const IMP_T = T_CITY - T_IMP, ZI = 1.0;
  const STAGES = [
    { at: 1.05, on: { wonders: true }, chip: { icon: "w-landmark", label: `${won.length} maravillas en la región`, sub: "Parques, monumentos, universidades e hitos" } },
    { at: 1.9, on: {}, chip: { icon: "w-landmark", label: lasCondes.name, sub: `${people(lasCondes.population)} habitantes · ${costanera.name}` } },
    { at: 2.75, on: {}, chip: { icon: "w-university", label: `${nOf("university")} universidades · ${nOf("monument")} monumentos`, sub: "Según Wikidata, por número de artículos" } },
  ];
  const layersAt = (n) => Object.assign({}, ...STAGES.slice(0, n).map((s) => s.on));
  // the Costanera tower stands 9 km west of Las Condes' seat
  const harA = { x: costanera.x + 60, y: costanera.y - 25, rpx: 50 };
  const harB = { x: costanera.x + 10, y: costanera.y - 5, rpx: 66 };
  const lensV = { x: (lensB.x - lensA.x) / (LENS_T - ZO), y: (lensB.y - lensA.y) / (LENS_T - ZO) }; // the lens drift, units/s
  const impCam = (t) => {
    if (t >= ZI) return camAt(harA, harB, glide((t - ZI) / (IMP_T - ZI + 0.35)));
    const c = camZoom(lensB, harA, smooth(t / ZI)), d = t * (1 - smooth(t / ZI));
    return { ...c, x: c.x + lensV.x * d, y: c.y + lensV.y * d };
  };
  shot({
    id: "improvements", t0: T_IMP, trans: "cut", t1: T_CITY,
    cues: STAGES.map((s) => s.at + 0.1), // each chip appearing (score.js rings a bell)
    render(t) {
      const cam = impCam(t);
      if (t < ZI) {
        return [
          { view: { ...cam } },
          { view: { ...cam, lens: LENSES[LENSES.length - 1].id, ...WIDE }, alpha: 1 - smooth((t - 0.15) / (ZI - 0.3)) },
        ];
      }
      let n = 0;
      while (n < STAGES.length && t >= STAGES[n].at + 0.45) n++;
      const out = [{ view: { ...cam, layers: layersAt(n) } }];
      if (n < STAGES.length && t > STAGES[n].at) out.push({ view: { ...cam, layers: layersAt(n + 1) }, alpha: smooth((t - STAGES[n].at) / 0.45) });
      return out;
    },
    overlay(ctx, t) {
      vignette(ctx, W, H, 0.5 * (1 - smooth(t / (ZI * 0.8))));
      let y = 70;
      for (const s of STAGES) {
        const a = win(t, s.at, IMP_T - 0.1, 0.4, 0.3);
        if (a > 0) chip(ctx, 80 - (1 - smooth((t - s.at) / 0.4)) * 40, y, s.chip, a, { size: 0.9 });
        y += 86;
      }
    },
  });

  // 6. A city screen: fly south-west over the Maipo valley farmland to Melipilla and open its City View. ---------
  const hc = F.city("Melipilla");
  const cv = stage.cityView(hc.id);
  const bb = cv.model.bbox;
  const cit = data.citizens.cities[hc.id];
  const nat = data.citizens.national;
  const groups = data.citizens.groups.age;
  const figs = (fig) => groups.flatMap((g) => Array(fig[g.key] || 0).fill(g.key));
  const HI = "elder";
  const hiGroup = groups.find((g) => g.key === HI);
  const badge = badgeOf(data.districts, hc.id);
  const foreign = (c) => 1 - c.nativity.shares.born_in_chile;
  const panel = {
    name: hc.name,
    full: hc.full,
    badge: badge && badge.district ? { label: badge.label, color: badge.color, icon: badge.icon } : null,
    stats: [[people(hc.population), "Habitantes"], [`${(hc.gdp / 1e12).toFixed(1)} bill.`, `Ventas ${hc.gdp_year}`], [signedPct(hc.growth), `Crecimiento ${y0}-${y1}`]],
    rowsTitle: "Habitantes · edades",
    highlight: hiGroup ? `Resaltado: ${hiGroup.label}` : "",
    rows: [
      { label: hc.name, figs: figs(cit.age.figures), hi: HI, ratio: oneIn(cit.age.shares[HI]) },
      { label: "Región", figs: figs(nat.age.figures), hi: HI, ratio: oneIn(nat.age.shares[HI]) },
    ],
    extraTitle: "Censo 2024",
    districts: [
      { icon: "l-age", name: `${cit.age.median} años`, line: `Edad mediana (región: ${nat.age.median} años)` },
      { icon: "l-foreign-born", name: pct(foreign(cit)), line: `Nacidos fuera de Chile (región: ${pct(foreign(nat))})` },
    ],
    source: `${stripParen(data.citizens.vintage)} · ${stripParen(data.nation.gdp_vintage)}`,
  };
  const CITY_T = T_AND - T_CITY, FLY = 1.7, CITY_IN = 0.6;
  // frame: the comuna in the left part of the frame (the panel covers the right 45%)
  const mapW = (W - 820 - 56) / stage.dpr; // css px of open map on the left
  const fitRpx = Math.min((mapW * 0.8) / (bb.x1 - bb.x0), (F.css.h * 0.7) / (bb.y1 - bb.y0)) * stage.R;
  const cityCam = (rpx) => {
    const s = rpx / stage.R;
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    return { x: cx + (F.css.w / 2 - mapW / 2) / s, y: cy + 10 / s, rpx };
  };
  const hcA = cityCam(fitRpx * 0.95), hcB = cityCam(fitRpx * 1.07);
  // the flight bows south (map units at mid-way) so it crosses the farmland of the Maipo valley (Talagante, Isla de
  // Maipo) rather than the built-up west of Santiago
  const south = (c, k) => ({ ...c, y: c.y + 350 * Math.sin(Math.PI * k) });
  shot({
    id: "city", t0: T_CITY, trans: "cut", t1: T_AND,
    cues: [FLY - CITY_IN, 1.3], // the city screen opening, the panel coming up
    render(t) {
      // after the flight the camera keeps pushing in, gathering speed into the cut
      const cam = t < FLY ? south(camFly(impCam(IMP_T), hcA, smoother(t / FLY), 4), smoother(t / FLY)) : camAt(hcA, hcB, ((u) => 0.5 * u + 0.5 * u * u)(clamp01((t - FLY) / (CITY_T - FLY))));
      const on = smooth((t - (FLY - CITY_IN)) / CITY_IN);
      const cityAnimMs = Math.max(0, t - (FLY - CITY_IN)) * 1000;
      if (on >= 1) return [{ view: { ...cam, city: hc.id, cityAnimMs } }];
      // the wonders layer carries over the cut and fades during the climb
      // (province names stay off during the climb: at mid-height they would fill the frame)
      const out = [{ view: { ...cam, layers: layersAt(STAGES.length) } }];
      const noNames = smooth(t / 0.35); // the province names fade out over the first frames (no pop at the cut)
      if (noNames < 1) out.push({ view: { ...cam, labels: false, layers: layersAt(STAGES.length) }, alpha: noNames });
      else out[0].view.labels = false;
      const plain = smooth((t - 0.1) / 0.6);
      if (plain > 0) out.push({ view: { ...cam, labels: false }, alpha: plain });
      if (on > 0) out.push({ view: { ...cam, city: hc.id, cityAnimMs }, alpha: on });
      return out;
    },
    overlay(ctx, t) {
      cityPanel(ctx, W, H, panel, win(t, 1.3, CITY_T + 0.3, 0.3, 0.4), clamp01((t - 1.3) / 0.7), t - 0.8);
    },
  });

  // 7. The high Andes: start on El Morado, pull out to the whole region. (Id "trade" is what score.js looks for.) ---
  const AND_T = T_END - T_AND;
  const elevAt = (wd) => data.world.elev_max?.[wd.cell] ?? data.world.elev[wd.cell];
  const maxElev = Math.max(...data.world.elev_max.filter(Number.isFinite));
  const andA = { x: morado.x - 20, y: morado.y + 15, rpx: 30 };
  const endB = { x: land.cx + 10, y: land.cy + 5, rpx: homeRpx * 0.98 };
  // one pull-out from El Morado to the whole region, decelerating all the way through the end card (no stop at the cut)
  const andCam = (t) => {
    const k = easeOutQ(t / (T_OUT - T_AND)), z = camZoom(andA, endB, k), l = camAt(andA, endB, k);
    return { x: (z.x + l.x) / 2, y: (z.y + l.y) / 2, rpx: z.rpx }; // half anchored on El Morado, half straight to the centre
  };
  shot({
    id: "trade", t0: T_AND, trans: "punch", t1: T_END,
    render(t) {
      const cam = andCam(t);
      return [
        { view: { ...cam, resources: false } },
        { view: { ...cam, resources: false, layers: { wonders: true } }, alpha: smooth((t - 0.1) / 0.4) },
        { view: { ...cam, ...WIDE, layers: { wonders: true } }, alpha: smooth((t - 0.6) / 0.45) },
      ];
    },
    overlay(ctx, t, frame) {
      const a = win(t, 0.25, AND_T, 0.4, 0.4);
      const [sx, sy] = frame.toScreen(morado.x, morado.y);
      pulseRing(ctx, sx, sy, frame.cam.scale * stage.R * 1.5 * 2.2, a, t);
      caption(ctx, W, H, {
        kicker: "Cordillera de los Andes",
        title: morado.name,
        sub: `Hexágono a ${int(elevAt(morado))} m · la cota máxima de la región es ${int(maxElev)} m`,
        source: srcLabel(dem),
      }, win(t, 0.45, AND_T - 0.05, 0.45, 0.3), clamp01((t - 0.45) / 0.6));
    },
  });

  // 8. End card: the camera keeps settling on the whole region as the wonders fade and the card comes up. ---------
  shot({
    id: "end", t0: T_END, trans: "cut", t1: T_OUT,
    render(t) {
      const cam = andCam(AND_T + t);
      return [
        { view: { ...cam, ...WIDE } },
        // the wonders stay faintly lit under the card
        { view: { ...cam, ...WIDE, layers: { wonders: true } }, alpha: 1 - 0.6 * smooth(t / 0.9) },
      ];
    },
    overlay(ctx, t) {
      darken(ctx, W, H, 0.55 * smooth(t / 0.5));
      vignette(ctx, W, H, 0.9 * smooth(t / 0.5));
      endCard(ctx, W, H, cfg, { facts: cfg.credit ?? `${data.sources.length} fuentes de datos públicas`, fallback: cfg.cta },
        smooth((t - 0.1) / 0.5), clamp01((t - 0.15) / 0.6));
    },
  });

  const duration = T_OUT;
  return { shots, duration, fps: FPS, frames: Math.round(duration * FPS), fade: FADE, cfg, facts: F, panel };
}

/** Shots visible at absolute time T, each with its transition progress `alpha` (0..1 over the incoming shot's fade).
 * A shot stays on screen until the next one is fully in (whatever its own t1 says), and everything under a fully
 * opaque shot is dropped. Transitions (`trans` on the incoming shot): undefined = crossfade (FADE s); "dip" = through
 * dark (DIP s); "punch" = zoom-through cut (PUNCH s; main.js draws it); "cut" = none (the camera carries on). */
const DIP = 0.6, PUNCH = 0.4;
export const fadeOf = (sb, s) => s.fade ?? ({ dip: DIP, punch: PUNCH, cut: 0 }[s.trans] ?? sb.fade);
export function activeShots(sb, T) {
  const out = [];
  sb.shots.forEach((s, i) => {
    const next = sb.shots[i + 1];
    const end = next ? Math.max(s.t1, next.t0 + fadeOf(sb, next)) : s.t1;
    if (T < s.t0 || T >= end) return;
    const f = fadeOf(sb, s);
    const alpha = i === 0 || f <= 0 ? 1 : clamp01((T - s.t0) / f);
    out.push({ shot: s, alpha: s.trans ? alpha : smooth(alpha), sec: T - s.t0 });
  });
  let k = out.length - 1;
  while (k > 0 && out[k].alpha < 1) k--;
  return out.slice(k);
}
