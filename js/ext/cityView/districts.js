// City View "Districts": the city's real industry specialisation (districts.json) as strategy-game districts, plus
// the Encampment tier from military.json where a build has that file (the Santiago map omits it: `mil` is then null
// and no Encampment text, rule or vintage is shown).
//
//   cityDistricts(ddata, mil, id) → [district]   the metro's districts, strongest first, each with what the dock and
//                                                the map plaques need ({id, name, short, color, icon, lq, emp, …})
//   badgeOf(ddata, id) → {label, text, color, icon, district} | null | undefined   the city-type badge
//   districtsHtml(m, ddata, mil) → HTML          the section body
//   badgeHtml(m, ddata) → HTML                   the header badge
import { esc, int, pct } from "../../format.js";
import { compact, money } from "./fmt.js";
import { icon } from "../../ui/icon.js";
import { hasIcon } from "../../icons.js";
import { T } from "../../terms.js";

// Icons the district catalog names (d-*) are not drawn yet; until they are, a near icon from the set stands in,
// and canvas plaques without any icon get the letter in `mark`.
const FALLBACK = {
  campus: ["y-science", "🎓"], commercial_hub: ["i-finance", "💰"], industrial_zone: ["i-manufacturing", "🏭"],
  harbor: ["i-transportation", "⚓"], theater_square: ["i-arts", "🎭"], entertainment_complex: ["i-accommodation", "🎡"],
  aerodrome: ["i-transportation", "✈️"], government_plaza: ["i-public_admin", "🏛"], encampment: [null, "⛺"],
  aqueduct: ["i-utilities", "💧"],
};
// Names for the map plaques, used only when the file's catalog has no name for the id (it normally does, in Spanish).
const SHORT = {
  campus: "Campus", commercial_hub: "Comercio", industrial_zone: "Industria", harbor: "Puerto", theater_square: "Teatro",
  entertainment_complex: "Ocio", aerodrome: "Aeródromo", government_plaza: "Plaza de gobierno", encampment: "Campamento",
  aqueduct: "Acueducto",
};
const TIER = { garrison: "Guarnición", fortress: "Fortaleza" };
const shortOf = (id, c) => c?.short || c?.name || SHORT[id] || id;

const catCache = new WeakMap();
function catalog(ddata) {
  let m = catCache.get(ddata);
  if (!m) catCache.set(ddata, (m = new Map((ddata?.catalog || []).map((c) => [c.id, c]))));
  return m;
}

export function iconFor(id, cat) {
  if (cat?.icon && hasIcon(cat.icon)) return cat.icon;
  const f = FALLBACK[id]?.[0];
  return f && hasIcon(f) ? f : null;
}

const instCache = new WeakMap();
function installationsById(mil) {
  let m = instCache.get(mil);
  if (!m) instCache.set(mil, (m = new Map((mil?.installations || []).map((i) => [i.id, i]))));
  return m;
}

/**
 * The metro's districts: districts.json entries (strongest first), with military.json's Encampment merged in (its
 * tier label; added at the end when only military.json has one).
 */
export function cityDistricts(ddata, mil, id) {
  const cat = catalog(ddata);
  const row = ddata?.cities?.[id] || null;
  const mc = mil?.cities?.[id] || null;
  const out = [];
  for (const d of row?.districts || []) {
    const c = cat.get(d.id) || {};
    const spec = d.via === "specialty" && d.sub;
    out.push({
      ...d, name: c.name || SHORT[d.id] || d.id, color: c.color || "#5a6a7a", icon: iconFor(d.id, c), emoji: FALLBACK[d.id]?.[1] || "◆",
      cat: c, subName: d.sub ? c.sub?.[d.sub] || ddata.industries?.[d.sub]?.title || d.sub : null,
      // The map plaque: a speciality-qualified district is labelled by that speciality (its own LQ is the reason).
      short: spec ? c.sub?.[d.sub] || shortOf(d.id, c) : shortOf(d.id, c),
      mapLq: spec ? d.sub_lq : d.lq,
      military: d.id === "encampment" ? mc : null,
    });
  }
  if (mc && !out.some((d) => d.id === "encampment")) {
    const c = cat.get("encampment") || {};
    out.push({
      id: "encampment", name: c.name || SHORT.encampment, color: c.color || "#8a4a3a", icon: iconFor("encampment", c), emoji: "⛺",
      cat: c, lq: null, emp: null, short: TIER[mc.tier] || SHORT.encampment, mapLq: null, military: mc, militaryOnly: true,
    });
  }
  for (const d of out) {
    if (d.military) d.tierLabel = TIER[d.military.tier] || d.military.tier;
  }
  return out;
}

