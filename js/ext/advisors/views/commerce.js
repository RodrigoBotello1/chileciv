// Commerce advisor ("Master of Trade"): freight routes between zones (trade.json), the busiest ports and airports and the road
// and rail network (infrastructure.json). Both files are optional: each section shows only what its file has. Units,
// rules and vintages are quoted from the files; nothing here names a source of its own.
import { esc, fin, el as mk, withAlpha } from "../core/util.js";
import { int, pct, money, count3, signedPct } from "../core/fmt.js";
import { barList, shareBar, stackedBars, swatchLegend, sizeLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, segmented, sourcesHtml } from "../core/view.js";
import { frameBox, focusPoint } from "../core/frame.js";
import { T } from "../../../terms.js";

// Route colours by mode (original palette: ochre road, iron rail, blue water, lilac air, sea-green mixed,
// dark copper pipeline drawn dashed).
const MODE_COLOR = { truck: "#d9a457", rail: "#a3acb8", water: "#4f9ad6", air: "#c9a0e0", multiple: "#8fcbb8", pipeline: "#b0703e", other: "#9a9aa8" };
const PORT_COLOR = "#4f9ad6", AIR_COLOR = "#e6cf86";
const MUSD = 1e6; // trade.json money is in millions (`_musd` keys; Chilean pesos in this build)
const KTON = 1e3; // trade.json weight is in thousands (`_tons_k` keys)
const TOP_N = 15;

/** The largest of 1, 2, 5 × 10^k that is not above x (legend sizes that suit whatever the data's scale is). */
function niceBelow(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  return (x >= 5 * p ? 5 : x >= 2 * p ? 2 : 1) * p;
}

