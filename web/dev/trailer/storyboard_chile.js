// The Chile trailer's storyboard (open dev/trailer.html?map=chile). Same shape as storyboard.js (the RM story) and the
// same shot ids (score.js times the music to them), but it tells the story of the whole country, north to south:
// the Atacama, the Andes, rain, earthquakes, Santiago and Valparaíso, the volcanoes of the south, Valdivia's City
// View and Patagonia. Every number shown is read from web/chile/data at render time.
import {
  titleCard, endCard, caption, chip, lensLegend, cityPanel, pulseRing, vignette, darken,
  win, smooth, clamp01,
} from "./overlays.js";
import { int, pct } from "../../js/format.js";
import {
  FPS, W, H, FADE, activeShots, fadeOf, gatherFacts, camAt, camZoom, camFly, smoother, glide, easeOutQ,
  people, signedPct, oneIn, stripParen, srcLabel,
} from "./storyboard.js";

export { FPS, W, H, activeShots, fadeOf };

export const CONFIG = {
  title: "chileciv",
  subtitle: "Chile como mapa de estrategia",
  url: "rodrigobotello1.github.io/chileciv",
  cta: "Sobre usaciv de Andrej Karpathy",
  credit: "Datos públicos: INE, SII, CR2, USGS, Smithsonian, ESA, Wikidata",
};

/**
 * Shots (ids are what score.js looks for): title (the Atacama) → terrain (south along the country to the Andes over
 * Santiago) → cities (Santiago and Valparaíso) → lenses (rain, earthquakes, density; the camera runs south) →
 * improvements (the volcanoes of the south) → city (Valdivia's City View) → trade (Patagonia, Torres del Paine,
 * pulling back to the whole country) → end.
 */
