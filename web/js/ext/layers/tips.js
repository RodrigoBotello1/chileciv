// Hover tooltips for the map-art layers (HTML strings; every data value is escaped). Each says where the number comes
// from and the caveat that matters for it (trade values are model estimates; the trade arc is a drawing aid; curated
// landmarks are an editorial pick). Sources are quoted from the files themselves (their `vintage`, `rules`, `units`
// and name tables), never hardcoded here.
import { esc, compact, int, pct, money } from "../../format.js";
import { FORT_KINDS, fortKind, WONDER_KINDS } from "../../render/art/sites.js";
import { MODE_STYLE } from "../../render/art/improvements.js";

const muted = (s) => `<span class="muted">${s}</span>`;
const num = (n) => (n == null || !Number.isFinite(n) ? "–" : compact(n));
const sign = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±");
/** A compact number with its unit: "1.2 M toneladas", "8,500 toneladas". */
const qty = (n, unit) => {
  const s = num(n);
  return `${s} ${esc(unit)}`;
};
const has = (v) => v != null && v !== "";

/** The provincia name for a provincia code (codes mean little to readers); the code itself when it is not on the map. */
const stateName = (m, ref) => m?.w?.raw?.states?.find((s) => s.abbr === ref || s.fips === ref)?.name || ref || ""; // abbr (CRD) or provincia code (131)
/** "Santiago" once, not "Santiago · Santiago", when a site's comuna and provincia are the same place. */
const place = (...parts) => [...new Set(parts.filter(has).map(String))].join(" · ");
/** A file's vintage for one part ("ports"), as a muted source line; "" when the file has none. */
function sourceLine(file, part, extra = "") {
  const v = file?.vintage;
  const text = typeof v === "object" && v ? v[part] : v;
  return [has(text) ? `Datos: ${esc(text)}. ` : "", extra].filter(Boolean).join("");
}

const HUB_NAME = { L: "Aeropuerto hub grande", M: "Aeropuerto hub mediano", S: "Aeropuerto hub pequeño", N: "Aeropuerto de pasajeros sin hub" };
const PORT_TYPE = { coastal: "Puerto marítimo", great_lakes: "Puerto lacustre", inland: "Puerto fluvial" };