export async function mount(ctx) {
  const { app, el, link, data } = ctx;
  const [trade, infra] = await Promise.all([app.loadData("trade").catch(() => null), app.loadData("infrastructure").catch(() => null)]);
  if (!trade && !infra) {
    el.innerHTML = `<p class="adv-empty pad">No hay datos de rutas comerciales ni de infraestructura en esta versión (trade.json e infrastructure.json aún no existen), así que el Maestro del comercio no tiene nada que informar por ahora.</p>`;
    return {};
  }
  const grid = app.w.grid;
  const metros = data.levels.metros;
  const api = { hotRoute: null };
  let zoneOfCity = null;
  // A state code (or fips, or name) as the provincia name; unknown values are shown as they are.
  const stName = (ref) => {
    if (ref == null || ref === "") return "";
    const i = app.w.raw.states.findIndex((s) => s.abbr === ref || s.fips === ref || s.name === ref);
    return i >= 0 ? app.data.states?.[i]?.name || app.w.raw.states[i].name : String(ref);
  };
  const units = trade?.units || {};
  // What freight is measured in: money (value_musd) when the file has it, otherwise weight (tons_k). A file such as
  // The Chile build has tonnes only, so every sort, bar, line width and label below goes through `amt`.
  const byValue = (trade?.routes || []).some((r) => fin(r.value_musd));
  const amt = (r) => (byValue ? r.value_musd : r.tons_k) || 0;
  // The weight unit without its "miles de" / thousand prefix (miles de toneladas → toneladas): amounts are shown in mil / M of the base unit.
  const tonUnit = String(units.tons_k || "").replace(/^(miles de\s+|mil\s+|thousand\s+)/i, "") || "toneladas";
  const tonsK = (v) => `${count3(v * KTON)} ${tonUnit}`;
  const amtText = (v) => (byValue ? money(v * MUSD) : tonsK(v));
  const AMT = byValue ? "valor" : "volumen";

  // --- headline -------------------------------------------------------------------------------------------------
  const nm = trade?.national_musd || {};
  const nt = trade?.national_tons_k || {};
  const when = fin(trade?.year) ? `${trade.year}` : trade?.vintage;
  const ports0 = infra?.ports || [], airports0 = infra?.airports || [];
  const topPort = ports0.filter((p) => fin(p.tons)).sort((a, b) => b.tons - a.tons)[0];
  const topAir = airports0.filter((a) => fin(a.enplanements)).sort((a, b) => b.enplanements - a.enplanements)[0];
  const headline = [
    byValue && fin(nm.domestic) && { label: "Carga interna", value: money(nm.domestic * MUSD), sub: [trade?.vintage, "por valor"].filter(Boolean).join(" · ") },
    !byValue && fin(nt.total) && { label: "Carga interna", value: tonsK(nt.total), sub: [when, "por volumen"].filter(Boolean).join(" · ") },
    topPort && { label: "Puerto más activo", value: `${count3(topPort.tons)} ${infra?.units?.tons || "toneladas"}`, sub: topPort.name },
    topAir && { label: "Aeropuerto más activo", value: count3(topAir.enplanements), sub: `${topAir.name || topAir.id}${topAir.year ? ` · ${topAir.year}` : ""} · pasajeros` },
  ].filter(Boolean);
  const foreign = [fin(nm.import) ? `Importaciones ${money(nm.import * MUSD)}` : "", fin(nm.export) ? `Exportaciones ${money(nm.export * MUSD)}` : ""].filter(Boolean);
  const split = !byValue && fin(nt.within_county) && fin(nt.between_counties)
    ? `De ${tonsK(nt.total ?? nt.within_county + nt.between_counties)} en el año, ${tonsK(nt.within_county)} comienzan y terminan en la misma comuna y ${tonsK(nt.between_counties)} cruzan límites comunales.` : "";
  el.insertAdjacentHTML("beforeend", (headline.length ? tiles(headline) : "")
    + (trade ? `<p class="adv-callout">${byValue ? `El valor de la carga${units.value_musd ? ` (${esc(units.value_musd)})` : ""}` : "El volumen de la carga"} describe las mercancías que circulan entre lugares, no lo que produce cada lugar. ${byValue ? "" : "Estos datos solo traen el peso, no el valor de las mercancías. "}${split ? `${split} ` : ""}${foreign.length ? `${foreign.join(" y ")} se calculan aparte.` : ""}</p>` : ""));

  // --- trade routes ---------------------------------------------------------------------------------------------
  let routes = [], zoneById = new Map(), routeCells = new Map(), overlayOff = null;
  const st = { mode: null, zone: null, route: null };
  let routeBars = null, zTable = null;
  const rDetail = mk("div", "adv-detail");
  if (trade) {
    zoneById = new Map((trade.zones || []).map((z) => [z.id, z]));
    const modeName = new Map((trade.modes || []).map((m) => [m.id, m.name]));
    const comm = trade.commodities || {};
    const zName = (id) => zoneById.get(id)?.short || zoneById.get(id)?.name || id;
    routes = (trade.routes || []).map((r) => {
      const pts = (r.path || []).filter((c) => c >= 0 && c < grid.size).map((c) => [grid.cx(c), grid.cy(c)]);
      return { ...r, key: `${r.a}-${r.b}`, label: `${zName(r.a)} ⇄ ${zName(r.b)}`, pts, path2d: smoothPath(pts) };
    });
    routes.forEach((r) => { for (const c of r.path || []) { if (!routeCells.has(c)) routeCells.set(c, []); routeCells.get(c).push(r); } });
    for (const list of routeCells.values()) list.sort((a, b) => amt(b) - amt(a));
    const vMax = Math.max(1, ...routes.map(amt));
    const hasPipeline = routes.some((r) => r.top_mode === "pipeline");

    const rBody = section(el, { title: "Rutas comerciales", kicker: typeof trade.vintage === "string" ? trade.vintage : "", note: `${esc(trade.rule || "")}` });
    // Mode mix of the routes, weighted by the amount (money, or weight when the file has no money).
    const modeTot = {};
    for (const r of routes) for (const [m, s] of Object.entries(r.modes || {})) modeTot[m] = (modeTot[m] || 0) + (s || 0) * amt(r);
    const modeParts = (trade.modes || []).map((m) => ({ key: m.id, label: m.name, value: modeTot[m.id] || 0, color: MODE_COLOR[m.id] || "#999", text: amtText(modeTot[m.id] || 0) })).filter((p) => p.value > 0);
    rBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">Cómo se transporta la carga de estas ${routes.length} rutas (por ${AMT})</h4>`);
    const modeBar = shareBar(rBody, {
      parts: modeParts,
      onHover: (p) => { api.modeHot = p ? p.key : null; redraw(); },
      onClick: (p) => setMode(st.mode === p.key ? null : p.key),
    });
    const fRow = mk("div", "adv-row adv-filterbar");
    rBody.appendChild(fRow);
    fRow.addEventListener("click", (e) => {
      if (e.target.closest("[data-clear-mode]")) setMode(null);
      if (e.target.closest("[data-clear-zone]")) setZone(null);
    });
    const rHost = mk("div");
    rBody.appendChild(rHost);
    rBody.appendChild(rDetail);
    rBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${esc(trade.path_note || "")} El grosor de la línea representa el ${AMT}; el color, el modo de transporte principal${hasPipeline ? " (los oleoductos van con línea punteada)" : ""}.</p>${swatchLegend((trade.modes || []).filter((m) => modeTot[m.id] > 0).map((m) => ({ label: m.name, color: MODE_COLOR[m.id] })))}`);

    const routeHighlight = (r) => {
      const za = zoneById.get(r.a), zb = zoneById.get(r.b);
      const cells = new Set();
      const cities = new Set();
      for (const z of [za, zb]) {
        if (z?.anchor?.city) cities.add(z.anchor.city);
        for (const id of z?.cities || []) for (const c of metros.byKey.get(id)?.ref.footprint || []) cells.add(c);
      }
      return { cells, cities, label: r.label };
    };
    const visibleRoutes = () => routes.filter((r) => (!st.mode || r.top_mode === st.mode) && (!st.zone || r.a === st.zone || r.b === st.zone));
    const drawRoutes = () => {
      const vis = visibleRoutes();
      rHost.innerHTML = "";
      routeBars = barList(rHost, {
        rank: !st.mode && !st.zone, ariaLabel: `Rutas de carga con mayor ${AMT}`, max: vMax,
        rows: vis.map((r) => ({
          key: r.key, label: r.label, value: amt(r), text: amtText(amt(r)), color: MODE_COLOR[r.top_mode],
          sub: [modeName.get(r.top_mode) || r.top_mode, comm[r.top_commodity]].filter(Boolean).join(" · "), full: `n.° ${r.rank} ${zoneById.get(r.a)?.name || r.a} ⇄ ${zoneById.get(r.b)?.name || r.b}`,
        })),
        selected: st.route?.key,
        onHover: (row) => {
          const r = row ? routes.find((x) => x.key === row.key) : null;
          setHotRoute(r);
          link.hover(r ? routeHighlight(r) : null);
        },
        onClick: (row) => selectRoute(routes.find((x) => x.key === row.key)),
      });
      fRow.innerHTML = (st.mode ? `<span class="adv-fchip">Modo: <b>${esc(modeName.get(st.mode) || st.mode)}</b><button type="button" data-clear-mode aria-label="Quitar el filtro de modo">✕</button></span>` : "")
        + (st.zone ? `<span class="adv-fchip">Zona: <b>${esc(zName(st.zone))}</b> · ${vis.length} rutas<button type="button" data-clear-zone aria-label="Quitar el filtro de zona">✕</button></span>` : "");
      if (!vis.length) rHost.innerHTML = `<p class="adv-empty">Entre las ${routes.length} rutas más grandes no hay ninguna que ${[st.zone ? "pase por esta zona" : "", st.mode ? "tenga este modo como principal" : ""].filter(Boolean).join(" y ")}.</p>`;
      modeBar.setSelected(st.mode);
      redraw();
    };
    function setMode(m) { st.mode = m; drawRoutes(); }
    function setZone(id) {
      st.zone = id;
      drawRoutes();
      zTable?.setSelected(id ? new Set([id]) : null);
      const z = id ? zoneById.get(id) : null;
      if (z) {
        const h = zoneHighlight(z);
        link.base({ ...h, dimOthers: true }, { frame: true });
      } else link.base(null);
      drawZoneDetail();
    }
    function selectRoute(r) {
      st.route = st.route === r ? null : r;
      routeBars?.setSelected(st.route?.key ?? null);
      drawRouteDetail();
      redraw();
      if (st.route) frameRoute(st.route);
    }
    function frameRoute(r) {
      if (!r.pts.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of r.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const R = grid.R * 3;
      frameBox(app, { x0: x0 - R, y0: y0 - R, x1: x1 + R, y1: y1 + R }, { pad: 40, maxScale: 2.6 });
    }
    function drawRouteDetail() {
      const r = st.route;
      if (!r) { rDetail.innerHTML = ""; return; }
      const parts = Object.entries(r.modes || {}).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
      // Units are the file's own (trade.units); a figure the route does not have gets no tile.
      const facts = [
        fin(r.value_musd) && { label: "Valor", value: money(r.value_musd * MUSD), sub: "ambos sentidos" },
        fin(r.tons_k) && { label: byValue ? "Peso" : "Volumen", value: tonsK(r.tons_k), sub: "ambos sentidos" },
        fin(r.dist_km) && { label: "Distancia", value: `${int(r.dist_km)} km`, sub: fin(r.tmiles_m) ? `${count3(r.tmiles_m * 1e6)}${units.tmiles_m ? ` (${units.tmiles_m})` : ""}` : /\(([^()]+)\)/.exec(units.dist_km || "")?.[1] || "" },
      ].filter(Boolean);
      rDetail.innerHTML = `<div class="adv-card-detail">
        <h4 class="adv-h4">n.° ${r.rank} ${esc(zoneById.get(r.a)?.name || r.a)} ⇄ ${esc(zoneById.get(r.b)?.name || r.b)}</h4>
        ${facts.length ? tiles(facts) : ""}
        <p class="adv-note">${parts.length ? `<b>Modos:</b> ${parts.map(([m, s]) => `${esc(modeName.get(m) || m)} ${pct(s)}`).join(" · ")}. ` : ""}${comm[r.top_commodity] ? `<b>Principal mercancía:</b> ${esc(comm[r.top_commodity])}.` : ""}</p>
        <button type="button" class="adv-mini" data-unpin>Cerrar</button></div>`;
      rDetail.querySelector("[data-unpin]").addEventListener("click", () => selectRoute(st.route));
    }

    // Zones table.
    const zBody = section(el, {
      title: "Zonas de carga",
      note: `${byValue ? "Valor de la carga de cada zona: la que comienza y termina dentro de la zona, la que intercambia con otras zonas y el comercio exterior." : `Volumen de carga de cada zona (unidad: ${esc(tonUnit)}): la que comienza y termina dentro de la zona, y la que sale hacia o llega desde otras zonas.`} Pasa el cursor sobre una fila para ver las comunas de la zona en el mapa; haz clic para ver sus rutas y contrapartes.`,
    });
    const zoneHighlight = (z) => {
      const cells = new Set();
      for (const id of z.cities || []) for (const c of metros.byKey.get(id)?.ref.footprint || []) cells.add(c);
      if (!cells.size && z.anchor?.cell != null) cells.add(z.anchor.cell);
      return { cells, cities: z.anchor?.city ? new Set([z.anchor.city]) : undefined, label: z.name };
    };
    // The provincia a zone lies in, by name; left out when it only repeats the zone's own name.
    const zStates = (z) => (z.states || []).map(stName).filter((nm) => nm && nm !== z.name && nm !== z.short).join(", ");
    const zones = (trade.zones || []).map((z) => ({ ...z, key: z.id }));
    // A zone's totals in the measure in use: money has within / other_zones / import / export, weight has
    // within / out / in (so "with other zones" is out + in).
    const tot = (z) => (byValue ? z.totals_musd : z.totals_tons_k) || null;
    const otherOf = (z) => { const t = tot(z); return !t ? null : fin(t.other_zones) ? t.other_zones : fin(t.out) || fin(t.in) ? (t.out || 0) + (t.in || 0) : null; };
    // Table cells are narrow: a weight is shown without its unit (the note above the table names it).
    const zText = (v) => (!fin(v) ? "–" : byValue ? money(v * MUSD) : count3(v * KTON));
    const has = (k) => zones.some((z) => fin(tot(z)?.[k]));
    zTable = createTable(zBody, {
      caption: "Zonas de carga", rank: true, maxHeight: 260, search: "Buscar zona",
      searchText: (z) => `${z.name} ${z.short || ""} ${zStates(z)}`,
      columns: [
        { key: "name", label: "Zona", align: "l", width: "minmax(0,1.9fr)", value: (z) => z.short || z.name, html: (z) => `${esc(z.short || z.name)}${zStates(z) ? ` <span class="sub">${esc(zStates(z))}</span>` : ""}`, tip: (z) => z.name },
        has("within") && { key: "within", label: "Interna", value: (z) => tot(z)?.within, text: (z) => zText(tot(z)?.within), title: "Carga que comienza y termina dentro de la zona" },
        { key: "other", label: "Con otras zonas", short: "Intercambio con otras zonas", value: otherOf, text: (z) => zText(otherOf(z)), title: has("out") || has("in") ? "Salida más entrada" : "", bar: { max: Math.max(...zones.map((z) => otherOf(z) || 0), 1), color: "rgba(47,164,184,.3)" } },
        has("out") && { key: "out", label: "Salida", value: (z) => tot(z)?.out, text: (z) => zText(tot(z)?.out), title: "Desde esta zona hacia otras zonas", hideBelow: 380 },
        has("in") && { key: "in", label: "Entrada", value: (z) => tot(z)?.in, text: (z) => zText(tot(z)?.in), title: "Desde otras zonas hacia esta zona", hideBelow: 380 },
        (has("import") || has("export")) && { key: "foreign", label: "Importación + exportación", short: "Comercio exterior", value: (z) => (tot(z) ? (tot(z).import || 0) + (tot(z).export || 0) : null), text: (z) => (tot(z) ? zText((tot(z).import || 0) + (tot(z).export || 0)) : "–"), hideBelow: 380 },
      ].filter(Boolean),
      rows: zones, sort: { key: "other", dir: "desc" },
      onHover: (z) => link.hover(z ? zoneHighlight(z) : null),
      onClick: (z) => setZone(st.zone === z.id ? null : z.id),
    });
    const zDetail = mk("div", "adv-detail");
    zBody.appendChild(zDetail);
    function drawZoneDetail() {
      const z = st.zone ? zoneById.get(st.zone) : null;
      if (!z) { zDetail.innerHTML = ""; return; }
      const cityNames = (z.cities || []).slice(0, 6).map((id) => esc(metros.byKey.get(id)?.name || id)).join(", ");
      zDetail.innerHTML = `<div class="adv-card-detail"><h4 class="adv-h4">${esc(z.name)}</h4>
        <p class="adv-note">${z.kind === "rest_of_state" ? `El resto de la ${T.state} fuera de las zonas urbanas. ` : ""}${fin(z.counties) ? `${int(z.counties)} comunas en el mapa · ` : ""}Comunas: ${cityNames || "no está en el mapa"}${(z.cities || []).length > 6 ? "…" : ""}</p>
        <h4 class="adv-h4">Principales contrapartes</h4><div class="adv-zp"></div></div>`;
      barList(zDetail.querySelector(".adv-zp"), {
        compact: true, ariaLabel: "Principales zonas con las que intercambia",
        rows: ((byValue ? z.partners : z.partners_tons_k) || []).map(([id, v, m]) => ({ key: id, label: zoneById.get(id)?.name || `Zona ${id} (no está en el mapa)`, value: v, text: amtText(v), sub: modeName.get(m) || m, color: MODE_COLOR[m] })),
        onHover: (row) => { const pz = row ? zoneById.get(row.key) : null; link.hover(pz ? zoneHighlight(pz) : null); },
        onClick: (row) => { if (zoneById.has(row.key)) setZone(row.key); },
      });
    }

    // The routes overlay: all visible routes (unless the map-art layer already draws them), the hovered one on top.
    const tradeLayerOn = () => {
      try { return (app.staticLayers?.() || []).some((l) => /trade/i.test(l.id) && (typeof l.visible !== "function" || l.visible())); } catch { return false; }
    };
    const overlay = {
      id: "adv-commerce-routes", z: 18, space: "world",
      draw(ctx2, cam) {
        const s = cam.scale;
        ctx2.save();
        ctx2.lineCap = "round";
        ctx2.lineJoin = "round";
        const vis = visibleRoutes();
        const hot = api.hotRoute || st.route;
        if (!tradeLayerOn()) {
          for (const r of vis) {
            if (r === hot) continue;
            const wpx = 1.2 + 4.5 * Math.sqrt(amt(r) / vMax);
            const faded = api.modeHot && r.top_mode !== api.modeHot;
            ctx2.setLineDash(r.top_mode === "pipeline" ? [6 / s, 4 / s] : []);
            ctx2.strokeStyle = "rgba(10,8,4,.55)";
            ctx2.lineWidth = (wpx + 2) / s;
            if (!faded) ctx2.stroke(r.path2d);
            ctx2.strokeStyle = withAlpha(MODE_COLOR[r.top_mode] || "#999", faded ? 0.18 : 0.85);
            ctx2.lineWidth = wpx / s;
            ctx2.stroke(r.path2d);
          }
        }
        if (hot) {
          ctx2.setLineDash([]);
          const wpx = 2.5 + 5 * Math.sqrt(amt(hot) / vMax);
          ctx2.strokeStyle = "rgba(10,8,4,.9)";
          ctx2.lineWidth = (wpx + 4) / s;
          ctx2.stroke(hot.path2d);
          ctx2.strokeStyle = "#ffd36a";
          ctx2.lineWidth = wpx / s;
          ctx2.stroke(hot.path2d);
          for (const p of [hot.pts[0], hot.pts[hot.pts.length - 1]]) {
            if (!p) continue;
            ctx2.beginPath();
            ctx2.arc(p[0], p[1], 5 / s, 0, Math.PI * 2);
            ctx2.fillStyle = "#fff3c4";
            ctx2.fill();
            ctx2.strokeStyle = "rgba(10,8,4,.9)";
            ctx2.lineWidth = 1.5 / s;
            ctx2.stroke();
          }
        }
        ctx2.restore();
      },
    };
    overlayOff = app.registerOverlay(overlay);
    ctx.cleanup(() => overlayOff?.());
    function setHotRoute(r) {
      if (api.hotRoute === r) return;
      api.hotRoute = r || null;
      redraw();
    }
    api.setHotRoute = setHotRoute;
    api.selectRoute = selectRoute;
    api.drawRoutes = drawRoutes;
    drawRoutes();
  }
  function redraw() { app.requestDraw(); }

  // --- ports and airports -----------------------------------------------------------------------------------------
  let portBars = null, airBars = null, portBubbles = null, airBubbles = null;
  if (infra) {
    const v = infra.vintage || {};
    const ports = ports0.map((p) => ({ ...p, key: `p${p.id}` }));
    const airports = airports0.map((a) => ({ ...a, key: `a${a.id}` }));
    // Only the breakdown the file really has: a part no port reports is left out of the bars and the legend.
    const PK = [{ key: "domestic", label: "Nacional", color: "#8fcbb8" }, { key: "imports", label: "Importaciones", color: "#4f9ad6" }, { key: "exports", label: "Exportaciones", color: "#d9a457" }]
      .filter((k) => ports.some((p) => fin(p[k.key])));
    const tons = (x) => `${count3(x)} ${infra.units?.tons || "toneladas"}`; // the file names its own unit of weight
    const flyToKey = (list, key) => flyTo(list.find((x) => x.key === key));

    if (ports.length) {
      const pBody = section(el, { title: "Puertos", kicker: v.ports || "", note: `${esc(infra.rules?.ports || "")}${PK.length ? ` Las barras dividen la carga de cada puerto en ${PK.map((k) => k.label).join(", ")}.` : ""}` });
      const portHover = (p) => {
        link.hover(p ? { cells: new Set(p.cell != null ? [p.cell] : []), label: p.name } : null);
        portBubbles?.setHot(p ? p.key : null);
      };
      const top = ports.filter((p) => fin(p.tons)).sort((a, b) => b.tons - a.tons).slice(0, TOP_N);
      // The provincia after the name, unless the port is named after it.
      const portSub = (p) => { const nm = stName(p.state); return nm && !String(p.name).includes(nm) ? nm : ""; };
      if (PK.length) {
        portBars = stackedBars(pBody, {
          rows: top.map((p) => ({ key: p.key, label: p.name, sub: portSub(p), parts: Object.fromEntries(PK.map((k) => [k.key, p[k.key]])), total: p.tons, text: tons(p.tons) })),
          keys: PK, fmt: tons, ariaLabel: "Puertos con más carga",
          onHover: (x) => portHover(x ? ports.find((p) => p.key === x.row.key) : null),
          onClick: (x) => flyToKey(ports, x.row.key),
        });
      } else {
        portBars = barList(pBody, {
          rank: true, ariaLabel: "Puertos con más carga",
          rows: top.map((p) => ({ key: p.key, label: p.name, sub: portSub(p), value: p.tons, text: tons(p.tons), color: PORT_COLOR })),
          onHover: (r) => portHover(r ? ports.find((p) => p.key === r.key) : null),
          onClick: (r) => flyToKey(ports, r.key),
        });
      }
      pBody.insertAdjacentHTML("beforeend", (PK.length ? swatchLegend(PK) : "") + (ports.length > top.length ? `<p class="adv-note">${int(ports.length)} puertos: se muestran los ${top.length} con más carga.</p>` : ""));
    }

    let drawAir = () => {};
    // Cargo: pounds landed (`cargo_lbs`, the original contract) or tonnes (`cargo_tons`), whichever the file has.
    const cargoKey = airports.some((a) => fin(a.cargo_tons)) ? "cargo_tons" : "cargo_lbs";
    // The unit of air cargo is the file's own (infrastructure.json units): the key's name alone does not tell.
    const cargoUnit = infra.units?.[cargoKey] || (cargoKey === "cargo_tons" ? "toneladas" : "libras");
    // A Chinese airport name reads better than its code; a long Latin one is listed by code and city as before.
    const airLabel = (a) => [a.id, a.city || a.name].filter(Boolean).join(" ");
    const hasPax = airports.some((a) => fin(a.enplanements)), hasCargo = airports.some((a) => fin(a[cargoKey]));
    if (airports.length && (hasPax || hasCargo)) {
      const aBody = section(el, { title: "Aeropuertos", kicker: v.airports || "", note: esc(infra.rules?.airports || "") });
      let aMode = hasPax ? "pax" : "cargo";
      const aHost = mk("div");
      if (hasPax && hasCargo) segmented(aBody, { label: "Ordenar por", value: aMode, options: [{ value: "pax", label: "Pasajeros" }, { value: "cargo", label: "Carga" }], onChange: (x) => { aMode = x; drawAir(); } });
      aBody.appendChild(aHost);
      const airHover = (a) => {
        link.hover(a ? { cells: new Set(a.cell != null ? [a.cell] : []), label: [a.id, a.name].filter(Boolean).join(" · ") } : null);
        airBubbles?.setHot(a ? a.key : null);
      };
      drawAir = () => {
        aHost.innerHTML = "";
        const k = aMode === "pax" ? "enplanements" : cargoKey;
        const list = airports.filter((a) => fin(a[k])).sort((a, b) => b[k] - a[k]).slice(0, TOP_N);
        let anyChange = false;
        airBars = barList(aHost, {
          rank: true, ariaLabel: aMode === "pax" ? "Aeropuertos con más pasajeros" : "Aeropuertos con más carga",
          rows: list.map((a) => {
            const ch = aMode === "pax" && fin(a.enplanements_prev) && a.enplanements_prev > 0 ? a.enplanements / a.enplanements_prev - 1 : null;
            if (fin(ch)) anyChange = true;
            return {
              key: a.key, label: airLabel(a), full: [a.id, a.name].filter(Boolean).join(" · "), value: a[k],
              text: aMode === "pax" ? count3(a[k]) : `${count3(a[k])} ${cargoUnit}`,
              sub: aMode === "pax" ? (fin(ch) ? `${signedPct(ch)}${fin(a.year) ? ` (frente a ${a.year - 1})` : ""}` : "") : stName(a.state),
              tone: fin(ch) ? (ch >= 0 ? "good" : "bad") : undefined, color: AIR_COLOR,
            };
          }),
          onHover: (r) => airHover(r ? airports.find((a) => a.key === r.key) : null),
          onClick: (r) => flyToKey(airports, r.key),
        });
        aHost.insertAdjacentHTML("beforeend", `<p class="adv-note">${aMode === "pax" ? `Pasajeros embarcados en el año${anyChange ? "; la variación es frente al año anterior" : ""}.` : `Carga, en ${cargoUnit}, según el criterio que publica la fuente.`}</p>`);
      };
      drawAir();
    }

    // On the map: circles for ports (tons) and airports (passengers).
    const mapPorts = ports.filter((p) => fin(p.tons) && fin(p.x) && fin(p.y));
    // Where the file ranks airports into hub classes, only the hubs are drawn (class "N" = not a hub), as before.
    const hubbed = airports.some((a) => a.hub);
    const mapAirs = airports.filter((a) => fin(a.enplanements) && fin(a.x) && fin(a.y) && (!hubbed || (a.hub && a.hub !== "N")));
    if (mapPorts.length || mapAirs.length) {
      const mBody = section(el, { title: "Puertos y aeropuertos en el mapa" });
      let show = mapPorts.length && mapAirs.length ? "both" : mapPorts.length ? "ports" : "air";
      const opts = [
        mapPorts.length && mapAirs.length && { value: "both", label: "Puertos y aeropuertos" },
        mapPorts.length && { value: "ports", label: "Puertos" },
        mapAirs.length && { value: "air", label: "Aeropuertos" },
        { value: "none", label: routes.length ? "Solo rutas" : "Ninguno" },
      ].filter(Boolean);
      segmented(mBody, { label: "Mostrar", value: show, options: opts, onChange: (x) => { show = x; drawSites(); } });
      const sizeBox = mk("div");
      mBody.appendChild(sizeBox);
      portBubbles = ctx.bubbles("ports", {
        rMax: 20, alpha: 0.5,
        tip: (b) => {
          const p = b.it;
          const split = PK.filter((k) => fin(p[k.key])).map((k) => `${k.label} ${count3(p[k.key])}`).join(" · ");
          return `<b>${esc(p.name)}</b><br>Puerto · <b>${tons(p.tons)}</b>${p.year ? ` (${esc(p.year)})` : ""}${fin(p.rank) ? ` · n.° ${p.rank}` : ""}${split ? `<br><span class="sub">${esc(split)}</span>` : ""}`;
        },
        onHover: (b) => portBars?.setHot(b ? b.key : null),
        onClick: (b) => { portBars?.setHot(b.key); flyTo(b.it); },
      });
      airBubbles = ctx.bubbles("airports", {
        rMax: 16, alpha: 0.5,
        tip: (b) => `<b>${esc([b.it.id, b.it.name].filter(Boolean).join(" · "))}</b><br>${esc(infra.hubs?.[b.it.hub] || "Aeropuerto")} · <b>${count3(b.it.enplanements)}</b> pasajeros${fin(b.it[cargoKey]) ? `<br><span class="sub">carga ${count3(b.it[cargoKey])} ${cargoUnit}</span>` : ""}`,
        onHover: (b) => airBars?.setHot(b ? b.key : null),
        onClick: (b) => { airBars?.setHot(b.key); flyTo(b.it); },
      });
      const drawSites = () => {
        const pMax = Math.max(1, ...mapPorts.map((p) => p.tons)), aMax = Math.max(1, ...mapAirs.map((a) => a.enplanements));
        const showP = show === "both" || show === "ports", showA = show === "both" || show === "air";
        portBubbles.set(showP ? mapPorts.map((p) => ({ key: p.key, x: p.x, y: p.y, value: p.tons, color: PORT_COLOR, it: p })) : [], { vMax: pMax });
        airBubbles.set(showA ? mapAirs.map((a) => ({ key: a.key, x: a.x, y: a.y, value: a.enplanements, color: AIR_COLOR, it: a })) : [], { vMax: aMax });
        // Legend circles at round values just under the largest site, whatever the data's scale.
        const steps = (max) => { const hi = niceBelow(max); return hi >= 10 ? [hi / 10, hi] : [hi]; };
        sizeBox.innerHTML = (showP && mapPorts.length ? sizeLegend(steps(pMax), (x) => 20 * Math.sqrt(x / pMax), tons, "Puertos (azul): volumen de carga") : "")
          + (showA && mapAirs.length ? sizeLegend(steps(aMax), (x) => 16 * Math.sqrt(x / aMax), (x) => count3(x), `Aeropuertos (dorado): pasajeros${hubbed ? ", solo aeropuertos principales" : ""}`) : "");
      };
      drawSites();
    }

    // Roads and rail: the counts and rules (the map-art layers draw them; switches live in the map-layers menu).
    const nRoad = [], nRail = [];
    for (const r of infra.roads || []) nRoad[r[2]] = (nRoad[r[2]] || 0) + 1;
    for (const r of infra.rail || []) nRail[r[2]] = (nRail[r[2]] || 0) + 1;
    if ((infra.roads || []).length || (infra.rail || []).length) {
      const nBody = section(el, { title: "Carreteras y ferrocarril", open: false });
      const toggles = (() => { try { return app.ui.mapToggles?.() || []; } catch { return []; } })();
      const counts = (classes, n) => (classes || []).map((c, i) => `<b>${esc(c.name)}</b>: ${int(n[i] || 0)} tramos de hexágonos`).join(" · ");
      nBody.innerHTML = `<p class="adv-note">${[counts(infra.road_classes, nRoad), counts(infra.rail_tiers, nRail)].filter(Boolean).join("<br>")}</p>
        ${infra.rules?.roads ? `<p class="adv-note">${esc(infra.rules.roads)}</p>` : ""}${infra.rules?.rail ? `<p class="adv-note">${esc(infra.rules.rail)}</p>` : ""}
        ${toggles.length ? `<p class="adv-note">Los íconos de carreteras, ferrocarril e instalaciones se activan o desactivan desde el menú de capas del mapa.</p>` : ""}`;
    }
  }
  function flyTo(p) {
    if (!p || !fin(p.x) || !fin(p.y)) return;
    focusPoint(app, p.x, p.y, Math.min(app.cam.maxScale, Math.max(app.cam.scale, (app.cam.fitScale || 1) * 3)));
  }

  const iv = infra?.vintage || {};
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, [...(trade?.sources || []), ...(infra?.sources || [])], [
    ...(trade ? [
      "Las rutas se dibujan sobre las carreteras del mapa solo para que se lean bien: no son el camino real de la carga. Una ruta entre dos comunas representa todo el intercambio de carga entre las dos zonas.",
    ] : []),
    ...(iv.ports || iv.airports ? [`${[iv.ports ? `Puertos: ${esc(iv.ports)}` : "", iv.airports ? `Aeropuertos: ${esc(iv.airports)}` : ""].filter(Boolean).join("; ")}. Los años de ambas estadísticas pueden ser distintos.`] : []),
    ...((infra?.roads || []).length || (infra?.rail || []).length ? [`Las carreteras y vías férreas del mapa${iv.roads ? ` (${esc(iv.roads)})` : ""} son trazados simplificados de referencia, no datos estadísticos.`] : []),
  ]));

  return {
    onMapHover(h) {
      if (h.item?.kind === "port") portBars?.setHot(`p${h.item.data?.id}`);
      if (h.item?.kind === "airport") airBars?.setHot(`a${h.item.data?.id}`);
      if (!routes.length) return;
      const list = h.cell >= 0 ? (routeCells.get(h.cell) || []).filter((r) => (!st.mode || r.top_mode === st.mode) && (!st.zone || r.a === st.zone || r.b === st.zone)) : [];
      const fromLayer = h.item?.kind === "route" ? routes.find((x) => x.a === h.item.data?.route?.a && x.b === h.item.data?.route?.b) : null;
      const r = fromLayer || list[0] || null;
      routeBars?.setHot(r ? r.key : null);
      // Only light the route up from the map when no circle is under the pointer (those have their own hover).
      api.setHotRoute?.(r);
      const z = h.cell >= 0 ? zoneOfCell(h.cell) : null;
      zTable?.setHot(z, false);
    },
    onMapClick(ev) {
      if (ev.item?.kind === "port" || ev.item?.kind === "airport") { flyTo(ev.item.data); return true; }
      const list = ev.item?.kind === "route" ? routes.filter((x) => x.a === ev.item.data?.route?.a && x.b === ev.item.data?.route?.b) : ev.cell >= 0 ? routeCells.get(ev.cell) || [] : [];
      const r = list.find((x) => (!st.mode || x.top_mode === st.mode) && (!st.zone || x.a === st.zone || x.b === st.zone));
      if (r && !ev.city) { api.selectRoute(r); return true; }
      return false;
    },
    onEscape() {
      if (st.route) { api.selectRoute(st.route); return true; }
      if (st.zone || st.mode) { st.zone = null; st.mode = null; link.base(null); api.drawRoutes?.(); zTable?.setSelected(null); return true; }
      return false;
    },
  };

  function zoneOfCell(cell) {
    if (!zoneOfCity) { zoneOfCity = new Map(); for (const z of zoneById.values()) for (const id of z.cities || []) zoneOfCity.set(id, z.id); }
    const m = metros.rowAtCell(cell);
    return m ? zoneOfCity.get(m.key) ?? null : null;
  }
}

/** A smooth Path2D through hex-centre points (quadratic curves through the midpoints), in map units. */
function smoothPath(pts) {
  const p = new Path2D();
  if (!pts.length) return p;
  p.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) { p.lineTo(pts[1][0], pts[1][1]); return p; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    p.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1];
  p.lineTo(l[0], l[1]);
  return p;
}
