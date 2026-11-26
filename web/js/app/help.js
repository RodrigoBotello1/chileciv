// Keyboard & mouse cheat-sheet.
import { icon } from "../ui/icon.js";
import { T } from "../terms.js";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const MOD = isMac ? "⌘" : "Ctrl";
const UPSTREAM_URL = "https://karpathy.ai/usaciv/"; // the original this site is ported from
const TAIWAN_URL = "https://github.com/i-am-alvin/taiwanciv"; // the port this one is built on

const ROWS = [
  ["Moverse", [
    [["Arrastrar", "←↑→↓", "WASD"], "Desplazar el mapa"],
    [["Rueda", "+", "–"], "Acercar y alejar"],
    [["Doble clic"], "Acercar a ese punto"],
    [["Dos dedos"], "Pellizcar para hacer zoom, arrastrar para desplazar (táctil)"],
    [["Minimapa"], "Clic o arrastre para saltar a un lugar"],
  ]],
  ["Explorar", [
    [["Clic en una comuna"], "Abrir la vista de comuna"],
    [["Clic en tierra"], `Abrir esa ${T.state}`],
    [["/", `${MOD} K`], `Buscar comunas y ${T.states}`],
    [["L", "Shift L"], "Lente siguiente / anterior"],
    [["Leyenda"], "Pasa el mouse o arrastra sobre la escala para mostrar solo ese rango"],
    [["R"], "Mostrar u ocultar recursos"],
  ]],
  ["Paneles", [
    [["?"], "Esta ayuda"],
    [["Esc"], "Cerrar la ayuda, la búsqueda, el Almanaque y luego el panel"],
  ]],
];

export function initHelp() {
  const modal = document.getElementById("help");
  if (!modal) return { open() {}, close() {}, get isOpen() { return false; } };
  const card = modal.querySelector(".help-card");
  let restore = null;
  card.innerHTML = `
    <button class="icon-btn help-close" data-close aria-label="Cerrar la ayuda">${icon("close", "✕", { size: 13 })}</button>
    <h2 id="help-title">${icon("help", "?", { size: 22 })}<span>Controles</span></h2>
    <div class="help-cols">${ROWS.map(([title, rows]) => `
      <section><h3>${title}</h3>${rows.map(([keys, what]) => `
        <div class="help-row"><span class="keys">${keys.map((k) => `<kbd>${k}</kbd>`).join("")}</span><span>${what}</span></div>`).join("")}
      </section>`).join("")}</div>
    <p class="help-foot">Cada número viene de datos públicos: abre el <b>Almanaque</b> para ver las fuentes.
      El enlace de la barra de direcciones siempre reabre esta misma vista.
      Basado en <a href="${UPSTREAM_URL}" target="_blank" rel="noopener">usaciv</a> de Andrej Karpathy (MIT)
      y en el port <a href="${TAIWAN_URL}" target="_blank" rel="noopener">taiwanciv</a> (MIT).</p>`;

  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    if (restore && document.contains(restore)) restore.focus();
    restore = null;
  };
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) close();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault(); // keep the focus inside the card: the close button and the two links in the footer
    const stops = [...card.querySelectorAll("[data-close], a[href]")];
    const k = stops.indexOf(document.activeElement);
    stops[(k + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
  });

  return {
    open() {
      if (!modal.hidden) return;
      restore = document.activeElement;
      modal.hidden = false;
      card.querySelector("[data-close]").focus();
    },
    close,
    toggle() { modal.hidden ? this.open() : close(); },
    get isOpen() { return !modal.hidden; },
  };
}
