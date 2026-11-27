// City View "Citizens" rows: the city's people as rows of small figures (citizens.json).
//
//   citizensHtml(m, data) → HTML      the rows (placeholders for the figure canvases)
//   mountCitizens(host, m, data)       paints the figures and wires the hover / focus read-out
//
// Each row: N figures (from the file's `figures`, or rounded here with the same largest-remainder method), a caption
// ("Cada figura ≈ 72 mil personas"), a read-out line that a hovered or focused figure fills ("Entre los trabajadores de
// Santiago, 1 de cada 7 pertenece a "...", región: 1 de cada 14") and a thin regional bar for comparison. A row type the file does not have at all
// (no `groups` entry) is left out; a row the source did not publish for this city is said so, never drawn as zeros.
//
// Category names and the row descriptions come from the file (`groups[row][].label` / `.short`, `rows[row]`): the
// pipeline writes them in Spanish and defines what each category covers (age bands, schooling levels), so nothing
// here states a definition of its own.
import { esc, int, pct } from "../../format.js";
import { compact } from "./fmt.js";
import { CATEGORY_COLOR, artKey, figureCanvas, loadPainter } from "./figures.js";
import { T } from "../../terms.js";
import { mountPyramid, pyramidHtml } from "./pyramid.js";

/** groups → (row, key) → the key of the figure and colour that category uses (its own, or the one its icon names). */
function artOf(groups) {
  const map = new Map();
  for (const [r, gs] of Object.entries(groups || {})) for (const g of gs || []) map.set(`${r}|${g.key}`, artKey(r, g.key, g.icon));
  return (r, k) => map.get(`${r}|${k}`) || k;
}

// noun: whom one figure counts, with its article ("los trabajadores"). sub: shown only when the file has no description for the row.
const ROWS = [
  { id: "workforce", title: "Ocupación", sub: "por ocupación", noun: "los trabajadores", n: null },
  { id: "age", title: "Generaciones", sub: "por edad", noun: "los habitantes", n: null },
  { id: "commute", title: "Traslado", sub: "cómo llegan al trabajo los ocupados", noun: "los trabajadores", n: null },
  { id: "education", title: "Educación", sub: "por nivel educacional más alto", noun: "las personas", n: 10 },
  { id: "nativity", title: "Origen", sub: "dónde nacieron los habitantes", noun: "los habitantes", n: 10 },
];

/**
 * Whom a row counts, for its captions. The education row's base is an age floor that differs by source, so it is
 * read from the file's own description of the row ("Nivel educacional de las personas de 15 años o más" → "las personas de 15 años o más").
 */
function nounOf(rd, data) {
  const m = rd.id === "education" ? /(\d+)\s*años/.exec(data?.rows?.education || "") : null;
  return m ? `las personas de ${m[1]} años o más` : rd.noun;
}
const bare = (noun) => noun.replace(/^(los|las) /, ""); // the noun without its article, for captions

/** Largest-remainder rounding of counts into n figures (the pipeline's method, for rows without figures). */
export function largestRemainder(counts, keys, n) {
  const tot = keys.reduce((a, k) => a + (counts[k] || 0), 0);
  if (!(tot > 0)) return null;
  const raw = keys.map((k) => ((counts[k] || 0) / tot) * n);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, v) => a + v, 0);
  const order = raw.map((v, j) => [v - Math.floor(v), j]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < left; k++) out[order[k][1]]++;
  return Object.fromEntries(keys.map((k, j) => [k, out[j]]));
}

/** "1 de cada 7", "3 de cada 10", "menos de 1 en mil", as {text, pl} (pl: the verb takes the plural); null without a share. */
export function oneIn(share) {
  if (share == null || !Number.isFinite(share)) return null;
  if (share <= 0) return { text: "nadie" };
  if (share < 0.001) return { text: "menos de 1 en mil" };
  if (share >= 0.3) {
    const k = Math.round(share * 10);
    return k >= 10 ? { text: "casi todos", pl: true } : { text: `${k} de cada 10`, pl: true };
  }
  const n = Math.round(1 / share);
  return { text: `1 de cada ${int(n)}` };
}

/** The read-out sentence, built from the category's own label (no per-category wording to keep in step with the data). */
function sentence(label, share, natShare, cityName, noun) {
  const a = oneIn(share);
  if (!a) return "";
  const us = oneIn(natShare);
  return `Entre ${noun} de ${cityName}, ${a.text} ${a.pl ? "pertenecen" : "pertenece"} a "${label}"${us ? ` (${T.nationShort}: ${us.text})` : ""}`;
}

