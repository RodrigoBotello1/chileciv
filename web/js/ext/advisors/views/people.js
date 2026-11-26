// People advisor: population, growth, density, age and immigration.
// Levels: states = provinces, metros = the cities of cities.json (the 52 comunas), counties = comuna detail. County sections
// appear only when counties.json has the column with at least one value (a build may lack some).
import { esc, fin, colorScale, robustDomain, RAMPS } from "../core/util.js";
import { pct, int, compact, signedPct, count3, fmtShort, fmtValue } from "../core/fmt.js";
import { barList, histogram, rampLegend } from "../core/charts.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, mapPicker, frameBtn, sourcesHtml, topBy } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { growthLens } from "../core/lenses.js";

const METRO_MIN = 100000; // comunas of 100 mil residents or more

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const n = data.nat;
  const { states, metros, counties } = data.levels;
  const yrs = n.growth_years || [];
  const minPop = compact(METRO_MIN);
  const has = (k) => !!counties && counties.rows.some((r) => fin(r.v[k]));
  const hasLens = (id) => !!app.lensById?.has(id);
  // A column's own label from counties.json when it has one, else ours.
  const lab = (k, es) => counties?.field(k)?.label || es;
  // The province a comuna-detail row belongs to, by name.
  const stName = new Map((app.w.raw.states || []).flatMap((s) => [[s.abbr, s.name], [s.fips, s.name]]));
  const parentOf = (r) => (r.level === "counties" ? stName.get(r.v.state) || stName.get(String(r.key).slice(0, 3)) || "" : "");

  el.insertAdjacentHTML("beforeend", tiles([
    { label: "Población", value: count3(n.population), sub: data.vintage },
    { label: `Crecimiento de la población ${yrs.join("–")}`.trim(), value: signedPct(n.growth, 2), sub: "Población a fin de año según registros oficiales" },
    { label: "Divisiones administrativas", value: `${int(states.rows.length || metros.rows.length)} provincias`, sub: counties ? `${int(counties.rows.length)} comunas (detalle)` : "" },
  ]));

  // --- the map: growth by default, so the map tells the same story as the first chart ---------------------------
  let gLevel = "metros";
  const mapRow = document.createElement("div");
  mapRow.className = "adv-sec adv-mapsec";
  el.appendChild(mapRow);
  // A lens is offered under its own name from lenses.json when it has one.
  const lensOpt = (value, label, id) => { const nm = app.lensById?.get(id)?.name; return hasLens(id) ? [{ value, label: nm || label, lens: () => id }] : []; };
  const picker = mapPicker(ctx, mapRow, {
    value: "growth", label: "Mapa",
    options: [
      { value: "growth", label: "Crecimiento de la población", lens: () => growthLens(data, gLevel) },
      ...(counties ? [...lensOpt("density", "Densidad de población", "density"), ...lensOpt("age", "Edad", "age"), ...lensOpt("foreign_born", lab("foreign_born", "Nacidos en el extranjero"), "foreign_born")] : []),
      { value: "terrain", label: "Terreno", lens: () => null },
    ],
  });

  // --- growth ---------------------------------------------------------------------------------------------------
  const gBody = section(el, { title: "Quién crece y quién pierde población", note: `${yrs.length ? `Cambio de la población entre ${yrs.join("–")}` : "Cambio de la población"} (registros oficiales), con las mismas divisiones administrativas en ambos años. Las comunas solo entran con ${minPop} habitantes o más.` });
  const gHost = document.createElement("div");
  segmented(gBody, { label: "Unidad", value: gLevel, options: [{ value: "metros", label: "Comunas" }, { value: "states", label: "Provincias" }], onChange: (v) => { gLevel = v; drawGrowth(); if (picker.value === "growth") picker.refresh(); } });
  gBody.appendChild(gHost);
  function drawGrowth() {
    gHost.innerHTML = "";
    const lv = gLevel === "metros" ? metros : states;
    const min = gLevel === "metros" ? METRO_MIN : 0;
    const fast = topBy(lv.rows, (r) => r.v.growth, { n: 8, min });
    const slow = topBy(lv.rows, (r) => r.v.growth, { n: 8, min, asc: true });
    if (!fast.length) { gHost.innerHTML = `<p class="adv-empty">Sin datos</p>`; return; }
    const max = Math.max(...[...fast, ...slow].map((x) => Math.abs(x.v)));
    const mk = (list) => list.map((x) => ({ key: x.r.key, label: x.r.name, sub: "", value: x.v, text: signedPct(x.v), tone: x.v >= 0 ? "good" : "bad", row: x.r }));
    const opts = {
      diverging: true, max,
      onHover: (r) => link.hover(r ? rowsHighlight(lv, [r.row]) : null),
      onClick: (r) => lv.focus(r.row),
    };
    const slowTitle = slow.every((x) => x.v < 0) ? "Población en descenso" : "Crecimiento más lento";
    gHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Crecimiento más rápido</h4>`);
    barList(gHost, { ...opts, rows: mk(fast), ariaLabel: "Crecimiento más rápido" });
    gHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${slowTitle}</h4>`);
    barList(gHost, { ...opts, rows: mk(slow), ariaLabel: slowTitle });
  }
  drawGrowth();

  const baseSrc = ["ine_censo2024", metros.field("population")?.source, states.field("population")?.source];
  if (!counties) {
    el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">Aún no se construye counties.json, así que no hay gráficos de comunas en detalle.</p>`);
    el.insertAdjacentHTML("beforeend", sourcesHtml(data, baseSrc, []));
    return {};
  }

  // --- density --------------------------------------------------------------------------------------------------
  const cByKey = counties.byKey;
  let hist = null, pinnedBin = null;
  const binInfo = document.createElement("div");
  binInfo.className = "adv-brushinfo";
  if (has("density")) {
    const dBody = section(el, { title: "Qué tan apretados vivimos", note: "Habitantes por kilómetro cuadrado de cada comuna (escala logarítmica). Cambia a \"Población\" para ponderar por habitantes: la mayoría vive en el extremo más denso. Pasa el cursor sobre una barra para ver esas comunas; haz clic para dejarlas marcadas." });
    const dCtl = document.createElement("div");
    dCtl.className = "adv-row";
    dBody.appendChild(dCtl);
    let weighted = false;
    segmented(dCtl, { label: "Contar", value: "counties", options: [{ value: "counties", label: "Comunas" }, { value: "people", label: "Población" }], onChange: (v) => { weighted = v === "people"; drawHist(); } });
    if (hasLens("density")) {
      const dLens = document.createElement("button");
      dLens.type = "button";
      dLens.className = "adv-mini";
      dLens.textContent = "Colorear el mapa por densidad de población";
      dLens.addEventListener("click", () => picker.set("density"));
      dCtl.appendChild(dLens);
    }
    const histHost = document.createElement("div");
    dBody.appendChild(histHost);
    dBody.appendChild(binInfo);
    const popSum = counties.rows.reduce((a, r) => a + (r.v.population || 0), 0);
    const landSum = counties.rows.reduce((a, r) => a + (r.v.land_km2 || 0), 0);
    const avgDensity = landSum > 0 ? popSum / landSum : null;
    // The histogram spans the data (a little beyond the sparsest and densest comuna).
    const dVals = counties.rows.map((r) => r.v.density).filter((v) => fin(v) && v > 0);
    const dom = dVals.length ? [Math.min(...dVals) * 0.8, Math.max(...dVals) * 1.25] : [0.3, 30000];
    const densRamp = RAMPS.heat;
    const drawHist = () => {
      histHost.innerHTML = "";
      const vals = counties.rows.map((r) => ({ key: r.key, v: r.v.density, w: r.v.population }));
      hist = histogram(histHost, {
        values: vals, log: true, bins: 30, domain: dom, weighted, height: 130,
        fmt: (v) => fmtShort("float", v), unitLabel: "comunas", weightFmt: (w) => `Población ${count3(w)}`,
        label: "Histograma de densidad de población por comuna",
        colorOf: (_, t) => colorScale({ type: "seq", domain: [0, 1], ramp: densRamp })(t),
        markers: fin(avgDensity) ? [{ v: avgDensity, label: "Promedio regional" }] : [],
        onHover: (bin) => link.hover(bin ? rowsHighlight(counties, bin.keys.map((k) => cByKey.get(k)), { dim: true }) : null),
        onClick: (bin) => {
          pinnedBin = pinnedBin === bin.i ? null : bin.i;
          const rows = pinnedBin != null ? bin.keys.map((k) => cByKey.get(k)) : [];
          link.base(rows.length ? rowsHighlight(counties, rows, { dim: true }) : null, { frame: rows.length > 1 });
          binInfo.innerHTML = rows.length ? `<b>${int(rows.length)}</b> comunas, ${fmtShort("float", bin.x0)}–${fmtShort("float", bin.x1)} hab/km² · población ${count3(rows.reduce((a, r) => a + (r.v.population || 0), 0))} ${frameBtn()}<button type="button" class="adv-mini" data-clear>Limpiar</button>` : "";
        },
      });
    };
    binInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) { pinnedBin = null; link.base(null); binInfo.innerHTML = ""; } });
    drawHist();
  }

  // --- age and foreign-born -------------------------------------------------------------------------------------
  let scatter = null;
  const selInfo = document.createElement("div");
  selInfo.className = "adv-brushinfo";
  const hasAge = has("median_age") && has("foreign_born");
  if (hasAge) {
    const ageLabel = lab("median_age", "Mediana de edad"), fbLabel = lab("foreign_born", "Nacidos en el extranjero");
    const colourNote = has("density") ? ", color según densidad de población" : "";
    const fbFmt = counties.field("foreign_born")?.format || "pct";
    const aBody = section(el, { title: `Edad y ${fbLabel.toLowerCase()}`, note: `Cada punto es una comuna: ${esc(ageLabel.toLowerCase())} en el eje horizontal, ${esc(fbLabel.toLowerCase())} en el vertical y tamaño según población${colourNote}. Arrastra para dibujar un rectángulo, seleccionar comunas y marcarlas en el mapa. Pasa el cursor sobre el mapa para ubicar la comuna en el gráfico.` });
    const mapBtns = [["age", ageLabel], ["foreign_born", fbLabel]].filter(([id]) => hasLens(id));
    if (mapBtns.length) {
      const aCtl = document.createElement("div");
      aCtl.className = "adv-row";
      aBody.appendChild(aCtl);
      aCtl.innerHTML = `<span class="adv-note">Colorear el mapa por</span>${mapBtns.map(([id, label]) => `<button type="button" class="adv-mini" data-map="${id}">${esc(label)}</button>`).join("")}`;
      aCtl.addEventListener("click", (e) => { const v = e.target.closest("[data-map]")?.dataset.map; if (v) picker.set(v); });
    }
    const dDom = robustDomain(counties.rows.map((r) => r.v.density), 0.02, true) || [1, 2000];
    const dColor = colorScale({ type: "seq", domain: dDom, log: true, ramp: RAMPS.heat });
    const big = topBy(counties.rows, (r) => r.v.population, { n: 6 }).map((x) => x.r.key);
    const medAge = medianOf(counties.rows, "median_age");
    scatter = createScatter(aBody, {
      height: 310,
      points: counties.rows.map((r) => ({ key: r.key, x: r.v.median_age, y: r.v.foreign_born, s: r.v.population, c: r.v.density, label: r.name, sub: parentOf(r), row: r })),
      x: { label: ageLabel, fmt: (v) => String(+v.toFixed(0)) },
      y: { label: fbLabel, fmt: (v) => fmtShort(fbFmt, v) },
      size: { label: "Población", fmt: count3, max: 14, min: 1.4 },
      ...(has("density") ? { color: (c) => dColor(c), colorLabel: "Densidad de población", colorFmt: (v) => `${fmtValue("float", v)} hab/km²` } : {}),
      labels: big,
      refX: fin(medAge) ? [{ v: medAge, label: "Mediana de las comunas" }] : [],
      onHover: (p) => link.hover(p ? rowsHighlight(counties, [p.row]) : null),
      onClick: (p) => counties.focus(p.row),
      onBrush: (set) => {
        const sel = set ? counties.rows.filter((r) => set.has(r.key)) : [];
        link.base(sel.length ? rowsHighlight(counties, sel, { dim: true }) : null, { frame: sel.length > 1 });
        selInfo.innerHTML = sel.length ? selSummary(sel) : "";
      },
    });
    if (has("density")) aBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.heat, domain: dDom, log: true, fmt: (v) => fmtShort("float", v), label: "Habitantes por km²" }));
    aBody.appendChild(selInfo);
    selInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) { scatter.setSelected(null); link.base(null); selInfo.innerHTML = ""; } });
  }
  function selSummary(sel) {
    const pop = sel.reduce((a, r) => a + (r.v.population || 0), 0);
    const top = [...sel].sort((a, b) => (b.v.population || 0) - (a.v.population || 0)).slice(0, 5);
    return `<b>${int(sel.length)}</b> comunas · población ${count3(pop)}${fin(n.population) && n.population > 0 ? ` (${pct(pop / n.population)} de la región)` : ""}<br><span class="sub">Más pobladas: ${top.map((r) => `${esc(r.name)}${parentOf(r) ? ` (${esc(parentOf(r))})` : ""}`).join(" · ")}</span> ${frameBtn()}<button type="button" class="adv-mini" data-clear>Limpiar</button>`;
  }

  const countySrc = ["population", "land_km2", "density", "median_age", "foreign_born"].map((k) => counties.field(k)?.source);
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, [...baseSrc, ...countySrc], [
    "El mapa de crecimiento colorea cada comuna por su propio cambio de población; los hexágonos grises no pertenecen a ninguna. Cambia el gráfico a \"Provincias\" y cada hexágono toma el color de su provincia.",
    "El crecimiento se calcula con la población de registros oficiales, con las mismas divisiones administrativas en los dos años.",
    `Las cifras de las comunas en detalle son de "${esc(data.countyVintage)}", y su año puede ser distinto al de las provincias y comunas-ciudad.`,
    ...(hasAge ? ["Cada punto es la mediana de edad de esa comuna; la mediana de un grupo de comunas no es el promedio de sus medianas."] : []),
    ...(data.countiesOffMap ? [`Las ${int(data.countiesOffMap)} comunas más pequeñas no llegan a un hexágono: al seleccionarlas no se marca nada en el mapa.`] : []),
  ]));

  return {
    onMapHover(h) {
      const r = h.cell >= 0 ? counties.rowAtCell(h.cell) : null;
      scatter?.setHot(r ? r.key : null);
      hist?.setHot(r ? hist.binOf(r.v.density)?.i ?? null : null);
    },
    onEscape() {
      if (scatter?.selected || pinnedBin != null) {
        scatter?.setSelected(null); pinnedBin = null; link.base(null); selInfo.innerHTML = ""; binInfo.innerHTML = "";
        return true;
      }
      return false;
    },
  };
}

function medianOf(rows, k) {
  const s = rows.map((r) => r.v[k]).filter(fin).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}