/** The city-type badge; undefined while districts.json is loading, null when there is none. */
export function badgeOf(ddata, id) {
  if (!ddata) return ddata; // undefined (loading) or null (missing)
  const row = ddata.cities?.[id];
  if (!row) return null;
  if (!row.badge) return { label: "Sin tipo específico", text: "Ningún sector alcanza el umbral de un distrito.", color: "#6a7484", icon: null, district: null };
  const c = catalog(ddata).get(row.badge.district) || {};
  return { ...row.badge, color: c.color || "#6a7484", icon: iconFor(row.badge.district, c), emoji: FALLBACK[row.badge.district]?.[1] };
}

export function badgeHtml(m, ddata) {
  const b = badgeOf(ddata, m.city.id);
  if (!b) return "";
  return `<span class="cv-type${b.district ? "" : " plain"}" style="--tc:${esc(b.color)}" title="Tipo de comuna: ${esc(b.text || b.label)}${ddata.vintage ? ` (${esc(ddata.vintage)})` : ""}">
    <span class="cv-type-ic">${icon(b.icon, b.emoji || "◆", { size: 13 })}</span>${esc(b.label)}</span>`;
}

const ge = (lb) => (lb ? "≥" : "");
const signed = (x) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`);

function lqTag(lq, lb, tip) {
  if (lq == null) return "";
  const cls = lq >= 1.25 ? "hi" : lq <= 0.75 ? "lo" : "mid";
  return `<span class="cv-lq ${cls}" title="${esc(tip || `Cociente de localización: ${lq.toFixed(2)} veces la proporción ${T.regional} del empleo`)}">×${ge(lb)}${lq.toFixed(1)}</span>`;
}
// "El valor no se publicó en N comunas": the note for a value some members withheld.
const withheld = (n) => `El valor no se publicó en ${n} ${n === 1 ? "comuna" : "comunas"}`;

function districtCard(d, row, ddata, mil) {
  const nat = ddata?.national || {};
  const c = d.cat || {};
  const lb = !!d.lower_bound;
  const supTip = lb ? `${withheld(d.suppressed)}, por eso es un límite inferior.` : "";
  const facts = [];
  if (d.emp != null) {
    facts.push(`<div><span>Empleo</span><b>${ge(lb)}${compact(d.emp)}</b><small>${d.share != null ? `${pct(d.share, 1)} de la comuna` : ""}</small></div>`);
  }
  if (d.avg_pay != null) {
    facts.push(`<div><span>Sueldo medio</span><b>${money(d.avg_pay)}</b><small>${row?.avg_pay != null ? `comuna ${money(row.avg_pay)}` : ""}</small></div>`);
  }
  if (d.strength != null) {
    facts.push(`<div title="Empleos sobre la norma ${T.regional}: empleo − empleo ÷ cociente de localización (así se ordenan los distritos)"><span>Sobre la norma</span><b>${ge(lb)}${compact(Math.max(0, d.strength))}</b><small>empleos</small></div>`);
  }
  let spec = "";
  if (d.sub && d.subName) {
    // the speciality's own withheld flag (districts.json sub_lower_bound; older files: the top-industries row)
    const slb = d.sub_lower_bound ?? !!(row?.top || []).find((t) => t.naics === d.sub)?.lower_bound;
    spec = `<p class="cv-dc-sub">${d.via === "specialty" ? "Califica por" : "Mayor especialidad"}: <b>${esc(d.subName)}</b> ${lqTag(d.sub_lq, slb, slb && d.sub_lq != null ? `Cociente de localización: al menos ${d.sub_lq.toFixed(2)} veces la proporción ${T.regional} (parte de los valores no se publicó, por eso es un límite inferior)` : undefined)}${
      d.sub_emp != null ? ` <small>${ge(slb)}${compact(d.sub_emp)} empleos</small>` : ""}${
      d.via === "specialty" && d.lq != null ? `<br><small>Las industrias del distrito en conjunto son ${d.lq.toFixed(2)} veces la proporción ${T.regional}; solo esta especialidad supera el umbral.</small>` : ""}</p>`;
  }
  let milHtml = "";
  if (d.military) {
    const mc = d.military;
    const inst = installationsById(mil);
    const names = (mc.installations || []).map((i) => inst.get(i)?.name).filter(Boolean);
    milHtml = `<div class="cv-dc-mil">
      <p><b>${esc(d.tierLabel)}</b>${mc.naval ? " (naval)" : ""}: ${int(mc.armed_forces)} residentes en las fuerzas armadas, ${pct(mc.share, mc.share < 0.01 ? 2 : 1)} de las personas de 16 años o más.</p>
      ${names.length ? `<p class="cv-dc-inst">${names.slice(0, 5).map((n) => `<span>${esc(n)}</span>`).join("")}${
        mc.installation_count > Math.min(5, names.length) ? `<small>+${mc.installation_count - Math.min(5, names.length)} más</small>` : ""}</p>` : ""}
    </div>`;
  }
  const caveat = c.caveat ? `<p class="cv-dc-cav">${esc(c.caveat)}</p>` : "";
  const title = d.militaryOnly ? `${esc(d.name)} · ${esc(d.tierLabel)}` : d.military ? `${esc(d.name)} · ${esc(d.tierLabel)}` : esc(d.name);
  return `<div class="cv-dc" style="--dc:${esc(d.color)}" title="${esc(c.description || "")}${c.description && supTip ? " " : ""}${esc(supTip)}">
    <div class="cv-dc-h"><span class="cv-dc-hex">${icon(d.icon, d.emoji, { size: 18 })}</span>
      <div class="cv-dc-t"><b>${title}</b><small>${esc(c.description || "")}</small></div>
      ${d.lq != null ? lqTag(d.lq, lb, `Cociente de localización: la proporción de empleo de la comuna en estas industrias es ${d.lq.toFixed(2)} veces la ${T.regional}.${supTip}`) : ""}</div>
    ${facts.length ? `<div class="cv-dc-f">${facts.join("")}</div>` : ""}
    ${spec}${milHtml}${caveat}
  </div>`;
}

function topTable(row, ddata) {
  const top = row?.top || [];
  if (!top.length) return "";
  const max = Math.max(...top.map((t) => t.lq || 0), 1);
  // Pay and year-on-year change are columns only when the source has them for some row (a household survey has
  // neither); the stylesheet lays out all five columns, so a shorter row states its own.
  const hasPay = top.some((t) => t.avg_pay != null), hasOty = top.some((t) => t.oty_pct != null);
  const grid = hasPay && hasOty ? "" : ` style="grid-template-columns:minmax(0,1fr) 46px 40px${hasPay || hasOty ? " 46px" : ""}"`;
  // The industry's code is quoted only when it is a classification code (has a digit), not a key of the data file.
  const code = (t) => (/\d/.test(String(t.naics)) ? ` (código de actividad ${esc(t.naics)})` : "");
  // The pay column drops the $ prefix (the header carries it) so the values fit the narrow column.
  return `<h4 class="cv-h4">Industrias más especializadas <span class="muted">por cociente de localización</span></h4>
  <div class="cv-top" role="table" aria-label="Industrias más especializadas">
    <div class="cv-top-r cv-top-hd" role="row"${grid}><span role="columnheader">Industria</span><span role="columnheader">Empleo</span><span role="columnheader">×${T.nationShort}</span>${
      hasPay ? `<span role="columnheader">Sueldo ($)</span>` : ""}${hasOty ? `<span role="columnheader">1 año</span>` : ""}</div>
    ${top.map((t) => {
      const named = ddata.industries?.[t.naics]?.title;
      const title = named || `Código de actividad ${t.naics}`;
      const lb = !!t.lower_bound;
      return `<div class="cv-top-r" role="row"${grid} title="${esc(title)}${named ? code(t) : ""}${t.avg_pay != null ? `, sueldo medio ${esc(money(t.avg_pay))}` : ""}${lb ? `. Límite inferior: ${withheld(t.suppressed)}.` : ""}">
        <span role="cell" class="cv-top-n">${esc(title)}<i style="width:${((Math.log(1 + (t.lq || 0)) / Math.log(1 + max)) * 100).toFixed(1)}%"></i></span>
        <span role="cell">${ge(lb)}${compact(t.emp)}</span>
        <span role="cell"><b>${t.lq != null ? `${ge(lb)}${t.lq.toFixed(1)}` : "–"}</b></span>
        ${hasPay ? `<span role="cell">${compact(t.avg_pay)}</span>` : ""}
        ${hasOty ? `<span role="cell" class="${t.oty_pct == null ? "" : t.oty_pct >= 0 ? "good" : "bad"}">${signed(t.oty_pct)}</span>` : ""}</div>`;
    }).join("")}
  </div>`;
}

/** The Districts section body. ddata: districts.json (undefined while loading, null when missing). */
export function districtsHtml(m, ddata, mil) {
  if (ddata === undefined) return `<p class="muted cv-note">Cargando distritos…</p>`;
  if (!ddata) return `<p class="muted cv-note">No hay datos de distritos.</p>`;
  const id = m.city.id;
  const row = ddata.cities?.[id] || null;
  const list = cityDistricts(ddata, mil, id);
  const b = badgeOf(ddata, id);
  let lead;
  if (!row) {
    // A null row: the source does not cover this city. The file's own note says which source and which places.
    lead = `<p class="cv-lead">${esc(m.city.name)} no está en el universo de la fuente y no tiene empleo por actividad, por eso aquí no hay distritos.</p>${
      ddata.note ? `<p class="cv-note">${esc(ddata.note)}</p>` : ""}`;
  } else {
    const cnt = row.counties ? ` (de ${row.counties[0]} de ${row.counties[1]} comunas)` : "";
    const pay = row.avg_pay != null
      ? `, sueldo medio ${money(row.avg_pay)}${ddata.national?.avg_pay != null ? ` (${T.nationShort} ${money(ddata.national.avg_pay)})` : ""}` : "";
    const text = String(b?.text || "").replace(/\.\s*$/, "");
    lead = `<p class="cv-lead">${b?.district ? `<b class="cv-type-l" style="--tc:${esc(b.color)}">${esc(b.label)}</b>${text ? ` · ${esc(text)}` : ""}.${row.emp != null ? " " : ""}` : ""}${
      row.emp != null ? `${int(row.emp)} empleos contados${cnt}${pay}.` : ""}</p>`;
  }
  const cards = list.length
    ? `<div class="cv-dcs">${list.map((d) => districtCard(d, row, ddata, mil)).join("")}</div>`
    : row ? `<p class="muted cv-note">Ningún sector de la comuna alcanza el umbral de un distrito${ddata.rule?.text ? " (ver abajo \"Cómo se eligen los distritos\")" : ""}.</p>` : "";
  // "≥" is explained only where this city shows one (a source that withholds nothing never does).
  const anyLower = list.some((d) => d.lower_bound || d.sub_lower_bound) || (row?.top || []).some((t) => t.lower_bound);
  // Only with military.json: the Encampment rule and its vintage.
  const hasMil = !!mil && list.some((d) => d.military);
  const milRule = hasMil && mil.rule ? `<p><b>Nivel de campamento</b>: ${esc(mil.rule)}</p>` : "";
  const milVintage = hasMil ? (typeof mil.vintage === "object" ? [mil.vintage.installations, mil.vintage.acs].filter(Boolean).join("; ") : mil.vintage || "") : "";
  return `${lead}
    ${cards}
    ${topTable(row, ddata)}
    ${list.length ? `<div class="cv-schematic">
      <p><b>◆ En el mapa</b>, cada distrito aparece como una placa sobre un hexágono cercano a la comuna. Las posiciones son esquemáticas: muestran en qué se especializa la comuna, no dónde están los empleos.</p>
    </div>` : ""}
    ${ddata.rule?.text || milRule || ddata.note ? `<details class="cv-more cv-rule"><summary>Cómo se eligen los distritos</summary>
      ${ddata.rule?.text ? `<p>${esc(ddata.rule.text)}</p>` : ""}${milRule}
      ${ddata.note && row ? `<p>${esc(ddata.note)}</p>` : ""}
    </details>` : ""}
    <p class="cv-note">${ddata.vintage ? `Fuente: ${esc(ddata.vintage)}. ` : ""}×N = cociente de localización${anyLower ? "; ≥ = límite inferior (parte de los valores no se publicó)" : ""}. ${
      milVintage ? `Nivel de campamento: ${esc(milVintage)}.` : ""}</p>`;
}
