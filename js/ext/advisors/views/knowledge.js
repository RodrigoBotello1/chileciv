// Knowledge advisor: degrees, broadband and the Science yield.
// County-level (comuna detail) sections need their counties.json column to have values: a build without broadband or income
// hides those charts, and the distribution chart then shows degrees instead of broadband. Each column is labelled
// and formatted by its own field metadata (label, unit, format): the ids are inherited from the US build, and in
// the Santiago build `broadband` may be a speed in Mbps rather than a share of households (see its field unit).
import { esc, fin, ratio, colorScale, robustDomain, RAMPS } from "../core/util.js";
import { pct, int, compact, count3, fmtShort, fmtCell } from "../core/fmt.js";
import { barList, histogram, rampLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, mapPicker, frameBtn, sourcesHtml, topBy } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { scienceLens } from "../core/lenses.js";
import { CURRENCY } from "../../../format.js";
import { T } from "../../../terms.js";

const METRO_MIN = 100000; // comunas of 100 mil residents or more
const LEVEL_NAME = { counties: "Comunas (detalle)", metros: "Comunas" };
// City income when the data gives the measure no label: the median total income per tax unit on filed returns.
const INCOME_ES = "Mediana de ingreso por declarante";

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const n = data.nat;
  const nation = app.data.nation;
  const { metros, counties } = data.levels;
  const INCOME = metros.field("median_income")?.label || INCOME_ES;
  const sci = nation.yields?.find((y) => y.key === "science");
  const sciName = sci?.label || "Ciencia";
  const usSci = n.yields?.science;
  const usShare = ratio(usSci, n.employed);
  const has = (k) => !!counties && counties.rows.some((r) => fin(r.v[k]));
  const hasLens = (id) => !!app.lensById?.has(id);
  // A column's own label from counties.json when it has one, else ours.
  const lab = (k, es) => counties?.field(k)?.label || es;
  const degLabel = lab("bachelors", "Estudios universitarios"), bbLabel = lab("broadband", "Acceso a internet");
  const fmtOf = (k) => counties?.field(k)?.format || "pct";
  // A short unit to print after a value that is not a share: the field's unit when brief, or its trailing
  // parenthesis ("Velocidad media de descarga móvil (Mbps)" → Mbps).
  const unitOf = (k) => {
    if (fmtOf(k) === "pct") return "";
    const u = String(counties?.field(k)?.unit || ""), m = /\(([^()]{1,8})\)$/.exec(u);
    return u.length <= 8 ? u : m ? m[1] : "";
  };
  const cell = (k, v) => (fin(v) ? `${fmtCell(fmtOf(k), v)}${unitOf(k) ? ` ${unitOf(k)}` : ""}` : "–");
  // The province a comuna-detail row belongs to, by name; a city row needs no such suffix.
  const stName = new Map((app.w.raw.states || []).flatMap((s) => [[s.abbr, s.name], [s.fips, s.name]]));
  const parentOf = (r) => (r.level === "counties" ? stName.get(r.v.state) || stName.get(String(r.key).slice(0, 3)) || "" : "");
  const wavg = (k) => {
    if (!counties) return null;
    let a = 0, w = 0;
    for (const r of counties.rows) if (fin(r.v[k]) && fin(r.v.population)) { a += r.v[k] * r.v.population; w += r.v.population; }
    return w ? a / w : null;
  };

  el.insertAdjacentHTML("beforeend", tiles([
    { label: `Empleo en ${sciName.toLowerCase()}`, value: count3(usSci), sub: fin(usShare) ? `${pct(usShare)} de los ocupados` : "", color: sci?.color },
    ...(has("bachelors") ? [{ label: degLabel, value: cell("bachelors", wavg("bachelors")), sub: "Promedio de las comunas ponderado por población" }] : []),
    ...(has("broadband") ? [{ label: bbLabel, value: cell("broadband", wavg("broadband")), sub: "Promedio de las comunas ponderado por población" }] : []),
  ]));

  // --- the map: degrees by default (the scatter's x axis), or the Science yield's share by city -----------------
  const mapRow = document.createElement("div");
  mapRow.className = "adv-sec adv-mapsec";
  el.appendChild(mapRow);
  const degLens = !!counties && hasLens("bachelors"), bbLens = !!counties && hasLens("broadband");
  const picker = mapPicker(ctx, mapRow, {
    value: degLens ? "bachelors" : "science", label: "Mapa",
    options: [
      ...(degLens ? [{ value: "bachelors", label: degLabel, lens: () => "bachelors" }] : []),
      { value: "science", label: `Empleo en ${sciName.toLowerCase()}`, lens: () => scienceLens(data) },
      ...(bbLens ? [{ value: "broadband", label: bbLabel, lens: () => "broadband" }] : []),
      { value: "terrain", label: "Terreno", lens: () => null },
    ],
  });

  // --- science yield --------------------------------------------------------------------------------------------
  // A description from the data, followed by a space unless it already ends in punctuation.
  const lead = (d) => (d ? esc(d) + (/[.!?;)]$/.test(d) ? "" : " ") : "");
  const sBody = section(el, { title: `Rendimiento de ${sciName.toLowerCase()}`, note: `${lead(sci?.description)}El ranking por proporción solo incluye comunas de ${compact(METRO_MIN)} habitantes o más.` });
  const sHost = document.createElement("div");
  let mode = "share";
  segmented(sBody, { label: "Ordenar por", value: mode, options: [{ value: "share", label: "Parte del empleo" }, { value: "abs", label: "Más trabajadores" }], onChange: (v) => { mode = v; drawSci(); } });
  const sMap = document.createElement("button");
  sMap.type = "button";
  sMap.className = "adv-mini";
  sMap.textContent = `Colorear el mapa por empleo en ${sciName.toLowerCase()}`;
  sMap.addEventListener("click", () => picker.set("science"));
  sBody.querySelector(".adv-seg")?.after(sMap);
  sBody.appendChild(sHost);
  const share = (r) => ratio(r.v.y_science, r.v.employed);
  function drawSci() {
    sHost.innerHTML = "";
    const list = mode === "abs" ? topBy(metros.rows, (r) => r.v.y_science, { n: 12 }) : topBy(metros.rows, share, { n: 12, min: METRO_MIN });
    if (!list.length) { sHost.innerHTML = `<p class="adv-empty">Sin datos</p>`; return; }
    const vsNation = (r) => (fin(share(r)) && usShare > 0 ? `${(share(r) / usShare).toFixed(2)} veces ${T.nation}` : "");
    barList(sHost, {
      rank: true, ariaLabel: `Ranking de empleo en ${sciName.toLowerCase()}`,
      rows: list.map((x) => ({ key: x.r.key, label: x.r.name, sub: mode === "abs" ? (fin(share(x.r)) ? pct(share(x.r)) : "") : vsNation(x.r), value: x.v, text: mode === "abs" ? count3(x.v) : pct(x.v), color: sci?.color, row: x.r })),
      onHover: (r) => link.hover(r ? rowsHighlight(metros, [r.row]) : null),
      onClick: (r) => metros.focus(r.row),
    });
  }
  drawSci();

  const sciSrc = [metros.field("y_science")?.source, metros.field("employed")?.source];
  if (!counties) {
    el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">Aún no se construye counties.json, así que no hay gráficos de comunas en detalle.</p>`);
    el.insertAdjacentHTML("beforeend", sourcesHtml(data, sciSrc, []));
    return {};
  }

  // --- degrees vs income ----------------------------------------------------------------------------------------
  const incOf = (r) => (r.level === "counties" ? r.v.income : r.v.median_income);
  const degLevels = ["counties", "metros"].filter((k) => data.levels[k].rows.some((r) => fin(r.v.bachelors) && fin(incOf(r))));
  let level = degLevels[0] || "counties";
  const lv = () => data.levels[level];
  let scatter = null;
  const selInfo = document.createElement("div");
  selInfo.className = "adv-brushinfo";
  const clearSel = () => { scatter?.setSelected(null); link.base(null); selInfo.innerHTML = ""; };
  const bbOn = has("broadband");
  const incLabelOf = (k) => (k === "counties" ? lab("income", "Ingreso") : INCOME);
  if (degLevels.length) {
    const dBody = section(el, { title: "Estudios e ingreso", note: `${esc(degLabel)} frente al ingreso${bbOn ? `; el color es ${esc(bbLabel)}` : ""}. Arrastra para seleccionar; pasa el cursor sobre el mapa para ubicar la comuna en el gráfico.` });
    const dCtl = document.createElement("div");
    dCtl.className = "adv-row";
    dBody.appendChild(dCtl);
    if (degLevels.length > 1) segmented(dCtl, { label: "Unidad", value: level, options: degLevels.map((k) => ({ value: k, label: LEVEL_NAME[k] })), onChange: (v) => { level = v; drawDeg(); } });
    const bbDom = robustDomain(counties.rows.map((r) => r.v.broadband), 0.02) || [0, 1];
    const bbColor = colorScale({ type: "seq", domain: bbDom, ramp: RAMPS.seq });
    scatter = createScatter(dBody, {
      height: 300, points: [],
      x: { label: degLabel, fmt: (v) => fmtShort(fmtOf("bachelors"), v) },
      y: { label: `${incLabelOf(level)} (${CURRENCY})`, fmt: compact, log: true },
      size: { label: "Población", fmt: count3, max: 14, min: 1.4 },
      ...(bbOn ? { color: (c) => bbColor(c), colorLabel: bbLabel, colorFmt: (v) => cell("broadband", +v) } : {}),
      onHover: (p) => link.hover(p ? rowsHighlight(lv(), [p.row]) : null),
      onClick: (p) => lv().focus(p.row),
      onBrush: (set) => {
        const sel = set ? lv().rows.filter((r) => set.has(r.key)) : [];
        link.base(sel.length ? rowsHighlight(lv(), sel, { dim: true }) : null, { frame: sel.length > 1 });
        selInfo.innerHTML = sel.length ? `<b>${int(sel.length)}</b> seleccionadas (${LEVEL_NAME[level].toLowerCase()}) · población ${count3(sel.reduce((a, r) => a + (r.v.population || 0), 0))} ${frameBtn()}<button type="button" class="adv-mini" data-clear>Limpiar</button>` : "";
      },
    });
    if (bbOn) dBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.seq, domain: bbDom, fmt: (v) => fmtShort(fmtOf("broadband"), v), label: `${bbLabel}${unitOf("broadband") ? ` (${unitOf("broadband")})` : ""}` }));
    dBody.appendChild(selInfo);
    selInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) clearSel(); });
    drawDeg();
  }
  function drawDeg() {
    clearSel();
    const rows = lv().rows;
    scatter.update({
      y: { label: `${incLabelOf(level)} (${CURRENCY})`, fmt: compact, log: true },
      points: rows.map((r) => ({ key: r.key, x: r.v.bachelors, y: incOf(r), s: r.v.population, c: r.v.broadband, label: r.name, sub: parentOf(r), row: r })),
      labels: topBy(rows, (r) => r.v.population, { n: 6 }).map((x) => x.r.key),
    });
  }

  // --- distribution: broadband, or degrees when the build has no broadband column --------------------------------
  const distKey = bbOn ? "broadband" : has("bachelors") ? "bachelors" : null;
  let distHist = null;
  if (distKey) {
    const isBb = distKey === "broadband";
    const distLabel = isBb ? bbLabel : degLabel;
    const desc = counties.field(distKey)?.description;
    const distFmt = fmtOf(distKey), distUnit = unitOf(distKey);
    const bBody = section(el, { title: `Distribución de ${distLabel.toLowerCase()}`, note: `${esc(distLabel)} en cada comuna${distUnit ? ` (${esc(distUnit)})` : ""}. ${desc ? lead(desc) : ""}Pasa el cursor sobre una barra para marcar esas comunas.` });
    const bHost = document.createElement("div");
    bBody.appendChild(bHost);
    // The axis spans the data; a share is widened to whole 5% steps.
    const vals = counties.rows.map((r) => r.v[distKey]).filter(fin);
    const dom = distFmt === "pct"
      ? [Math.max(0, Math.floor(Math.min(...vals) * 20) / 20), Math.min(1, Math.max(0.05, Math.ceil(Math.max(...vals) * 20) / 20))]
      : [Math.min(...vals), Math.max(...vals)];
    if (dom[1] <= dom[0]) dom[1] = dom[0] + (distFmt === "pct" ? 0.05 : 1);
    distHist = histogram(bHost, {
      values: counties.rows.map((r) => ({ key: r.key, v: r.v[distKey] })), bins: 30, domain: dom, height: 120,
      fmt: (v) => fmtShort(distFmt, v), unitLabel: "comunas", label: `Histograma de ${distLabel.toLowerCase()} por comuna`,
      colorOf: (_, t) => colorScale({ type: "seq", domain: [0, 1], ramp: RAMPS.seq })(t),
      onHover: (bin) => link.hover(bin ? rowsHighlight(counties, bin.keys.map((k) => counties.byKey.get(k)), { dim: true }) : null),
    });
    createTable(bBody, {
      caption: `${distLabel} por comuna`, rank: true, maxHeight: 240, search: "Buscar comunas",
      rows: counties.rows.filter((r) => fin(r.v[distKey])),
      columns: [
        { key: "name", label: "Comuna", align: "l", value: (r) => r.name, html: (r) => `${esc(r.name)}${parentOf(r) ? ` <span class="sub">${esc(parentOf(r))}</span>` : ""}` },
        { key: "population", label: "Población", value: (r) => r.v.population, text: (r) => count3(r.v.population) },
        { key: distKey, label: distLabel, value: (r) => r.v[distKey], text: (r) => cell(distKey, r.v[distKey]), bar: { max: dom[1], color: "rgba(74,134,214,.4)" } },
        ...(isBb && has("bachelors") ? [{ key: "bachelors", label: degLabel, value: (r) => r.v.bachelors, text: (r) => cell("bachelors", r.v.bachelors) }] : []),
      ],
      sort: { key: distKey, dir: isBb ? "asc" : "desc" },
      onHover: (r) => link.hover(r ? rowsHighlight(counties, [r]) : null),
      onClick: (r) => counties.focus(r),
    });
  }

  const countySrc = ["bachelors", "broadband", ...(degLevels.length ? ["income"] : [])].filter(has).map((k) => counties.field(k)?.source);
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, [...sciSrc, ...countySrc, ...(degLevels.includes("metros") ? [metros.field("median_income")?.source] : [])], [
    `El mapa de empleo en ${esc(sciName.toLowerCase())} solo colorea el territorio de cada comuna (los hexágonos grises no pertenecen a ninguna).`,
    ...(distKey || degLevels.length ? [`${esc(degLabel)}${bbOn ? ` y ${esc(bbLabel)}` : ""} son cifras de las comunas (${esc(data.countyVintage)})${degLevels.includes("metros") ? "; los valores de cada comuna-ciudad se agregan desde sus unidades con ponderación por población, así que son aproximados" : ""}.`] : []),
    ...(!degLevels.length && has("bachelors") ? ["Estos datos no traen ingreso, así que no hay gráfico de estudios frente a ingreso."] : []),
    ...(data.countiesOffMap ? [`Las ${int(data.countiesOffMap)} comunas más pequeñas no llegan a un hexágono: al seleccionarlas no se marca nada en el mapa.`] : []),
  ]));

  return {
    onMapHover(h) {
      if (scatter) {
        const r = h.cell >= 0 ? lv().rowAtCell(h.cell) : null;
        scatter.setHot(r ? r.key : null);
      }
      if (distHist) {
        const c = h.cell >= 0 ? counties.rowAtCell(h.cell) : null;
        distHist.setHot(c ? distHist.binOf(c.v[distKey])?.i ?? null : null);
      }
    },
    onEscape() {
      if (scatter?.selected) { clearSel(); return true; }
      return false;
    },
  };
}
