// Economy advisor: GDP by industry, city GDP on the map, leaders, specialisation and growth vs output.
// "Metros" are the cities of cities.json: in the Santiago build the 52 comunas (docs/PORTING.md).
// Chile has no GDP by comuna: the "gdp" field holds annual sales of firms headquartered there (SII), so the copy says sales.
import { esc, fin, ratio, colorScale, robustDomain, RAMPS } from "../core/util.js";
import { money, dollars, pct, compact, signedPct, count3, fmtShort } from "../core/fmt.js";
import { barList, rampLegend, sizeLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, selectBox, sourcesHtml, frameBtn } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { icon } from "../../../ui/icon.js";
import { hasIcon } from "../../../icons.js";
import { T } from "../../../terms.js";

export const METRO_MIN = 100000; // comunas of 100 mil residents or more
// City income when the data gives the measure no label: the median total income per tax unit on filed returns.
const INCOME_ES = "Mediana de ingreso por declarante";
const short = (s) => String(s || "").replace(/\s*[（(].*[）)]\s*$/, "");
const indIcon = (k) => (hasIcon(`i-${k}`) ? icon(`i-${k}`, "•", { size: 14 }) : k === "government" ? icon("i-public_admin", "🏛", { size: 14 }) : "");

export function mount(ctx) {
  const { app, data, el, link, params } = ctx;
  const nation = app.data.nation;
  const n = nation.nation || {};
  const metros = data.levels.metros;
  const rows = metros.rows;
  const INCOME = metros.field("median_income")?.label || INCOME_ES;
  const gdpInd = n.gdp_by_industry || {};
  const jobInd = Object.keys(nation.industries || {});
  const indName = (k) => short(nation.industries?.[k] || k);
  const minPop = compact(METRO_MIN);

  // --- headline -------------------------------------------------------------------------------------------------
  const topInd = Object.entries(gdpInd).filter(([, v]) => fin(v)).sort((a, b) => b[1] - a[1])[0];
  // Without GDP by industry the third tile shows the biggest employer instead.
  const topJob = Object.entries(n.jobs || {}).filter(([, v]) => fin(v)).sort((a, b) => b[1] - a[1])[0];
  el.insertAdjacentHTML("beforeend", tiles([
    { label: `Ventas anuales ${n.gdp_year || ""}`.trim(), value: money(n.gdp), sub: nation.gdp_vintage || "Pesos corrientes" },
    { label: "Ventas por habitante", value: money(ratio(n.gdp, n.population)), sub: "Ventas ÷ población" },
    topInd
      ? { label: "Mayor rubro", value: short(nation.gdp_industries?.[topInd[0]] || nation.industries?.[topInd[0]] || topInd[0]), sub: `${pct(topInd[1] / n.gdp)} de las ventas` }
      : { label: "Mayor rubro en empleo", value: topJob ? indName(topJob[0]) : "–", sub: topJob && fin(ratio(topJob[1], n.employed)) ? `${pct(topJob[1] / n.employed)} de los ocupados` : "" },
  ]));

  // --- GDP by industry ------------------------------------------------------------------------------------------
  const states = app.data.states || [];
  const indRows = Object.entries(gdpInd).filter(([, v]) => fin(v)).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
    key: k, label: short(nation.gdp_industries?.[k] || nation.industries?.[k] || k), full: nation.gdp_industries?.[k], value: v, text: money(v), sub: pct(v / n.gdp), icon: indIcon(k),
  }));
  let indBars = null;
  if (indRows.length) {
    const indBody = section(el, { title: "Ventas por rubro", kicker: `${T.nationName}`, note: `Ventas anuales de cada rubro. Pasa el cursor sobre un rubro para marcar las ${T.states} donde pesa más en la economía; haz clic para listar las comunas más especializadas en él.` });
    indBars = barList(indBody, {
      rows: indRows, ariaLabel: "Ventas por rubro",
      onHover: (r) => {
        if (!r) return link.hover(null);
        const top = states.map((s, i) => ({ i, v: ratio(s.gdp_by_industry?.[r.key], s.gdp) })).filter((x) => fin(x.v)).sort((a, b) => b.v - a.v).slice(0, 8);
        link.hover({ states: new Set(top.map((x) => x.i)), dimOthers: true });
      },
      onClick: (r) => {
        const k = r.key === "government" ? "public_admin" : r.key;
        if (!jobInd.includes(k)) return; // no jobs by that industry key: nothing to rank
        setIndustry(k);
        specBody.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    });
  }

  // --- map: city GDP circles ------------------------------------------------------------------------------------
  const mapBody = section(el, { title: "Economía de las comunas en el mapa", note: "Cada círculo es una comuna: su área son las ventas y su color, las ventas por habitante. Pasa el cursor sobre un círculo para ver las cifras; haz clic para abrir la comuna." });
  const ppDomain = robustDomain(rows.filter((r) => r.v.population >= 100000).map((r) => r.v.gdp_pc), 0.03, true)
    || robustDomain(rows.map((r) => r.v.gdp_pc), 0.03, true) || [1, 10];
  const ppColor = colorScale({ type: "seq", domain: ppDomain, ramp: RAMPS.gold });
  const gMax = Math.max(1, ...rows.map((r) => r.v.gdp || 0));
  const bubbles = ctx.bubbles("gdp", {
    rMax: 30, minR: 1.5, alpha: 0.6,
    tip: (b) => `<b>${esc(b.row.name)}</b><br>Ventas <b>${money(b.row.v.gdp)}</b> · por habitante <b>${money(b.row.v.gdp_pc)}</b><br>Población ${count3(b.row.v.population)}`,
    onHover: (b) => { table.setHot(b ? b.key : null); scatter.setHot(b ? b.key : null); link.hover(b ? rowsHighlight(metros, [b.row]) : null); },
    onClick: (b) => app.selectCity(b.row.ref),
  });
  const bubbleItems = rows.filter((r) => fin(r.v.gdp)).map((r) => ({ key: r.key, x: app.w.grid.cx(r.ref.cell), y: app.w.grid.cy(r.ref.cell), value: r.v.gdp, color: ppColor(r.v.gdp_pc), row: r }));
  bubbles.set(bubbleItems, { vMax: gMax });
  const showBubbles = document.createElement("label");
  showBubbles.className = "adv-check";
  showBubbles.innerHTML = `<input type="checkbox" checked> Mostrar círculos de ventas`;
  showBubbles.querySelector("input").addEventListener("change", (e) => bubbles.set(e.target.checked ? bubbleItems : [], { vMax: gMax }));
  mapBody.appendChild(showBubbles);
  // Legend circles at the three powers of ten up to the largest GDP on the map, whatever the currency's scale.
  const gTop = 10 ** Math.floor(Math.log10(gMax));
  mapBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.gold, domain: ppDomain, fmt: money, label: "Ventas por habitante" })
    + sizeLegend([gTop / 100, gTop / 10, gTop].filter((v) => v >= 1 && v <= gMax), (v) => 30 * Math.sqrt(v / gMax), money, "Área del círculo = ventas (con el zoom inicial)"));

  // --- leaders --------------------------------------------------------------------------------------------------
  const lBody = section(el, { title: "Comunas líderes", note: `Las ventas por habitante solo ordenan comunas de ${minPop} habitantes o más (en las comunas pequeñas, una sola empresa mueve la cifra).` });
  const big = rows.filter((r) => (r.v.population || 0) >= METRO_MIN);
  segmented(lBody, {
    label: "Ordenar por", value: "gdp",
    options: [{ value: "gdp", label: "Mayores ventas" }, { value: "gdp_pc", label: "Ventas por habitante" }, { value: "growth", label: "Mayor crecimiento" }],
    onChange: (v) => { table.setRows(v === "gdp" ? rows : big); table.setColumns(cols, { key: v, dir: "desc" }); },
  });
  // A city is a comuna here, so the name stands alone (no province after it).
  const nameCol = { key: "name", label: "Comuna", align: "l", value: (r) => r.name, html: (r) => esc(r.name) };
  const cols = [
    nameCol,
    { key: "gdp", label: "Ventas", width: "minmax(96px,1.2fr)", value: (r) => r.v.gdp, text: (r) => money(r.v.gdp), bar: { max: gMax, color: "rgba(224,181,76,.35)" } },
    { key: "gdp_pc", label: "Por habitante", value: (r) => r.v.gdp_pc, text: (r) => money(r.v.gdp_pc) },
    { key: "growth", label: "Crecimiento", value: (r) => r.v.growth, text: (r) => signedPct(r.v.growth) },
  ];
  const table = createTable(lBody, {
    caption: "Comunas por ventas", columns: cols, rows, sort: { key: "gdp", dir: "desc" }, rank: true, maxHeight: 280,
    search: "Buscar comunas",
    onHover: (r) => { link.hover(r ? rowsHighlight(metros, [r]) : null); bubbles.setHot(r ? r.key : null); scatter.setHot(r ? r.key : null); },
    onClick: (r) => app.selectCity(r.ref),
  });

  // --- specialisation -------------------------------------------------------------------------------------------
  const specBody = section(el, { title: "Quién se especializa en qué", note: `Cociente de localización (CL): la proporción de los ocupados de la comuna que trabaja en el rubro ÷ la proporción ${T.ofNation}. ×2 significa el doble de concentración que ${T.inNation}. Solo comunas de ${minPop} habitantes o más; las 15 más especializadas se marcan en el mapa.` });
  if (!jobInd.length) specBody.closest("section").hidden = true; // nation.json has no industries
  let industry = params.industry && jobInd.includes(params.industry) ? params.industry : jobInd.includes("manufacturing") ? "manufacturing" : jobInd[0];
  const indSel = selectBox(specBody, {
    label: "Rubro", value: industry,
    options: jobInd.map((k) => ({ value: k, label: indName(k) })),
    onChange: (v) => setIndustry(v),
  });
  const specInfo = document.createElement("p");
  specInfo.className = "adv-note";
  specBody.appendChild(specInfo);
  const lq = (r, k = industry) => {
    const o = r.ref;
    const us = ratio(n.jobs?.[k], n.employed);
    return us ? ratio(ratio(o.jobs?.[k], o.employed), us) : null;
  };
  const specCols = (maxLq, alpha) => [
    nameCol,
    { key: "share", label: "Parte del empleo", value: (r) => ratio(r.ref.jobs?.[industry], r.ref.employed), text: (r) => pct(ratio(r.ref.jobs?.[industry], r.ref.employed)) },
    { key: "lq", label: "CL", value: (r) => lq(r), text: (r) => (fin(lq(r)) ? `×${lq(r).toFixed(2)}` : "–"), bar: { max: maxLq, color: `rgba(74,134,214,${alpha})` } },
    { key: "workers", label: "Trabajadores", value: (r) => r.ref.jobs?.[industry], text: (r) => count3(r.ref.jobs?.[industry]) },
  ];
  const specTable = createTable(specBody, {
    caption: "Comunas más especializadas", rank: true, maxHeight: 260, rows: [],
    columns: specCols(1, 0.4),
    sort: { key: "lq", dir: "desc" },
    onHover: (r) => { link.hover(r ? rowsHighlight(metros, [r]) : null); scatter.setHot(r ? r.key : null); bubbles.setHot(r ? r.key : null); },
    onClick: (r) => app.selectCity(r.ref),
  });

  // --- scatter --------------------------------------------------------------------------------------------------
  const scBody = section(el, { title: "Crecimiento y ventas", note: "Cada punto es una comuna: ventas por habitante en el eje horizontal, crecimiento de la población en el vertical y tamaño según población. Arrastra para dibujar un rectángulo, seleccionar comunas y marcarlas en el mapa." });
  const scCtl = document.createElement("div");
  scCtl.className = "adv-row";
  scBody.appendChild(scCtl);
  let colorBy = jobInd.length ? "lq" : "none", allMetros = false;
  selectBox(scCtl, {
    label: "Color", value: colorBy,
    // A measure with no value for any city is not offered.
    options: [...(jobInd.length ? [{ value: "lq", label: "Especialización (rubro elegido)" }] : []), { value: "unemployment", label: "Desempleo" }, { value: "median_income", label: INCOME }, { value: "none", label: "Ninguno" }]
      .filter((o) => o.value === "lq" || o.value === "none" || rows.some((r) => fin(r.v[o.value]))),
    onChange: (v) => { colorBy = v; drawScatter(); },
  });
  segmented(scCtl, { label: "Comunas", value: "big", options: [{ value: "big", label: `${minPop} o más` }, { value: "all", label: "Todas" }], onChange: (v) => { allMetros = v === "all"; drawScatter(); } });
  const legendEl = document.createElement("div");
  const scatter = createScatter(scBody, {
    points: [], height: 300,
    x: { label: "Ventas por habitante", fmt: (v) => money(v), log: true },
    y: { label: "Crecimiento de la población", fmt: (v) => fmtShort("signed", v) },
    size: { label: "Población", fmt: count3, max: 15, min: 2 },
    refY: [{ v: n.growth ?? 0, label: `${T.NationShort} ${signedPct(n.growth)}` }],
    onHover: (p) => { link.hover(p ? rowsHighlight(metros, [p.row]) : null); bubbles.setHot(p ? p.key : null); table.setHot(p ? p.key : null, false); },
    onClick: (p) => app.selectCity(p.row.ref),
    onBrush: (set) => {
      const sel = set ? rows.filter((r) => set.has(r.key)) : [];
      link.base(sel.length ? rowsHighlight(metros, sel, { dim: true }) : specHighlight(), { frame: sel.length > 1 });
      bubbles.setSelected(set);
      brushInfo.innerHTML = sel.length ? brushSummary(sel) : "";
    },
  });
  scBody.appendChild(legendEl);
  const brushInfo = document.createElement("div");
  brushInfo.className = "adv-brushinfo";
  scBody.appendChild(brushInfo);
  function brushSummary(sel) {
    const pop = sel.reduce((a, r) => a + (r.v.population || 0), 0);
    const gdp = sel.reduce((a, r) => a + (r.v.gdp || 0), 0);
    return `<b>${sel.length}</b> comunas seleccionadas · población ${count3(pop)} · ventas ${money(gdp)}${fin(ratio(gdp, n.gdp)) ? ` (${pct(gdp / n.gdp)} ${T.ofNation})` : ""} ${frameBtn()}<button type="button" class="adv-mini" data-clear>Limpiar</button>`;
  }
  brushInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) { scatter.setSelected(null); link.base(specHighlight()); bubbles.setSelected(null); brushInfo.innerHTML = ""; } });

  function drawScatter() {
    const list = rows.filter((r) => allMetros || (r.v.population || 0) >= METRO_MIN);
    const cv = (r) => (colorBy === "lq" ? lq(r) : colorBy === "none" ? null : r.v[colorBy]);
    let color = null, legend = "";
    if (colorBy !== "none") {
      const dom = robustDomain(list.map(cv), 0.03, colorBy === "lq") || [0, 1];
      const spec = colorBy === "lq" ? { type: "seq", domain: [Math.max(0.2, dom[0]), Math.max(1.5, dom[1])], log: true, ramp: RAMPS.seq } : { type: "seq", domain: dom, ramp: colorBy === "unemployment" ? RAMPS.heat : RAMPS.gold };
      const cs = colorScale(spec);
      color = (c) => cs(c);
      const f = colorBy === "lq" ? (v) => `×${v.toFixed(1)}` : colorBy === "unemployment" ? (v) => pct(v) : money;
      legend = rampLegend({ ramp: spec.ramp, domain: spec.domain, fmt: f, log: spec.log, label: colorBy === "lq" ? `Especialización en ${indName(industry)} (cociente de localización)` : colorBy === "unemployment" ? "Desempleo" : INCOME });
    }
    const labels = [...list].sort((a, b) => (b.v.population || 0) - (a.v.population || 0)).slice(0, 8).map((r) => r.key);
    scatter.update({
      points: list.filter((r) => fin(r.v.gdp_pc) && fin(r.v.growth)).map((r) => ({ key: r.key, x: r.v.gdp_pc, y: r.v.growth, s: r.v.population, c: cv(r), label: r.name, sub: "", row: r })),
      color, labels, colorLabel: colorBy === "none" ? null : colorBy === "lq" ? "CL" : colorBy === "unemployment" ? "Desempleo" : INCOME,
      colorFmt: colorBy === "lq" ? (v) => `×${(+v).toFixed(2)}` : colorBy === "unemployment" ? pct : dollars,
    });
    legendEl.innerHTML = legend;
  }

  let specTop = [];
  const specHighlight = () => (specTop.length ? rowsHighlight(metros, specTop, { ringMax: 15 }) : null);
  function setIndustry(k) {
    industry = k;
    if (k != null) indSel.set(k);
    const list = big.filter((r) => fin(lq(r))).sort((a, b) => lq(b) - lq(a));
    specTop = list.slice(0, 15);
    const maxLq = Math.max(1, ...list.slice(0, 40).map((r) => lq(r)));
    specTable.setColumns(specCols(maxLq, 0.45), { key: "lq", dir: "desc" });
    specTable.setRows(list);
    const us = ratio(n.jobs?.[k], n.employed);
    specInfo.innerHTML = k == null ? "" : `${T.NationShort}: <b>${pct(us)}</b> de los ocupados (${count3(n.jobs?.[k])}) trabaja en ${esc(indName(k))}.`;
    if (!scatter.selected) link.base(specHighlight());
    indBars?.setSelected(k === "public_admin" ? "government" : k);
    drawScatter();
  }
  setIndustry(industry);

  // Sources and vintages come from the data (field definitions, nation.json), not from a list written here.
  const srcIds = [...["gdp", "gdp_pc", "population", "employed", "unemployment", "median_income"].filter((k) => rows.some((r) => fin(r.v[k]))).map((k) => metros.field(k)?.source), "ine_censo2024", ...(nation.sources || [])];
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, srcIds, [
    ...(nation.gdp_vintage && nation.vintage && nation.gdp_vintage !== nation.vintage
      ? [`Las ventas vienen de "${esc(nation.gdp_vintage)}", y la población y el empleo de "${esc(nation.vintage)}": las ventas por habitante dividen dos cifras de fuentes distintas, posiblemente de años distintos.`] : []),
    "La especialización (cociente de localización) se calcula con la estructura del empleo de cada comuna: mide concentración del empleo, no de las ventas.",
    `Las comunas de menos de ${minPop} habitantes no entran en los rankings de ventas por habitante ni de especialización; elige "Todas" para verlas en el gráfico de dispersión.`,
  ]));

  return {
    onMapHover(h) {
      const r = h.cell >= 0 ? metros.rowAtCell(h.cell) : null;
      scatter.setHot(r ? r.key : null);
      specTable.setHot(r ? r.key : null);
    },
    onEscape() {
      if (scatter.selected) { scatter.setSelected(null); link.base(specHighlight()); bubbles.setSelected(null); brushInfo.innerHTML = ""; return true; }
      return false;
    },
  };
}
