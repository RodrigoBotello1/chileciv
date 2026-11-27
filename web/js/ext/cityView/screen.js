// The city screen: a docked dashboard (a bottom sheet on phones) with the header (and its city-type badge),
// Citizens (figure rows from citizens.json), Districts (districts.json), Economy, Workforce, Resources and Compare.
// Plain HTML strings + inline SVG charts; render(el, model, handlers) fills `el`. The citizens and districts files
// load on demand (h.loadData) and fill their sections when they arrive; a build without districts.json drops that
// section and its tab. On the Santiago map a city is a comuna and its member list is just itself.
import { dollars, esc, int, pct } from "../../format.js";
import { compact, money, popShort, yieldValue } from "./fmt.js";
import { icon, glyph } from "../../ui/icon.js";
import { css } from "../../color.js";
import { isCapital } from "../../world.js";
import { sparkline, meter, bar } from "./charts.js";
import { popSeries, rankCount, resourceValue, LAND } from "./model.js";
import { citizensHtml, mountCitizens } from "./citizens.js";
import { paesHtml } from "./paes.js";
import { cityDistricts, districtsHtml } from "./districts.js";
import { T } from "../../terms.js";

const TABS = [
  ["citizens", "Habitantes", "pop"],
  ["districts", "Distritos", "l-developed"],
  ["economy", "Economía", "y-gold"],
  ["workforce", "Empleo", "y-production"],
  ["resources", "Recursos", "resources"],
  ["compare", "Comparar", "layers"],
];

const signed = (g, d = 1) => (g == null ? "–" : `${g >= 0 ? "+" : "−"}${Math.abs(g * 100).toFixed(d)}%`);
const rankCache = new WeakMap();
function countOf(cities, key) {
  let m = rankCache.get(cities);
  if (!m) rankCache.set(cities, (m = new Map()));
  if (!m.has(key)) m.set(key, rankCount(cities, key));
  return m.get(key);
}

// Medal colours scale with the number of ranked cities: about the top 1% gold and the top 5% silver on a map with
// hundreds of cities, and never fewer than the top 3 / top 10 (the 52 comunas).
function rankBadge(rank, of, label, tip) {
  if (rank == null) return "";
  const tier = rank <= Math.max(3, Math.round(of / 90)) ? "gold" : rank <= Math.max(10, Math.round(of / 18)) ? "silver" : "bronze";
  return `<div class="cv-rank ${tier}" title="${esc(tip || `${label}: lugar ${rank} de ${of} comunas (1 = más alto)`)}">
    <span class="cv-medal">#${rank}</span><span class="cv-rank-l">${esc(label)}</span></div>`;
}

function lqBadge(lq) {
  if (lq == null) return "";
  const tip = `Cociente de localización: esta proporción es ${lq.toFixed(2)} veces la ${T.regional}`;
  const cls = lq >= 1.25 ? "hi" : lq <= 0.75 ? "lo" : "mid";
  return `<span class="cv-lq ${cls}" title="${esc(tip)}">×${lq.toFixed(1)}</span>`;
}

function medallion(id, fallback, bg, size = 18) {
  return `<span class="cv-med" style="--bg:${esc(bg)}">${icon(id, fallback, { size })}</span>`;
}

// The "gdp" field is the annual sales (SII) the data's gdp_vintage names; there is no official GDP by comuna, so the
// screen never calls it GDP.
const GDP = "Ventas de empresas";
const GDP_NOTE = "Lo que declaran al SII las empresas con sede en la comuna. No es PIB.";
const GDP_TIP = "Ventas anuales que declaran al SII las empresas, privadas o del Estado, con casa matriz en la comuna. "
  + "Se cuentan donde está la sede y no donde se vende: por eso las comunas de oficinas (Las Condes, Santiago, "
  + "Providencia) concentran la mayor parte del país. El gasto de ministerios, municipios y hospitales públicos no es "
  + "venta y no entra. No es PIB: las ventas incluyen lo que las empresas compran a otras.";
const GDP_PC = "Ventas por habitante";
/** True when sources.json (a list, or {sources: [...]}) has an entry with this id. */
function hasSource(sources, id) {
  const list = Array.isArray(sources) ? sources : Array.isArray(sources?.sources) ? sources.sources : [];
  return list.some((x) => x?.id === id);
}

