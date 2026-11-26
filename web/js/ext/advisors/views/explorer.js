// Explorer: the generic slice-and-dice. Pick a level, any columns, filter, sort, plot any X / Y / size / colour,
// brush points onto the map, and show a column as a map lens where one exists.
import { esc, fin, colorScale, robustDomain, extent, RAMPS } from "../core/util.js";
import { fmtValue, fmtShort, fmtCell, parseNum, count3, int, compact } from "../core/fmt.js";
import { rampLegend, swatchLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, segmented, selectBox, sourcesHtml, frameBtn } from "../core/view.js";
import { rowsHighlight, extendData } from "../core/data.js";

// Preferred columns and axes, in order: the first ones the level really has data for are used (a field with no
// value in any row, e.g. incomes in this build, is skipped), topped up with the level's other numeric columns.
const DEFAULT_COLS = {
  states: ["population", "growth", "gdp_pc", "median_income", "unemployment", "density", "employed"],
  metros: ["states", "population", "growth", "gdp_pc", "median_income", "unemployment", "employed"],
  counties: ["population", "density", "income", "poverty"],
};
const N_DEFAULT_COLS = 5;
const DEFAULT_XY = {
  states: { x: ["median_income", "gdp_pc", "density"], y: ["growth", "unemployment"], s: ["population"], c: ["unemployment", "gdp_pc"] },
  metros: { x: ["gdp_pc", "density"], y: ["growth", "unemployment"], s: ["population"], c: ["median_income", "unemployment"] },
  counties: { x: ["income", "density"], y: ["bachelors", "growth"], s: ["population"], c: ["density"] },
};
// Table headers shorter than the field's own label, for the columns core/data.js defines (labels that come from
// the data files are shown as they are).
const SHORT = {
  energy_mw: "Capacidad eléctrica", median_income: "Mediana ingreso", n_districts: "N.º distritos", qcew_jobs: "Empleo por rubro", top_industry: "Rubro más especializado", top_lq: "CL",
  cz_median_age: "Mediana de edad", cz_specialist: "Habitantes destacados", def_per_resident: "Defensa por habitante", def_pct_gdp: "Defensa % ventas",
};
const OPS = { num: [">", "≥", "<", "≤", "="], text: ["=", "contains", "≠"] };
const OP_LABEL = { contains: "contiene" };
// Text filters ignore case and accents (Ñuñoa = nunoa).
const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Remember the explorer's setup per viewer (a convenience; the page works without it).
const STORE = "advisors.explorer.v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch { return null; } };
const save = (s) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode */ } };

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  // Columns from the optional files (industry districts, citizen mixes): loaded on demand, only when the Explorer
  // opens, and added to the levels once. The military columns are added only when that file is already loaded
  // (it is left out of the Santiago build, so they never are: no request, no empty columns).
  await extendData(data, [...(app.data.military != null ? ["military"] : []), "districts", "citizens"]);
  const avail = ["states", "metros", "counties"].filter((k) => data.levels[k]);
  const saved = load() || {};
  /** The field `k` of level `lv` when it exists and some row has a value for it. */
  const live = (lv, k) => { const f = lv?.field(k); return f && !f.empty ? f : null; };
  const firstLive = (lv, keys, numericOnly = true) => keys.find((k) => { const f = live(lv, k); return f && (!numericOnly || f.format !== "text"); }) || "";
  const defaultCols = (level) => {
    const lv = data.levels[level];
    const list = DEFAULT_COLS[level].filter((k) => live(lv, k));
    for (const f of lv.fields) {
      if (list.length >= N_DEFAULT_COLS) break;
      if (!f.empty && f.format !== "text" && !list.includes(f.key)) list.push(f.key);
    }
    return list.slice(0, N_DEFAULT_COLS);
  };
  const defaultXY = (level) => {
    const lv = data.levels[level], d = DEFAULT_XY[level];
    const nums = lv.fields.filter((f) => !f.empty && f.format !== "text").map((f) => f.key);
    const x = firstLive(lv, d.x) || nums[0] || "population";
    const y = firstLive(lv, d.y.filter((k) => k !== x)) || nums.find((k) => k !== x) || x;
    return { x, y, s: firstLive(lv, d.s), c: firstLive(lv, d.c.filter((k) => k !== x && k !== y)) };
  };
  const st = {
    level: avail.includes(ctx.params.level) ? ctx.params.level : avail.includes(saved.level) ? saved.level : avail.includes("metros") ? "metros" : avail[0],
    cols: { ...Object.fromEntries(avail.map((k) => [k, defaultCols(k)])), ...(saved.cols || {}) },
    xy: { ...Object.fromEntries(avail.map((k) => [k, defaultXY(k)])), ...(saved.xy || {}) },
    filters: [],
    onlySel: false,
    sel: null,
  };
  const persist = () => save({ level: st.level, cols: st.cols, xy: st.xy });
  const L = () => data.levels[st.level];

  // --- controls -------------------------------------------------------------------------------------------------
  const top = section(el, { title: "Explorar los datos", note: "Elige qué comparar, agrega filtros, ordena la tabla y grafica dos columnas cualesquiera. Pasa el cursor sobre una fila o un punto para verlo en el mapa; arrastra sobre el gráfico para seleccionar un grupo." });
  const lvRow = document.createElement("div");
  lvRow.className = "adv-row";
  top.appendChild(lvRow);
  segmented(lvRow, {
    label: "Nivel", value: st.level,
    options: avail.map((k) => ({ value: k, label: data.levels[k].label })),
    onChange: (v) => { st.level = v; st.filters = st.filters.filter((f) => live(L(), f.key)); st.sel = null; persist(); rebuild(); },
  });
  const colsBox = document.createElement("details");
  colsBox.className = "adv-cols";
  lvRow.appendChild(colsBox);

  const fRow = document.createElement("div");
  fRow.className = "adv-fbuild";
  top.appendChild(fRow);
  const chipsRow = document.createElement("div");
  chipsRow.className = "adv-row adv-filterbar";
  top.appendChild(chipsRow);
  const summary = document.createElement("p");
  summary.className = "adv-note adv-summary";
  top.appendChild(summary);

  // --- table ----------------------------------------------------------------------------------------------------
  const tBody = section(el, { title: "Tabla" });
  const selRow = document.createElement("div");
  selRow.className = "adv-row";
  tBody.appendChild(selRow);
  const tableHost = document.createElement("div");
  tBody.appendChild(tableHost);
  let table = null;

  // --- chart ----------------------------------------------------------------------------------------------------
  const cBody = section(el, { title: "Gráfico" });
  const axes = document.createElement("div");
  axes.className = "adv-axes";
  cBody.appendChild(axes);
  const scatterHost = document.createElement("div");
  cBody.appendChild(scatterHost);
  const legendEl = document.createElement("div");
  cBody.appendChild(legendEl);
  const lensRow = document.createElement("div");
  lensRow.className = "adv-row";
  cBody.appendChild(lensRow);
  const fieldInfo = document.createElement("div");
  fieldInfo.className = "adv-fieldinfo";
  cBody.appendChild(fieldInfo);
  const scatter = createScatter(scatterHost, {
    height: 320, points: [],
    onHover: (p) => { link.hover(p ? rowsHighlight(L(), [p.row]) : null); table?.setHot(p ? p.key : null, false); },
    onClick: (p) => L().focus(p.row),
    onBrush: (set) => { st.sel = set; applySelection(); },
  });
  const srcEl = document.createElement("div");
  el.appendChild(srcEl);

  // --- logic ----------------------------------------------------------------------------------------------------
  const fieldOpts = (withNone = false, numeric = true) => {
    const fs = L().fields.filter((f) => !f.empty && (numeric ? f.format !== "text" : f.key !== "name"));
    return [...(withNone ? [{ value: "", label: "Ninguno" }] : []), ...fs.map((f) => ({ value: f.key, label: f.label, group: f.group }))];
  };
  const numeric = (f) => f && f.format !== "text";
  const val = (r, k) => r.v[k] ?? null;
  const fmtF = (f, v) => fmtValue(f.format, v, f.unit);

  function passes(r) {
    for (const f of st.filters) {
      const fd = L().field(f.key);
      if (!fd) continue;
      const v = val(r, f.key);
      if (numeric(fd)) {
        if (!fin(v)) return false;
        const t = f.value;
        if (f.op === ">" && !(v > t)) return false;
        if (f.op === "≥" && !(v >= t)) return false;
        if (f.op === "<" && !(v < t)) return false;
        if (f.op === "≤" && !(v <= t)) return false;
        if (f.op === "=" && !(Math.abs(v - t) <= Math.abs(t) * 0.005 + 1e-9)) return false;
      } else {
        const s = fold(v), t = fold(f.value);
        if (f.op === "=" && s !== t) return false;
        if (f.op === "≠" && s === t) return false;
        if (f.op === "contains" && !s.includes(t)) return false;
      }
    }
    return true;
  }
  const filtered = () => L().rows.filter(passes);

  function renderCols() {
    const on = new Set(st.cols[st.level]);
    const groups = new Map();
    for (const f of L().fields) {
      if (f.key === "name" || f.empty) continue; // a column no row has a value for is not offered
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(f);
    }
    colsBox.innerHTML = `<summary class="adv-mini">Columnas (${shownCols().length})</summary><div class="adv-cols-pop">${[...groups].map(([g, list]) => `<fieldset><legend>${esc(g)}</legend>${list.map((f) => `<label title="${esc(f.description)}"><input type="checkbox" value="${esc(f.key)}"${on.has(f.key) ? " checked" : ""}> ${esc(f.label)}</label>`).join("")}</fieldset>`).join("")}</div>`;
  }
  colsBox.addEventListener("change", (e) => {
    const k = e.target.value;
    const list = st.cols[st.level].filter((x) => x !== k);
    if (e.target.checked) list.push(k);
    st.cols = { ...st.cols, [st.level]: list };
    colsBox.querySelector("summary").textContent = `Columnas (${shownCols().length})`;
    persist();
    buildTable();
  });

  function renderFilterBuilder() {
    fRow.innerHTML = "";
    const fs = L().fields.filter((f) => !f.empty);
    if (!fs.length) return;
    // An example of a text value: a real name from the level's own rows.
    const sample = (f) => { const v = L().rows.map((r) => val(r, f.key)).find((x) => x != null && x !== ""); return v != null ? `ej. ${v}` : "texto"; };
    const fsel = selectBox(fRow, { label: "Filtro", value: fs.find((f) => f.key === "population")?.key || fs[0].key, options: fs.map((f) => ({ value: f.key, label: f.label, group: f.group })) });
    const ops = document.createElement("select");
    ops.setAttribute("aria-label", "Comparación");
    const valIn = document.createElement("input");
    valIn.type = "text";
    valIn.setAttribute("aria-label", "Valor");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "adv-mini";
    add.textContent = "Agregar";
    const syncOps = () => {
      const f = L().field(fsel.value);
      ops.innerHTML = (numeric(f) ? OPS.num : OPS.text).map((o) => `<option value="${esc(o)}">${esc(OP_LABEL[o] || o)}</option>`).join("");
      valIn.placeholder = numeric(f) ? (f.format === "pct" || f.format === "signed" ? "ej. 25%" : f.format === "usd" || f.format === "money" ? "ej. 800k" : "ej. 1m") : sample(f);
    };
    fsel.select.addEventListener("change", syncOps);
    syncOps();
    const submit = () => {
      const f = L().field(fsel.value);
      if (!f || !valIn.value.trim()) return;
      const v = numeric(f) ? parseNum(valIn.value, f.format) : valIn.value.trim();
      if (v == null) { valIn.setCustomValidity("Escribe un número"); valIn.reportValidity(); return; }
      valIn.setCustomValidity("");
      st.filters.push({ key: f.key, op: ops.value, value: v });
      valIn.value = "";
      refresh();
    };
    add.addEventListener("click", submit);
    valIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    fRow.append(ops, valIn, add);
    // quick presets
    const presets = document.createElement("span");
    presets.className = "adv-presets";
    const P = (!live(L(), "population") ? [] : st.level === "counties" ? [["population", "≥", 1e5]] : [["population", "≥", 1e6], ["population", "≥", 2.5e5]])
      .filter(([k, , v]) => L().rows.some((r) => val(r, k) >= v)); // a preset no row passes is not offered
    presets.innerHTML = P.map((p, i) => `<button type="button" class="adv-mini" data-preset="${i}">${esc(`${compact(p[2])} habitantes o más`)}</button>`).join("");
    presets.addEventListener("click", (e) => {
      const i = e.target.closest("[data-preset]")?.dataset.preset;
      if (i == null) return;
      const [key, op, value] = P[+i];
      st.filters = st.filters.filter((f) => f.key !== key);
      st.filters.push({ key, op, value });
      refresh();
    });
    fRow.appendChild(presets);
  }

  function renderChips() {
    chipsRow.innerHTML = st.filters.map((f, i) => {
      const fd = L().field(f.key);
      const txt = `${fd?.label || f.key} ${OP_LABEL[f.op] || f.op} ${numeric(fd) ? fmtShort(fd.format, f.value) : f.value}`;
      return `<span class="adv-fchip">${esc(txt)}<button type="button" data-rm="${i}" aria-label="Quitar el filtro: ${esc(txt)}">✕</button></span>`;
    }).join("") + (st.filters.length > 1 ? `<button type="button" class="adv-mini" data-rm="all">Limpiar todo</button>` : "") + (st.filters.length && filterHighlight() ? frameBtn() : "");
  }
  chipsRow.addEventListener("click", (e) => {
    const i = e.target.closest("[data-rm]")?.dataset.rm;
    if (i == null) return;
    if (i === "all") st.filters = [];
    else st.filters.splice(+i, 1);
    refresh();
  });

  /** The chosen columns the current level has data for. */
  function shownCols() {
    return (st.cols[st.level] || []).filter((k) => live(L(), k));
  }

  function buildTable() {
    const lv = L();
    const keys = shownCols();
    const sortKey = keys.includes("population") ? "population" : keys[0] || "name";
    const maxOf = (k) => { const e = extent(lv.rows.map((r) => val(r, k))); return e ? Math.max(Math.abs(e[0]), Math.abs(e[1])) : 1; };
    const cols = [
      { key: "name", label: lv.field("name")?.label || "Nombre", align: "l", width: "minmax(92px,1.7fr)", value: (r) => r.name, html: (r) => `${esc(r.name)}${st.level !== "states" && r.sub ? ` <span class="sub">${esc(r.sub)}</span>` : ""}` },
      ...keys.map((k) => {
        const f = lv.field(k);
        const title = `${f.label}${f.unit ? ` (${f.unit})` : ""}. Haz clic para ordenar.`;
        const short = SHORT[k] || (k.startsWith("y_") ? esc(f.label.replace(/\s*\(?(trabajadores|ocupados|empleo)\)?$/i, "")) : null);
        // The name column already carries the province as a suffix, so a province column goes first when space is short.
        const isState = k === "state" || k === "states";
        return numeric(f)
          ? { key: k, label: f.label, short, title, value: (r) => val(r, k), text: (r) => fmtCell(f.format, val(r, k), f.unit), tip: (r) => fmtF(f, val(r, k)), bar: k === sortKey ? { max: maxOf(k), color: "rgba(154,123,201,.32)" } : null }
          : { key: k, label: f.label, short, title, align: "l", width: isState ? "minmax(0,.55fr)" : "minmax(0,.8fr)", hideBelow: isState ? 480 : 0, value: (r) => val(r, k), text: (r) => val(r, k) ?? "–" };
      }),
    ];
    if (!table) {
      table = createTable(tableHost, {
        caption: `Tabla de ${lv.label}`, columns: cols, rows: [], sort: { key: sortKey, dir: "desc" }, rank: true, maxHeight: 360,
        search: `Buscar en ${lv.label}`,
        onHover: (r) => { link.hover(r ? rowsHighlight(L(), [r]) : null); scatter.setHot(r ? r.key : null); },
        onClick: (r) => L().focus(r),
      });
    } else table.setColumns(cols, { key: sortKey, dir: "desc" });
    refreshRows();
  }

  function axisSelects() {
    axes.innerHTML = "";
    // A saved axis the level no longer has data for falls back to the level's default.
    const dxy = defaultXY(st.level);
    const xy = (st.xy[st.level] = { ...dxy, ...(st.xy[st.level] || {}) });
    const fix = (k, fallback) => (live(L(), k) && numeric(L().field(k)) ? k : fallback);
    xy.x = fix(xy.x, dxy.x);
    xy.y = fix(xy.y, dxy.y);
    xy.s = xy.s && live(L(), xy.s) ? xy.s : "";
    xy.c = xy.c && live(L(), xy.c) ? xy.c : "";
    const mk = (key, label, none) => selectBox(axes, {
      label, value: xy[key], options: fieldOpts(none, key !== "c"),
      onChange: (v) => { xy[key] = v; if (key === "x" || key === "y") delete xy[`log${key}`]; persist(); drawScatter(); },
    });
    mk("x", "X", false);
    mk("y", "Y", false);
    mk("s", "Tamaño", true);
    mk("c", "Color", true);
    const logs = document.createElement("span");
    logs.className = "adv-logs";
    logs.innerHTML = `<label class="adv-check"><input type="checkbox" data-log="x"> X en escala log</label><label class="adv-check"><input type="checkbox" data-log="y"> Y en escala log</label>`;
    axes.appendChild(logs);
    logs.addEventListener("change", (e) => {
      const a = e.target.dataset.log;
      xy[`log${a}`] = e.target.checked;
      persist();
      drawScatter();
    });
  }
  // A skewed, positive column reads better on a log axis.
  const autoLog = (k, rows) => {
    const e = extent(rows.map((r) => val(r, k)), true);
    const all = rows.map((r) => val(r, k)).filter(fin);
    return !!e && all.every((v) => v > 0) && e[1] / e[0] > 60;
  };

  function drawScatter() {
    const lv = L();
    const xy = st.xy[st.level];
    const rows = filtered();
    const fx = lv.field(xy.x), fy = lv.field(xy.y), fs = xy.s ? lv.field(xy.s) : null, fc = xy.c ? lv.field(xy.c) : null;
    if (!fx || !fy) { scatter.update({ points: [] }); lensRow.innerHTML = ""; fieldInfo.innerHTML = `<p class="adv-empty">Sin datos.</p>`; srcEl.innerHTML = sourcesHtml(data, []); return; }
    const lx = xy.logx ?? autoLog(xy.x, rows), ly = xy.logy ?? autoLog(xy.y, rows);
    axes.querySelector('[data-log="x"]').checked = lx;
    axes.querySelector('[data-log="y"]').checked = ly;
    let color = null;
    legendEl.innerHTML = "";
    if (fc) {
      if (numeric(fc)) {
        const signed = fc.format === "signed";
        const cl = autoLog(fc.key, rows);
        const dom = robustDomain(rows.map((r) => val(r, fc.key)), 0.03, cl) || [0, 1];
        const spec = signed ? { type: "div", domain: dom, mid: 0 } : { type: "seq", domain: dom, log: cl, ramp: fc.higher_is === "bad" ? RAMPS.heat : RAMPS.seq };
        const cs = colorScale(spec);
        color = (c) => cs(c);
        legendEl.innerHTML = rampLegend({ ramp: spec.ramp || RAMPS.div, domain: signed ? [-Math.max(...dom.map(Math.abs)), Math.max(...dom.map(Math.abs))] : dom, log: cl, fmt: (v) => fmtShort(fc.format, v), label: fc.label, mid: signed ? 0 : null });
      } else {
        const cats = [...new Set(rows.map((r) => val(r, fc.key)))].slice(0, 12);
        const pal = ["#e0b54c", "#4a86d6", "#3f9c82", "#c46a4f", "#9a7bc9", "#6e9a3c", "#d98a2b", "#5fbfbf", "#c9a0c0", "#a3a3c2", "#e8774a", "#b9b06a"];
        const m = new Map(cats.map((c, i) => [c, pal[i]]));
        color = (c) => m.get(c) || "#8b8070";
        const more = new Set(rows.map((r) => val(r, fc.key))).size > cats.length;
        legendEl.innerHTML = swatchLegend([...cats.map((c) => ({ label: c ?? "–", color: m.get(c) })), ...(more ? [{ label: "Otros", color: "#8b8070" }] : [])], fc.label);
      }
    }
    const big = [...rows].sort((a, b) => (val(b, "population") || 0) - (val(a, "population") || 0)).slice(0, st.level === "states" ? 10 : 6).map((r) => r.key);
    scatter.update({
      points: rows.map((r) => ({ key: r.key, x: val(r, xy.x), y: val(r, xy.y), s: fs ? val(r, xy.s) : null, c: fc ? val(r, xy.c) : null, label: r.name, sub: r.sub, row: r })),
      x: { label: fx.label, fmt: (v) => fmtShort(fx.format, v), log: lx },
      y: { label: fy.label, fmt: (v) => fmtShort(fy.format, v), log: ly },
      size: fs && numeric(fs) ? { label: fs.label, fmt: (v) => fmtF(fs, v), max: st.level === "counties" ? 13 : 15, min: 1.6 } : null,
      radius: st.level === "counties" ? 2.2 : 3.5,
      color, colorLabel: fc?.label, colorFmt: (v) => (fc && numeric(fc) ? fmtF(fc, v) : String(v)),
      labels: big,
      refLines: [], refX: [], refY: [],
    });
    if (st.sel) scatter.setSelected(st.sel);
    // Lens buttons for the plotted columns that have a matching map lens.
    lensRow.innerHTML = "";
    const lensFields = [fc, fy, fx].filter((f, i, a) => f && f.lens && a.findIndex((g) => g && g.lens === f.lens) === i);
    for (const f of lensFields) {
      const lens = app.lensById.get(f.lens);
      if (!lens) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "adv-lensbtn";
      const on = app.state.lens?.id === lens.id;
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on ? `El mapa muestra el lente "${lens.name}"` : `Ver "${f.label}" en el mapa como lente`;
      b.addEventListener("click", () => { app.setLens(app.state.lens?.id === lens.id ? null : lens.id); drawScatter(); });
      lensRow.appendChild(b);
    }
    if (!lensFields.length) lensRow.innerHTML = `<span class="adv-note">Estas columnas no tienen un lente en el mapa: pasa el cursor sobre el gráfico o arrastra para seleccionar, y verás dónde están.</span>`;
    fieldInfo.innerHTML = [fx, fy, fs, fc].filter((f, i, a) => f && a.indexOf(f) === i).map((f) => `<p><b>${esc(f.label)}</b>${f.unit ? ` <span class="sub">${esc(f.unit)}</span>` : ""}${f.description ? `: ${esc(f.description)}` : ""}</p>`).join("");
    const srcIds = [fx, fy, fs, fc].filter(Boolean).map((f) => f.source).filter(Boolean);
    const gdpVintage = data.nation?.gdp_vintage;
    srcEl.innerHTML = sourcesHtml(data, srcIds, [
      ...(lv.fields.some((f) => !f.empty && f.label.endsWith("≈")) ? ["Las columnas marcadas con ≈ son promedios de las comunas ponderados por población: sirven de referencia, pero no son la estadística de esa unidad."] : []),
      ...(data.vintage || data.countyVintage ? [`${data.vintage ? `Datos de comunas y provincias: ${esc(data.vintage)}. ` : ""}${data.countyVintage ? `Datos de comunas (detalle): ${esc(data.countyVintage)}.` : ""}`.trim()] : []),
      ...(gdpVintage && live(lv, "gdp") ? [`Ventas: ${esc(gdpVintage)}, de un año distinto al de la población.`] : []),
      ...(st.level === "counties" && data.countiesOffMap ? [`${int(data.countiesOffMap)} comunas son más chicas que un hexágono: siguen en la tabla y los gráficos, pero no se pueden delinear en el mapa.`] : []),
    ]);
  }

  function applySelection() {
    const lv = L();
    const sel = st.sel ? lv.rows.filter((r) => st.sel.has(r.key)) : [];
    link.base(sel.length ? rowsHighlight(lv, sel, { dim: true }) : filterHighlight(), { frame: sel.length > 1 || (!sel.length && st.filters.length > 0) });
    table?.setSelected(st.sel);
    selRow.innerHTML = st.sel ? `<span class="adv-fchip">${int(st.sel.size)} seleccionados en el gráfico<button type="button" data-clear-sel aria-label="Quitar la selección">✕</button></span>${frameBtn()}
      <label class="adv-check"><input type="checkbox" data-only${st.onlySel ? " checked" : ""}> Mostrar solo lo seleccionado</label>` : `<span class="adv-note">Tip: arrastra sobre el gráfico de abajo para seleccionar un grupo.</span>`;
    refreshRows();
    updateSummary();
  }
  selRow.addEventListener("click", (e) => { if (e.target.closest("[data-clear-sel]")) { st.sel = null; st.onlySel = false; scatter.setSelected(null); applySelection(); } });
  selRow.addEventListener("change", (e) => { if (e.target.matches("[data-only]")) { st.onlySel = e.target.checked; refreshRows(); } });

  // With filters on, outline the rows that pass (when there are not too many to read).
  function filterHighlight() {
    if (!st.filters.length) return null;
    const rows = filtered();
    if (!rows.length || rows.length > (st.level === "counties" ? 1500 : 300)) return null;
    return rowsHighlight(L(), rows, { dim: true, ringMax: 12 });
  }

  function refreshRows() {
    if (!table) return;
    let rows = filtered();
    if (st.onlySel && st.sel) rows = rows.filter((r) => st.sel.has(r.key));
    table.setRows(rows);
  }
  function updateSummary() {
    const rows = filtered();
    const pop = rows.reduce((a, r) => a + (val(r, "population") || 0), 0);
    summary.innerHTML = `<b>${int(rows.length)}</b> / ${int(L().rows.length)} ${esc(L().label.toLowerCase())}${pop > 0 ? ` · población ${count3(pop)}` : ""}${st.sel ? ` · <b>${int(st.sel.size)}</b> seleccionados` : ""}`;
  }
  function refresh() {
    renderChips();
    st.sel = null;
    scatter.setSelected(null);
    refreshRows();
    drawScatter();
    applySelection();
  }
  function rebuild() {
    if (table) { table.destroy(); table = null; }
    renderCols();
    renderFilterBuilder();
    axisSelects();
    buildTable();
    refresh();
  }
  rebuild();

  const hostRowAt = (cell) => (cell >= 0 ? L().rowAtCell(cell) : null);
  return {
    onMapHover(h) {
      const r = hostRowAt(h.cell);
      scatter.setHot(r ? r.key : null);
      table?.setHot(r ? r.key : null);
    },
    onEscape() {
      if (st.sel) { st.sel = null; st.onlySel = false; scatter.setSelected(null); applySelection(); return true; }
      return false;
    },
  };
}
