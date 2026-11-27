// Compare extension: "Comparar comunas". A docked screen (app mode "compare") with up to 4 comunas as columns and
// the metrics of compare.json as rows, grouped. Each cell shows the value, a small bar scaled to the largest value
// among the selected comunas, and a subtle green / red mark on the best / worst when the metric has a direction.
//
//   data: compare.json (app.loadData, lazily on first open; a missing file hides every entry point)
//   URL hash: #cmp=13201,13101,13114
//   entry points: top-bar button "Comparar", the "Comparar" chip in the comuna panel (ui/cityPanel.js), app.compare.add(id)
import { esc, int, pct, money } from "../../format.js";

const MAX = 4;
const norm = (s) => String(s || "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const num = (v, d) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function fmt(m, v) {
  if (v == null || Number.isNaN(v)) return "–";
  switch (m.format) {
    case "int": return int(v);
    case "pct": return (m.id === "growth" && v > 0 ? "+" : "") + pct(v, 1);
    case "usd": return money(v);
    case "years": return num(v, 1);
    case "float": return num(v, Math.abs(v) < 10 ? 2 : 1);
    default: return String(v);
  }
}

function injectCss() {
  if (document.getElementById("compare-css")) return;
  const l = document.createElement("link");
  l.id = "compare-css";
  l.rel = "stylesheet";
  l.href = new URL("../../../css/compare.css", import.meta.url).href;
  document.head.appendChild(l);
}