export const tips = {
  port(p, m) {
    const inf = m.data.infrastructure;
    const unit = inf?.units?.tons || "toneladas";
    const lines = [`<b>${esc(p.name)}</b> ${muted(esc(place(PORT_TYPE[p.type] || (has(p.type) && /[^\x00-\x7f]/.test(p.type) ? p.type : "Puerto"), stateName(m, p.state))))}`];
    const rank = has(p.rank) ? `Lugar ${esc(p.rank)} por carga · ` : "";
    if (p.tons != null) lines.push(`${rank}<b>${qty(p.tons, unit)}</b>${has(p.year) ? ` (${esc(p.year)})` : ""}`);
    if (p.foreign != null || p.domestic != null) lines.push(`Internacional ${num(p.foreign)} · nacional ${num(p.domestic)}`);
    if (p.imports != null || p.exports != null) lines.push(`Importaciones ${num(p.imports)} · exportaciones ${num(p.exports)}`);
    lines.push(muted(sourceLine(inf, "ports", "El ícono marca el centro del área portuaria; en puertos alargados la posición es aproximada.")));
    return lines.join("<br>");
  },
  airport(a, m) {
    const inf = m.data.infrastructure;
    const title = [a.id, a.name].filter(has).map(esc).join(" · ");
    const lines = [`<b>${title}</b> ${muted(esc(place(a.city, stateName(m, a.state))))}`];
    if (a.hub) lines.push(esc(inf?.hubs?.[a.hub] || HUB_NAME[a.hub] || a.hub));
    else if (a.enplanements == null && a.cargo_lbs != null) lines.push("Aeropuerto de carga (fuera de las estadísticas de pasajeros)");
    if (a.enplanements != null) {
      let ch = "";
      if (a.enplanements_prev > 0 && Number.isFinite(+a.year)) {
        const r = a.enplanements / a.enplanements_prev - 1;
        ch = ` (${sign(r)}${Math.abs(r * 100).toFixed(1)}% frente a ${a.year - 1})`;
      }
      lines.push(`${has(a.year) ? `${esc(a.year)}: ` : ""}<b>${qty(a.enplanements, inf?.units?.enplanements || "pasajeros")}</b>${ch}`);
    }
    // The contract's key is cargo_lbs (pounds): the unit shown is the file's own when it states one.
    if (a.cargo_lbs != null) lines.push(`Carga ${qty(a.cargo_lbs, inf?.units?.cargo_lbs || inf?.units?.cargo || "lb")}`);
    const src = sourceLine(inf, "airports");
    if (src) lines.push(muted(src));
    return lines.join("<br>");
  },
  fort(f, m) {
    const mil = m.data.military;
    const comp = mil?.components?.find((c) => c.id === f.component);
    const name = comp?.name || FORT_KINDS[fortKind(f.component)]?.name || "Instalación militar";
    const tier = { major: "Base principal", base: "Base", site: "Puesto" }[f.tier] || "";
    const status = { act: "", semi: " · uso parcial", care: " · en mantención" }[f.status] ?? "";
    const lines = [
      `<b>${esc(f.name)}</b> ${muted(esc(stateName(m, f.state)))}`,
      `${esc(name)}${f.joint ? " · base conjunta" : ""}${tier ? ` · ${esc(tier)}` : ""}${esc(status)}`,
    ];
    if (f.area_km2 != null) lines.push(`Superficie ${int(f.area_km2)} km²`);
    lines.push(muted(sourceLine(mil, "installations", "El tamaño del ícono sigue la superficie, no la dotación.")));
    return lines.join("<br>");
  },
  range(r, m) {
    const mil = m.data.military;
    const comp = mil?.components?.find((c) => c.id === r.component);
    return [
      `<b>${esc(r.name)}</b> ${muted(esc(stateName(m, r.state)))}`,
      ["Zona restringida", comp?.name, r.area_km2 != null ? `${int(r.area_km2)} km²` : ""].filter(has).map(esc).join(" · "),
      muted(mil?.rules?.ranges ? esc(mil.rules.ranges) : "Se dibuja sobre los hexágonos que cubre."),
    ].join("<br>");
  },
  wonder(x, m) {
    const k = WONDER_KINDS[x.kind]?.name || "Maravilla";
    const rule = m.data.wonders?.rules?.find((r) => r.id === x.rule);
    const mt = x.metrics || {};
    const year = (y) => (has(y) ? ` (${esc(y)})` : "");
    const lines = [`<b>${esc(x.name)}</b> ${muted(esc(stateName(m, x.state)))}`];
    if (x.kind === "university") {
      lines.push(`${esc(k)}${has(x.rank) ? ` · lugar ${esc(x.rank)} por gasto en investigación` : ""}`);
      if (mt.rd_usd != null) lines.push(`I+D ${money(mt.rd_usd)}${year(mt.year)}${mt.federal_usd != null && mt.rd_usd > 0 ? `, ${pct(mt.federal_usd / mt.rd_usd, 0)} de fuente pública` : ""}`);
      if (mt.enrollment != null) lines.push(`${int(mt.enrollment)} estudiantes${year(mt.enrollment_year)}`);
    } else if (x.curated) {
      lines.push(`${esc(k)} · selección manual (no ordenada según datos)`);
      if (mt.visits != null) lines.push(`${qty(mt.visits, "visitas")}${year(mt.year)}`);
      if (mt.designated) lines.push(`Declarado en ${esc(mt.designated)}`);
    } else {
      lines.push(`${esc(k)}${has(x.rank) ? ` · lugar ${esc(x.rank)} por visitas` : ""}${mt.unit_type ? ` (${esc(mt.unit_type)})` : ""}`);
      if (mt.visits != null) lines.push(`<b>${qty(mt.visits, "visitas")}</b>${year(mt.year)}${mt.visits_of ? ` ${muted(`(${esc(mt.visits_of)})`)}` : ""}`);
      if (mt.area_km2 != null) lines.push(`${int(mt.area_km2)} km²`);
    }
    if (rule?.text) lines.push(muted(esc(rule.text)));
    return lines.join("<br>");
  },
  route(rt, m) {
    const r = rt.route;
    const t = m.data.trade || {};
    const a = rt.a?.short || rt.a?.name || r.a, b = rt.b?.short || rt.b?.name || r.b;
    const modeName = (k) => t.modes?.find?.((x) => x.id === k)?.name || MODE_STYLE[k]?.label || k;
    const modes = Object.entries(r.modes || {}).filter(([, v]) => v >= 0.05).sort((p, q) => q[1] - p[1])
      .map(([k, v]) => `${esc(modeName(k))} ${Math.round(v * 100)}%`).join(" · ");
    const com = t.commodities?.[r.top_commodity];
    const when = t.vintage || t.year;
    const lines = [
      `<b>${esc(a)} ⇄ ${esc(b)}</b> ${muted(has(r.rank) ? `Ruta comercial n.º ${esc(r.rank)}` : "Ruta comercial")}`,
      // Money when the file has it, with the weight after it; weight alone when it has no money.
      `Carga anual ${r.value_musd != null ? `<b>${money(r.value_musd * 1e6)}</b>${r.tons_k != null ? `, ${qty(r.tons_k * 1e3, "toneladas")}` : ""}` : r.tons_k != null ? `<b>${qty(r.tons_k * 1e3, "toneladas")}</b>` : "<b>–</b>"} (${has(when) ? `${esc(when)}, ` : ""}estimación)`,
    ];
    if (modes) lines.push(modes);
    if (com) lines.push(`Producto principal: ${esc(com)}`);
    lines.push(muted(t.path_note ? esc(t.path_note) : "Suma de ambos sentidos. El arco une la mayor comuna de cada zona y es solo ilustrativo: los datos registran dónde empieza y termina la carga, no su ruta."));
    return lines.join("<br>");
  },
};