export function buildStoryboard(stage, cfg = CONFIG) {
  const { data } = stage;
  const F = gatherFacts(stage);
  const { land, src } = F;
  const shots = [];
  const shot = (s) => { shots.push(s); return s; };
  const WIDE = { banners: false, resources: false, labels: false };
  // hex radius in css px that makes the frame show `span` map units from top to bottom
  const rpxFor = (span) => (F.css.h * stage.R) / span;
  const key = (x, y, span) => ({ x, y, rpx: rpxFor(span) });

  const T_TERRAIN = 3.1, T_STGO = 5.8, T_LENS = 9.8, T_IMP = 15.3, T_CITY = 19.9, T_AND = 24.6, T_END = 27.4, T_OUT = 30;

  const byName = (name) => data.wonders.wonders.find((w) => w.name === name);
  const cityNamed = (name) => {
    const c = F.city(name);
    if (!c) throw new Error(`storyboard: cities.json has no ${name}`);
    return c;
  };
  const stgo = cityNamed("Santiago"), valpo = cityNamed("Valparaíso"), hc = cityNamed("Valdivia"), anto = cityNamed("Antofagasta");
  const paine = data.wonders.wonders.find((w) => /Torres del Paine/.test(w.name));
  if (!paine) throw new Error("storyboard: wonders.json has no Torres del Paine");

  // 1. Title over the Atacama: the desert on the left, the Andes (Licancabur, Lascar) on the right, slow push-in. ---
  const titleA = key(anto.x + 600, anto.y - 100, 2900), titleB = key(anto.x + 550, anto.y + 20, 2450);
  shot({
    id: "title", t0: 0, t1: T_TERRAIN + 0.2,
    render: (t) => [{ view: { ...camAt(titleA, titleB, t / 3.3), ...WIDE, banners: false } }],
    overlay(ctx, t) {
      darken(ctx, W, H, 0.42);
      vignette(ctx, W, H, 0.85);
      titleCard(ctx, W, H, cfg, win(t, -0.5, T_TERRAIN + 0.15, 0.9, 0.4), clamp01((t + 0.4) / 1.6));
    },
  });

  // 2. Terrain: south along the country, from the Atacama up into the Andes above Santiago. -----------------------
  const dem = src.get("srtm15"), cover = src.get("worldcover");
  const TERRAIN_T = T_STGO - T_TERRAIN;
  const terA = key(anto.x + 450, anto.y + 1100, 1500), terB = key(stgo.x + 520, stgo.y - 150, 900);
  shot({
    id: "terrain", t0: T_TERRAIN, trans: "dip", t1: T_STGO,
    render: (t) => [{ view: { ...camFly(terA, terB, glide(t / (TERRAIN_T + 0.2)), 0.6), banners: false } }],
    overlay(ctx, t) {
      caption(ctx, W, H, {
        kicker: "Terreno",
        title: "Cada hexágono viene de datos reales",
        sub: "Altura y cobertura del suelo dibujan de la cordillera al mar",
        source: [dem, cover].filter(Boolean).map(srcLabel).join(" · "),
      }, win(t, 0.45, TERRAIN_T + 0.05, 0.45, 0.3), clamp01((t - 0.45) / 0.6));
    },
  });

  // 3. Cities: Santiago and Valparaíso, 90 km apart, slow push-in between the two banners. ------------------------
  const STGO_T = T_LENS - T_STGO;
  const mid = { x: (stgo.x + valpo.x) / 2, y: (stgo.y + valpo.y) / 2 };
  const stgoA = key(mid.x + 30, mid.y + 60, 950), stgoEnd = key(mid.x, mid.y, 700);
  const stgoCam = (t) => camAt(stgoA, stgoEnd, smooth(t / STGO_T));
  shot({
    id: "cities", t0: T_STGO, trans: "punch", t1: T_LENS,
    render: (t) => [{ view: stgoCam(t) }],
    overlay(ctx, t, frame) {
      const a = win(t, 1.3, STGO_T - 0.05, 0.5, 0.4);
      for (const c of [stgo, valpo]) {
        const [sx, sy] = frame.toScreen(c.x, c.y);
        pulseRing(ctx, sx, sy, frame.cam.scale * stage.R * 1.5 * 2.2, a, t);
      }
      caption(ctx, W, H, {
        kicker: "Comunas",
        title: `${stgo.name} y ${valpo.name}`,
        sub: `${people(stgo.population)} y ${people(valpo.population)} habitantes`,
        source: `Población: ${stripParen(String(data.nation.vintage).split(";")[0])}`,
      }, a, clamp01((t - 1.3) / 0.6));
    },
  });

  // 4. Lenses: pull out of the central valley, then the camera runs south from the Atacama to the fjords while rain
  // (desert to rainforest), earthquakes and density wash over the map. ---------------------------------------------
  const LENSES = ["rain", "quakes", "density"].map((id) => stage.lensById.get(id)).filter(Boolean);
  const nLens = data.lenses.lenses.length;
  const lensFmt = stage.formatLensTick;
  const legendOf = (l) => ({ name: l.name, unit: l.unit, icon: l.icon, ramp: l.ramp, lo: lensFmt(l, 0, 0), hi: lensFmt(l, 1, 4) });
  // rain: the driest and the wettest comuna, read from the lens's own values at each comuna's cell
  const rainL = stage.lensById.get("rain");
  const rainOf = (c) => rainL?.values?.[c.cell];
  const withRain = rainL ? data.cities.filter((c) => Number.isFinite(rainOf(c))) : [];
  const dry = withRain.reduce((a, c) => (rainOf(c) < rainOf(a) ? c : a), withRain[0]);
  const wet = withRain.reduce((a, c) => (rainOf(c) > rainOf(a) ? c : a), withRain[0]);
  const rainSub = dry && wet ? `${dry.name} recibe ${int(rainOf(dry))} mm al año; ${wet.name}, ${int(rainOf(wet))} mm` : "Precipitación anual promedio";
  // quakes: the strongest one, parsed from the lens's description ("magnitud 9.5 en 1960 (...)")
  const quakeL = stage.lensById.get("quakes");
  const qm = /magnitud ([\d.]+) en (\d{4})/.exec(quakeL?.description || "");
  const quakeSub = qm ? `El más fuerte desde 1900: magnitud ${qm[1]} en ${qm[2]}` : "Sismos de magnitud 7 o más desde 1900";
  const lensSub = (l) => (l.id === "rain" ? rainSub : l.id === "quakes" ? quakeSub : l.id === "density" ? "Habitantes por km² en cada hexágono" : l.unit);
  const LENS_T = T_IMP - T_LENS, ZO = 1.0;
  const DUR = [2.0, 1.4, LENS_T - ZO - 3.4]; // seconds on each lens after the pull-out (rain gets the longest)
  const LS = [ZO, ZO + DUR[0], ZO + DUR[0] + DUR[1]]; // start of each lens, shot-local
  const LK = 0.4;
  const lensA = key(anto.x + 550, anto.y - 200, 4500);
  const lensB = key(hc.x + 400, hc.y + 600, 4500);
  const lensV = { x: (0.35 * (lensB.x - lensA.x)) / (LENS_T - ZO), y: (0.35 * (lensB.y - lensA.y)) / (LENS_T - ZO) }; // units/s at the end
  const lensCam = (t) => {
    if (t >= ZO) return camAt(lensA, lensB, glide((t - ZO) / (LENS_T - ZO)));
    return camFly(stgoEnd, lensA, smooth(t / ZO), 1.5);
  };
  const lensAt = (t) => {
    let i = 0;
    while (i < LENSES.length - 1 && t >= LS[i + 1]) i++;
    const k = i < LENSES.length - 1 ? smooth((t - (LS[i + 1] - LK)) / LK) : 0;
    return { i, k };
  };
  shot({
    id: "lenses", t0: T_LENS, trans: "cut", t1: T_IMP,
    cues: LENSES.map((l, i) => (i === 0 ? 0.1 : LS[i] - LK / 2)),
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
      vignette(ctx, W, H, 0.5 * smooth(t / ZO));
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

  // 5. Improvements: dive from the whole south into the volcanic arc (Villarrica, Llaima) and drift to Puyehue, with the
  // wonders layer (volcanoes, parks, monuments) coming in. ---------------------------------------------------------
  const won = data.wonders.wonders;
  const volc = won.filter((x) => x.rule === "volcano");
  const eruptedAt = (v) => v.metrics?.last_eruption ?? -Infinity;
  const oldest = Math.min(...volc.map(eruptedAt));
  const south = volc.filter((v) => v.y > stgo.y).sort((a, b) => a.y - b.y);
  const pool = south.length ? south : volc; // the story is in the south: the most recent eruption there
  const latest = pool.reduce((a, v) => (eruptedAt(v) > eruptedAt(a) ? v : a), pool[0]);
  const IMP_T = T_CITY - T_IMP, ZI = 1.0;
  const STAGES = [
    { at: 1.05, on: { wonders: true }, chip: { icon: "w-natural", label: `${volc.length} volcanes con erupción reciente`, sub: `Todos han hecho erupción desde ${oldest}` } },
    { at: 1.9, on: {}, chip: { icon: "w-natural", label: `Última: ${latest.short}`, sub: `Erupción en ${latest.metrics.last_eruption} · ${int(latest.metrics.elevation_m)} m` } },
    south.length ? { at: 2.75, on: {}, chip: { icon: "w-natural", label: `${south.length} de ${volc.length} al sur de ${stgo.name}`, sub: `De ${south[0].short} a ${south[south.length - 1].short}` } } : null,
  ].filter(Boolean);
  const layersAt = (n) => Object.assign({}, ...STAGES.slice(0, n).map((s) => s.on));
  // the arc: from the Villarrica-Llaima stretch to Puyehue-Cordon Caulle, the volcano nearest Valdivia
  const vol = (name) => byName(name) || south[0];
  const vA = vol("Volcán Villarrica"), vB = vol("Volcán Puyehue-Cordon Caulle");
  const harA = key(vA.x + 60, vA.y - 80, 850), harB = key(vB.x + 10, vB.y - 60, 650);
  const impCam = (t) => {
    if (t >= ZI) return camAt(harA, harB, glide((t - ZI) / (IMP_T - ZI + 0.35)));
    const c = camZoom(lensB, harA, smooth(t / ZI)), d = t * (1 - smooth(t / ZI));
    return { ...c, x: c.x + lensV.x * d, y: c.y + lensV.y * d };
  };
  shot({
    id: "improvements", t0: T_IMP, trans: "cut", t1: T_CITY,
    cues: STAGES.map((s) => s.at + 0.1),
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

  // 6. A city screen: from the volcanic arc to Valdivia and its City View. ----------------------------
  const cv = stage.cityView(hc.id);
  const bb = cv.model.bbox;
  const cit = data.citizens.cities[hc.id];
  const nat = data.citizens.national;
  const groups = data.citizens.groups.age;
  const figs = (fig) => groups.flatMap((g) => Array(fig[g.key] || 0).fill(g.key));
  const HI = "elder";
  const hiGroup = groups.find((g) => g.key === HI);
  const badge = null; // the comuna type badge was removed from the map
  const foreign = (c) => 1 - c.nativity.shares.born_in_chile;
  const [gy0, gy1] = hc.growth_years || [2017, 2024];
  const panel = {
    name: hc.name,
    full: hc.full,
    badge: badge && badge.district ? { label: badge.label, color: badge.color, icon: badge.icon } : null,
    stats: [[people(hc.population), "Habitantes"], [`${(hc.gdp / 1e12).toFixed(1)} bill.`, `Ventas ${hc.gdp_year}`], [signedPct(hc.growth), `Crecimiento ${gy0}-${gy1}`]],
    rowsTitle: "Habitantes · edades",
    highlight: hiGroup ? `Resaltado: ${hiGroup.label}` : "",
    rows: [
      { label: hc.name, figs: figs(cit.age.figures), hi: HI, ratio: oneIn(cit.age.shares[HI]) },
      { label: "Chile", figs: figs(nat.age.figures), hi: HI, ratio: oneIn(nat.age.shares[HI]) },
    ],
    extraTitle: "Censo 2024",
    districts: [
      { icon: "l-age", name: `${cit.age.median} años`, line: `Edad mediana (Chile: ${nat.age.median} años)` },
      { icon: "l-foreign-born", name: pct(foreign(cit)), line: `Nacidos fuera de Chile (Chile: ${pct(foreign(nat))})` },
    ],
    source: `${stripParen(data.citizens.vintage)} · ${stripParen(data.nation.gdp_vintage)}`,
  };
  const CITY_T = T_AND - T_CITY, FLY = 1.7, CITY_IN = 0.6;
  const mapW = (W - 820 - 56) / stage.dpr;
  const fitRpx = Math.min((mapW * 0.8) / (bb.x1 - bb.x0), (F.css.h * 0.7) / (bb.y1 - bb.y0)) * stage.R;
  const cityCam = (rpx) => {
    const s = rpx / stage.R;
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    return { x: cx + (F.css.w / 2 - mapW / 2) / s, y: cy + 10 / s, rpx };
  };
  const hcA = cityCam(fitRpx * 0.95), hcB = cityCam(fitRpx * 1.07);
  shot({
    id: "city", t0: T_CITY, trans: "cut", t1: T_AND,
    cues: [FLY - CITY_IN, 1.3],
    render(t) {
      const cam = t < FLY ? camFly(impCam(IMP_T), hcA, smoother(t / FLY), 1) : camAt(hcA, hcB, ((u) => 0.5 * u + 0.5 * u * u)(clamp01((t - FLY) / (CITY_T - FLY))));
      const on = smooth((t - (FLY - CITY_IN)) / CITY_IN);
      const cityAnimMs = Math.max(0, t - (FLY - CITY_IN)) * 1000;
      if (on >= 1) return [{ view: { ...cam, city: hc.id, cityAnimMs } }];
      const out = [{ view: { ...cam, layers: layersAt(STAGES.length) } }];
      const noNames = smooth(t / 0.35);
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

  // 7. Patagonia: start on Torres del Paine, pull back to the whole country. (Id "trade" is what score.js looks for.) --
  const AND_T = T_END - T_AND;
  const nProt = won.filter((x) => x.rule === "protected_area").length;
  const wiki = src.get("wikidata_rm");
  const andA = key(paine.x + 20, paine.y + 15, 320);
  const endB = key(land.cx + 10, land.cy + 5, (land.y1 - land.y0 + 2 * stage.R) * 1.1);
  const andCam = (t) => {
    const k = easeOutQ(t / (T_OUT - T_AND)), z = camZoom(andA, endB, k), l = camAt(andA, endB, k);
    return { x: (z.x + l.x) / 2, y: (z.y + l.y) / 2, rpx: z.rpx };
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
      const [sx, sy] = frame.toScreen(paine.x, paine.y);
      pulseRing(ctx, sx, sy, frame.cam.scale * stage.R * 1.5 * 2.2, a, t);
      caption(ctx, W, H, {
        kicker: "Patagonia",
        title: paine.short,
        sub: `${int(paine.metrics.area_km2)} km² · una de las ${nProt} áreas protegidas del mapa`,
        source: wiki ? srcLabel(wiki).replace(/\s*de la Región Metropolitana.*$/, "") : "Wikidata",
      }, win(t, 0.45, AND_T - 0.05, 0.45, 0.3), clamp01((t - 0.45) / 0.6));
    },
  });

  // 8. End card: the camera keeps settling on the whole country as the wonders fade and the card comes up. ---------
  shot({
    id: "end", t0: T_END, trans: "cut", t1: T_OUT,
    render(t) {
      const cam = andCam(AND_T + t);
      return [
        { view: { ...cam, ...WIDE } },
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
