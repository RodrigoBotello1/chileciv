// Military advisor ("General"): installations and ranges, troops by province, defense spending by province,
// garrison comunas, and veterans and armed-forces residents by comuna. The Santiago build has no military layer
// (military.json is omitted on purpose), so this view shows its empty message there.
import { esc, fin, el as mk } from "../core/util.js";
import { int, pct, money, count3, dollars } from "../core/fmt.js";
import { stackedBars, sizeLegend, swatchLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, chips, segmented, mapPicker, sourcesHtml } from "../core/view.js";
import { rowsHighlight, extendData } from "../core/data.js";
import { countyLens, stateLens } from "../core/lenses.js";
import { frameBox, focusPoint } from "../core/frame.js";
import { T } from "../../../terms.js";

// Colours per component (branch hues; reserve = lighter, guard = gold tones).
const COMP_COLOR = {
  army: "#7d9a46", navy: "#3f6fc2", air_force: "#6fb3e0", marines: "#c24a3e",
  army_reserve: "#a8bd78", navy_reserve: "#8aa6db", air_force_reserve: "#a9d3ee", marine_reserve: "#e08f86",
  army_guard: "#d6b04a", air_guard: "#e6cf86", other: "#9a9aa8",
};
const COMP_SHORT = {
  army: "Ejército", navy: "Armada", air_force: "Fuerza Aérea", marines: "Infantería de Marina", army_reserve: "Res. Ejército", navy_reserve: "Res. Armada",
  air_force_reserve: "Res. FA", marine_reserve: "Res. Inf. Marina", army_guard: "Guardia Ejército", air_guard: "Guardia Aérea", other: "Otros Defensa",
};
const COMP_GROUPS = [
  { id: "active", label: "Servicio activo", ids: ["army", "navy", "air_force", "marines"] },
  { id: "reserve", label: "Reserva", ids: ["army_reserve", "navy_reserve", "air_force_reserve", "marine_reserve"] },
  { id: "guard", label: "Guardia nacional", ids: ["army_guard", "air_guard"] },
  { id: "other", label: "Otros", ids: ["other"] },
];
const TIER_LABEL = { major: "Mayor", base: "Base", site: "Sitio" };
const AREA_CAP = 3000; // km²: circles stop growing here (a few ranges are 10,000 km²+)
const STEEL_RAMP = ["#141b26", "#2a3a52", "#46627f", "#6f91ad", "#a9c3d6", "#eef4f8"];
const SPEND_RAMP = ["#1b1410", "#3e2a1c", "#6e4626", "#a66f34", "#d9a457", "#f8e2a6"];

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  await extendData(data, ["military"]);
  const mil = app.data.military;
  if (!mil) {
    el.innerHTML = `<p class="adv-empty pad">Sin datos.</p>`;
    return {};
  }
  const { states: stLevel, metros, counties } = data.levels;
  const comps = (mil.components || []).map((c) => ({ ...c, color: COMP_COLOR[c.id] || "#9a9aa8", short: COMP_SHORT[c.id] || c.name }));
  const compById = new Map(comps.map((c) => [c.id, c]));
  const insts = (mil.installations || []).map((it, i) => ({ ...it, key: it.id || String(i) }));
  const instByKey = new Map(insts.map((it) => [it.key, it]));
  const nat = mil.national || {};
  const vint = mil.vintage || {};
  const stateIdx = (abbr) => stLevel.byKey.get(abbr)?.ref ?? null;
  const stateName = (abbr) => stLevel.byKey.get(abbr)?.name || STATE_NAMES[abbr] || abbr;
  const instCells = (it) => (it.cells && it.cells.length ? it.cells : it.cell != null ? [it.cell] : []);
  // cell → the installation boundaries covering it (largest first), for map → dashboard.
  const cellInst = new Map();
  for (const it of insts) for (const c of it.cells || []) if (!cellInst.has(c)) cellInst.set(c, it);
  const cellRange = new Map();
  for (const r of mil.ranges || []) for (const c of r.cells || []) if (!cellRange.has(c)) cellRange.set(c, r);

  const st = { comps: new Set(comps.map((c) => c.id)), tier: "big", state: null };

  // --- headline -------------------------------------------------------------------------------------------------
  const P = nat.personnel || {}, S = nat.spending || {};
  el.insertAdjacentHTML("beforeend", tiles([
    { label: "Servicio activo", value: count3(P.active?.total), sub: `+ ${count3(P.guard_reserve?.total)} guardia y reserva`, color: "#a9c3d6" },
    { label: "Gasto en defensa", value: money(S.total), sub: `${pct(S.pct_gdp)} de las ventas · ${esc(vint.spending || "")}` },
    { label: "Veteranos", value: count3(nat.veterans), sub: "civiles de 18 años o más" },
  ]) + `<p class="adv-callout">No se publica la dotación de cada base, así que el mapa las dimensiona por la tierra dentro de su límite. Las cifras de tropa de abajo son por ${T.state}.</p>`);

  // --- map colour -----------------------------------------------------------------------------------------------
  const mapRow = mk("div", "adv-sec adv-mapsec");
  el.appendChild(mapRow);
  const afLens = () => countyLens(data, "armed_forces_pct", {
    name: "Residentes de las fuerzas armadas", emoji: "🎖️", ramp: STEEL_RAMP,
    description: "Personal en servicio activo entre los residentes de 16 años o más, por comuna, contado donde viven. Cada hexágono toma la comuna de su centro.",
  });
  const perResLens = () => stateLens(data, "def-per-resident", (abbr) => mil.states?.[abbr]?.spending?.per_resident ?? null, {
    name: "Gasto en defensa por habitante", emoji: "💵", format: "usd", unit: "$ por habitante", ramp: SPEND_RAMP, source: "oldcc_spending",
    description: `Contratos, subvenciones y remuneraciones de defensa por habitante, por ${T.state} (${vint.spending || "fuente"}). Los contratos siguen el lugar de ejecución.`,
  });
  mapPicker(ctx, mapRow, {
    value: "terrain",
    options: [
      { value: "terrain", label: "Terreno", lens: () => null },
      ...(app.lensById?.get("veterans") ? [{ value: "veterans", label: "Veteranos", lens: () => "veterans" }] : []),
      ...(counties ? [{ value: "af", label: "Tropa en su comuna", lens: afLens }] : []),
      { value: "dollars", label: "$ por habitante", lens: perResLens },
    ],
  });

  // --- installations --------------------------------------------------------------------------------------------
  const iBody = section(el, {
    title: "Instalaciones", kicker: esc(vint.installations || "Defensa"),
    note: `Todos los sitios activos de defensa ${T.inNation}: el área del círculo sigue la tierra dentro de su límite (tope de ${int(AREA_CAP)} km²; los sitios sin límite son puntos). ${esc(mil.rules?.tier || "")}`,
  });
  const counts = new Map();
  for (const it of insts) counts.set(it.component, (counts.get(it.component) || 0) + 1);
  const compChips = chips(iBody, {
    label: "Componentes",
    items: comps.filter((c) => counts.get(c.id)).map((c) => ({ key: c.id, label: c.short, color: c.color, count: counts.get(c.id) })),
    onChange: (on) => { st.comps = on; apply(); },
  });
  const qRow = mk("div", "adv-row");
  qRow.innerHTML = COMP_GROUPS.map((g) => `<button type="button" class="adv-mini" data-g="${g.id}">${esc(g.label)}</button>`).join("") + `<button type="button" class="adv-mini" data-g="all">Todos</button>`;
  iBody.appendChild(qRow);
  qRow.addEventListener("click", (e) => {
    const g = e.target.closest("[data-g]")?.dataset.g;
    if (!g) return;
    st.comps = g === "all" ? new Set(comps.map((c) => c.id)) : new Set(COMP_GROUPS.find((x) => x.id === g).ids);
    compChips.set(st.comps);
    apply();
  });
  const tRow = mk("div", "adv-row");
  iBody.appendChild(tRow);
  segmented(tRow, {
    label: "Tamaño", value: st.tier,
    options: [{ value: "major", label: "Mayores" }, { value: "big", label: "Mayores y bases" }, { value: "all", label: "Todos los sitios" }],
    onChange: (v) => { st.tier = v; apply(); },
  });
  const stateChip = mk("div", "adv-row adv-filterbar");
  iBody.appendChild(stateChip);
  stateChip.addEventListener("click", (e) => { if (e.target.closest("[data-clear-state]")) setState(null); });
  const legend = mk("div");
  legend.innerHTML = sizeLegend([100, 1000, AREA_CAP], (v) => 14 * Math.sqrt(v / AREA_CAP), (v) => `${int(v)} km²`, "Área del círculo = tierra dentro del límite");
  iBody.appendChild(legend);
  const instTable = createTable(iBody, {
    caption: "Instalaciones de defensa", search: `Buscar instalaciones, ${T.states}`, rank: true, maxHeight: 280,
    searchText: (r) => `${r.name} ${r.state} ${compById.get(r.component)?.name || ""}`,
    columns: [
      { key: "name", label: "Instalación", align: "l", width: "minmax(0,1.9fr)", value: (r) => r.name, html: (r) => `<i class="dot" style="background:${esc(compById.get(r.component)?.color || "#999")}"></i>${esc(r.name)}${r.joint ? ` <span class="sub">conjunta</span>` : ""}`, tip: (r) => `${r.name} · ${compById.get(r.component)?.name || r.component}${r.status !== "act" ? ` · ${STATUS[r.status] || r.status}` : ""}` },
      { key: "component", label: "Rama", align: "l", width: "minmax(0,.9fr)", hideBelow: 400, value: (r) => compById.get(r.component)?.short, text: (r) => compById.get(r.component)?.short || r.component },
      { key: "tier", label: "Nivel", align: "l", width: "46px", value: (r) => ({ major: 0, base: 1, site: 2 })[r.tier], text: (r) => TIER_LABEL[r.tier] || r.tier },
      { key: "state", label: `${T.State}`, align: "l", width: "40px", value: (r) => r.state, text: (r) => r.state || "–" },
      { key: "area", label: "Área", width: "minmax(0,.8fr)", value: (r) => r.area_km2, text: (r) => (fin(r.area_km2) ? `${count3(r.area_km2)} km²` : "–"), title: "Tierra dentro del límite (vacío: sin límite publicado)" },
    ],
    rows: [], sort: { key: "area", dir: "desc" },
    onHover: (r) => {
      link.hover(r ? { cells: new Set(instCells(r)), label: r.name } : null);
      bubbles.setHot(r ? r.key : null);
    },
    onClick: (r) => flyTo(r),
  });
  function flyTo(r) {
    if (r.cells && r.cells.length > 2) {
      const b = app.highlightBounds({ cells: new Set(r.cells) });
      if (b) return frameBox(app, b, { pad: 60, maxScale: 3 });
    }
    focusPoint(app, r.x, r.y, Math.min(app.cam.maxScale, Math.max(app.cam.scale, (app.cam.fitScale || 1) * 3)));
  }

  // --- by state -------------------------------------------------------------------------------------------------
  const sBody = section(el, {
    title: `Tropa y gasto por ${T.state}`,
    note: `Personal por ${T.state} de destino (${esc(vint.personnel || "fuente")}); gasto por lugar de ejecución (${esc(vint.spending || "fuente")}). Haz clic en una ${T.state} para ver su detalle y filtrar las bases a ella.`,
  });
  const sCtl = mk("div", "adv-row");
  sBody.appendChild(sCtl);
  let metric = "troops", showAll = false;
  segmented(sCtl, {
    label: "Medida", value: metric,
    options: [{ value: "troops", label: "Tropa" }, { value: "dollars", label: "Pesos" }, { value: "perres", label: "Por habitante" }, { value: "gdp", label: "% de las ventas" }],
    onChange: (v) => { metric = v; drawStates(); },
  });
  const allBtn = mk("button", "adv-mini");
  allBtn.type = "button";
  sCtl.appendChild(allBtn);
  allBtn.addEventListener("click", () => { showAll = !showAll; drawStates(); });
  const sHost = mk("div");
  sBody.appendChild(sHost);
  const sLegend = mk("div");
  sBody.appendChild(sLegend);
  const detail = mk("div", "adv-detail");
  sBody.appendChild(detail);
  let stacks = null;
  const METRICS = {
    troops: {
      keys: [{ key: "active", label: "Servicio activo", color: "#6f91ad" }, { key: "guard", label: "Guardia y reserva", color: "#d6b04a" }, { key: "civ", label: "Civiles de defensa", color: "#9a9aa8" }],
      parts: (s) => ({ active: s.personnel?.active?.total, guard: s.personnel?.guard_reserve?.total, civ: s.personnel?.civilian?.total }),
      total: (s) => s.personnel?.total, fmt: count3,
    },
    dollars: {
      keys: [{ key: "contracts", label: "Contratos", color: "#d9a457" }, { key: "payroll", label: "Remuneraciones", color: "#6f91ad" }, { key: "grants", label: "Subvenciones", color: "#8fcbb8" }],
      parts: (s) => ({ contracts: s.spending?.contracts, payroll: s.spending?.payroll, grants: s.spending?.grants }),
      total: (s) => s.spending?.total, fmt: money,
    },
    perres: { keys: [{ key: "v", label: "$ por habitante", color: "#d9a457" }], parts: (s) => ({ v: s.spending?.per_resident }), total: (s) => s.spending?.per_resident, fmt: dollars },
    gdp: { keys: [{ key: "v", label: `Parte de las ventas de la ${T.state}`, color: "#c46a4f" }], parts: (s) => ({ v: s.spending?.pct_gdp }), total: (s) => s.spending?.pct_gdp, fmt: (v) => pct(v) },
  };
  const milStates = Object.entries(mil.states || {}).filter(([, s]) => s);
  function drawStates() {
    const M = METRICS[metric];
    const rows = milStates
      .map(([abbr, s]) => ({ key: abbr, label: stateName(abbr), sub: stateIdx(abbr) == null ? "fuera del mapa" : "", parts: M.parts(s), total: M.total(s), text: M.fmt(M.total(s)) }))
      .filter((r) => fin(r.total))
      .sort((a, b) => b.total - a.total);
    const shown = showAll ? rows : rows.slice(0, 15);
    allBtn.textContent = showAll ? "Top 15" : `Todas (${rows.length})`;
    sHost.innerHTML = "";
    stacks = stackedBars(sHost, {
      rows: shown, keys: M.keys, fmt: (v) => M.fmt(v), ariaLabel: `Defensa por ${T.state}`,
      onHover: (x) => {
        if (!x) return link.hover(null);
        const i = stateIdx(x.row.key);
        link.hover(i != null ? { states: new Set([i]), dimOthers: true, label: x.row.label } : null);
      },
      onClick: (x) => setState(st.state === x.row.key ? null : x.row.key, true),
    });
    if (st.state) stacks.setSelected(st.state);
    sLegend.innerHTML = M.keys.length > 1 ? swatchLegend(M.keys) : "";
  }

  function drawDetail() {
    const abbr = st.state;
    const s = abbr ? mil.states?.[abbr] : null;
    if (!abbr) { detail.innerHTML = ""; return; }
    if (!s) { detail.innerHTML = `<p class="adv-empty">No hay cifras de defensa para ${esc(stateName(abbr))}.</p>`; return; }
    const p = s.personnel, sp = s.spending;
    const branch = p ? [["Ejército", p.active?.army], ["Armada", p.active?.navy], ["Infantería de Marina", p.active?.marines], ["Fuerza Aérea", p.active?.air_force], ["Fuerza Espacial", p.active?.space_force], ["Guardia Costera", p.active?.coast_guard]] : [];
    const nInst = insts.filter((it) => it.state === abbr).length;
    detail.innerHTML = `<div class="adv-card-detail">
      <h4 class="adv-h4">${esc(stateName(abbr))}</h4>
      ${tiles([
        { label: "Servicio activo", value: p ? int(p.active?.total) : "–", sub: p ? `${int(p.guard_reserve?.total)} guardia y reserva` : "sin cifra de personal" },
        { label: "Gasto en defensa", value: sp ? money(sp.total) : "–", sub: sp ? `${pct(sp.pct_gdp)} de las ventas · ${dollars(sp.per_resident)}/habitante` : "sin cifra de gasto" },
        { label: "Instalaciones", value: int(nInst), sub: "Sitios registrados aquí" },
      ])}
      ${p ? `<p class="adv-note"><b>Servicio activo por rama:</b> ${branch.filter(([, v]) => fin(v) && v > 0).map(([k, v]) => `${esc(k)} ${int(v)}`).join(" · ")}. Civiles de defensa: ${int(p.civilian?.total)}.</p>` : ""}
      ${sp ? `<p class="adv-note"><b>Adónde va el dinero:</b> contratos ${money(sp.contracts)}, remuneraciones ${money(sp.payroll)}, subvenciones ${money(sp.grants)}.</p>` : ""}
      ${sp?.top_vendors?.length ? `<p class="adv-note"><b>Principales contratistas:</b> ${sp.top_vendors.map((v) => `${esc(v.name)} ${money(v.contracts)}`).join(" · ")}</p>` : ""}
      ${sp?.top_counties?.length ? `<h4 class="adv-h4">Contratos por comuna</h4><div class="adv-chiplist">${sp.top_counties.map((c, i) => `<button type="button" class="adv-mini" data-county="${i}"${c.county ? "" : " disabled title=\"No es una comuna del mapa\""}>${esc(c.name)} <b>${money(c.contracts)}</b></button>`).join("")}</div>` : ""}
    </div>`;
    detail.querySelectorAll("[data-county]").forEach((b) => {
      const c = sp.top_counties[+b.dataset.county];
      const row = c.county ? counties?.byKey.get(c.county) : null;
      if (!row) return;
      b.addEventListener("pointerenter", () => link.hover(rowsHighlight(counties, [row])));
      b.addEventListener("pointerleave", () => link.hover(null));
      b.addEventListener("click", () => counties.focus(row));
    });
  }

  // --- garrisons ------------------------------------------------------------------------------------------------
  const gBody = section(el, {
    title: "Comunas con guarnición",
    note: `${esc(mil.rules?.encampment || mil.rule || "")}`,
  });
  const garrisons = Object.entries(mil.cities || {}).map(([id, c]) => ({ ...c, key: id, row: metros.byKey.get(id) })).filter((g) => g.row);
  const gTable = createTable(gBody, {
    caption: "Comunas con guarnición", rank: true, maxHeight: 250, search: "Buscar comunas",
    searchText: (g) => g.row.name,
    columns: [
      { key: "name", label: "Comuna", align: "l", width: "minmax(0,1.8fr)", value: (g) => g.row.name, html: (g) => `${esc(g.row.name)} <span class="sub">${esc(g.row.sub)}</span>`, tip: (g) => `${g.row.name}: ${(g.installations || []).map((id) => instByKey.get(id)?.name || id).join(", ")}` },
      { key: "tier", label: "Nivel", align: "l", width: "minmax(0,.8fr)", value: (g) => (g.tier === "fortress" ? 0 : 1), text: (g) => `${g.tier === "fortress" ? "Fortaleza" : "Guarnición"}${g.naval ? " ⚓" : ""}` },
      { key: "af", label: "De uniforme", value: (g) => g.armed_forces, text: (g) => count3(g.armed_forces), title: "Residentes de las fuerzas armadas de 16 años o más (donde viven)" },
      { key: "share", label: "Proporción", value: (g) => g.share, text: (g) => pct(g.share), title: "Proporción de los residentes de 16 años o más en servicio activo", bar: { max: Math.max(...garrisons.map((g) => g.share || 0), 0.01), color: "rgba(135,150,171,.35)" } },
    ],
    rows: garrisons, sort: { key: "share", dir: "desc" },
    onHover: (g) => link.hover(g ? rowsHighlight(metros, [g.row]) : null),
    onClick: (g) => metros.focus(g.row),
  });
  gBody.insertAdjacentHTML("beforeend", `<p class="adv-note">⚓ naval: las instalaciones calificadas de la Armada y la Infantería de Marina de la comuna pesan más que las del Ejército y la Fuerza Aérea (una instalación mayor cuenta 4, una base 1). Una comuna grande califica por dotación solo si sirven al menos 2,000 residentes y el 0.3% de sus residentes de 16 años o más: mira la columna de proporción.</p>`);

  // --- ranges ---------------------------------------------------------------------------------------------------
  const rBody = section(el, { title: "Campos de tiro y terreno restringido", note: esc(mil.rules?.ranges || "") });
  const ranges = (mil.ranges || []).map((r) => ({ ...r, key: r.id }));
  const rTable = createTable(rBody, {
    caption: "Mayores campos militares", rank: true, maxHeight: 240,
    columns: [
      { key: "name", label: "Campo", align: "l", width: "minmax(0,2fr)", value: (r) => r.name, html: (r) => `<i class="dot" style="background:${esc(compById.get(r.component)?.color || "#999")}"></i>${esc(r.name)}` },
      { key: "state", label: `${T.State}`, align: "l", width: "40px", value: (r) => r.state, text: (r) => r.state || "–" },
      { key: "area", label: "Area", width: "minmax(0,.9fr)", value: (r) => r.area_km2, text: (r) => `${count3(r.area_km2)} km²`, bar: { max: Math.max(...ranges.map((r) => r.area_km2 || 0), 1), color: "rgba(194,74,62,.3)" } },
    ],
    rows: ranges, sort: { key: "area", dir: "desc" },
    onHover: (r) => link.hover(r ? { cells: new Set(r.cells || []), dimOthers: true, color: "#f09a7f", label: r.name } : null),
    onClick: (r) => { const b = app.highlightBounds({ cells: new Set(r.cells || []) }); if (b) frameBox(app, b, { pad: 60, maxScale: 2.6 }); },
  });

  // --- veterans -------------------------------------------------------------------------------------------------
  const vBody = section(el, {
    title: "Veteranos y tropa en su comuna",
    note: `Veteranos civiles de 18 años o más y residentes en servicio activo de 16 años o más, contados donde viven (${esc(vint.acs || data.countyVintage)}). Las proporciones de ${T.states} y comunas son cifras sumadas ÷ bases sumadas de sus comunas.`,
  });
  let vLevel = "states";
  const vCtl = mk("div", "adv-row");
  vBody.appendChild(vCtl);
  segmented(vCtl, {
    label: "Lugares", value: vLevel,
    options: [{ value: "states", label: `${T.States}` }, { value: "metros", label: "Comunas" }, ...(counties ? [{ value: "counties", label: "Comunas (detalle)" }] : [])],
    onChange: (v) => { vLevel = v; vTable.setRows(vRows()); },
  });
  const vRows = () => data.levels[vLevel].rows.filter((r) => fin(r.v.veterans_pct) && (vLevel !== "counties" || (r.v.population || 0) >= 10000));
  const vTable = createTable(vBody, {
    caption: "Veteranos y fuerzas armadas", rank: true, maxHeight: 260, search: "Buscar lugares",
    columns: [
      { key: "name", label: "Lugar", align: "l", width: "minmax(0,1.7fr)", value: (r) => r.name, html: (r) => `${esc(r.name)}${r.level !== "states" && r.sub ? ` <span class="sub">${esc(r.sub)}</span>` : ""}` },
      { key: "veterans", label: "Veteranos", value: (r) => r.v.veterans, text: (r) => count3(r.v.veterans) },
      { key: "veterans_pct", label: "Proporción", value: (r) => r.v.veterans_pct, text: (r) => pct(r.v.veterans_pct), bar: { max: 0.2, color: "rgba(135,150,171,.35)" }, title: "Veteranos entre los civiles de 18 años o más" },
      { key: "armed_forces_pct", label: "De uniforme", value: (r) => r.v.armed_forces_pct, text: (r) => pct(r.v.armed_forces_pct), title: "Servicio activo entre los residentes de 16 años o más" },
    ],
    rows: vRows(), sort: { key: "veterans_pct", dir: "desc" },
    onHover: (r) => link.hover(r ? rowsHighlight(data.levels[vLevel], [r]) : null),
    onClick: (r) => data.levels[vLevel].focus(r),
  });
  vBody.insertAdjacentHTML("beforeend", `<p class="adv-note">Solo comunas de 10,000 habitantes o más (las estimaciones de las comunas pequeñas son ruidosas).</p>`);

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, mil.sources || [], [
    esc(mil.caveats || ""),
    `El personal es de ${esc(vint.personnel || "la fuente de personal")}; el gasto es de ${esc(vint.spending || "la fuente de gasto")}, la edición más reciente publicada. Son años distintos.`,
    "Los niveles de instalación salen del área del límite y del componente, nunca de la dotación: un campo \"mayor\" puede tener poca gente y un cuartel chico mucha.",
    `Unos pocos sitios figuran en una ${T.state} que no es la suya: la tabla conserva la ${T.state} del registro; los campos usan la ${T.state} que contiene la mayoría de sus hexágonos.`,
    `Los territorios fuera del mapa aparecen en los gráficos por ${T.state} pero no en el mapa.`,
  ].filter(Boolean)));

  // --- map ------------------------------------------------------------------------------------------------------
  const bubbles = ctx.bubbles("bases", {
    rMax: 14, minR: 2.6, alpha: 0.6,
    tip: (b) => {
      const it = b.it, c = compById.get(it.component);
      return `<b>${esc(it.name)}</b><br>${esc(c?.name || it.component)} · ${esc(TIER_LABEL[it.tier] || it.tier)}${fin(it.area_km2) ? ` · ${count3(it.area_km2)} km²` : ""}${it.state ? ` · ${esc(it.state)}` : ""}${it.status !== "act" ? `<br><span class="sub">${esc(STATUS[it.status] || it.status)}</span>` : ""}`;
    },
    onHover: (b) => {
      instTable.setHot(b ? b.key : null);
      link.hover(b && b.it.cells?.length ? { cells: new Set(b.it.cells), noBeacon: true } : null);
    },
    onClick: (b) => { instTable.setHot(b.key); flyTo(b.it); },
  });

  function visible() {
    return insts.filter((it) => st.comps.has(it.component) && (st.tier === "all" || it.tier === "major" || (st.tier === "big" && it.tier === "base")) && (!st.state || it.state === st.state));
  }
  function setState(abbr, fly = false) {
    st.state = abbr;
    stacks?.setSelected(abbr);
    if (!abbr) stacks?.setSelected(null);
    apply();
    drawDetail();
    const i = abbr ? stateIdx(abbr) : null;
    if (i != null && fly) {
      const b = app.highlightBounds({ states: new Set([i]) });
      if (b) frameBox(app, b, { pad: 30, maxScale: 2.6 });
    }
  }
  function apply() {
    const vis = visible();
    instTable.setRows(vis);
    bubbles.set(vis.map((it) => ({ key: it.key, x: it.x, y: it.y, value: fin(it.area_km2) ? Math.min(AREA_CAP, it.area_km2) : 0, color: compById.get(it.component)?.color || "#999", it })), { vMax: AREA_CAP });
    const i = st.state ? stateIdx(st.state) : null;
    link.base(i != null ? { states: new Set([i]), dimOthers: true } : null);
    stateChip.innerHTML = st.state
      ? `<span class="adv-fchip">${T.State}: <b>${esc(stateName(st.state))}</b> · ${int(vis.length)} sitios<button type="button" data-clear-state aria-label="Quitar el filtro de ${T.state}">✕</button></span>`
      : "";
  }
  drawStates();
  apply();

  return {
    onMapHover(h) {
      const owner = h.cell >= 0 ? app.w.raw.owner[h.cell] : -1;
      const abbr = owner >= 0 ? stLevel.rows[owner]?.key : null;
      stacks?.setHot(abbr || null);
      const r = h.cell >= 0 ? cellRange.get(h.cell) : null;
      rTable.setHot(r ? r.id : null, !!r);
      // A fort or range drawn by the map-art layer names its record; otherwise the boundary under the pointer.
      const inst = h.item?.kind === "fort" ? instByKey.get(h.item.data?.id) : h.cell >= 0 ? cellInst.get(h.cell) : null;
      if (inst) instTable.setHot(inst.key);
      if (h.item?.kind === "range") rTable.setHot(h.item.data?.id ?? null);
      const m = h.cell >= 0 ? metros.rowAtCell(h.cell) : null;
      gTable.setHot(m && mil.cities?.[m.key] ? m.key : null, false);
      const vr = h.cell >= 0 ? data.levels[vLevel]?.rowAtCell(h.cell) : null;
      vTable.setHot(vr ? vr.key : null, false);
    },
    onMapClick(ev) {
      const fort = ev.item?.kind === "fort" ? instByKey.get(ev.item.data?.id) : null;
      if (fort) { instTable.setHot(fort.key); flyTo(fort); return true; }
      // A click on a province (not a comuna) filters the General's view to it; a second click clears it.
      if (ev.city || ev.state == null) return false;
      const abbr = stLevel.rows[ev.state]?.key;
      if (!abbr) return false;
      setState(st.state === abbr ? null : abbr);
      return true;
    },
    onEscape() {
      if (st.state) { setState(null); return true; }
      return false;
    },
  };
}

const STATUS = { act: "Activa", semi: "Semiactiva", care: "En custodia" };
const STATE_NAMES = {};

