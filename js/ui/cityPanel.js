import { css } from "../color.js";
import { esc } from "../format.js";
import { isCapital } from "../world.js";
import { yieldGrid, amenities, industries, gdpRow, gdpLabel, popLine, growthSpan, showPanel, hidePanel } from "./infoPanel.js";

/**
 * ctx: {w, nation, onClose, onPedia, onState(stateIndex)}
 */
export function openCityPanel(city, ctx) {
  const { w, nation } = ctx;
  const n = nation.nation;
  const owner = city.cell != null ? w.raw.owner[city.cell] : -1;
  const col = css(w.stateColor[owner] || [190, 190, 190]);

  // The city's provinces as links to their province panels, by name. When a comuna and its province share a name
  // (Santiago), that chip reads "Panel de provincia" instead of repeating the comuna's own name.
  const own = (s) => s.name === city.name || s.name === city.full || (s.fips != null && String(s.fips) === String(city.id));
  const states = (city.states || [])
    .map((abbr) => ({ abbr, i: w.raw.states.findIndex((s) => s.abbr === abbr) }))
    .map(({ abbr, i }) => {
      const s = i >= 0 ? w.raw.states[i] : null;
      if (s && own(s)) return ctx.onState ? `<button class="chip" data-state="${i}" title="Abrir el panel de la provincia de ${esc(s.name)}">Panel de provincia ›</button>` : "";
      return s && ctx.onState
        ? `<button class="chip" data-state="${i}" title="Abrir ${esc(s.name)}">${esc(s.name)}</button>`
        : `<span class="chip">${esc(s?.name || abbr)}</span>`;
    })
    .join("");
  // Under the title: what `full` adds to the name ("Puente Alto, Región Metropolitana" → "Región Metropolitana") and the seat, if given.
  const full = String(city.full || "");
  const extra = full.startsWith(city.name) ? full.slice(String(city.name).length).replace(/^[\s,]+/, "") : full;
  const sub = [extra || (city.name_en && city.name_en !== city.name ? city.name_en : ""), city.seat && city.seat !== city.name ? `El estandarte está sobre ${city.seat}` : ""].filter(Boolean).map(esc).join(" · ");

  const growth = growthSpan(city, n);
  const living = (amenities(city, n, nation) + gdpRow(city, nation)).trim();

  showPanel({
    kind: "city",
    stripe: col,
    title: city.name,
    titleHtml: `${isCapital(city) ? `<span class="cap" title="Capital">★</span> ` : ""}${esc(city.name)}`,
    sub: `${sub}${states ? `<div class="chips">${states}</div>` : ""}`,
    headExtra: popLine(city, growth),
    sections: [
      { title: "Rendimientos", html: `<div class="yield-grid">${yieldGrid(nation, city.yields)}</div>` },
      living && { title: "Calidad de vida y vivienda", html: living },
      { title: "Rubros · dónde trabaja la gente", html: industries(city, nation) },
    ],
    foot: `Fuente: ${esc(nation.vintage || "")}${nation.gdp_vintage ? `; ${esc(gdpLabel(nation))}: ${esc(nation.gdp_vintage)}` : ""}.
      Un ×N en verde indica que el rubro pesa N veces más en el empleo de la comuna que en el de la región.`,
    onClose: ctx.onClose,
    onPedia: ctx.onPedia,
    wire(panel) {
      panel.querySelectorAll("[data-state]").forEach((b) => (b.onclick = () => ctx.onState(+b.dataset.state)));
    },
  });
}

export const closeCityPanel = hidePanel;
