// Land advisor: national land cover, where each cover dominates, the provinces' make-up and who works the land.
import { esc, fin, ratio } from "../core/util.js";
import { pct, int, compact, count3 } from "../core/fmt.js";
import { shareBar, barList, donut, smallMultiples } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, segmented, lensButton, sourcesHtml, topBy, frameBtn } from "../core/view.js";
import { LAND_KEYS, LAND_LABEL, LAND_COLOR, rowsHighlight } from "../core/data.js";
import { T } from "../../../terms.js";

const LENS_OF = { forest: "forest", crop: "farmland", pasture: "farmland", developed: "developed" };
const FOOD_MIN = 100000; // cities in the farm-worker ranking

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const w = app.w;
  const P = w.raw.pct;
  const owner = w.raw.owner;
  const { states } = data.levels;
  if (!P) {
    el.innerHTML = `<p class="adv-empty pad">world.json no trae las proporciones de cobertura del suelo.</p>`;
    return {};
  }
  // The land-cover source as the data names it (sources.json), for the notes below.
  const landSrcId = states.field(`land_${LAND_KEYS[0]}`)?.source || app.lensById?.get("forest")?.source || "";
  const landSrc = data.source(landSrcId);
  const landSrcText = landSrc?.title || "";

  // --- national shares and dominant cover per hex ---------------------------------------------------------------
  const sums = Object.fromEntries(LAND_KEYS.map((k) => [k, 0]));
  const dominant = new Map(LAND_KEYS.map((k) => [k, []]));
  let cells = 0;
  for (let i = 0; i < w.grid.size; i++) {
    if (!(owner[i] >= 0)) continue;
    let tot = 0, best = null, bv = 0;
    for (const k of LAND_KEYS) {
      const v = P[k]?.[i] || 0;
      tot += v;
      if (v > bv) { bv = v; best = k; }
    }
    if (tot <= 0) continue; // no land-cover samples
    cells++;
    for (const k of LAND_KEYS) sums[k] += P[k]?.[i] || 0;
    dominant.get(best).push(i);
  }
  const share = Object.fromEntries(LAND_KEYS.map((k) => [k, cells ? sums[k] / (cells * 100) : 0]));
  const other = Math.max(0, 1 - LAND_KEYS.reduce((a, k) => a + share[k], 0));

  el.insertAdjacentHTML("beforeend", tiles([
    { label: LAND_LABEL.forest, value: pct(share.forest, 0), sub: `De la tierra ${T.ofNation}`, color: LAND_COLOR.forest },
    { label: "Tierra agropecuaria", value: pct(share.crop + share.pasture, 0), sub: `${LAND_LABEL.crop}＋${LAND_LABEL.pasture}`, color: LAND_COLOR.crop },
    { label: LAND_LABEL.developed, value: pct(share.developed, 1), sub: "Tierra construida", color: LAND_COLOR.developed },
  ]));

  // --- composition ----------------------------------------------------------------------------------------------
  const cBody = section(el, { title: "Qué hay en esta tierra", kicker: `${T.nationName}`, note: `Proporción de la tierra que ocupa cada cobertura (${landSrcText ? `${esc(landSrcText)}; ` : ""}promedio de todos los hexágonos). Pasa el cursor sobre una clase para iluminar los hexágonos donde predomina; haz clic para dejarla fija.` });
  let pinned = null;
  const parts = [...LAND_KEYS.map((k) => ({ key: k, label: LAND_LABEL[k], value: share[k], color: LAND_COLOR[k], text: pct(share[k]) })), { key: "other", label: "Otros (suelo desnudo, etc.)", value: other, color: "#6c6358", text: pct(other) }].sort((a, b) => (a.key === "other") - (b.key === "other") || b.value - a.value);
  const domHighlight = (k, dim = true) => (dominant.has(k) ? { cells: new Set(dominant.get(k)), dimOthers: dim, color: LAND_COLOR[k] } : null);
  const sb = shareBar(cBody, {
    parts,
    onHover: (p) => link.hover(p && p.key !== "other" ? { ...domHighlight(p.key), color: "#fff3c4" } : null),
    onClick: (p) => pin(p.key === "other" || pinned === p.key ? null : p.key),
  });
  const pinInfo = document.createElement("div");
  pinInfo.className = "adv-brushinfo";
  cBody.appendChild(pinInfo);
  const lensRow = document.createElement("div");
  lensRow.className = "adv-row";
  // The lens buttons carry the lens's own name: its numbers may come from another source than the hex land cover.
  const lensIds = ["forest", "farmland", "developed"].filter((id) => app.lensById?.has(id));
  for (const id of lensIds) {
    const b = lensButton(app, id, `Lente ${app.lensById.get(id).name}`);
    if (b) lensRow.appendChild(b);
  }
  const lensSrc = [...new Set(lensIds.map((id) => app.lensById.get(id).source).filter((s) => s && s !== landSrcId))];
  cBody.appendChild(lensRow);
  function pin(k) {
    pinned = k;
    sb.setSelected(k);
    link.base(k ? domHighlight(k) : null, { frame: true });
    if (!k) { pinInfo.innerHTML = ""; return; }
    const n = dominant.get(k).length;
    const lens = LENS_OF[k] && app.lensById?.get(LENS_OF[k]);
    pinInfo.innerHTML = `<b>${esc(LAND_LABEL[k])}</b> es la cobertura mayor en <b>${int(n)}</b> hexágonos (${pct(n / cells, 0)} de los hexágonos de tierra) y cubre ${pct(share[k])} de toda la tierra.
      ${lens ? `<button type="button" class="adv-mini" data-lens="${lens.id}">Mostrar el lente "${esc(lens.name)}"</button>` : ""}${frameBtn()}<button type="button" class="adv-mini" data-clear>Limpiar</button>`;
  }
  pinInfo.addEventListener("click", (e) => {
    if (e.target.closest("[data-clear]")) pin(null);
    const l = e.target.closest("[data-lens]")?.dataset.lens;
    if (l) app.setLens(l);
  });

  // --- per state ------------------------------------------------------------------------------------------------
  const sBody = section(el, { title: `Composición de la tierra por ${T.state}`, note: `La tierra de cada ${T.state} repartida por tipo de cobertura. Ordena por cualquier tipo; pasa el cursor sobre una ${T.state} para marcarla y haz clic para abrirla.` });
  const stRows = states.rows.filter((r) => LAND_KEYS.some((k) => fin(r.v[`land_${k}`])));
  const comp = (r) => `<span class="adv-minibar">${LAND_KEYS.map((k) => {
    const v = r.v[`land_${k}`];
    return fin(v) && v > 0 ? `<i style="width:${(v * 100).toFixed(2)}%;background:${LAND_COLOR[k]}" title="${esc(`${LAND_LABEL[k]} ${pct(v)}`)}"></i>` : "";
  }).join("")}</span>`;
  const domOf = (r) => LAND_KEYS.reduce((b, k) => ((r.v[`land_${k}`] ?? -1) > (r.v[`land_${b}`] ?? -1) ? k : b), LAND_KEYS[0]);
  let sortKey = "forest";
  const colsFor = (k) => [
    { key: "name", label: `${T.State}`, align: "l", width: "minmax(0,1.1fr)", value: (r) => r.name, text: (r) => r.name },
    { key: "comp", label: "Composición", align: "l", width: "minmax(0,1.6fr)", value: (r) => r.v[`land_${k}`], html: comp, title: `Ordenar por ${LAND_LABEL[k]}` },
    { key: "share", label: LAND_LABEL[k], value: (r) => r.v[`land_${k}`], html: (r) => `<span class="dot" style="background:${LAND_COLOR[k]}"></span>${pct(r.v[`land_${k}`], 0)}` },
    { key: "dom", label: "Predominante", align: "l", width: "minmax(0,.9fr)", value: (r) => LAND_LABEL[domOf(r)], text: (r) => LAND_LABEL[domOf(r)] },
  ];
  const sortSeg = document.createElement("div");
  sortSeg.className = "adv-row";
  sBody.appendChild(sortSeg);
  segmented(sortSeg, {
    label: "Ordenar por", value: sortKey,
    options: LAND_KEYS.map((k) => ({ value: k, label: LAND_LABEL[k] })),
    onChange: (k) => { sortKey = k; table.setColumns(colsFor(k), { key: "share", dir: "desc" }); drawShape(); },
  });
  let shape = "table";
  segmented(sortSeg, { label: "Vista", value: shape, options: [{ value: "table", label: "Tabla" }, { value: "grid", label: "Anillos" }], onChange: (v) => { shape = v; drawShape(); } });
  const tableHost = document.createElement("div");
  const gridHost = document.createElement("div");
  sBody.append(tableHost, gridHost);
  const table = createTable(tableHost, {
    caption: `Cobertura del suelo por ${T.state}`, rank: true, maxHeight: 320, rows: stRows, columns: colsFor(sortKey), sort: { key: "share", dir: "desc" },
    onHover: (r) => link.hover(r ? rowsHighlight(states, [r]) : null),
    onClick: (r) => states.focus(r),
  });
  // Small multiples: one donut per province, sorted by the chosen cover. The tile carries the province name,
  // which reads better than its code.
  let grid = null;
  function drawShape() {
    tableHost.hidden = shape !== "table";
    gridHost.hidden = shape !== "grid";
    if (shape !== "grid") return;
    gridHost.innerHTML = "";
    const sorted = [...stRows].sort((a, b) => (b.v[`land_${sortKey}`] ?? -1) - (a.v[`land_${sortKey}`] ?? -1));
    grid = smallMultiples(gridHost, {
      min: 92,
      items: sorted.map((r) => ({ key: r.key, label: r.name || r.v.abbr || r.key, sub: pct(r.v[`land_${sortKey}`], 0), row: r })),
      render: (cell, it) => donut(cell, {
        interactive: false, size: 62, thickness: 12,
        parts: LAND_KEYS.map((k) => ({ key: k, label: LAND_LABEL[k], value: it.row.v[`land_${k}`], color: LAND_COLOR[k] })),
        center: { big: pct(it.row.v[`land_${sortKey}`], 0), small: "" },
        ariaLabel: `${it.row.name}: ${LAND_KEYS.map((k) => `${LAND_LABEL[k]} ${pct(it.row.v[`land_${k}`], 0)}`).join(", ")}`,
      }),
      onHover: (it) => link.hover(it ? rowsHighlight(states, [it.row]) : null),
      onClick: (it) => states.focus(it.row),
    });
  }
  drawShape();

  // --- who works the land ---------------------------------------------------------------------------------------
  const food = app.data.nation.yields?.find((y) => y.key === "food");
  const foodDesc = food?.description || "Trabajadores de la agricultura, la ganadería, la silvicultura y la pesca.";
  const fBody = section(el, { title: "Quién trabaja la tierra", note: `${esc(foodDesc)}${/[.!?;)]$/.test(foodDesc) ? "" : " "}Ordenado por la proporción de los ocupados.` });
  const fHost = document.createElement("div");
  let fLevel = "states";
  segmented(fBody, { label: "Unidad", value: fLevel, options: [{ value: "states", label: `${T.States}` }, { value: "metros", label: "Comunas" }], onChange: (v) => { fLevel = v; drawFood(); } });
  fBody.appendChild(fHost);
  function drawFood() {
    fHost.innerHTML = "";
    const lv = data.levels[fLevel];
    const list = topBy(lv.rows, (r) => ratio(r.v.y_food, r.v.employed), { n: 10, min: fLevel === "metros" ? FOOD_MIN : 0 });
    if (!list.length) { fHost.innerHTML = `<p class="adv-empty">Sin datos</p>`; return; }
    barList(fHost, {
      rank: true, ariaLabel: "Trabajadores de agricultura, ganadería, silvicultura y pesca",
      rows: list.map((x) => ({ key: x.r.key, label: x.r.name, sub: `${count3(x.r.v.y_food)} personas`, value: x.v, text: pct(x.v), color: food?.color, row: x.r })),
      onHover: (r) => link.hover(r ? rowsHighlight(lv, [r.row]) : null),
      onClick: (r) => lv.focus(r.row),
    });
    if (fLevel === "metros") fHost.insertAdjacentHTML("beforeend", `<p class="adv-note">Solo comunas de ${compact(FOOD_MIN)} habitantes o más.</p>`);
  }
  drawFood();

  // A hex's width in km: grid units ÷ the projection's units per km (world.json projection.scale; 1 when absent).
  const hexKm = (2 * w.grid.R) / (w.raw.projection?.scale || 1);
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, [landSrcId, ...lensSrc, data.levels.metros.field("y_food")?.source, states.field("employed")?.source], [
    `La cobertura del suelo${landSrcText ? ` (${esc(landSrcText)})` : ""} se remuestrea a hexágonos de 1 km de radio (unos ${+hexKm.toFixed(1)} km de lado a lado), así que lo pequeño (una chacra en un valle, un caserío) se funde con lo que lo rodea.`,
    "\"Predominante\" es la cobertura con mayor proporción dentro del hexágono; no significa que todo el hexágono sea de esa clase.",
    ...(lensSrc.length ? [`Los botones de lente abren otros datos (${lensSrc.map((s) => esc(data.source(s)?.title || s)).join(", ")}), con otras clases y otro año que la cobertura por hexágono de aquí, así que las cifras no coinciden.`] : []),
    `Las ${T.states} sin cifra de ocupados no entran en el ranking de empleo agropecuario.`,
  ]));

  return {
    onMapHover(h) {
      const r = h.cell >= 0 ? states.rowAtCell(h.cell) : null;
      table.setHot(r ? r.key : null);
      if (shape === "grid") grid?.setHot(r ? r.key : null);
      if (h.cell >= 0 && owner[h.cell] >= 0) {
        let best = null, bv = 0;
        for (const k of LAND_KEYS) { const v = P[k]?.[h.cell] || 0; if (v > bv) { bv = v; best = k; } }
        sb.setHot(best);
      } else sb.setHot(null);
    },
    onEscape() {
      if (pinned) { pin(null); return true; }
      return false;
    },
  };
}