const sameText = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
const fmtArea = (a) => (a == null ? "–" : a >= 100 ? compact(a) : a.toFixed(1));
const gw = (mw) => (mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw)} MW`);

// --- header --------------------------------------------------------------------------------------------------------
function header(m) {
  const c = m.city, n = m.nation.nation;
  const cities = m.cityList;
  const col = css(m.stateRGB);
  // The chip opens the provincia panel. A comuna that is its own provincia gets a plain "Datos de la provincia" chip
  // (its name is already the title); another provincia is named in full (codes mean little to readers).
  const chips = m.states.map((s) => {
    const label = s.self ? `Datos de la ${T.state}` : s.name;
    return s.index >= 0
      ? `<button class="chip" data-state="${s.index}" title="${esc(`Abrir el panel de la ${T.state}: ${s.name}`)}">${esc(label)}</button>`
      : s.self ? "" : `<span class="chip">${esc(label)}</span>`;
  }).join("");
  const g = Number.isFinite(c.growth) ? c.growth : null;
  const yrs = Array.isArray(c.growth_years) ? c.growth_years : null;
  const growth = g == null ? "" : `<span class="cv-growth ${g >= 0 ? "good" : "bad"}" title="Variación de la población${yrs ? ` ${yrs[0]}–${yrs[1]}` : ""}${n.growth != null ? `. ${T.NationShort}: ${signed(n.growth)}` : ""}">${g >= 0 ? "▲" : "▼"} ${Math.abs(g * 100).toFixed(1)}%${yrs ? ` <small>desde ${yrs[0]}</small>` : ""}</span>`;
  const perCap = c.gdp != null && c.population ? c.gdp / c.population : null;
  const r = c.ranks || {};
  const N = (k) => countOf(cities, k);
  // The line under the title: only what `full` adds to the name (Santiago, Región Metropolitana → Región Metropolitana), never the name twice.
  const fullRaw = c.full && !sameText(c.full, c.name) ? String(c.full) : "";
  const full = fullRaw.startsWith(String(c.name)) ? fullRaw.slice(String(c.name).length).trim() : fullRaw;
  return `
  <div class="sheet-grip cv-grip" aria-hidden="true"></div>
  <header class="cv-head" style="--sc:${col}">
    <div class="cv-ribbon" aria-hidden="true"></div>
    <button class="icon-btn cv-close" data-close aria-label="Cerrar la vista de comuna (Esc)" title="Volver al mapa (Esc)">${icon("close", "✕", { size: 13 })}</button>
    <div class="cv-kind">Vista de comuna</div>
    <div class="cv-title">
      <div class="cv-crest" aria-hidden="true"><span>${esc(popShort(c.population))}</span></div>
      <div class="cv-tt">
        <h2 class="cv-name" tabindex="-1">${isCapital(c) ? `<span class="cv-cap" title="Capital ${T.ofNation}">★</span> ` : ""}${esc(c.name)}</h2>
        ${full ? `<div class="cv-full">${esc(full)}</div>` : ""}
        ${chips ? `<div class="chips">${chips}</div>` : ""}
      </div>
    </div>
    <div class="cv-headline">
      <div class="cv-big"><span class="lbl">${icon("pop", "👥", { size: 13 })} Población</span><b>${int(c.population)}</b>${growth}</div>
      <div class="cv-big" title="${esc(GDP_TIP)}"><span class="lbl">${icon("y-gold", "💰", { size: 13 })} ${GDP}${c.gdp_year ? ` (${c.gdp_year})` : ""}</span><b>${money(c.gdp)}</b>${
        perCap != null ? `<span class="cv-sub">${money(perCap)} por habitante</span>` : ""}<span class="cv-sub cv-gdp-note">${GDP_NOTE}</span></div>
    </div>
    <div class="cv-ranks" aria-label="Lugar entre las ${cities.length} comunas">
      ${rankBadge(r.population, N("population"), "Población")}
      ${rankBadge(r.gdp, N("gdp"), GDP)}
      ${rankBadge(r.gdp_per_capita, N("gdp_per_capita"), GDP_PC)}
      ${rankBadge(r.growth, N("growth"), "Crecimiento", r.growth != null ? `Crecimiento: lugar ${r.growth} de ${N("growth")} comunas (1 = más rápido)` : "")}
    </div>
  </header>
  <nav class="cv-tabs" aria-label="Secciones de la vista de comuna">
    ${TABS.map(([id, label, ic]) => `<button type="button" data-tab="${id}">${icon(ic, "•", { size: 14 })}<span>${label}</span></button>`).join("")}
  </nav>`;
}

// --- citizens ------------------------------------------------------------------------------------------------------
function citizens(m) {
  const c = m.city, n = m.nation.nation;
  const series = popSeries(c);
  const ch = series.length >= 2 ? series.at(-1).value / series[0].value - 1 : null;
  // sub: the small line beside the value; by default the national value, left out when there is none. A measure
  // the city has no value for (the build does not carry it, or not for this city) gets no row at all.
  const row = (ic, fb, label, v, us, fmt, better, max, sub = us != null ? `${T.nationShort} ${fmt(us)}` : "", tick = us) => (v == null ? "" : `
    <div class="cv-stat">
      <div class="cv-stat-top"><span class="sl">${icon(ic, fb, { size: 14 })}${esc(label)}</span>
        <span class="sv"><b>${v == null ? "–" : fmt(v)}</b>${sub ? `<small>${sub}</small>` : ""}</span></div>
      ${meter(v, tick, max ?? Math.max(v || 0, us || 0) * 1.35, better)}
    </div>`);
  // Employed residents: no national figure to set beside a count, so the share of residents (and the national share).
  const empShare = c.employed != null && c.population > 0 ? c.employed / c.population : null;
  const usEmpShare = n.employed != null && n.population > 0 ? n.employed / n.population : null;
  const empSub = empShare == null ? ""
    : `${pct(empShare)} de los habitantes${usEmpShare != null ? ` · ${T.nationShort} ${pct(usEmpShare)}` : ""}`;
  const multi = m.tiles.length > 1;
  // Residents per hex need the population-density lens; without it the hexes show their land use only.
  const hasRes = m.tiles.some((t) => t.residents != null);
  const tilesNote = !multi ? `Esta comuna cabe en un solo hexágono del mapa (cerca de ${fmtArea(m.hexArea)} km²), que se muestra junto al ícono de la comuna.`
    : hasRes ? `En el mapa, cada hexágono de la comuna muestra <b>≈ habitantes</b> (densidad de población de la comuna × área del hexágono, una estimación) y el <b>uso de suelo principal</b> (proporción del suelo del hexágono)${
      m.residentsSum > 0 ? `. Según esa estimación, los ${m.tiles.length} hexágonos suman unas ${compact(m.residentsSum)} personas` : ""}.`
      : `En el mapa, cada hexágono de la comuna muestra su <b>uso de suelo principal</b> (proporción del suelo del hexágono).`;
  return `
  <section class="cv-sec" id="cv-citizens" data-sec="citizens" aria-labelledby="cv-h-citizens">
    <h3 id="cv-h-citizens">${icon("pop", "👥", { size: 15 })}Habitantes</h3>
    <div class="cv-citizens" data-citizens>${citizensHtml(m, undefined)}</div>
    <h4 class="cv-h4">Población</h4>
    <div class="cv-card">
      <div class="cv-card-h"><span>Población ${series.length ? `${series[0].year}–${series.at(-1).year}` : ""}</span>${
        ch != null ? `<span class="${ch >= 0 ? "good" : "bad"}">${signed(ch)}</span>` : ""}</div>
      ${sparkline(series, { fmt: (v) => popShort(v), title: `Población de ${c.name} por año` })}
      ${series.length >= 2 ? `<p class="cv-note">Población al cierre de cada año${
        hasSource(m.sources, "ine_censo2024") ? " (INE)" : ""}, con los mismos límites comunales en todos los años.</p>` : ""}
    </div>
    <div class="cv-stats">
      ${row("pop", "👥", "Trabajadores de empresas con casa matriz aquí", c.employed, null, int, null, c.population, empSub, usEmpShare != null ? usEmpShare * c.population : null)}
      ${row("unemployment", "😐", "Desempleo", c.unemployment, n.unemployment, (x) => pct(x), "low")}
      ${row("l-income", "💵", `Ingreso mediano${m.nation.income_year ? ` (${m.nation.income_year})` : ""}`, c.median_income, n.median_income, dollars, "high")}
      ${row("l-homeownership", "🔑", "Arriendo mediano mensual", c.median_rent, n.median_rent, dollars, null)}
      ${row("l-home", "🏠", "Valor mediano de la vivienda", c.home_value, n.home_value, dollars, null)}
      ${row(null, "⚖️", "Carga del arriendo (arriendo ÷ ingreso)", c.rent_burden, n.rent_burden, (x) => pct(x), "low")}
    </div>
    <div data-paes></div>
    <div class="cv-legend-tiles">${tileLegend(m)}<p>${tilesNote}</p></div>
    <h4 class="cv-h4">Comunas miembro <span class="muted">(${(c.counties || []).length})</span></h4>
    <div class="cv-counties" data-counties><p class="muted cv-note">Cargando comunas…</p></div>
  </section>`;
}

function tileLegend(m) {
  const counts = new Map();
  for (const t of m.tiles) if (t.land) counts.set(t.land.key, (counts.get(t.land.key) || 0) + 1);
  return `<div class="cv-tl">${LAND.filter((g) => counts.has(g.key)).map((g) =>
    `<span class="cv-tl-i"><i style="background:${esc(m.landColor(g.key))}"></i>${esc(g.label)} <small>${counts.get(g.key)}</small></span>`).join("")}</div>`;
}

const COUNTY_ROWS = 12; // rows of the member table shown before "y N más"

/**
 * A value of a counties.json column, formatted by the column's own field metadata (`format`), compactly: the member
 * table's columns are narrow, so money drops its $ prefix (the header carries it) and large counts use mil / M.
 */
function fieldCell(f, v) {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "–";
  if (typeof v !== "number") return esc(v);
  switch (f?.format) {
    case "pct": return pct(v);
    case "usd": return compact(v);
    case "years": return v.toFixed(1);
    case "float": return Math.abs(v) >= 100 ? int(v) : v.toFixed(1);
    default: return Math.abs(v) >= 1e5 ? compact(v) : int(v);
  }
}

export function countiesTable(m, data) {
  const c = m.city;
  if (!data || !Array.isArray(data.rows)) return `<p class="muted cv-note">No hay datos de comunas.</p>`;
  const col = Object.fromEntries(data.columns.map((k, j) => [k, j]));
  const want = new Set(c.counties || []);
  const rows = data.rows.filter((r) => want.has(r[col.geoid])).sort((a, b) => (b[col.population] || 0) - (a[col.population] || 0));
  if (!rows.length) return `<p class="muted cv-note">No hay filas de datos para esta comuna.</p>`;
  const maxPop = rows[0][col.population] || 1;
  const show = rows.slice(0, COUNTY_ROWS);
  const vint = data.vintage ? ` (${esc(data.vintage)})` : "";
  // A member's provincia is named only when it is not the city itself.
  const other = (r) => (col.state == null ? "" : m.otherStates?.(c, [r[col.state]])[0] || "");
  // Labels, units and formats of the three value columns come from the file's own field metadata (data.fields), so
  // a column says what the build put in it; the Spanish names here stand in only when a field has no label.
  const field = (k) => (data.fields || []).find((f) => f.key === k) || null;
  const COLS = [["population", "Población"], ["density", "Densidad"], ["income", "Ingreso"]].map(([k, fb]) => ({ k, f: field(k), fb }));
  const head = ({ f, fb }) => `<span role="columnheader" title="${esc([f?.unit, f?.description].filter(Boolean).join(": "))}">${
    esc(f?.label || fb)}${f?.format === "usd" ? " ($)" : ""}</span>`;
  const cell = ({ k, f }, r) => {
    const v = col[k] == null ? null : r[col[k]];
    const full = v != null && f?.format === "usd" ? dollars(v) : "";
    return `<span role="cell"${full ? ` title="${esc(full)}"` : ""}>${fieldCell(f, v)}</span>`;
  };
  return `<div class="cv-ctable" role="table" aria-label="Comunas miembro">
    <div class="cv-cr cv-cr-h" role="row"><span role="columnheader">${esc(field("name")?.label || "Comuna")}</span>${COLS.map(head).join("")}</div>
    ${show.map((r) => `<div class="cv-cr" role="row">
      <span role="cell" class="cv-cn">${esc(r[col.name])}${other(r) ? ` <small>${esc(other(r))}</small>` : ""}${bar(r[col.population] / maxPop, "var(--sc, #c9a45c)")}</span>
      ${COLS.map((c2) => cell(c2, r)).join("")}</div>`).join("")}
    ${rows.length > show.length ? `<p class="muted cv-note">Y ${rows.length - show.length} comunas más.</p>` : ""}
    <p class="cv-note">Estadísticas por comuna${vint}.</p>
  </div>`;
}

// --- districts -----------------------------------------------------------------------------------------------------
function districts(m) {
  return `
  <section class="cv-sec" id="cv-districts" data-sec="districts" aria-labelledby="cv-h-districts">
    <h3 id="cv-h-districts">${icon("l-developed", "🏙", { size: 15 })}Distritos</h3>
    <div data-districts>${districtsHtml(m, undefined, null)}</div>
  </section>`;
}

// --- economy -------------------------------------------------------------------------------------------------------
function economy(m) {
  const c = m.city, nat = m.nation, n = nat.nation;
  const r = c.ranks || {};
  const cities = m.cityList;
  const perCap = c.gdp != null && c.population ? c.gdp / c.population : null;
  const usPerCap = n.gdp && n.population ? n.gdp / n.population : null;
  const yields = nat.yields.map((y) => {
    const v = c.yields?.[y.key];
    const rk = r[y.key];
    // The gold yield is labelled "Ventas de empresas" when it is the city's gdp figure itself; otherwise it keeps the data's label.
    const lbl = y.key === "gold" && c.gdp != null && v === c.gdp ? GDP : y.label;
    return `<div class="cv-yield" style="--yc:${esc(y.color)}" title="${esc(y.label)}: ${esc(y.description || "")}">
      <div class="ico">${glyph(y, 20)}</div><div class="val">${yieldValue(y, v)}</div>
      <div class="lbl">${esc(lbl)}</div>
      ${rk != null ? `<div class="rk" title="Lugar ${rk} de ${countOf(cities, y.key)} comunas">Lugar ${rk} <small>de ${countOf(cities, y.key)}</small></div>` : ""}</div>`;
  }).join("");
  const gi = m.gdpInds;
  const maxShare = gi.length ? Math.max(...gi.map((d) => Math.max(d.share, d.natShare))) : 1;
  const gdpRow = (d) => d.undisclosed
    ? `<div class="cv-ind und" title="Algunas industrias no publican su valor: ${esc(d.missing.map((k) => nat.industries?.[k] || k).join(", ") || "varias industrias")}. Esta fila es lo que queda de las ${GDP.toLowerCase()} de la comuna al restar todas las industrias publicadas.">
      <span class="cv-ind-ic" style="--bg:${esc(d.color)}">${icon(d.icon, "?", { size: 13 })}</span>
      <span class="cv-ind-n">${esc(d.short)}</span>
      <span class="cv-ind-v">${money(d.value)} <small>${pct(d.share, 0)}</small></span>
      ${bar(d.share / maxShare, "#7c8494", 0)}
    </div>`
    : `<div class="cv-ind" title="${esc(d.label)}: ${money(d.value)} (${pct(d.share)} de las ${GDP.toLowerCase()} de la comuna; ${T.nationShort} ${pct(d.natShare)})${d.estimated ? ". Incluye una estimación de valores no publicados." : ""}">
      <span class="cv-ind-ic" style="--bg:${esc(d.color)}">${icon(d.icon, "•", { size: 13 })}</span>
      <span class="cv-ind-n">${esc(d.short)}${lqBadge(d.lq)}</span>
      <span class="cv-ind-v">${d.estimated ? "≈" : ""}${money(d.value)} <small>${pct(d.share, 0)}</small></span>
      ${bar(d.share / maxShare, d.lq != null && d.lq >= 1.25 ? "#9fd76a" : "#c9a45c", d.natShare / maxShare)}
    </div>`;
  return `
  <section class="cv-sec" id="cv-economy" data-sec="economy" aria-labelledby="cv-h-economy">
    <h3 id="cv-h-economy">${icon("y-gold", "💰", { size: 15 })}Economía</h3>
    <div class="cv-gdp">
      <div><span class="lbl">${GDP}${c.gdp_year ? ` (${c.gdp_year})` : ""}</span><b>${money(c.gdp)}</b>${r.gdp != null ? `<small>Lugar ${r.gdp} de ${countOf(cities, "gdp")}</small>` : ""}</div>
      <div><span class="lbl">${GDP_PC}</span><b>${money(perCap)}</b>${
        usPerCap && perCap != null ? `<small class="${perCap >= usPerCap ? "good" : "bad"}">${T.nationShort} ${money(usPerCap)}</small>` : ""}</div>
      <div><span class="lbl">Parte de las ${GDP.toLowerCase()} ${T.ofNation}</span><b>${c.gdp != null && n.gdp ? pct(c.gdp / n.gdp, 2) : "–"}</b>${
        c.population && n.population ? `<small>${pct(c.population / n.population, 2)} de la población</small>` : ""}</div>
    </div>
    <h4 class="cv-h4">Rendimientos <span class="muted">lugar entre las comunas</span></h4>
    <div class="cv-yields">${yields}</div>
    ${gi.length ? `<h4 class="cv-h4">${GDP} por industria <span class="muted">marca = proporción ${T.regional}</span></h4>
      <div class="cv-inds">${gi.slice(0, 8).map(gdpRow).join("")}</div>
      ${gi.length > 8 ? `<details class="cv-more"><summary>Las ${gi.length} industrias</summary><div class="cv-inds">${gi.slice(8).map(gdpRow).join("")}</div></details>` : ""}`
      : ""}
    <p class="cv-note">${GDP}: ${nat.gdp_vintage ? `${esc(nat.gdp_vintage)}, ` : ""}en pesos corrientes${gi.length ? `; las proporciones usan el total de las ${GDP.toLowerCase()} de la comuna. ×N = proporción de la industria en las ${GDP.toLowerCase()} de la comuna frente a su proporción ${T.regional}` : ""}.${
      gi.some((d) => d.estimated) ? " ≈ indica una estimación que incluye valores no publicados." : ""}${
      gi.some((d) => d.undisclosed) ? ` "No publicado" = ${GDP.toLowerCase()} que no se publican por reserva estadística.` : ""}</p>
  </section>`;
}

// --- workforce -----------------------------------------------------------------------------------------------------
function workforce(m) {
  const cards = m.inds.map((d) => {
    const spec = d.lq != null && d.lq >= 1.25;
    return `<div class="cv-bld${spec ? " spec" : ""}" title="${esc(d.label)}: ${int(d.jobs)} personas (${pct(d.share)}; ${T.nationShort} ${pct(d.natShare)})">
      ${medallion(d.icon, "•", d.color, 17)}
      <div class="cv-bld-t"><span class="cv-bld-n">${esc(d.short)}</span>
        <span class="cv-bld-v">${compact(d.jobs)} <small>${pct(d.share, 1)}</small></span></div>
      ${lqBadge(d.lq)}
    </div>`;
  }).join("");
  return `
  <section class="cv-sec" id="cv-workforce" data-sec="workforce" aria-labelledby="cv-h-workforce">
    <h3 id="cv-h-workforce">${icon("y-production", "⚙️", { size: 15 })}Empleo</h3>
    ${cards ? `<p class="cv-lead">Industrias en que trabajan ${m.city.employed != null ? `los ${int(m.city.employed)} ocupados` : "los ocupados"} de la comuna. <span class="cv-lq hi">×N</span> compara la proporción del empleo de una industria con la ${T.regional}.</p>
    <div class="cv-blds">${cards}</div>` : `<p class="muted cv-note">No hay datos de empleo por industria para esta comuna.</p>`}
    <p class="cv-note">Fuente: ${esc(m.nation.vintage || "ver la Guía")}. <span data-dnote>Los distritos del mapa se definen aparte, con el cociente de localización de cada industria: ver "Distritos".</span></p>
  </section>`;
}

// --- resources -----------------------------------------------------------------------------------------------------
function resources(m) {
  const list = m.sites.map((s, k) => {
    const t = s.type;
    const val = resourceValue(s.item, t, compact);
    // The site's provincia, only when it is not the city itself (a site filed under a neighbour).
    const where = s.item.state ? m.otherStates?.(m.city, [s.item.state])[0] || "" : "";
    return `<button type="button" class="cv-site" data-site="${k}" title="Volar a ${esc(s.item.name)}">
      <span class="cv-med" style="--bg:${esc(t?.color || "#3a4a5e")}">${glyph(t, 16)}</span>
      <span class="cv-site-t"><b>${esc(s.item.name)}</b><small>${esc(t?.name || s.item.type)}${where ? ` · ${esc(where)}` : ""}</small>
        ${s.item.detail ? `<small class="cv-site-d">${esc(s.item.detail)}</small>` : ""}</span>
      <span class="cv-site-v">${esc(val)}<i aria-hidden="true">›</i></span>
    </button>`;
  }).join("");
  const mw = m.sites.filter((s) => s.type?.unit === "MW").reduce((a, s) => a + (s.item.value || 0), 0);
  const summary = m.sites.length
    ? `<p class="cv-lead">${m.sites.length} ${m.sites.length === 1 ? "sitio marcado" : "sitios marcados"}${mw ? ` · capacidad de generación marcada de ${gw(mw)}` : ""}. Haz clic en uno para volar allí.</p>`
    : `<p class="muted cv-note">No hay sitios de recursos marcados en esta comuna. El mapa solo marca los grandes (cada tipo tiene un umbral de tamaño).</p>`;
  return `
  <section class="cv-sec" id="cv-resources" data-sec="resources" aria-labelledby="cv-h-resources">
    <h3 id="cv-h-resources">${icon("resources", "⛏️", { size: 15 })}Recursos</h3>
    ${summary}
    <div class="cv-sites">${list}</div>
    ${m.sites.length ? `<p class="cv-note">Sitios cuyo hexágono tiene su centro dentro de la comuna. Solo sitios marcados, no toda la capacidad de la comuna.</p>` : ""}
  </section>`;
}

// --- compare -------------------------------------------------------------------------------------------------------
const COMPARE = {
  size: { label: "Tamaño y riqueza", cols: [
    ["Población", (c) => c.population, (v) => popShort(v)],
    [GDP_PC, (c) => (c.gdp != null && c.population ? c.gdp / c.population : null), money],
    ["Ingreso", (c) => c.median_income, money],
    ["Crecimiento", (c) => (Number.isFinite(c.growth) ? c.growth : null), (v) => signed(v)],
  ] },
  housing: { label: "Vivienda y empleo", cols: [
    ["Valor vivienda", (c) => c.home_value, money],
    ["Arriendo/mes", (c) => c.median_rent, (v) => dollars(v)],
    ["Carga arriendo", (c) => c.rent_burden, (v) => pct(v, 0)],
    ["Desempleo", (c) => c.unemployment, (v) => pct(v)],
  ] },
};

/**
 * The metric sets to offer: a column that is null for the city and every peer is dropped (a build without income,
 * rent or home values), and when a set is left with a single column the sets are folded into one table.
 */
export function compareSets(m) {
  const rows = [m.city, ...m.peers];
  const sets = Object.entries(COMPARE)
    .map(([id, s]) => ({ id, label: s.label, cols: s.cols.filter(([, f]) => rows.some((c) => f(c) != null)) }))
    .filter((s) => s.cols.length);
  const all = sets.flatMap((s) => s.cols);
  if (sets.length > 1 && all.length <= 5 && sets.some((s) => s.cols.length < 2)) return [{ id: sets[0].id, label: "", cols: all }];
  return sets;
}

export function compareTable(m, set = "size") {
  const rows = [m.city, ...m.peers];
  const sets = compareSets(m);
  const cols = (sets.find((s) => s.id === set) || sets[0])?.cols || [];
  if (!cols.length) return `<p class="muted cv-note">Sin datos.</p>`;
  const grid = `grid-template-columns:minmax(0,1.25fr) repeat(${cols.length},minmax(0,1fr))`;
  const max = cols.map(([, f]) => Math.max(...rows.map((c) => Math.abs(f(c) ?? 0))) || 1);
  // Under a name: its provincia, when that is another unit than the city itself (never for a comuna that is its own provincia).
  const where = (c) => (m.otherStates?.(c, c.states) || []).join(", ");
  return `<div class="cv-cmp" role="table" aria-label="${esc(m.city.name)} y comunas de tamaño similar">
    <div class="cv-cmp-r cv-cmp-h" role="row" style="${grid}"><span role="columnheader">Comuna</span>${cols.map(([l]) => `<span role="columnheader">${esc(l)}</span>`).join("")}</div>
    ${rows.map((c, k) => `<div class="cv-cmp-r${k === 0 ? " me" : ""}" role="row" style="${grid}">
      <span role="cell">${k === 0 ? `<b class="cv-cmp-n">${esc(c.name)}</b>` : `<button type="button" class="cv-cmp-n" data-peer="${esc(c.id)}" title="Abrir ${esc(c.name)} en la vista de comuna">${esc(c.name)}</button>`}${where(c) ? `<small>${esc(where(c))}</small>` : ""}</span>
      ${cols.map(([, f, fmt], j) => {
        const v = f(c);
        const col = v != null && v < 0 ? "#f08a6a" : k === 0 ? "#ecd08e" : "#8fa6bd";
        return `<span role="cell"><em>${v == null ? "–" : esc(fmt(v))}</em>${bar(v == null ? 0 : Math.abs(v) / max[j], col)}</span>`;
      }).join("")}
    </div>`).join("")}
  </div>`;
}

function compare(m) {
  const sets = compareSets(m);
  const first = sets[0]?.id || "size";
  return `
  <section class="cv-sec" id="cv-compare" data-sec="compare" aria-labelledby="cv-h-compare">
    <h3 id="cv-h-compare">${icon("layers", "⚖️", { size: 15 })}Comparar</h3>
    <p class="cv-lead">${m.peers.length ? `Las ${m.peers.length} comunas más cercanas en población. Haz clic en una para abrirla.` : "No hay comunas para comparar."}
      <button type="button" class="cv-link" onclick="window.__app?.compare?.open('${m.city.id}')">Comparar en detalle con otras comunas ›</button></p>
    ${sets.length > 1 ? `<div class="cv-seg" role="group" aria-label="Métricas">
      ${sets.map((s) => `<button type="button" data-set="${s.id}" aria-pressed="${s.id === first}">${esc(s.label)}</button>`).join("")}
    </div>` : ""}
    <div data-compare>${compareTable(m, first)}</div>
  </section>`;
}

function footer(m) {
  const nat = m.nation;
  return `<div class="cv-foot">Fuentes: ${esc(nat.vintage || "")}${nat.gdp_vintage ? `; ${GDP}: ${esc(nat.gdp_vintage)}` : ""}. La fuente y el año de cada dato están en la Guía; el lugar se mide entre las ${m.cityList.length} comunas del mapa.
    <a href="#" data-pedia>Guía ›</a></div>`;
}

/**
 * Scrolls the dock to a section (its tab id, e.g. "districts"). Citizens and districts arrive later and change the
 * heights above, so the section is re-aligned as they do, for up to 4 s or until the user scrolls themselves.
 */
export function goToSection(el, id) {
  const sec = el?.querySelector(`[data-sec="${id}"]`);
  if (!sec) return false;
  const align = () => {
    const nav = el.querySelector(".cv-tabs");
    el.scrollTop = Math.max(0, sec.offsetTop - (nav?.offsetHeight || 0) - 4);
    el.onscroll?.(); // the tab spy (a scroll event is not always sent for a programmatic jump)
  };
  align();
  let ro = null;
  const stop = () => {
    ro?.disconnect();
    ro = null;
    for (const t of ["wheel", "touchstart", "keydown", "pointerdown"]) el.removeEventListener(t, stop);
  };
  for (const t of ["wheel", "touchstart", "keydown", "pointerdown"]) el.addEventListener(t, stop, { passive: true });
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver(() => { if (sec.isConnected) align(); else stop(); });
    for (const c of el.children) ro.observe(c);
  }
  setTimeout(stop, 4000);
  return true;
}

/**
 * Fill the dock. handlers: {onClose, onState(idx), onPeer(id), onSite(site), onSiteHover(site|null), onPedia,
 * loadCounties() → Promise<counties.json|null>, loadData(name) → Promise<data|null>, onDistricts(list)} (the
 * city's districts once districts.json is in, for the map plaques).
 */
export function render(el, m, h) {
  el.classList.add("cv-dock");
  el.style.setProperty("--sc", css(m.stateRGB));
  el.innerHTML = header(m) + citizens(m) + districts(m) + economy(m) + workforce(m) + resources(m) + compare(m) + footer(m);
  el.scrollTop = 0;

  el.querySelector("[data-close]").onclick = () => h.onClose();
  el.querySelectorAll("[data-state]").forEach((b) => (b.onclick = () => h.onState(+b.dataset.state)));
  el.querySelector("[data-pedia]").onclick = (e) => { e.preventDefault(); h.onPedia(); };

  // Sites: hover lights the hex on the map, click flies there.
  el.querySelectorAll("[data-site]").forEach((b) => {
    const s = m.sites[+b.dataset.site];
    b.onclick = () => h.onSite(s);
    b.onmouseenter = b.onfocus = () => h.onSiteHover(s);
    b.onmouseleave = b.onblur = () => h.onSiteHover(null);
  });

  // Compare: metric sets and peer links (delegated, the table is re-rendered).
  const cmp = el.querySelector("[data-compare]");
  el.querySelectorAll("[data-set]").forEach((b) => (b.onclick = () => {
    el.querySelectorAll("[data-set]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    cmp.innerHTML = compareTable(m, b.dataset.set);
  }));
  cmp.addEventListener("click", (e) => {
    const b = e.target.closest("[data-peer]");
    if (b) h.onPeer(b.dataset.peer);
  });

  // Tabs scroll to their section; the active tab follows the scroll position. A section can leave after the first
  // paint (no districts.json in this build), so the spy only looks at tabs and sections still in the dock.
  const nav = el.querySelector(".cv-tabs");
  const tabs = [...el.querySelectorAll("[data-tab]")];
  const secs = tabs.map((t) => el.querySelector(`[data-sec="${t.dataset.tab}"]`));
  tabs.forEach((t, k) => (t.onclick = () => {
    if (!secs[k]?.isConnected) return;
    const top = secs[k].offsetTop - nav.offsetHeight - 4;
    el.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }));
  const spy = () => {
    const y = el.scrollTop + nav.offsetHeight + 24;
    let k = -1, last = -1;
    secs.forEach((s, j) => {
      if (!s?.isConnected) return;
      if (k < 0 || s.offsetTop <= y) k = j;
      last = j;
    });
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) k = last;
    tabs.forEach((t, j) => t.classList.toggle("on", j === k));
  };
  el.onscroll = spy;
  spy();

  // Citizens and districts arrive with their files (each loaded once, on demand). A build without citizens.json
  // has no figure rows: their slot goes, and the section keeps its population chart, stats and member table.
  const czHost = el.querySelector("[data-citizens]");
  Promise.resolve(h.loadData?.("citizens")).then((data) => {
    if (!czHost.isConnected) return;
    if (!data?.cities) { czHost.remove(); return; }
    czHost.innerHTML = citizensHtml(m, data);
    mountCitizens(czHost, m, data);
  }, () => czHost.remove());
  // PAES results (paes.json, lazy): a build without the file, or a comuna without test takers, leaves the slot empty.
  const pHost = el.querySelector("[data-paes]");
  Promise.resolve(h.loadData?.("paes")).then((data) => {
    if (pHost.isConnected) pHost.innerHTML = paesHtml(m, data);
  }, () => {});
  const dHost = el.querySelector("[data-districts]");
  // A build without districts.json has no Districts section at all: the section and its tab go, rather than a tab
  // that only says there is no data.
  const dropDistricts = () => {
    if (!dHost.isConnected) return;
    el.querySelector('[data-sec="districts"]')?.remove();
    el.querySelector('[data-tab="districts"]')?.remove();
    el.querySelectorAll("[data-dnote]").forEach((n) => n.remove()); // text that points at the Districts section
    spy();
  };
  // military.json is omitted on this map (docs/PORTING.md): loadData resolves null without a request, and
  // districts.js then shows no Encampment tier, rule or vintage.
  Promise.all([
    Promise.resolve(h.loadData?.("districts")).catch(() => null),
    Promise.resolve(h.loadData?.("military")).catch(() => null),
  ]).then(([dd, mil]) => {
    if (!dHost.isConnected) return;
    if (!dd) {
      dropDistricts();
      h.onDistricts?.([]);
      return;
    }
    dHost.innerHTML = districtsHtml(m, dd, mil ?? null);
    h.onDistricts?.(cityDistricts(dd, mil ?? null, m.city.id));
  }, dropDistricts);

  // Member comunas arrive with counties.json (loaded once, on demand).
  const host = el.querySelector("[data-counties]");
  Promise.resolve(h.loadCounties()).then((data) => {
    if (host.isConnected) host.innerHTML = countiesTable(m, data);
  }, () => { if (host.isConnected) host.innerHTML = `<p class="muted cv-note">No hay datos de comunas.</p>`; });
}
