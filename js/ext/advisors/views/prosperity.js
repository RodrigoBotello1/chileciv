// Prosperity & Housing advisor: income vs home values, poverty, rents and unemployment.
// Every tile, chart and table needs its measure to have a value somewhere (in the Chile build cities and provincias have
// no home value or rent), so those parts stay hidden and the advisor says which are missing. A comuna column is
// labelled, formatted and ordered by its own field metadata in counties.json (label, unit, format, higher_is): the
// column ids are inherited from the US build and do not say what the Chilean numbers mean.
import { esc, fin, colorScale, RAMPS } from "../core/util.js";
import { money, dollars, pct, int, compact, count3, fmtShort, fmtCell } from "../core/fmt.js";
import { barList, histogram, rampLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, lensButton, sourcesHtml, topBy, frameBtn } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { CURRENCY } from "../../../format.js";

const METRO_MIN = 100000; // comunas below this population are left out of the rent ranking
const BIG_METRO = 100000; // same floor as METRO_MIN, for the unemployment ranking
const LEVEL_NAME = { counties: "Comunas", metros: "Comunas", states: "Provincias" };
// City income when the data gives the measure no label.
const INCOME_ES = "Mediana del ingreso por hogar";

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const n = data.nat;
  const { states, metros, counties } = data.levels;
  const INCOME = metros.field("median_income")?.label || INCOME_ES;
  const any = (lv, f) => !!lv && lv.rows.some((r) => fin(f(r)));
  // The provincia a comuna belongs to, by name; a city or provincia row needs no such suffix.
  const stName = new Map((app.w.raw.states || []).flatMap((s) => [[s.abbr, s.name], [s.fips, s.name]]));
  const parentOf = (r) => (r.level === "counties" ? stName.get(r.v.state) || stName.get(String(r.key).slice(0, 3)) || "" : "");
  const nameHtml = (r) => `${esc(r.name)}${parentOf(r) ? ` <span class="sub">${esc(parentOf(r))}</span>` : ""}`;
  const missing = []; // measures without a single value, named in the footer
  // A comuna column's own label and unit from counties.json, with a Spanish fallback.
  const lab = (k, es) => counties?.field(k)?.label || es;
  // "Ingreso (mediana por hogar)": the label with what it measures, taken from the field's unit text.
  const defOf = (k, es) => {
    const u = String(counties?.field(k)?.unit || "").replace(/ \([^()]*\)$/, "");
    return `${lab(k, es)}${u && u !== lab(k, es) ? ` (${u})` : ""}`;
  };
  const incYear = app.data.nation.income_year;

  const headline = [
    fin(n.median_income) && { label: INCOME, value: dollars(n.median_income), sub: incYear ? `Ingresos ${incYear}` : "" },
    fin(n.home_value) && { label: "Mediana del valor de la vivienda", value: money(n.home_value), sub: fin(n.median_income) && n.median_income > 0 ? `${(n.home_value / n.median_income).toFixed(1)} veces el ingreso` : "" },
    fin(n.unemployment) && { label: "Desempleo", value: pct(n.unemployment), sub: data.vintage },
  ].filter(Boolean);
  if (headline.length) el.insertAdjacentHTML("beforeend", tiles(headline));

  // --- income vs home value -------------------------------------------------------------------------------------
  const incOf = (r) => (r.level === "counties" ? r.v.income : r.v.median_income);
  const ratioOf = (r) => (fin(r.v.home_value) && fin(incOf(r)) && incOf(r) > 0 ? r.v.home_value / incOf(r) : null);
  const affLevels = ["counties", "metros"].filter((k) => any(data.levels[k], ratioOf));
  let level = affLevels[0] || "metros";
  const lv = () => data.levels[level];
  let scatter = null, affTable = null;
  const selInfo = document.createElement("div");
  selInfo.className = "adv-brushinfo";
  const clearSel = () => { scatter?.setSelected(null); affTable?.setSelected(null); link.base(null); selInfo.innerHTML = ""; };
  const incLabelOf = (k) => (k === "counties" ? lab("income", "Ingreso") : INCOME);
  const homeLabelOf = (k) => (k === "counties" ? lab("home_value", "Valor de la vivienda") : "Mediana del valor de la vivienda");
  if (!affLevels.length) {
    if (![counties, metros].some((l) => any(l, incOf))) missing.push("ingresos");
    if (![counties, metros].some((l) => any(l, (r) => r.v.home_value))) missing.push("valor de la vivienda");
  } else {
    // Reference lines at whole multiples of income that fall inside the data (up to three), and a colour ramp to match.
    const ratios = affLevels.flatMap((k) => data.levels[k].rows.map(ratioOf)).filter(fin).sort((a, b) => a - b);
    const rLo = ratios[Math.floor(ratios.length * 0.02)], rHi = ratios[Math.ceil(ratios.length * 0.98) - 1];
    const picked = [3, 5, 8, 12, 16, 24, 32].filter((k) => k >= rLo * 0.7 && k <= rHi * 1.3).slice(-3);
    const marks = picked.length ? picked : [3, 5, 8];
    const ratioDomain = rHi > rLo ? [Math.floor(rLo), Math.ceil(rHi)] : [2, 10];
    const ratioColor = colorScale({ type: "seq", domain: ratioDomain, ramp: RAMPS.heat });
    const aBody = section(el, { title: "Cuántos años de ingreso cuesta una vivienda", note: `${affLevels.length === 1 && level === "counties" ? `${esc(defOf("home_value", "Valor de la vivienda"))} contra ${esc(defOf("income", "Ingreso"))}` : "Mediana del valor de la vivienda contra mediana del ingreso"}. Las líneas punteadas marcan ${marks.join(", ")} años de ingreso: más arriba, más difícil de pagar. Arrastra un rectángulo para seleccionar áreas; pasa el cursor sobre el mapa para encontrarlas en el gráfico.` });
    const aCtl = document.createElement("div");
    aCtl.className = "adv-row";
    aBody.appendChild(aCtl);
    if (affLevels.length > 1) segmented(aCtl, { label: "Área", value: level, options: affLevels.map((k) => ({ value: k, label: LEVEL_NAME[k] })), onChange: (v) => { level = v; drawAfford(); } });
    for (const id of ["income", "home"]) {
      const b = lensButton(app, id, `Lente: ${app.lensById?.get(id)?.name || ""}`);
      if (b) aCtl.appendChild(b);
    }
    scatter = createScatter(aBody, {
      height: 310, points: [],
      x: { label: incLabelOf(level), fmt: money, log: true },
      y: { label: `${homeLabelOf(level)} (${CURRENCY})`, fmt: compact, log: true },
      size: { label: "Población", fmt: count3, max: 14, min: 1.4 },
      refLines: marks.map((k) => ({ k, label: `${k}×` })),
      color: (c) => ratioColor(c), colorLabel: "Vivienda ÷ ingreso", colorFmt: (v) => `×${(+v).toFixed(1)}`,
      onHover: (p) => { link.hover(p ? rowsHighlight(lv(), [p.row]) : null); affTable.setHot(p ? p.key : null, false); },
      onClick: (p) => lv().focus(p.row),
      onBrush: (set) => {
        const sel = set ? lv().rows.filter((r) => set.has(r.key)) : [];
        link.base(sel.length ? rowsHighlight(lv(), sel, { dim: true }) : null, { frame: sel.length > 1 });
        affTable.setSelected(set);
        selInfo.innerHTML = sel.length ? `Seleccionadas: <b>${int(sel.length)}</b> ${LEVEL_NAME[level].toLowerCase()} · población ${count3(sel.reduce((a, r) => a + (r.v.population || 0), 0))} ${frameBtn()}<button type="button" class="adv-mini" data-clear>Borrar</button>` : "";
      },
    });
    aBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.heat, domain: ratioDomain, fmt: (v) => `×${v}`, label: "Vivienda ÷ ingreso" }));
    aBody.appendChild(selInfo);
    selInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) clearSel(); });
    aBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Resumen de accesibilidad</h4>`);
    const salesCol = affLevels.length === 1 && level === "counties" && any(counties, (r) => r.v.home_sales);
    affTable = createTable(aBody, {
      caption: "Vivienda e ingreso", rank: true, maxHeight: 260, rows: [], search: "Buscar área",
      columns: [
        { key: "name", label: "Área", align: "l", value: (r) => r.name, html: nameHtml },
        { key: "inc", label: "Ingreso", value: incOf, text: (r) => money(incOf(r)) },
        { key: "home", label: "Vivienda", value: (r) => r.v.home_value, text: (r) => money(r.v.home_value) },
        // How many sales the median price rests on, when the data says (a thin sample makes a jumpy median).
        ...(salesCol ? [{ key: "sales", label: lab("home_sales", "N° de ventas"), value: (r) => r.v.home_sales, text: (r) => (fin(r.v.home_sales) ? int(r.v.home_sales) : "–") }] : []),
        { key: "ratio", label: "Veces", value: (r) => ratioOf(r), html: (r) => fin(ratioOf(r)) ? `<span class="dot" style="background:${ratioColor(ratioOf(r))}"></span>×${ratioOf(r).toFixed(1)}` : "–" },
      ],
      sort: { key: "ratio", dir: "desc" },
      onHover: (r) => { link.hover(r ? rowsHighlight(lv(), [r]) : null); scatter.setHot(r ? r.key : null); },
      onClick: (r) => lv().focus(r),
    });
    drawAfford();
  }
  function drawAfford() {
    clearSel();
    const rows = lv().rows.filter((r) => fin(ratioOf(r)));
    scatter.update({
      x: { label: incLabelOf(level), fmt: money, log: true },
      y: { label: `${homeLabelOf(level)} (${CURRENCY})`, fmt: compact, log: true },
      points: rows.map((r) => ({ key: r.key, x: incOf(r), y: r.v.home_value, s: r.v.population, c: ratioOf(r), label: r.name, sub: parentOf(r), row: r })),
      labels: topBy(rows, (r) => r.v.population, { n: 6 }).map((x) => x.r.key),
    });
    affTable.setRows(rows);
  }

  // --- poverty --------------------------------------------------------------------------------------------------
  let povHist = null;
  const hasPoverty = any(counties, (r) => r.v.poverty);
  if (hasPoverty) {
    const povField = counties.field("poverty");
    const povLabel = lab("poverty", "Pobreza");
    const povFmt = povField?.format || "pct";
    const isRate = povFmt === "pct";
    // A rate is worse when high; a low-income threshold (higher_is: good) is worse when low. The worse end sorts
    // first and takes the hot end of the ramp.
    const worseHigh = povField?.higher_is !== "good";
    const pBody = section(el, { title: povLabel, note: `${povField?.description ? esc(povField.description) + (/[.!?;)]$/.test(povField.description) ? " " : ". ") : ""}Pasa el cursor sobre las barras para ver esas comunas en el mapa; la tabla de abajo las lista todas.` });
    const pCtl = document.createElement("div");
    pCtl.className = "adv-row";
    pBody.appendChild(pCtl);
    const lb = lensButton(app, "poverty", `Lente: ${povLabel}`);
    if (lb) pCtl.appendChild(lb);
    const pHost = document.createElement("div");
    pBody.appendChild(pHost);
    const avgPov = (() => {
      let a = 0, w = 0;
      for (const r of counties.rows) if (fin(r.v.poverty) && fin(r.v.population)) { a += r.v.poverty * r.v.population; w += r.v.population; }
      return w ? a / w : null;
    })();
    // A rate's axis runs from 0 to just above the highest rate (the next 5%), so low rates still spread over the
    // bins; any other unit spans the data.
    const povVals = counties.rows.map((r) => r.v.poverty).filter(fin);
    const povMax = isRate ? Math.max(0.05, Math.ceil(Math.max(...povVals) * 20) / 20) : Math.max(...povVals);
    const povDom = isRate ? [0, povMax] : [Math.min(...povVals), povMax];
    const hasInc = any(counties, (r) => r.v.income);
    povHist = histogram(pHost, {
      values: counties.rows.map((r) => ({ key: r.key, v: r.v.poverty, w: r.v.population })), bins: 30, domain: povDom, height: 120,
      fmt: (v) => fmtShort(povFmt, v), unitLabel: "comunas", label: `Histograma de ${povLabel} por comuna`,
      colorOf: (_, t) => colorScale({ type: "seq", domain: [0, 1], ramp: RAMPS.heat })(worseHigh ? t : 1 - t),
      // The population-weighted mean of a rate is the national rate; of any other measure it is only an average.
      markers: fin(avgPov) ? [{ v: avgPov, label: isRate ? `Región ${pct(avgPov)}` : `Promedio ponderado por población ${fmtShort(povFmt, avgPov)}` }] : [],
      onHover: (bin) => link.hover(bin ? rowsHighlight(counties, bin.keys.map((k) => counties.byKey.get(k)), { dim: true }) : null),
    });
    const povTable = createTable(pBody, {
      caption: `${povLabel} por comuna`, rank: true, maxHeight: 240, rows: counties.rows.filter((r) => fin(r.v.poverty)), search: "Buscar comuna",
      columns: [
        { key: "name", label: "Comuna", align: "l", value: (r) => r.name, html: nameHtml },
        { key: "population", label: "Población", value: (r) => r.v.population, text: (r) => count3(r.v.population) },
        { key: "poverty", label: povLabel, value: (r) => r.v.poverty, text: (r) => fmtCell(povFmt, r.v.poverty), bar: { max: povMax, color: "rgba(232,119,74,.4)" } },
        ...(hasInc ? [{ key: "income", label: lab("income", "Ingreso"), value: (r) => r.v.income, text: (r) => fmtCell(counties.field("income")?.format || "usd", r.v.income) }] : []),
      ],
      sort: { key: "poverty", dir: worseHigh ? "desc" : "asc" },
      onHover: (r) => link.hover(r ? rowsHighlight(counties, [r]) : null),
      onClick: (r) => counties.focus(r),
    });
    ctx.cleanup(() => povTable.destroy());
  }

  // --- rent -----------------------------------------------------------------------------------------------------
  const hasRent = any(metros, (r) => r.v.rent_burden);
  if (!hasRent) missing.push("arriendos");
  else {
    // With no city over the population floor, rank them all rather than none.
    const rMin = topBy(metros.rows, (r) => r.v.rent_burden, { n: 1, min: METRO_MIN }).length ? METRO_MIN : 0;
    const rBody = section(el, { title: "Carga de arriendo por comuna", note: `Mediana del arriendo mensual × 12 ÷ mediana del ingreso${rMin ? `; solo comunas con población de ${compact(rMin)} o más` : ""}. Es el cociente de dos medianas: quienes arriendan suelen ganar menos que la mediana general, así que su carga real es mayor.` });
    const rentRows = (list) => list.map((x) => ({ key: x.r.key, label: x.r.name, sub: fin(x.r.v.median_rent) ? `${dollars(x.r.v.median_rent)} al mes` : "", value: x.v, text: pct(x.v), row: x.r }));
    const rOpts = { onHover: (r) => link.hover(r ? rowsHighlight(metros, [r.row]) : null), onClick: (r) => metros.focus(r.row) };
    const hi = topBy(metros.rows, (r) => r.v.rent_burden, { n: 10, min: rMin });
    const lo = topBy(metros.rows, (r) => r.v.rent_burden, { n: 5, min: rMin, asc: true });
    const rmax = Math.max(...hi.map((x) => x.v));
    rBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Mayor carga</h4>`);
    barList(rBody, { ...rOpts, rows: rentRows(hi), max: rmax, ariaLabel: "Mayor carga de arriendo" });
    rBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Menor carga</h4>`);
    barList(rBody, { ...rOpts, rows: rentRows(lo), max: rmax, ariaLabel: "Menor carga de arriendo" });
  }

  // --- unemployment ---------------------------------------------------------------------------------------------
  const uLevels = [any(states, (r) => r.v.unemployment) && "states", any(metros, (r) => r.v.unemployment) && "metros"].filter(Boolean);
  if (!uLevels.length) missing.push("desempleo");
  else {
    const uBody = section(el, { title: "Desempleo", note: `Desocupados ÷ fuerza de trabajo (${esc(data.vintage)}). De las comunas solo se listan las de población ${compact(BIG_METRO)} o más; las áreas sin valor quedan fuera.` });
    const uHost = document.createElement("div");
    let uLevel = uLevels[0];
    if (uLevels.length > 1) segmented(uBody, { label: "Alcance", value: uLevel, options: [{ value: "states", label: "Provincias" }, { value: "metros", label: "Comunas grandes" }], onChange: (v) => { uLevel = v; drawU(); } });
    uBody.appendChild(uHost);
    const drawU = () => {
      uHost.innerHTML = "";
      const lvU = uLevel === "states" ? states : metros;
      const min = uLevel === "states" ? 0 : BIG_METRO;
      const high = topBy(lvU.rows, (r) => r.v.unemployment, { n: 8, min });
      const low = topBy(lvU.rows, (r) => r.v.unemployment, { n: 8, min, asc: true });
      if (!high.length) { uHost.innerHTML = `<p class="adv-empty">Sin datos</p>`; return; }
      const max = Math.max(...high.map((x) => x.v));
      const tone = (v) => (!fin(n.unemployment) ? null : v > n.unemployment * 1.03 ? "bad" : v < n.unemployment * 0.97 ? "good" : null);
      const mk = (list) => list.map((x) => ({ key: x.r.key, label: x.r.name, sub: "", value: x.v, text: pct(x.v), tone: tone(x.v), row: x.r }));
      const o = { max, onHover: (r) => link.hover(r ? rowsHighlight(lvU, [r.row]) : null), onClick: (r) => lvU.focus(r.row) };
      uHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Más alto</h4>`);
      barList(uHost, { ...o, rows: mk(high), ariaLabel: "Mayor desempleo" });
      uHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Más bajo</h4>`);
      barList(uHost, { ...o, rows: mk(low), ariaLabel: "Menor desempleo" });
    };
    drawU();
  }

  if (!headline.length && !affLevels.length && !hasPoverty && !hasRent && !uLevels.length) {
    el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">Sin datos</p>`);
  }

  const srcIds = [
    ...(fin(n.median_income) ? [metros.field("median_income")?.source] : []),
    ...affLevels.flatMap((k) => (k === "counties" ? [counties.field("income")?.source, counties.field("home_value")?.source] : [metros.field("median_income")?.source, metros.field("home_value")?.source])),
    ...(hasPoverty ? [counties.field("poverty")?.source] : []),
    ...(hasRent ? [metros.field("median_rent")?.source, metros.field("rent_burden")?.source] : []),
    ...(uLevels.length ? [metros.field("unemployment")?.source, states.field("unemployment")?.source] : []),
  ];
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, srcIds, [
    ...(missing.length ? [`Estos datos no traen valores de ${missing.join(", ")}; por eso no se muestran los gráficos relacionados.`] : []),
    ...(affLevels.length ? ["Vivienda ÷ ingreso es el cociente de dos medianas de poblaciones distintas: sirve para comparar lugares entre sí, no indica cuántos años de ingreso necesita un hogar concreto para comprar."] : []),
    ...(affLevels.length === 1 && affLevels[0] === "counties" ? ["Las ciudades y provincias no tienen valor de vivienda, por eso la comparación de vivienda e ingreso solo existe por comuna."] : []),
    ...(affLevels.length === 1 && affLevels[0] === "counties" && any(counties, (r) => r.v.home_sales) ? [`En las comunas con pocas transacciones (${esc(lab("home_sales", "N° de ventas"))}), la mediana del valor puede depender de unas pocas operaciones; el múltiplo es solo referencial.`] : []),
    ...(affLevels.includes("counties") && affLevels.includes("metros") ? [`Las cifras de provincias y ciudades son de "${esc(data.vintage)}"; las de comunas son de "${esc(data.countyVintage)}", y los años pueden diferir.`] : []),
    ...(hasRent ? ["Arriendo ÷ ingreso es el cociente de dos medianas de poblaciones distintas: solo es una referencia aproximada, no la proporción que realmente paga quien arrienda."] : []),
    ...(uLevels.length && uLevels.some((k) => data.levels[k].rows.some((r) => !fin(r.v.unemployment))) ? ["Algunas áreas no tienen valor de desempleo; el ranking no las incluye."] : []),
    ...(data.countiesOffMap && (affLevels.includes("counties") || hasPoverty) ? [`${int(data.countiesOffMap)} de las comunas más pequeñas no llegan a un hexágono; al seleccionarlas no se marca ningún área en el mapa.`] : []),
  ]));

  return {
    onMapHover(h) {
      if (scatter) {
        const r = h.cell >= 0 ? lv().rowAtCell(h.cell) : null;
        scatter.setHot(r ? r.key : null);
        affTable.setHot(r ? r.key : null);
      }
      if (povHist && counties) {
        const c = h.cell >= 0 ? counties.rowAtCell(h.cell) : null;
        povHist.setHot(c ? povHist.binOf(c.v.poverty)?.i ?? null : null);
      }
    },
    onEscape() {
      if (scatter?.selected) { clearSel(); return true; }
      return false;
    },
  };
}