function rowModel(rowDef, row, nat, groups, figuresN) {
  const keys = (groups[rowDef.id] || []).map((g) => g.key);
  const n = figuresN[rowDef.id] ?? rowDef.n ?? 10;
  const figs = row.figures || largestRemainder(row.counts || {}, keys, n);
  const natFigs = nat?.figures || (nat ? largestRemainder(nat.counts || {}, keys, n) : null);
  return { keys, n, figs, natFigs };
}

// Specialists by row/key from the file (ratios from unrounded shares).
function specMap(city) {
  const m = new Map();
  for (const s of city?.specialists || []) m.set(`${s.row}|${s.key}`, s);
  return m;
}

/** The Citizens rows. data = citizens.json (or null / undefined while loading). */
export function citizensHtml(m, data) {
  const c = m.city;
  if (data === undefined) return `<p class="muted cv-note">Cargando la composición de los habitantes…</p>`;
  if (!data || !data.cities) return `<p class="muted cv-note">No hay datos de composición de los habitantes.</p>`;
  const row0 = data.cities[c.id];
  if (!row0) {
    return `<p class="muted cv-note">La fuente no tiene estadísticas de composición de los habitantes de ${esc(c.name)}, por eso aquí no hay figuras.</p>`;
  }
  const nat = data.national || {};
  const groups = data.groups || {};
  const specs = specMap(row0);
  const art = artOf(groups);
  const colorOf = (r, k, fallback) => CATEGORY_COLOR[r]?.[art(r, k)] || fallback;
  const label = Object.fromEntries(Object.entries(groups).map(([r, gs]) => [r, Object.fromEntries(gs.map((g) => [g.key, g.label || g.key]))]));
  // Legend labels: the file's short form when it has one, else its label.
  const short = Object.fromEntries(Object.entries(groups).map(([r, gs]) => [r, Object.fromEntries(gs.map((g) => [g.key, g.short || g.label || g.key]))]));
  const hi = data.rule?.specialist_high ?? 1.5, lo = data.rule?.specialist_low ?? 0.67;

  // Headline: median age, degrees, foreign-born, and the "great person" call-out (the strongest specialist).
  const med = row0.age?.median, usMed = nat.age?.median;
  const ba = row0.education?.bachelors_plus, usBa = nat.education?.bachelors_plus;
  const fb = row0.nativity?.foreign_born ?? row0.nativity?.shares?.foreign_born;
  const usFb = nat.nativity?.foreign_born ?? nat.nativity?.shares?.foreign_born;
  const chip = (v, us, fmt, lbl, tip) => (v == null ? "" : `<div class="cv-cz-chip" title="${esc(tip)}"><b>${fmt(v)}</b><span>${esc(lbl)}</span>${us != null ? `<small>${T.nationShort} ${fmt(us)}</small>` : ""}</div>`);
  const top = (row0.specialists || []).find((s) => s.ratio >= hi);
  const topRow = ROWS.find((r) => r.id === top?.row);
  const great = top && topRow ? `<div class="cv-great" style="--fc:${esc(colorOf(top.row, top.key, "#c9a45c"))}">
      <span class="cv-great-fig" data-great="${esc(top.row)}|${esc(top.key)}" aria-hidden="true"></span>
      <div><small>Habitante representativo</small><b>${esc(label[top.row]?.[top.key] || top.key)}</b>
      <span>Representa el ${pct(top.share, 1)} de ${esc(nounOf(topRow, data))} de la comuna, frente al ${pct(top.national, 1)} ${T.inNation}: ${top.ratio.toFixed(1)} veces la proporción ${T.regional}.</span></div></div>` : "";

  // Only the row types this build has (a `groups` entry); the others are not part of the data at all.
  const rows = ROWS.filter((rd) => Array.isArray(groups[rd.id]) && groups[rd.id].length).map((rd) => {
    const row = row0[rd.id];
    const head = `<div class="cv-cz-h"><b>${esc(rd.title)}</b><span>${esc(data.rows?.[rd.id] || rd.sub)}</span></div>`;
    if (!row) {
      return `<div class="cv-cz-row missing" data-row="${rd.id}">${head}
        <p class="muted cv-note">La fuente no tiene esta estadística para ${esc(c.name)}, por eso no se muestra esta fila.</p></div>`;
    }
    if (rd.id === "age" && row.pyramid && Array.isArray(data.age_bands)) {
      const medTxt = med != null ? ` · edad mediana ${med.toFixed(1)} años${usMed != null ? ` (${T.nationShort} ${usMed.toFixed(1)} años)` : ""}` : "";
      return pyramidHtml(c, row, nat.age, data.age_bands, `${compact(row.total)} habitantes${medTxt}. Pasa el cursor sobre un tramo para ver sus cifras.`);
    }
    const { keys, n, figs, natFigs } = rowModel(rd, row, nat[rd.id], groups, data.figures || {});
    if (!figs) return `<div class="cv-cz-row missing" data-row="${rd.id}">${head}<p class="muted cv-note">Esta fila no tiene datos.</p></div>`;
    const per = row.total / n;
    const cells = [];
    for (const k of keys) {
      for (let j = 0; j < (figs[k] || 0); j++) {
        const sp = specs.get(`${rd.id}|${k}`);
        const mark = sp ? (sp.ratio >= 1 ? "up" : "down") : "";
        // One tab stop per category (its first figure), not one per figure.
        cells.push(`<span class="cv-fig${mark ? ` ${mark}` : ""}" tabindex="${j ? -1 : 0}" role="img" data-k="${esc(k)}" aria-label="${esc(label[rd.id]?.[k] || k)}"></span>`);
      }
    }
    // Legend: every category, with its share, the national share and a chevron for specialists. Categories that
    // round to no figure are still listed (greyed), so nothing silently disappears.
    const legend = keys.map((k) => {
      const sh = row.shares?.[k], us = nat[rd.id]?.shares?.[k];
      const sp = specs.get(`${rd.id}|${k}`);
      const chev = sp ? `<em class="${sp.ratio >= 1 ? "up" : "down"}" title="${sp.ratio.toFixed(1)} veces la proporción ${T.regional}">${sp.ratio >= 1 ? "▲" : "▼"}</em>` : "";
      return `<span class="cv-cz-k${figs[k] ? "" : " zero"}" data-k="${esc(k)}" title="${esc(label[rd.id]?.[k] || k)}: ${sh != null ? pct(sh, 1) : "–"}${us != null ? ` (${T.nationShort} ${pct(us, 1)})` : ""}${figs[k] ? "" : ". Al redondear no alcanza una figura."}"><i style="background:${esc(colorOf(rd.id, k, "#888"))}"></i>${esc(short[rd.id]?.[k] || k)} <small>${sh != null ? pct(sh, 0) : "–"}</small>${chev}</span>`;
    }).join("");
    // National comparison bar (shares), aligned with the figures' order.
    const usBar = nat[rd.id]?.shares ? `<div class="cv-cz-us" title="Composición ${T.regional} (mismo orden)"><span>${T.NationShort}</span><div>${keys.map((k) => {
      const s = nat[rd.id].shares[k] || 0;
      return s > 0 ? `<i style="flex:${s};background:${esc(colorOf(rd.id, k, "#888"))}" title="${esc(short[rd.id]?.[k] || k)}: ${T.nationShort} ${pct(s, 1)}"></i>` : "";
    }).join("")}</div></div>` : "";
    const cap = `Cada figura ≈ ${compact(per)} personas · ${compact(row.total)} en total (${bare(nounOf(rd, data))})${rd.n && !row.figures ? " · redondeado aquí" : ""}`;
    const extra = rd.id === "age" && med != null ? ` · edad mediana ${med.toFixed(1)} años${usMed != null ? ` (${T.nationShort} ${usMed.toFixed(1)} años)` : ""}` : "";
    return `<div class="cv-cz-row" data-row="${rd.id}" style="--n:${n}">${head}
      <div class="cv-figs" role="group" aria-label="${esc(rd.title)}: ${esc(keys.filter((k) => figs[k]).map((k) => `${short[rd.id]?.[k] || k} ${figs[k]}/${n}`).join(", "))}">${cells.join("")}</div>
      ${usBar}
      <div class="cv-cz-out" aria-live="polite" data-default="${esc(cap + extra)}">${esc(cap + extra)}</div>
      <div class="cv-cz-legend">${legend}</div>
    </div>`;
  }).join("");

  const unreliable = row0.reliable === false
    ? `<p class="cv-warn">La muestra aquí es pequeña y el error es mayor: toma estas cifras solo como referencia.</p>` : "";
  return `
    <div class="cv-cz-top">
      ${chip(med, usMed, (v) => `${v.toFixed(1)} años`, "edad mediana", "Edad mediana de los habitantes")}
      ${chip(ba, usBa, (v) => pct(v, 0), "con título universitario o postgrado", `Personas de 25 años o más con título universitario, magíster o doctorado (Censo 2024)${row0.education?.doctorate ? `; ${row0.education.doctorate.toLocaleString("en-US")} con doctorado` : ""}`)}
      ${chip(fb, usFb, (v) => pct(v, 0), "nacidos en el extranjero", "Proporción de habitantes nacidos en otro país")}
    </div>
    ${great}
    ${unreliable}
    <div class="cv-cz${row0.reliable === false ? " unreliable" : ""}">${rows}</div>
    <p class="cv-note">${data.vintage ? `Fuente: ${esc(data.vintage)}. ` : ""}Las figuras se redondean con el método del mayor resto, así cada fila suma el total de figuras; pasa el cursor sobre una figura o tócala para ver la proporción de su categoría. ▲▼ = proporción de al menos ${hi} veces la ${T.regional}, o de a lo sumo ${lo} veces${
      Number.isFinite(data.rule?.min_count) ? `; no se marcan las categorías con menos de ${int(data.rule.min_count)} personas en la comuna` : ""}.</p>`;
}

/** Paint the figure canvases and wire the read-outs. */
export function mountCitizens(host, m, data) {
  if (!host || !data?.cities?.[m.city.id]) return;
  const row0 = data.cities[m.city.id];
  const nat = data.national || {};
  const labelOf = (rid, k) => (data.groups?.[rid] || []).find((g) => g.key === k)?.label || k;
  const dpr = Math.min(3, Math.max(1, Math.round((devicePixelRatio || 1) * 2) / 2));
  const art = artOf(data.groups);
  const paintAll = () => {
    host.querySelectorAll(".cv-cz-row[data-row]").forEach((rowEl) => {
      const rid = rowEl.dataset.row;
      rowEl.querySelectorAll(".cv-fig").forEach((el) => {
        const src = figureCanvas(rid, art(rid, el.dataset.k), 36, dpr);
        const cv = document.createElement("canvas");
        cv.width = src.width;
        cv.height = src.height;
        cv.getContext("2d").drawImage(src, 0, 0);
        el.replaceChildren(cv);
      });
    });
    const g = host.querySelector("[data-great]");
    if (g) {
      const [rid, k] = g.dataset.great.split("|");
      const src = figureCanvas(rid, art(rid, k), 36, dpr);
      const cv = document.createElement("canvas");
      cv.width = src.width;
      cv.height = src.height;
      cv.getContext("2d").drawImage(src, 0, 0);
      g.replaceChildren(cv);
    }
  };
  paintAll();
  if (row0.age?.pyramid && Array.isArray(data.age_bands)) mountPyramid(host, m.city, row0.age, nat.age, data.age_bands);
  // Once the citizen painter (render/art/people.js) loads, repaint the figures.
  loadPainter().then(() => { if (host.isConnected) paintAll(); });

  host.querySelectorAll(".cv-cz-row[data-row]").forEach((rowEl) => {
    const rid = rowEl.dataset.row;
    const rd = ROWS.find((r) => r.id === rid);
    const row = row0[rid];
    const out = rowEl.querySelector(".cv-cz-out");
    if (!row || !out) return;
    const show = (k) => {
      rowEl.querySelectorAll("[data-k]").forEach((el) => el.classList.toggle("lit", el.dataset.k === k));
      rowEl.classList.toggle("focus", !!k);
      if (!k) {
        out.textContent = out.dataset.default;
        out.classList.remove("on");
        return;
      }
      const sh = row.shares?.[k], us = nat[rid]?.shares?.[k];
      out.innerHTML = `${esc(sentence(labelOf(rid, k), sh, us, m.city.name, nounOf(rd, data)))}<small>Comuna ${sh != null ? pct(sh, 1) : "–"}${us != null ? ` · ${T.nationShort} ${pct(us, 1)}` : ""}${row.counts?.[k] != null ? ` · ≈${compact(row.counts[k])} personas` : ""}</small>`;
      out.classList.add("on");
    };
    let pinned = null;
    rowEl.addEventListener("pointerover", (e) => {
      const el = e.target.closest("[data-k]");
      if (el && rowEl.contains(el)) show(el.dataset.k);
    });
    rowEl.addEventListener("pointerleave", () => show(pinned));
    rowEl.addEventListener("focusin", (e) => {
      const el = e.target.closest("[data-k]");
      if (el) show(el.dataset.k);
    });
    rowEl.addEventListener("focusout", () => show(pinned));
    // A tap pins the category (phones have no hover); another tap on it lets go.
    rowEl.addEventListener("click", (e) => {
      const el = e.target.closest("[data-k]");
      if (!el) return;
      pinned = pinned === el.dataset.k ? null : el.dataset.k;
      show(pinned);
    });
  });
}