const ICON = `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5h6v14H4zM14 9h6v10h-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

export function install(app) {
  injectCss();
  let ids = [];
  let data = null, dataP = null;
  let available = null; // null = unknown, false = no compare.json
  let dock = null, root = null, topBtn = null;
  const dockW = () => Math.max(340, Math.min(840, innerWidth - 120));
  const city = (id) => app.cityById.get(id) ?? app.cityById.get(Number(id));
  const provName = (c) => {
    const ab = c?.states?.[0];
    return (app.w?.raw?.states || []).find((s) => s.abbr === ab)?.name || "";
  };

  // --- data ---------------------------------------------------------------------------------------------------------
  const ensureData = () => (dataP ??= app.loadData("compare").then((d) => (data = d && d.metrics && d.comunas ? d : null), () => null));
  const unavailable = () => {
    available = false;
    topBtn?.remove();
    topBtn = null;
    document.querySelectorAll("[data-compare]").forEach((b) => b.remove());
  };

  // --- selection ----------------------------------------------------------------------------------------------------
  const valid = (id) => !!city(id) && (!data || !!data.comunas[id]);
  function add(id) {
    id = String(id);
    if (!city(id) || ids.includes(id)) return false;
    if (ids.length >= MAX) { app.ui.toast(`Ya hay ${MAX} comunas; quita una para agregar otra`); return false; }
    ids.push(id);
    return true;
  }
  function open(id) {
    if (available === false) return;
    if (id != null) add(id);
    else if (!ids.length && app.state.selectedCity) add(app.state.selectedCity.id);
    if (app.mode === "compare") { renderBody(); app.hash.soon(); } else app.setMode("compare", {});
  }
  const remove = (id) => { ids = ids.filter((x) => x !== id); renderBody(); app.hash.soon(); };

  // --- screen -------------------------------------------------------------------------------------------------------
  function shell() {
    dock = app.ui.dock("left", { width: dockW(), label: "Comparar comunas" });
    dock.classList.add("cmp-dock");
    dock.innerHTML = "";
    root = document.createElement("div");
    root.className = "cmp-root";
    root.innerHTML = `
      <header class="cmp-head">
        <div class="cmp-title"><h2>Comparar comunas</h2><button type="button" class="icon-btn cmp-close" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">✕</button></div>
        <div class="cmp-add">
          <input type="search" class="cmp-input" placeholder="Agregar una comuna…" autocomplete="off" aria-label="Agregar una comuna">
          <span class="cmp-count"></span>
          <div class="cmp-results" role="listbox" hidden></div>
        </div>
      </header>
      <div class="cmp-scroll"></div>
      <footer class="cmp-foot"></footer>`;
    dock.appendChild(root);
    root.querySelector(".cmp-close").onclick = () => app.setMode(null);
    const input = root.querySelector(".cmp-input");
    const box = root.querySelector(".cmp-results");
    let results = [], sel = 0;
    const draw = () => {
      box.hidden = !results.length && !input.value.trim();
      box.innerHTML = results.length
        ? results.map((c, i) => `<button type="button" role="option" class="cmp-res${i === sel ? " sel" : ""}" data-id="${esc(c.id)}"><b>${esc(c.name)}</b><span>${esc(provName(c))}</span></button>`).join("")
        : input.value.trim() ? `<div class="cmp-none">Sin resultados</div>` : "";
    };
    const find = () => {
      const q = norm(input.value);
      if (!q) { results = []; return; }
      const out = [];
      for (const c of app.data.cities) {
        if (ids.includes(String(c.id)) || (data && !data.comunas[c.id])) continue;
        const n = norm(c.name);
        const s = n.startsWith(q) ? 0 : (" " + n).includes(" " + q) ? 1 : n.includes(q) ? 2 : -1;
        if (s >= 0) out.push([s, c]);
      }
      out.sort((a, b) => a[0] - b[0] || (b[1].population || 0) - (a[1].population || 0));
      results = out.slice(0, 6).map((x) => x[1]);
    };
    const pick = (id) => {
      if (add(id)) { input.value = ""; results = []; draw(); renderBody(); app.hash.soon(); }
    };
    input.addEventListener("input", () => { find(); sel = 0; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (results.length) { sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length; draw(); }
      } else if (e.key === "Enter") { e.preventDefault(); if (results[sel]) pick(results[sel].id); }
    });
    box.addEventListener("pointerdown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) pick(b.dataset.id); });
    root.querySelector(".cmp-scroll").addEventListener("click", (e) => {
      const x = e.target.closest("[data-rm]");
      if (x) remove(x.dataset.rm);
    });
    root._clear = () => { if (!input.value) return false; input.value = ""; results = []; draw(); return true; };
    root._input = input;
    renderBody();
  }

  function renderBody() {
    if (!root) return;
    const scroll = root.querySelector(".cmp-scroll");
    const input = root.querySelector(".cmp-input");
    root.querySelector(".cmp-count").textContent = `${ids.length} de ${MAX}`;
    input.disabled = ids.length >= MAX;
    input.placeholder = ids.length >= MAX ? "Quita una comuna para agregar otra" : "Agregar una comuna…";
    if (!data) { scroll.innerHTML = `<div class="cmp-empty">Cargando…</div>`; return; }
    const cols = ids.filter(valid);
    root.querySelector(".cmp-foot").innerHTML = `Fuente: ${esc(data.vintage || "")}. Verde y rojo: mejor y peor de la fila, solo cuando hay un sentido claro. Barras: contra el mayor valor elegido.`;
    if (!cols.length) {
      scroll.innerHTML = `<div class="cmp-empty"><b>Elige comunas para compararlas</b>Busca arriba o usa "Comparar" en el panel de una comuna. Puedes poner hasta ${MAX}.</div>`;
      return;
    }
    const tpl = `--n:${cols.length}`;
    let h = `<div class="cmp-grid" style="${tpl}"><div class="cmp-row cmp-cols"><div class="cmp-lab"></div>${cols
      .map((id) => { const c = city(id); return `<div class="cmp-colh"><button type="button" class="cmp-x" data-rm="${esc(id)}" aria-label="Quitar ${esc(c.name)}" title="Quitar">✕</button><b>${esc(c.name)}</b><span>${esc(provName(c))}</span></div>`; })
      .join("")}</div>`;
    const idx = new Map(data.metrics.map((m, i) => [m.id, i]));
    for (const g of data.groups) {
      const ms = data.metrics.filter((m) => m.group === g.id);
      if (!ms.length) continue;
      h += `<div class="cmp-group">${esc(g.name)}</div>`;
      for (const m of ms) {
        const k = idx.get(m.id);
        const vals = cols.map((id) => data.comunas[id]?.[k] ?? null);
        const real = vals.filter((v) => v != null);
        const maxAbs = Math.max(...real.map(Math.abs), 0);
        let best = null, worst = null;
        if (m.higher_is !== "neutral" && real.length > 1 && Math.max(...real) !== Math.min(...real)) {
          const hi = Math.max(...real), lo = Math.min(...real);
          [best, worst] = m.higher_is === "good" ? [hi, lo] : [lo, hi];
        }
        h += `<div class="cmp-row"><div class="cmp-lab" title="${esc(m.unit)}"><span>${esc(m.label)}</span><small>${esc(m.unit)}</small></div>${vals
          .map((v) => {
            if (v == null) return `<div class="cmp-cell none"><span class="v">–</span></div>`;
            const w = maxAbs ? Math.max(2, (Math.abs(v) / maxAbs) * 100) : 0;
            const cls = v === best ? " best" : v === worst ? " worst" : "";
            return `<div class="cmp-cell${cls}${v < 0 ? " neg" : ""}" title="${esc(m.label)}: ${esc(fmt(m, v))}"><span class="v">${esc(fmt(m, v))}</span><i class="bar"><i style="width:${w.toFixed(1)}%"></i></i></div>`;
          })
          .join("")}</div>`;
      }
    }
    scroll.innerHTML = h + `</div>`;
  }

  // --- mode and hash ------------------------------------------------------------------------------------------------
  app.registerMode("compare", {
    enter(params) {
      for (const id of params?.ids || []) add(id);
      if (!ids.length && app.state.selectedCity) add(app.state.selectedCity.id);
      shell();
      topBtn?.setAttribute("aria-pressed", "true");
      ensureData().then((d) => {
        if (!d) { app.ui.toast("No hay datos para comparar comunas"); unavailable(); if (app.mode === "compare") app.setMode(null); return; }
        ids = ids.filter(valid);
        renderBody();
        app.hash.soon();
        if (!ids.length) root?._input?.focus();
      });
    },
    exit() {
      topBtn?.setAttribute("aria-pressed", "false");
      const d = dock;
      dock = null; root = null;
      if (d && d.classList.contains("cmp-dock")) { d.classList.remove("cmp-dock"); app.ui.undock("left"); }
    },
    onEscape: () => root?._clear?.() === true,
  });
  app.hash.register("cmp", {
    get: () => (app.mode === "compare" && ids.length ? ids.join(",") : null),
    set(v) {
      if (v) {
        const list = String(v).split(",").map((s) => s.trim()).filter((s) => city(s));
        ids = [];
        list.slice(0, MAX).forEach(add);
        if (app.mode === "compare") { renderBody(); ensureData().then(() => { ids = ids.filter(valid); renderBody(); }); } else app.setMode("compare", {});
      } else if (app.mode === "compare") app.setMode(null);
    },
  });

  // --- entry points: only when compare.json exists ------------------------------------------------------------------
  const api = { MAX, get available() { return available; }, get ids() { return [...ids]; }, open, add: (id) => open(id), remove };
  app.compare = api;
  fetch(new URL("data/compare.json", location.href.replace(/[?#].*$/, "")), { method: "HEAD" })
    .then((r) => r.ok, () => false)
    .then((ok) => {
      if (!ok) { available = false; return; }
      available = true;
      topBtn = app.ui.addTopButton({ id: "btn-compare", icon: "compare", label: "Comparar", title: "Comparar comunas", onClick: () => (app.mode === "compare" ? app.setMode(null) : open()) });
      if (topBtn) { topBtn.innerHTML = `${ICON}<span class="lbl">Comparar</span>`; topBtn.setAttribute("aria-pressed", String(app.mode === "compare")); }
      // a comuna panel opened before this answer arrived has no chip yet: add it
      const c = app.state.selectedCity, panel = app.panels.element;
      if (c && panel && !panel.hidden && panel.dataset.kind === "city" && !panel.querySelector("[data-compare]")) {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.dataset.compare = "1";
        chip.title = `Comparar ${c.name} con otras comunas`;
        chip.textContent = "Comparar ›";
        chip.onclick = () => open(c.id);
        let host = panel.querySelector(".cp-head .chips");
        if (!host) {
          host = document.createElement("div");
          host.className = "chips";
          panel.querySelector(".cp-head .cp-name")?.after(host);
        }
        host.appendChild(chip);
      }
    });
}
