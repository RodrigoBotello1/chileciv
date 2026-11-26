// The Almanac (Almanaque): what every number means and exactly where it comes from.
// Page ids stay English (main.js and the City View open pages by id, e.g. pedia.open("Yields")); `title` is what the
// reader sees. Everything about sources and vintages is read from the data files, never written here.
import { resolveTables } from "../terrain.js";
import { esc } from "../format.js";
import { parseHex, luminance } from "../color.js";
import { icon, glyph } from "./icon.js";
import { gdpLabel, useSources } from "./infoPanel.js";

const COVER_ICON = { forest_deciduous: "l-forest", forest_evergreen: "l-forest", forest_mixed: "l-forest", cropland: "l-farmland", pasture: "l-farmland", urban: "l-developed" };
// Glyph colour that reads on a resource medallion (dark on light faces such as nuclear yellow or silver).
const inkOn = (hex) => {
  try { return /^#[0-9a-f]{6}$/i.test(hex || "") && luminance(parseHex(hex)) > 0.4 ? "#1c1710" : "#f8f0d8"; } catch { return "#f8f0d8"; }
};
const CATEGORY = { energy: "Energía", mineral: "Minerales", agri: "Agricultura", other: "Otros" };
const SCALE_NAME = { log: "logarítmica", linear: "lineal" };
const TAIWAN_URL = "https://github.com/i-am-alvin/taiwanciv"; // the port chileciv is built on
const UPSTREAM_URL = "https://karpathy.ai/usaciv/"; // the original's own address
const DEFAULT_PAGE = "About this map";
const num = (v) => (Number.isFinite(v) ? v.toLocaleString("en-US") : "–");

export function initPedia(data) {
  const modal = document.getElementById("pedia");
  const card = modal.querySelector(".modal-card");
  const nav = document.getElementById("pedia-nav");
  const body = document.getElementById("pedia-body");
  const srcName = (id) => data.sources?.find((s) => s.id === id)?.title || id || "";
  useSources(data.sources); // the panels name the population-change source by its sources.json title
  let restoreFocus = null;

  const h2 = (ic, fb, text) => `<h2>${icon(ic, fb, { size: 24 })}<span>${esc(text)}</span></h2>`;
  // world.json grid units are map units, not km: projection.scale = map units per km (docs/PORTING.md).
  const hexKm = () => {
    const scale = data.world.projection?.scale > 0 ? data.world.projection.scale : 1;
    return +((data.world.grid.radius * 2) / scale).toFixed(1);
  };
  const stateCount = () => (data.states?.length || data.world.states?.length || 0);
  const vintageLine = () => [data.nation.vintage, data.nation.gdp_vintage ? `${gdpLabel(data.nation)}: ${data.nation.gdp_vintage}` : ""].filter(Boolean).map(esc).join("; ");

  const pages = [
    { id: "About this map", title: "Acerca de este mapa", html: () => `
      ${h2("pedia", "📖", "Acerca de este mapa")}
      <p>chileciv dibuja la Región Metropolitana de Santiago como un juego de estrategia. Nada es inventado: cada hexágono,
      cada comuna y cada número viene de datos públicos, que se listan en <i>Fuentes</i>.</p>
      <h4>Cómo se construye</h4>
      <p>La región se proyecta (Albers de áreas iguales) y se corta en ${data.world.grid.cols}×${data.world.grid.rows}
      hexágonos de 1 km de radio (${hexKm()} km de punta a punta). Cada hexágono pertenece a la comuna y a la provincia que están bajo su centro,
      y el terreno sale de muestras de elevación dentro de cada uno.</p>
      <p>Cada <b>comuna</b> es una ciudad del mapa${data.cities?.length ? ` (${data.cities.length} en total)` : ""}${stateCount() ? `, agrupadas en ${stateCount()} provincias` : ""}: lleva un estandarte y sus números cubren toda la comuna, no solo su zona urbana.</p>
      <h4>Controles</h4>
      <p>Arrastra o usa las flechas / WASD para desplazarte · rueda, +/– o doble clic para hacer zoom · clic en una comuna o una provincia para abrir su panel ·
      / o ⌘K para buscar · L para recorrer los lentes · R para mostrar u ocultar recursos · ? para ver todos los atajos · Esc para cerrar.</p>
      <p>La barra de direcciones siempre guarda un enlace a lo que estás viendo (lente, selección y vista); usa <i>Compartir</i> para copiarlo
      o para descargar una imagen.</p>
      <h4>Código y créditos</h4>
      <p>chileciv está construido sobre <a href="${UPSTREAM_URL}" target="_blank" rel="noopener">usaciv</a> de Andrej Karpathy (MIT)
      y sobre el port a Taiwán, <a href="${TAIWAN_URL}" target="_blank" rel="noopener">taiwanciv</a>. Muestra la Región Metropolitana de Santiago
      con hexágonos de 1 km, y cada número viene de los datos públicos que se listan en este Almanaque.</p>` },
    { id: "Yields", title: "Rendimientos", html: () => {
      const gold = gdpLabel(data.nation);
      return `
      ${h2("y-production", "⚙️", "Rendimientos")}
      <p>Los rendimientos de un juego de civilización puestos sobre medidas reales. Los que se miden en personas cuentan trabajadores
      de un rubro; los que se miden en dinero van en pesos chilenos. La definición de cada uno:</p>
      <table>${data.nation.yields.map((y) => `<tr><td class="ic" style="color:${esc(y.color)}">${glyph(y, 26)}</td><td><b style="color:${esc(y.color)}">${esc(y.label)}${
        y.key === "gold" && !String(y.label).includes(gold) ? ` (${esc(gold.toLowerCase())})` : ""}</b><br>${esc(y.description || "")}</td></tr>`).join("")}</table>
      <h4>Calidad de vida y vivienda</h4>
      <p>Desempleo = personas desempleadas ÷ fuerza de trabajo.${data.nation.nation?.rent_burden != null ? ` Arriendo ÷ ingreso = arriendo mediano mensual × 12 ÷ ingreso mediano:
      una señal gruesa de carga, no la carga real de un hogar.` : ""} Las medidas que esta versión de los datos no trae (valor vacío) no aparecen en el panel.</p>`;
    } },
    { id: "States", title: "Provincias", html: () => `
      ${h2("terrain", "🗺️", "Provincias")}
      <p>Haz clic en cualquier hexágono de tierra sin estandarte para abrir el panel de su provincia${vintageLine() ? ` (${vintageLine()})` : ""}.</p>
      <p>El <b>ranking</b> (por ejemplo "3.º de ${stateCount() || "N"}") compara las ${stateCount() ? `${stateCount()} ` : ""}provincias del mapa; 1 es la mayor.</p>
      <p>Cada comuna pertenece a una sola provincia. El panel de una comuna y el de su provincia son distintos, pero comparten las mismas tablas de datos.</p>
      ${data.states ? "" : `<p class="muted">Esta versión de los datos no trae states.json, así que el panel de provincia solo muestra nombres y comunas.</p>`}` },
    { id: "Terrain", title: "Terreno", html: () => {
      const t = data.w?.tables || resolveTables(data.world.tables);
      const hasCover = Array.isArray(data.world.cover);
      const row = (x) => `<tr><td class="nm">${x.color ? `<span class="swatch" style="background:${esc(x.color)}"></span>` : ""}${
        COVER_ICON[x.key] ? icon(COVER_ICON[x.key], "", { size: 15 }) + " " : ""}<b>${esc(x.name)}</b></td><td>${esc(x.rule || "")}</td></tr>`;
      return `
      ${h2("terrain", "🗺️", "Terreno")}
      <p>Cada hexágono promedia las muestras de elevación que caen dentro. El relieve sale de la elevación media y de la rugosidad
      (desviación estándar) de esas muestras; el sombreado sale de las diferencias de elevación con los hexágonos vecinos, con luz desde el
      noroeste.</p>
      <h4>${icon("l-forest", "🌲", { size: 16 })} Cobertura del suelo</h4>
      ${hasCover
        ? `<p>El color base de cada hexágono es su grupo de cobertura dominante: el mayor entre las muestras de tierra que caen dentro.
           Los símbolos pequeños muestran la mezcla: los árboles crecen con la proporción de bosque, y los surcos, las cañas, los arbustos y las matas de pasto
           marcan cultivos, humedales, matorral y pastizal.</p>
           <table>${t.cover.filter((x) => x.id > 0).map(row).join("")}</table>`
        : `<p class="muted">Esta versión de los datos aún no trae cobertura del suelo; la tierra se colorea por elevación.</p>`}
      <h4>Relieve</h4>
      <table>${t.relief.map(row).join("")}</table>
      <h4>${icon("r-hydro", "💧", { size: 16 })} Agua</h4>
      <table>${t.water.filter((x) => x.id > 0).map(row).join("")}</table>
      <h4>Fuera de la región</h4>
      <p class="muted">La tierra que queda fuera de la región (Valparaíso, O'Higgins y Argentina) se dibuja bajo una niebla ligera:
      se muestra como contexto y no tiene datos detallados.</p>`;
    } },
    { id: "Lenses", title: "Lentes", html: () => `
      ${h2("layers", "▤", "Lentes")}
      <p>Los lentes recolorean el mapa con una sola medida, construida con datos por comuna${data.lenses.vintage ? ` (${esc(data.lenses.vintage)})` : ""}.
      El cálculo de cada lente está en su descripción.</p>
      <p>La leyenda muestra cuántos hexágonos caen en cada valor. Pasa el mouse o arrastra sobre ella para mostrar solo ese rango en el mapa.</p>
      ${data.lenses.lenses?.length ? "" : `<p class="muted">Esta versión de los datos no trae lentes.</p>`}
      ${(data.lenses.groups?.length ? data.lenses.groups : [{ id: null, name: "" }]).map((g) => {
        const ls = (data.lenses.lenses || []).filter((l) => !g.id || l.group === g.id);
        if (!ls.length) return "";
        return `${g.name ? `<h3 class="grp">${icon(`g-${g.id}`, "", { size: 16 })} ${esc(g.name)}</h3>` : ""}${ls.map((l) => `
          <div class="lens-entry"><div class="le-ic">${glyph(l, 26)}</div><div>
          <h4>${esc(l.name)}</h4><p>${esc(l.description || "")}<br>
          <i class="le-ramp" style="background:linear-gradient(90deg, ${(l.ramp || []).map(esc).join(",")})"></i>
          <span class="muted">${Array.isArray(l.domain) ? `Escala ${esc(SCALE_NAME[l.scale] || l.scale || "")}, ${num(l.domain[0])}–${num(l.domain[1])} ${esc(l.unit || "")}` : esc(l.unit || "")}${
            l.higher_is === "good" ? " · más alto es mejor" : l.higher_is === "bad" ? " · más alto es peor" : ""}${l.source ? " · " + esc(srcName(l.source)) : ""}</span></p></div></div>`).join("")}`;
      }).join("")}` },
    { id: "Resources", title: "Recursos", html: () => {
      const r = data.resources;
      if (!r?.types?.length) return `${h2("resources", "⛏️", "Recursos")}<p class="muted">Esta versión de los datos no trae capa de recursos.</p>`;
      const count = new Map();
      for (const it of r.items || []) count.set(it.type, (count.get(it.type) || 0) + 1);
      const cats = [...new Set(r.types.map((t) => t.category || "other"))];
      return `
      ${h2("resources", "⛏️", "Recursos")}
      <p>Los recursos marcan los principales puntos de interés de la región en los hexágonos donde están, con los tipos de la tabla.
      Solo se muestran los sitios relevantes: el umbral de cada tipo está en su descripción. Con el mapa alejado, un hexágono muestra su
      recurso de mayor rango; acércate para ver más. Pulsa <b>R</b> para mostrarlos u ocultarlos.</p>
      ${cats.map((c) => `<h4>${esc(CATEGORY[c] || c)}</h4><table class="res-table">
        <tr><th></th><th>Tipo</th><th>Qué se incluye</th><th>Sitios</th></tr>
        ${r.types.filter((t) => (t.category || "other") === c).map((t) => `<tr>
          <td class="ic"><span class="res-ic" style="background:${esc(t.color || "#24384f")};color:${inkOn(t.color)}">${glyph(t, 20)}</span></td>
          <td class="nm"><b>${esc(t.name)}</b>${t.unit ? `<br><span class="muted">valor en ${esc(t.unit)}</span>` : ""}</td>
          <td>${esc(t.description || "")}${t.source ? `<br><span class="muted">Fuente: ${esc(srcName(t.source))}</span>` : ""}</td>
          <td class="num">${count.get(t.id) || 0}</td></tr>`).join("")}</table>`).join("")}`;
    } },
    { id: "Sources", title: "Fuentes", html: () => `
      ${h2("pedia", "📖", "Fuentes")}
      ${data.sources?.length ? "" : `<p class="muted">Esta versión de los datos no trae sources.json.</p>`}
      ${(data.sources || []).map((s) => `
        <h4>${esc(s.title || s.id || "")}</h4>
        <p>${esc(s.description || "")}<br>
        <span class="muted">${[s.publisher, s.license, s.vintage].filter(Boolean).map(esc).join(" · ")}${
          s.homepage ? ` · <a href="${esc(s.homepage)}" target="_blank" rel="noopener">sitio oficial</a>` : ""}</span></p>
        <table>${(s.files || []).map((f) => `<tr><td><code>${esc(f.url || "")}</code></td><td class="muted" style="white-space:nowrap">${esc((f.retrieved || "").slice(0, 10))}<br>${((f.bytes || 0) / 1e6).toFixed(1)} MB</td></tr>`).join("")}</table>`).join("")}
      <p class="muted">El motor del mapa viene de <a href="${UPSTREAM_URL}" target="_blank" rel="noopener">usaciv</a> de Andrej Karpathy (MIT),
      a través del port <a href="${TAIWAN_URL}" target="_blank" rel="noopener">taiwanciv</a>.</p>` },
  ];
  const pageById = new Map(pages.map((p) => [p.id, p]));
  // A caller may pass the id or the visible title.
  const resolve = (name) => pageById.get(name) || pages.find((p) => p.title === name) || pageById.get(DEFAULT_PAGE);

  const show = (name) => {
    const page = resolve(name);
    body.innerHTML = page.html();
    body.scrollTop = 0;
    nav.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.page === page.id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
  };
  nav.innerHTML = `<div class="hd">Almanaque</div>` + pages.map((p) => `<button data-page="${esc(p.id)}">${esc(p.title)}</button>`).join("");
  nav.onclick = (e) => {
    const b = e.target.closest("button[data-page]");
    if (b) show(b.dataset.page);
  };
  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
    restoreFocus = null;
  };
  modal.onclick = (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) close();
  };
  // Keep Tab inside the dialog.
  modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...card.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  return {
    open(page = DEFAULT_PAGE) {
      if (modal.hidden) restoreFocus = document.activeElement;
      show(page);
      modal.hidden = false;
      (nav.querySelector("button.active") || card.querySelector("[data-close]"))?.focus();
    },
    close,
    get isOpen() {
      return !modal.hidden;
    },
  };
}
