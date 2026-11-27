// The "Trabajo" block for the comuna panel and the City View: share who work in another comuna, who arrives, main
// modes and the top destinations. Plain HTML; clicks on a destination are wired by index.js.
import { esc, pct, compact } from "../../format.js";
import { T } from "../../terms.js";

const num = (n) => Math.round(n).toLocaleString("en-US");

export function commuteBlock(city, data, nameOf) {
  const row = data?.comunas?.[city.id];
  if (!row) return null;
  const nat = data.national?.share_other;
  const modeName = new Map((data.modes || []).map((m) => [m.id, m.name]));
  const modes = Object.entries(row.modes || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const dests = (row.top || []).map(([id, n, s]) => ({ id, n, s, name: nameOf(id) })).filter((d) => d.name);
  const maxS = Math.max(...dests.map((d) => d.s), 1e-6);
  const other = row.share?.other;
  return `<div class="cm-block" data-commute="${esc(city.id)}">
    <p class="cm-lead">${other != null ? `<b>${pct(other, 0)}</b> trabaja en otra comuna` : ""}${
      row.in_other ? `${other != null ? " · " : ""}llegan <b>${compact(row.in_other)}</b> de otras comunas` : ""}</p>
    ${other != null && nat != null ? `<p class="cm-note">${T.Nation}: ${pct(nat, 1)}. Base: ${num(row.workers)} ocupados que viven en la comuna.</p>` : ""}
    ${modes.length ? `<h4 class="cm-h">Cómo van al trabajo</h4>${modes.map(([id, v]) => `<div class="cm-mode"><span>${esc(modeName.get(id) || id)}</span><b>${pct(v, 0)}</b><i class="cm-bar"><u style="width:${Math.max(2, v * 100)}%"></u></i></div>`).join("")}` : ""}
    ${dests.length ? `<h4 class="cm-h">Adónde van <span>(% de los ocupados de la comuna)</span></h4>${dests.map((d) => `<button type="button" class="cm-dest" data-city="${esc(d.id)}" title="Ir a ${esc(d.name)}: ${num(d.n)} personas">
      <span class="cm-n">${esc(d.name)}</span><b>${pct(d.s, d.s >= 0.02 ? 0 : 1)}</b><i class="cm-bar"><u style="width:${Math.max(3, (d.s / maxS) * 100)}%"></u></i></button>`).join("")}` : ""}
  </div>`;
}

export const CSS = `
.cm-block { font-size: 12px; margin-bottom: 8px; }
.cm-lead { margin: 2px 0 2px; font-size: 13px; line-height: 1.4; }
.cm-lead b { color: #ffb55a; font-size: 15px; }
.cm-note { margin: 0 0 6px; font-size: 11px; color: var(--ink-dim); line-height: 1.4; }
.cm-h { margin: 10px 0 4px; font: normal 11px var(--serif); letter-spacing: .14em; color: var(--gold); text-transform: uppercase; }
.cm-h span { font: 10px var(--sans); letter-spacing: 0; text-transform: none; color: var(--ink-dim); }
.cm-mode, .cm-dest { display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; align-items: center; width: 100%; margin: 0 0 5px; padding: 0; background: none; border: 0; color: inherit; font: inherit; text-align: left; }
.cm-dest { cursor: pointer; border-radius: 3px; }
.cm-dest:hover .cm-n, .cm-dest:focus-visible .cm-n { color: var(--gold-bright); text-decoration: underline; }
.cm-mode b, .cm-dest b { font-variant-numeric: tabular-nums; }
.cm-bar { grid-column: 1 / 3; height: 4px; border-radius: 2px; background: rgba(255,255,255,.07); overflow: hidden; }
.cm-bar u { display: block; height: 100%; border-radius: 2px; background: #ffa23c; }
.cm-mode .cm-bar u { background: #c9a45c; }
#commute-legend { position: fixed; z-index: 9; left: calc(12px + var(--dock-left, 0px)); top: calc(var(--topbar-h, 40px) + 10px);
  display: flex; align-items: center; gap: 8px; max-width: min(340px, calc(100vw - 24px)); padding: 5px 10px; border-radius: 6px; font-size: 11px; line-height: 1.3;
  color: var(--ink-dim); background: rgba(16, 25, 35, .82); border: 1px solid rgba(201,164,92,.3); pointer-events: auto; cursor: help; }
body.dock-open #commute-legend { top: calc(var(--topbar-h, 40px) + 70px); }
#commute-legend[hidden] { display: none; }
#commute-legend .sw { flex: none; width: 22px; height: 0; border-top: 3px dotted #ffa23c; position: relative; }
#commute-legend .sw.in { border-top-color: #5fd6cc; }
#commute-legend b { color: var(--ink); font-weight: 600; }
@media (max-width: 700px) { #commute-legend { font-size: 10px; padding: 4px 8px; max-width: calc(100vw - 24px); } }
`;
