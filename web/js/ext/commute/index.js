// Commute extension: "Viajes al trabajo". With a comuna selected, curved arcs fly from it to the comunas where its
// workers go (top 6 of commute.json), with the share on each; "Quién llega" adds, in another colour, where workers
// come from. Also a "Trabajo" block in the comuna panel and the City View, a small legend and a Guía paragraph.
//
// Data: commute.json (app.loadData; null when the file is missing: no arcs, no block, no switches).
// Performance: the overlay is the only drawing code; the requestAnimationFrame loop below runs only while arcs are
// visible (a city selected, switch on, tab visible) and is throttled; with prefers-reduced-motion the arcs are still.
import { drawArcs, OUT_COLOR, IN_COLOR, labelOut, labelIn } from "./arcs.js";
import { commuteBlock, CSS } from "./panel.js";
import { esc } from "../../format.js";

const TOP = 6;
const FRAME_MS = 33;

export function install(app) {
  const on = { out: true, in: false };
  let data = app.data.commute ?? null;
  const reduced = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)"); } catch { return { matches: false }; } })();

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const legend = document.createElement("div");
  legend.id = "commute-legend";
  legend.hidden = true;
  document.body.appendChild(legend);

  const row = () => {
    const c = app.state.selectedCity;
    return c && data?.comunas?.[c.id] ? { city: c, row: data.comunas[c.id] } : null;
  };
  const visible = () => (on.out || on.in) && !!data && !!row();
  const nameOf = (id) => app.cityById.get(id)?.name || "";
  const pos = (city) => {
    if (city?.cell == null) return null;
    const [x, y] = app.cam.toScreen(app.w.grid.cx(city.cell), app.w.grid.cy(city.cell));
    return { x, y };
  };

  // --- the overlay ------------------------------------------------------------------------------------------------
  function items() {
    const r = row();
    const from = pos(r.city);
    if (!from) return [];
    const out = [];
    if (on.out) {
      for (const [id, , share] of (r.row.top || []).slice(0, TOP)) {
        const to = pos(app.cityById.get(id));
        if (to && id !== r.city.id) out.push({ from, to, share, label: labelOut(share), color: OUT_COLOR });
      }
    }
    if (on.in) {
      const list = (r.row.top_in || []).slice(0, 4);
      const tot = Math.max(...list.map((x) => x[1]), 1);
      for (const [id, n] of list) {
        const o = pos(app.cityById.get(id));
        // share only scales the width here: arrivals have no "share of workers" in the file
        if (o && id !== r.city.id) out.push({ from: o, to: from, share: (n / tot) * 0.05, label: labelIn(n), color: IN_COLOR, reverse: false });
      }
    }
    return out;
  }
  function draw(ctx, cam) {
    if (!visible()) return;
    let list = items();
    if (!list.length) return;
    // crowded (zoomed far out): keep the four biggest
    const lens = list.map((i) => Math.hypot(i.to.x - i.from.x, i.to.y - i.from.y)).sort((a, b) => a - b);
    if (lens[lens.length >> 1] < 80 && list.length > 4) list = list.sort((a, b) => b.share - a.share).slice(0, 4);
    const Rpx = app.w.grid.radius * cam.scale;
    const zoom = Math.max(0.85, Math.min(1.5, 0.8 + Rpx / 30));
    drawArcs(ctx, list, {
      t: performance.now(), animate: !reduced.matches, zoom,
      view: app.visibleArea?.() || { x0: 0, y0: 44, x1: cam.w, y1: cam.h },
    });
  }
  app.registerOverlay({ id: "commute-arcs", z: 110, space: "screen", draw });

  // --- the animation loop: only while there is something to animate -----------------------------------------------
  let looping = false, last = 0;
  function loop(now) {
    if (!visible() || document.hidden || reduced.matches) { looping = false; return; }
    if (now - last >= FRAME_MS) { last = now; app.requestDraw(); }
    requestAnimationFrame(loop);
  }
  function sync() {
    const v = visible();
    legend.hidden = !v;
    if (v) legend.innerHTML = `<span class="sw${on.out ? "" : " in"}"></span><span><b>Viajes al trabajo</b> · Censo 2024 (INE)${on.in ? `<br><span style="color:${IN_COLOR}">Verde: de dónde llegan (número de personas)</span>` : ""}</span>`;
    legend.title = data?.rule || "";
    if (v && !looping && !document.hidden && !reduced.matches) { looping = true; requestAnimationFrame(loop); }
    app.requestDraw();
  }
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener?.("change", sync);

  // --- toggles ------------------------------------------------------------------------------------------------------
  const TOGGLES = [
    { id: "commute", key: "out", label: "Viajes al trabajo", icon: "l-commute", def: true,
      title: () => data?.rule || "Flechas desde la comuna elegida hacia donde trabaja su gente" },
    { id: "commute-in", key: "in", label: "Quién llega", icon: "l-commute", def: false,
      title: () => "Muestra, en verde, de qué comunas llegan más trabajadores a la comuna elegida" },
  ];
  const removers = new Map();
  const addToggle = (t) => {
    removers.set(t.id, app.ui.addMapToggle({
      id: t.id, label: t.label, icon: t.icon, title: t.title(), default: t.def,
      get: () => on[t.key],
      set: (v) => { on[t.key] = !!v; sync(); },
    }));
  };
  const dropToggle = (t) => { removers.get(t.id)?.(); removers.delete(t.id); app.ui.setMapToggle?.(t.id, null); };
  const setToggles = () => { for (const t of TOGGLES) (data ? addToggle : dropToggle)(t); };

  // --- the "Trabajo" block ------------------------------------------------------------------------------------------
  function inject() {
    for (const el of document.querySelectorAll("[data-commute-sec]")) el.remove();
    const c = app.state.selectedCity;
    const html = c && data ? commuteBlock(c, data, nameOf) : null;
    if (!html) return;
    const make = (cls, h3) => {
      const s = document.createElement("section");
      s.className = cls;
      s.dataset.commuteSec = "1";
      s.innerHTML = `<h3>${h3}</h3>${html}`;
      s.querySelectorAll("[data-city]").forEach((b) => (b.onclick = () => app.selectCity(b.dataset.city, { fly: true })));
      return s;
    };
    const panel = app.panels.element;
    if (panel && !panel.hidden && panel.dataset.kind === "city") {
      // before the industries list (long); at the end if that section is not found
      const at = [...panel.querySelectorAll(".cp-section")].find((x) => x.querySelector(".ind")) || panel.querySelector(".cp-foot");
      if (at) at.before(make("cp-section", "Trabajo"));
      return;
    }
    const sec = document.querySelector(".app-dock-right #cv-workforce");
    if (sec) sec.after(make("cv-sec", "Trabajo en otras comunas"));
  }
  const origCity = app.panels.city;
  app.panels.city = (city, ctx) => {
    origCity(city, ctx);
    inject();
  };
  app.on("select", () => { sync(); queueMicrotask(inject); });
  app.on("mode", () => requestAnimationFrame(inject));

  // --- data ---------------------------------------------------------------------------------------------------------
  const apply = (d) => {
    data = d && d.comunas ? d : null;
    if (app.pediaData) app.pediaData.commute = data;
    setToggles();
    sync();
    inject();
  };
  setToggles();
  if (app.data.commute !== undefined) apply(app.data.commute);
  else app.loadData("commute").then(apply, (err) => { console.warn("commute: failed to load", err); apply(null); });

  app.commute = { on, get data() { return data; } };
}
