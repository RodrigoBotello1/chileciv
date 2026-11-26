// The advisors' data model: three "levels" (states, metros, counties) of rows with typed fields, plus the links
// between rows and the hex map (row → highlight, cell → row). Built once from app.data (counties.json optional).
// In the Chile build, states = provincias (abbr = 3-letter code, fips = 3-digit province code such as "131"), counties = comunas
// (geoid = 5-digit comuna code such as "13101", whose first three digits are its provincia) and metros = the comunas as cities.
//
//   level = {id, label, noun, rows: [row], fields: [field], field(key), value(row, key),
//            highlight(rows, opts) → app.state.highlight, rowAtCell(cell) → row | null, focus(row), byKey: Map}
//   row   = {key, name, sub, level, ref, v: {fieldKey: value}}
//   field = {key, label, format, unit, higher_is, source, description, lens?, group, derived?}
// Labels, units and descriptions that come from the data files are shown as they are; the ones written here are for
// the columns this module derives.
import { fin, ratio } from "./util.js";
import { CURRENCY } from "../../../format.js";
import { frameBox } from "./frame.js";

const COUNTY_LENS = {
  density: "density", income: "income", home_value: "home", poverty: "poverty", median_age: "age", foreign_born: "foreign_born",
  bachelors: "bachelors", broadband: "broadband", commute: "commute", homeownership: "homeownership", uninsured: "uninsured",
  forest: "forest", developed: "developed",
  // community lenses of the original build (present only when lenses.json has them)
  faith: "faith", faith_tradition: "faith_tradition", amenities: "amenities", disasters: "disasters", veterans_pct: "veterans",
};
// County measures we can roll up to states and metros as population-weighted means.
const ROLLUP = ["density", "poverty", "median_age", "foreign_born", "bachelors", "broadband", "commute", "homeownership", "uninsured", "faith", "amenities"];
// Rolled-up means that only approximate the area's true value (a median, a quartile, a mean of rates or of an
// index). What a column measures differs by build (its key does not tell), so every weighted mean is marked;
// density alone is exact, being recomputed from the summed people and land.
const APPROX = new Set(ROLLUP.filter((k) => k !== "density"));
// County counts summed to states and metros, with their share recomputed from the implied denominators
// (count ÷ share = the county's base population), so the area's share is exact, not a mean of county shares.
const SUMS = [["veterans", "veterans_pct"], ["armed_forces", "armed_forces_pct"]];
const LAND_KEYS = ["forest", "crop", "pasture", "grass", "shrub", "wetland", "developed"];
export const LAND_LABEL = {
  forest: "Bosque", crop: "Cultivos", pasture: "Pastizal", grass: "Pradera", shrub: "Matorral", wetland: "Humedal", developed: "Zona urbanizada",
};
// Field groups (the headings of the Explorer's column picker).
const G = {
  economy: "Economía", people: "Población", prosperity: "Ingresos y vivienda", knowledge: "Educación", life: "Vida diaria", land: "Suelo", name: "Nombre",
  faith: "Fe", wellbeing: "Salud y bienestar", hazards: "Desastres", military: "Militar", yields: "Rendimientos", energy: "Energía", districts: "Distritos",
  citizens: "Habitantes", other: "Otros",
};
const paren = (s) => (s ? ` (${s})` : "");
export const LAND_COLOR = {
  forest: "#3f7a3a", crop: "#d2c457", pasture: "#93b852", grass: "#b9b06a", shrub: "#c9a874", wetland: "#4f9a86", developed: "#9a8f9e",
};
export { LAND_KEYS };

export function buildData(app) {
  const { cities = [], states = [], nation = {}, counties, resources, sources = [] } = app.data;
  const w = app.w;
  const grid = w.grid;
  const owner = w.raw.owner;
  const countyOf = w.raw.county || [];
  const n = grid.size;

  // --- cell indexes ---------------------------------------------------------------------------------------------
  const stateCells = new Map();
  const countyCells = new Map();
  for (let i = 0; i < n; i++) {
    const o = owner[i];
    if (!(o >= 0)) continue;
    if (!stateCells.has(o)) stateCells.set(o, []);
    stateCells.get(o).push(i);
    const c = countyOf[i];
    if (c >= 0) {
      if (!countyCells.has(c)) countyCells.set(c, []);
      countyCells.get(c).push(i);
    }
  }
  // cell → metro: footprints, smaller metros first so a bigger metro's majority wins; then every city's own cell.
  const cellMetro = new Map();
  for (let k = cities.length - 1; k >= 0; k--) for (const cell of cities[k].footprint || []) cellMetro.set(cell, cities[k]);
  for (const c of cities) if (c.cell != null) cellMetro.set(c.cell, c);

  const srcTitle = new Map(sources.map((s) => [s.id, s]));
  const nat = nation.nation || {};
  const vintage = nation.vintage || "";
  const countyVintage = counties?.vintage || "";

  // --- place references -----------------------------------------------------------------------------------------
  // A state (provincia) may be referred to by its abbr, its 3-digit code or its name; rows are keyed by the code (abbr).
  const stateList = Array.isArray(states) ? states : [];
  const stateRef = new Map();
  for (const list of [w.raw.states || [], stateList]) {
    list.forEach((s, i) => { for (const k of [s?.abbr, s?.fips, s?.name]) if (k != null && !stateRef.has(String(k))) stateRef.set(String(k), i); });
  }
  const stateNameAt = (i) => stateList[i]?.name || w.raw.states?.[i]?.name || "";
  const stateKeyAt = (i) => stateList[i]?.abbr ?? w.raw.states?.[i]?.abbr ?? null;
  /** Index of a county's state: from its `state` value (code or name), else from the first three digits of its geoid. */
  const countyState = (stateVal, geoid) => {
    let i = stateVal != null ? stateRef.get(String(stateVal)) : undefined;
    if (i == null && geoid != null) i = stateRef.get(String(geoid).slice(0, 3));
    return i ?? -1;
  };
  const cityIds = new Set(cities.map((c) => c.id));
  /** The city a county belongs to: its `cbsa` value, else the city whose id is its comuna code. */
  const countyCity = (cbsa, geoid) => {
    if (cbsa != null && cityIds.has(cbsa)) return cbsa;
    const code = geoid != null ? String(geoid).slice(0, 5) : null;
    return code != null && cityIds.has(code) ? code : cbsa ?? null;
  };
  /** The other states a city spans, by name. Empty when the city has the same name as its provincia, so no label
   *  prints the same name twice. */
  const cityStates = (c) => (c.states || [])
    .map((a) => { const i = stateRef.get(String(a)); return i != null ? stateNameAt(i) : String(a); })
    .filter((nm) => nm && nm !== c.name && nm !== c.full);

  // --- fields ---------------------------------------------------------------------------------------------------
  // A county column and the lens of the same measure share a key, or are paired in COUNTY_LENS.
  const lensFor = (k) => COUNTY_LENS[k] ?? (app.lensById?.has?.(k) ? k : null);
  const lensGroupName = new Map((app.data.lenses?.groups || []).map((g) => [g.id, g.name]));
  // lenses.json names its own groups: use those names for the same ids, so a column sits under one heading at every level.
  for (const id of Object.keys(G)) if (lensGroupName.has(id)) G[id] = lensGroupName.get(id);
  const lensGroupOf = (lensId) => { const l = lensId ? app.lensById?.get?.(lensId) : null; return (l && lensGroupName.get(l.group)) || null; };
  /** Group heading of a county column. What a column measures is decided by the data, not by its key, so the group
   *  of its lens in lenses.json comes first (a count goes with its share); then the fixed table below for columns
   *  without a lens; then the group of a lens built from the same source. */
  const groupFor = (k, source) => {
    const pair = SUMS.find(([n]) => n === k);
    const viaLens = lensGroupOf(lensFor(k)) || (pair ? lensGroupOf(lensFor(pair[1])) : null);
    if (viaLens) return viaLens;
    const g = groupOf(k);
    if (g !== G.other || !source) return g;
    for (const l of app.lensById?.values?.() || []) if (l.source === source && lensGroupName.get(l.group)) return lensGroupName.get(l.group);
    return g;
  };
  const incomeYear = nation.income_year ?? nat.income_year;
  const yrs = (nat.growth_years || []).join("–");
  // Source ids (sources.json): the Chile build's ids first, the original build's as a fallback. An id that
  // sources.json does not have simply cites nothing.
  const firstSource = (...ids) => ids.find((id) => id && srcTitle.has(id)) || ids.find(Boolean) || "";
  const SRC = {
    population: firstSource("ine_censo2024", "acs_1yr"), growth: firstSource("ine_censo2024", "pep_population"),
    gdp: firstSource("sii_empresas", "bea_gdp"), income: firstSource("acs_1yr"), labor: firstSource("sii_empresas", "acs_1yr"),
    land: firstSource("worldcover", "nlcd"),
  };
  // What the gold yield / gdp column really measures is told by nation.json (there is no official GDP by comuna).
  const goldNote = (nation.yields || []).find((y) => y.key === "gold")?.description || "";
  const F = (key, label, format, o = {}) => ({ key, label, format, unit: o.unit || null, higher_is: o.higher_is || "neutral", source: o.source || "", description: o.description || "", lens: o.lens || null, group: o.group || G.economy, derived: !!o.derived });
  const econFields = (src) => [
    F("population", "Población", "int", { unit: "habitantes", source: SRC.population, group: G.people, description: `Habitantes${paren(vintage)}.`, lens: "density" }),
    F("growth", "Crecimiento", "signed", { unit: "variación de la población", higher_is: "neutral", source: SRC.growth, group: G.people, description: `Variación de la población${yrs ? ` ${yrs}` : ""} (mismos límites comunales en ambos años).` }),
    F("gdp", "Ventas anuales", "money", { unit: `${CURRENCY} por año`, source: SRC.gdp, description: [nation.gdp_vintage ? `${nation.gdp_vintage}. ` : "", goldNote].filter(Boolean).join("") }),
    F("gdp_pc", "Ventas por habitante", "usd", { unit: `${CURRENCY} por habitante`, higher_is: "good", source: SRC.gdp, description: `Ventas${nat.gdp_year ? ` (${nat.gdp_year})` : ""} ÷ habitantes${paren(vintage)}; los años de referencia son distintos.` }),
    F("median_income", "Ingreso", "usd", { unit: "mediana del ingreso por hogar", higher_is: "good", source: SRC.income, group: G.prosperity, description: `Mediana del ingreso por hogar${incomeYear ? ` (${incomeYear})` : ""}.`, lens: "income" }),
    F("median_rent", "Arriendo", "usd", { unit: "mediana del arriendo mensual", source: SRC.income, group: G.prosperity, description: `Mediana del arriendo mensual${paren(vintage)}.` }),
    F("home_value", "Valor de la vivienda", "usd", { unit: "mediana del valor de la vivienda", source: SRC.income, group: G.prosperity, description: `Mediana del valor de la vivienda${paren(vintage)}.`, lens: "home" }),
    F("affordability", "Vivienda ÷ ingreso", "ratio", { unit: "años de ingreso", higher_is: "bad", group: G.prosperity, description: "Mediana del valor de la vivienda ÷ mediana del ingreso: cuántos años de ingreso cuesta una vivienda típica.", derived: true }),
    F("rent_burden", "Arriendo ÷ ingreso", "pct", { unit: "mediana del arriendo × 12 ÷ mediana del ingreso", higher_is: "bad", source: SRC.income, group: G.prosperity, description: "Mediana del arriendo mensual × 12 ÷ mediana del ingreso (cociente de medianas, no la proporción de arrendatarios con carga excesiva)." }),
    F("unemployment", "Desempleo", "pct", { unit: "desocupados ÷ fuerza de trabajo", higher_is: "bad", source: src, group: G.prosperity, description: `Desocupados ÷ fuerza de trabajo${paren(vintage)}.` }),
    F("employed", "Ocupados", "int", { unit: "personas", source: src, description: `Personas ocupadas${paren(vintage)}.` }),
    ...(nation.yields || []).filter((y) => y.unit !== "usd").map((y) => F(`y_${y.key}`, `${y.label}: ocupados`, "int", { unit: "personas", source: src, group: G.yields, description: y.description })),
  ];
  const rollupFields = () => counties ? [...ROLLUP.map((k) => {
    const f = counties.fields.find((x) => x.key === k);
    if (!f) return null;
    const approx = APPROX.has(k);
    return F(k, f.label + (approx ? " ≈" : ""), f.format, {
      unit: f.unit, higher_is: f.higher_is, source: f.source || "", group: groupFor(k, f.source), lens: lensFor(k),
      description: k === "density" ? `Población ÷ superficie, sumadas desde las comunas${paren(countyVintage)}.`
        : `${f.description || ""} Promedio de las comunas ponderado por población${approx ? " (aproximado, no es la cifra propia del área)" : ""}${!f.source ? paren(countyVintage) : ""}.`,
      derived: true,
    });
  }), ...SUMS.flatMap(([n, p]) => {
    const fn = counties.fields.find((x) => x.key === n), fp = counties.fields.find((x) => x.key === p);
    if (!fn || !fp) return [];
    return [
      F(n, fn.label, fn.format, { unit: fn.unit, source: fn.source, group: groupFor(n, fn.source), description: `${fn.description || ""} Suma de las comunas${paren(countyVintage)}.`, derived: true }),
      F(p, fp.label, fp.format, { unit: fp.unit, source: fp.source, group: groupFor(p, fp.source), lens: lensFor(p), description: `${fp.description || ""} Suma de personas de las comunas ÷ suma de sus poblaciones base${paren(countyVintage)}.`, derived: true }),
    ];
  })].filter(Boolean) : [];

  // --- roll-ups from counties -------------------------------------------------------------------------------------
  const roll = { states: new Map(), metros: new Map() };
  const cRows = [];
  if (counties) {
    const col = Object.fromEntries(counties.columns.map((k, j) => [k, j]));
    counties.rows.forEach((r, i) => cRows.push({ r, i }));
    const add = (map, key, r) => {
      if (key == null) return;
      let a = map.get(key);
      if (!a) map.set(key, (a = { pop: 0, land: 0, s: {}, wt: {}, n: {}, d: {}, dn: {}, dp: {}, zp: {} }));
      const pop = r[col.population];
      if (fin(pop)) a.pop += pop;
      if (fin(r[col.land_km2])) a.land += r[col.land_km2];
      for (const k of ROLLUP) {
        if (k === "density") continue;
        const v = r[col[k]];
        if (fin(v) && fin(pop) && pop > 0) {
          a.s[k] = (a.s[k] || 0) + v * pop;
          a.wt[k] = (a.wt[k] || 0) + pop;
        }
      }
      for (const [n, p] of SUMS) {
        if (col[n] == null) continue;
        const c = r[col[n]], s = col[p] != null ? r[col[p]] : null;
        if (!fin(c)) continue;
        a.n[n] = (a.n[n] || 0) + c;
        // A county with a zero count (share 0) has no implied base: it is estimated from its population at the
        // base-to-population ratio of the other counties (if every county is zero the share stays null, not 0).
        if (fin(s) && s > 0) {
          a.d[n] = (a.d[n] || 0) + c / s;
          a.dn[n] = (a.dn[n] || 0) + c;
          if (fin(pop)) a.dp[n] = (a.dp[n] || 0) + pop;
        } else if (c === 0 && fin(pop)) a.zp[n] = (a.zp[n] || 0) + pop;
      }
    };
    for (const { r } of cRows) {
      add(roll.states, stateKeyAt(countyState(r[col.state], r[col.geoid])), r);
      add(roll.metros, countyCity(r[col.cbsa], r[col.geoid]), r);
    }
  }
  const rolled = (map, key) => {
    const a = map.get(key);
    const out = {};
    if (!a) return out;
    out.density = a.land > 0 ? a.pop / a.land : null;
    out.land_km2 = a.land || null;
    for (const k of ROLLUP) if (k !== "density") out[k] = a.wt[k] ? a.s[k] / a.wt[k] : null;
    for (const [n, p] of SUMS) {
      out[n] = a.n[n] ?? null;
      const zeroBase = a.zp[n] && a.dp[n] ? (a.zp[n] * a.d[n]) / a.dp[n] : 0;
      out[p] = a.d[n] > 0 ? a.dn[n] / (a.d[n] + zeroBase) : null;
    }
    return out;
  };

  const econValues = (o) => ({
    population: o.population ?? null,
    growth: o.growth ?? null,
    gdp: o.gdp ?? o.yields?.gold ?? null,
    gdp_pc: ratio(o.gdp ?? o.yields?.gold, o.population),
    median_income: o.median_income ?? null,
    median_rent: o.median_rent ?? null,
    home_value: o.home_value ?? null,
    affordability: ratio(o.home_value, o.median_income),
    rent_burden: o.rent_burden ?? null,
    unemployment: o.unemployment ?? null,
    employed: o.employed ?? null,
    ...Object.fromEntries((nation.yields || []).filter((y) => y.unit !== "usd").map((y) => [`y_${y.key}`, o.yields?.[y.key] ?? null])),
  });

  // --- resources by place ---------------------------------------------------------------------------------------
  const items = resources?.items || [];
  const typeById = new Map((resources?.types || []).map((t) => [t.id, t]));
  const mwByMetro = new Map();
  items.forEach((it) => {
    if (typeById.get(it.type)?.unit !== "MW" || !fin(it.value) || !it.cbsa) return;
    mwByMetro.set(it.cbsa, (mwByMetro.get(it.cbsa) || 0) + it.value);
  });

  // --- states ---------------------------------------------------------------------------------------------------
  // sub is empty: the ISO code says little to a reader (it stays available as v.abbr and as the row key).
  const stateRows = stateList.map((s, idx) => ({
    key: s.abbr, name: s.name, sub: "", level: "states", ref: idx,
    v: {
      name: s.name, abbr: s.abbr, ...econValues(s), ...rolled(roll.states, s.abbr),
      ...Object.fromEntries(LAND_KEYS.map((k) => [`land_${k}`, s.land?.[k] ?? null])),
      energy_mw: s.energy ? s.energy.total : null,
    },
  }));
  const landSource = SRC.land;
  const areaSource = counties?.fields?.find((f) => f.key === "land_km2")?.source || "";
  const powerSource = (resources?.types || []).find((t) => t.unit === "MW" && t.source)?.source || "";
  const landFields = LAND_KEYS.map((k) => F(`land_${k}`, LAND_LABEL[k], "pct", { unit: "% de la superficie", source: landSource, group: G.land, description: `Proporción del suelo con "${LAND_LABEL[k]}" (promedio de los hexágonos del área).`, lens: k === "forest" ? "forest" : k === "developed" ? "developed" : null }));
  const energyField = () => F("energy_mw", "Potencia en el mapa", "mw", { unit: "MW de las centrales del mapa", source: powerSource, group: G.energy, description: "Capacidad de las centrales marcadas como recurso en el mapa (de cada tipo solo cuentan las que superan el umbral): no es la capacidad instalada total." });
  const areaField = () => F("land_km2", "Superficie", "km2", { unit: "km²", source: areaSource, group: G.land, derived: true });
  const states_ = makeLevel({
    id: "states", label: "Provincia", noun: "provincia",
    rows: stateRows,
    fields: [F("name", "Provincia", "text", { group: G.name }), ...econFields(SRC.labor), ...rollupFields(), areaField(), ...landFields, energyField()],
    highlight: (rows) => ({ states: new Set(rows.map((r) => r.ref)) }),
    rowAtCell: (cell, byKey) => (owner[cell] >= 0 ? stateRows[owner[cell]] || null : null),
    focus: (row) => app.selectState(row.ref, { fly: true }),
    cellsOf: (row) => stateCells.get(row.ref) || [],
  });

  // --- metros ---------------------------------------------------------------------------------------------------
  const metroRows = cities.map((c) => {
    const sub = cityStates(c).join(", ");
    return {
      key: c.id, name: c.name, sub, level: "metros", ref: c,
      v: {
        name: c.name, states: sub || null, kind: c.metro === false ? "Área urbana menor" : "Área urbana",
        ...econValues(c), ...rolled(roll.metros, c.id), energy_mw: mwByMetro.size ? mwByMetro.get(c.id) ?? 0 : null, // no power plants on the map at all: no column
      },
    };
  });
  const metroByCity = new Map(metroRows.map((r) => [r.ref, r]));
  // "Provincia" and "Tipo" only say something when a city spans other states or the file tells two kinds apart.
  const metroNameFields = [
    F("name", "Comuna", "text", { group: G.name }),
    ...(metroRows.some((r) => r.sub) ? [F("states", "Provincia", "text", { group: G.name })] : []),
    ...(cities.some((c) => c.metro === false) ? [F("kind", "Tipo", "text", { group: G.name, description: "Clasificación de la comuna en el archivo de datos: área urbana o área urbana menor." })] : []),
  ];
  const metros = makeLevel({
    id: "metros", label: "Comuna", noun: "comuna",
    rows: metroRows,
    fields: [...metroNameFields, ...econFields(SRC.labor), ...rollupFields(), areaField(), energyField()],
    highlight: (rows, o = {}) => {
      const cells = new Set();
      for (const r of rows) for (const c of r.ref.footprint || [r.ref.cell]) cells.add(c);
      return { cells, cities: rows.length <= (o.ringMax ?? 30) ? new Set(rows.map((r) => r.key)) : undefined };
    },
    rowAtCell: (cell) => { const c = cellMetro.get(cell); return c ? metroByCity.get(c) : null; },
    focus: (row) => app.selectCity(row.ref, { fly: true }),
    cellsOf: (row) => row.ref.footprint || [row.ref.cell],
  });

  // --- counties ---------------------------------------------------------------------------------------------------
  let counties_ = null;
  if (counties) {
    const cols = counties.columns;
    const cityName = new Map(cities.map((c) => [c.id, c.name]));
    // counties.json carries the faith_tradition category id; tables and filters read better with its name.
    const tradName = new Map((app.lensById?.get("faith_tradition")?.categories || []).map((c) => [c.id, c.name]));
    const countyRows = cRows.map(({ r, i }) => {
      const v = {};
      cols.forEach((k, j) => (v[k] = r[j]));
      const st = countyState(v.state, v.geoid);
      // The state column shows the provincia name whatever the file holds (code or name); `state` keeps its index.
      if (st >= 0) v.state = stateNameAt(st) || v.state;
      v.cbsa = countyCity(v.cbsa, v.geoid);
      v.metro = v.cbsa ? cityName.get(v.cbsa) || null : null;
      if (v.faith_tradition != null) v.faith_tradition = tradName.get(v.faith_tradition) || v.faith_tradition;
      return { key: v.geoid, name: shortCounty(v.name), full: v.name, sub: v.state ?? "", state: st, level: "counties", ref: i, v };
    });
    // counties.json rows follow world.json counties; map by geoid anyway in case they ever diverge.
    const worldIdx = new Map((w.raw.counties || []).map((c, k) => [c.geoid, k]));
    for (const row of countyRows) row.ref = worldIdx.get(row.key) ?? row.ref;
    const rowByWorld = new Map(countyRows.map((r) => [r.ref, r]));
    // Counties smaller than a hex own no cell: counties.json `cell` (the hex nearest the county's centre) stands in.
    const cellsOfRow = (r) => countyCells.get(r.ref) || (Number.isInteger(r.v.cell) ? [r.v.cell] : []);
    const fields = counties.fields.filter((f) => f.key !== "cbsa" && f.key !== "geoid" && f.key !== "cell").map((f) => ({
      ...F(f.key, f.key === "name" ? "Comuna" : f.key === "state" ? "Provincia" : f.label, f.format, { unit: f.unit, higher_is: f.higher_is, source: f.source, description: f.description, lens: lensFor(f.key), group: groupFor(f.key, f.source) }),
    }));
    // The city column repeats the provincia column when every city is its own state: add it only when it says more.
    if (countyRows.some((r) => r.v.metro && r.v.metro !== r.v.state)) {
      const at = Math.max(0, fields.findIndex((f) => f.key === "state")) + 1;
      fields.splice(at, 0, F("metro", "Ciudad", "text", { group: G.name, description: "Ciudad a la que pertenece la comuna (si está en el mapa)." }));
    }
    counties_ = makeLevel({
      id: "counties", label: "Comuna", noun: "comuna",
      rows: countyRows, fields,
      highlight: (rows) => {
        const cells = new Set();
        for (const r of rows) for (const c of cellsOfRow(r)) cells.add(c);
        return { cells };
      },
      rowAtCell: (cell) => (countyOf[cell] >= 0 ? rowByWorld.get(countyOf[cell]) || null : null),
      focus: (row) => {
        let cells = cellsOfRow(row);
        // A county smaller than a hex owns no cell: frame its metro instead, or open its state.
        if (!cells.length && row.v.cbsa) cells = cities.find((c) => c.id === row.v.cbsa)?.footprint || [];
        if (!cells.length) return row.state >= 0 ? app.selectState(row.state, { fly: true }) : undefined;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of cells) {
          const x = grid.cx(c), y = grid.cy(c);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        const R = grid.R * 6;
        frameBox(app, { x0: x0 - R, y0: y0 - R, x1: x1 + R, y1: y1 + R }, { pad: 24, maxScale: 2.4 });
      },
      cellsOf: (row) => cellsOfRow(row),
    });
  }

  const countiesOffMap = counties_ ? counties_.rows.filter((r) => !counties_.cellsOf(r).length).length : 0; // no hex, not even a stand-in
  return {
    app, nation, nat, vintage, countyVintage, countiesOffMap,
    levels: { states: states_, metros, counties: counties_ },
    stateCells, countyCells, cellMetro, metroByCity,
    items, typeById,
    source: (id) => srcTitle.get(id) || null,
  };
}

/** The short form of a county name for tables and chart labels. Comuna names (Providencia, Las Condes) are short already;
 *  a Latin "… County" is still abbreviated, as in the original. */
export function shortCounty(name) {
  return String(name || "").replace(/ County$/, " Co.").replace(/ Parish$/, " Par.");
}

/** A row's name as one label: a comuna with its provincia in front, anything else by its own name. */
export function placeLabel(row) {
  if (!row) return "";
  const name = row.full || row.name || "";
  return row.level === "counties" && row.sub && !name.startsWith(row.sub) ? `${row.sub}${name}` : name;
}

function groupOf(k) {
  if (["population", "density", "median_age", "foreign_born", "growth"].includes(k)) return G.people;
  if (["income", "home_value", "poverty", "homeownership", "uninsured"].includes(k)) return G.prosperity;
  if (["bachelors", "broadband"].includes(k)) return G.knowledge;
  if (["commute"].includes(k)) return G.life;
  if (["forest", "crop", "pasture", "developed", "land_km2"].includes(k)) return G.land;
  if (["name", "name_en", "state", "metro"].includes(k)) return G.name;
  if (["faith", "faith_tradition"].includes(k)) return G.faith;
  if (["amenities", "mhlth", "loneliness"].includes(k)) return G.wellbeing;
  if (["disasters"].includes(k)) return G.hazards;
  if (["armed_forces", "armed_forces_pct"].includes(k)) return G.military;
  return G.other;
}

function makeLevel(def) {
  const fieldByKey = new Map(def.fields.map((f) => [f.key, f]));
  const byKey = new Map(def.rows.map((r) => [r.key, r]));
  // field.empty: no row has a value for it (e.g. incomes and rents, which this build does not have). field(key)
  // still returns such a field; pickers and tables should leave it out instead of showing a column of "–".
  const markEmpty = () => {
    for (const f of def.fields) {
      f.empty = !def.rows.some((r) => (f.format === "text" ? r.v[f.key] != null && r.v[f.key] !== "" : fin(r.v[f.key])));
    }
  };
  markEmpty();
  return {
    ...def,
    byKey,
    field: (k) => fieldByKey.get(k) || null,
    value: (row, k) => row.v[k] ?? null,
    /** True when the field exists and at least one row has a value for it. */
    has: (k) => { const f = fieldByKey.get(k); return !!f && !f.empty; },
    numericFields: () => def.fields.filter((f) => f.format !== "text" && !f.empty),
    markEmpty,
    /** Add fields after the fact (optional files that load on demand); a key already present is skipped. */
    addFields(list) {
      for (const f of list) {
        if (fieldByKey.has(f.key)) continue;
        def.fields.push(f);
        fieldByKey.set(f.key, f);
      }
    },
  };
}

// --- fields from files that load on demand ------------------------------------------------------------------------
// extendData(data, names) loads the named files (military, districts, citizens) through app.loadData and adds their
// columns to the levels once per data model. Missing files (null) add nothing. Returns the loaded files by name.
const F4 = (key, label, format, o = {}) => ({ key, label, format, unit: o.unit || null, higher_is: o.higher_is || "neutral", source: o.source || "", description: o.description || "", lens: o.lens || null, group: o.group || G.other, derived: !!o.derived });

export async function extendData(data, names) {
  const app = data.app;
  const files = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await app.loadData(n).catch(() => null)])));
  data.extended ??= new Set();
  for (const n of names) {
    if (data.extended.has(n) || !files[n]) continue;
    data.extended.add(n);
    try {
      if (n === "military") extendMilitary(data, files[n]);
      if (n === "districts") extendDistricts(data, files[n]);
      if (n === "citizens") extendCitizens(data, files[n]);
    } catch (err) {
      console.error(`advisors: could not add the ${n} columns`, err);
    }
  }
  for (const lv of Object.values(data.levels)) lv?.markEmpty?.();
  return files;
}

function extendMilitary(data, mil) {
  const { states, metros } = data.levels;
  const v = mil.vintage || {};
  const instBy = (k) => {
    const m = new Map();
    for (const it of mil.installations || []) if (it[k]) m.set(it[k], (m.get(it[k]) || 0) + 1);
    return m;
  };
  const byState = instBy("state"), byMetro = instBy("cbsa");
  const src = { personnel: "dmdc_personnel", spending: "oldcc_spending" };
  states.addFields([
    F4("mil_active", "Militares en servicio", "int", { unit: "personas, según provincia de destino", source: src.personnel, group: G.military, description: `Personal en servicio de todas las ramas, según provincia de destino${paren(v.personnel)}.` }),
    F4("mil_guard_reserve", "Reservistas", "int", { unit: "personas", source: src.personnel, group: G.military, description: `Reservistas de cada provincia${paren(v.personnel)}.` }),
    F4("mil_civilian", "Civiles de defensa", "int", { unit: "personas", source: src.personnel, group: G.military, description: `Personal civil del sector defensa, según provincia de trabajo${paren(v.personnel)}.` }),
    F4("def_spending", "Gasto en defensa", "money", { unit: `${CURRENCY} por año`, source: src.spending, group: G.military, description: `Compras, transferencias y remuneraciones de defensa dentro de la provincia${paren(v.spending)}. Las compras se cuentan donde se ejecuta el contrato, no donde está la base.` }),
    F4("def_per_resident", "Gasto en defensa por habitante", "usd", { unit: `${CURRENCY} por habitante`, source: src.spending, group: G.military, description: `Gasto en defensa ÷ habitantes${paren(v.spending)}.` }),
    F4("def_pct_gdp", "Gasto en defensa como % del PIB", "pct", { unit: "% del PIB de la provincia", source: src.spending, group: G.military, description: `Gasto en defensa ÷ PIB de la provincia${paren(v.spending)}.` }),
    F4("installations", "Instalaciones militares", "int", { unit: "instalaciones", source: "mirta", group: G.military, description: `Instalaciones militares dentro de la provincia${paren(v.installations)}. No son comparables en tamaño: una instalación puede ser una oficina o un campo de entrenamiento.` }),
  ]);
  for (const r of states.rows) {
    const s = mil.states?.[r.key];
    const p = s?.personnel, sp = s?.spending;
    Object.assign(r.v, {
      mil_active: p?.active?.total ?? null, mil_guard_reserve: p?.guard_reserve?.total ?? null, mil_civilian: p?.civilian?.total ?? null,
      def_spending: sp?.total ?? null, def_per_resident: sp?.per_resident ?? null, def_pct_gdp: sp?.pct_gdp ?? null,
      installations: s ? byState.get(r.key) || 0 : null,
    });
  }
  metros.addFields([
    F4("encampment", "Nivel de campamento", "text", { source: "mirta", group: G.military, description: `"Fortaleza" o "Guarnición" cuando la comuna cumple la regla de campamento; vacío en otro caso. ${mil.rules?.encampment || mil.rule || ""}` }),
    F4("installations", "Instalaciones militares", "int", { unit: "instalaciones", source: "mirta", group: G.military, description: `Instalaciones militares dentro de la comuna${paren(v.installations)}. No son comparables en tamaño.` }),
  ]);
  for (const r of metros.rows) {
    const c = mil.cities?.[r.key];
    r.v.encampment = c ? (c.tier === "fortress" ? "Fortaleza" : "Guarnición") + (c.naval ? " (naval)" : "") : null;
    r.v.installations = byMetro.get(r.key) || 0;
  }
}

function extendDistricts(data, d) {
  const { metros, counties } = data.levels;
  const cat = new Map((d.catalog || []).map((c) => [c.id, c]));
  const vint = d.vintage || "";
  const dsrc = (d.sources || [])[0] || "";
  const lb = (x) => (x?.lower_bound ? " (al menos)" : "");
  const maxPer = d.rule?.max_per_city;
  metros.addFields([
    F4("city_type", "Tipo de comuna", "text", { source: dsrc, group: G.districts, description: `Título de la comuna: se nombra por su distrito más fuerte; si una especialidad pesa en el empleo mucho más que en la región, se usa el título de esa especialidad${paren(vint)}. Vacío significa que ningún distrito llega al umbral (industria diversa).` }),
    F4("districts", "Distritos", "text", { source: dsrc, group: G.districts, description: `Distritos industriales que la comuna alcanza, del más fuerte al más débil. ${d.rule?.text || ""}` }),
    F4("n_districts", "Número de distritos", "int", { source: dsrc, group: G.districts, description: `Distritos que alcanzan el umbral${maxPer ? ` (máximo ${maxPer})` : ""}.` }),
    // What these count (by workplace or by residence, employees or all workers) differs by build: the file's vintage and note say.
    F4("qcew_jobs", "Empleo por rubro", "int", { unit: "personas", source: dsrc, group: G.districts, description: `Empleo total de la comuna en la estadística por rubro usada para definir los distritos${paren(vint)}. ${d.note || ""}` }),
    F4("qcew_pay", "Remuneración anual media", "usd", { unit: `${CURRENCY} por persona al año`, source: dsrc, group: G.districts, description: `Remuneración anual media por ocupado en la misma estadística por rubro${paren(vint)}.` }),
    F4("top_industry", "Rubro más especializado", "text", { source: dsrc, group: G.districts, description: "Entre los rubros detallados que reunió este proyecto, el de mayor cociente de localización con empleo sobre el umbral." }),
    F4("top_lq", "Su cociente de localización", "lq", { unit: "× proporción del empleo regional", source: dsrc, group: G.districts, description: "Cociente de localización del rubro más especializado: su proporción del empleo de la comuna ÷ su proporción del empleo de la región. Es un piso cuando hay datos reservados." }),
  ]);
  for (const r of metros.rows) {
    const c = d.cities?.[r.key];
    const top = c?.top?.[0];
    Object.assign(r.v, {
      city_type: c?.badge?.label ?? null,
      districts: c ? (c.districts || []).map((x) => cat.get(x.id)?.name || x.id).join(", ") || null : null,
      n_districts: c ? (c.districts || []).length : null,
      qcew_jobs: c?.emp ?? null, qcew_pay: c?.avg_pay ?? null,
      top_industry: top ? `${d.industries?.[top.naics]?.title || top.naics}${lb(top)}` : null,
      top_lq: top?.lq ?? null,
    });
  }
  if (counties && d.counties) {
    counties.addFields([
      F4("districts", "Distritos", "text", { source: dsrc, group: G.districts, description: `Distritos industriales que la comuna alcanza, del más fuerte al más débil${paren(vint)}. ${d.rule?.county_note || ""}` }),
      F4("qcew_jobs", "Empleo por rubro", "int", { unit: "personas", source: dsrc, group: G.districts, description: `Empleo total de la comuna en la estadística por rubro usada para definir los distritos${paren(vint)}.` }),
    ]);
    for (const r of counties.rows) {
      const c = d.counties[r.key];
      r.v.districts = c ? (c.districts || []).map((x) => cat.get(x[0])?.name || x[0]).join(", ") || null : null;
      r.v.qcew_jobs = c?.emp ?? null;
    }
  }
}

// Citizens: a few telling shares of each row of citizens.json (the City View draws the whole mix as person icons).
// The third entry is only the fallback label: the file's own group labels are used when it has them. A category the
// file does not have gets no column.
const CZ = [
  ["workforce", "executive", "Directivos y gerentes"], ["workforce", "engineer", "Ingenieros y científicos"], ["workforce", "healer", "Personal de salud"],
  ["workforce", "service", "Trabajadores de servicios"], ["workforce", "farmer", "Agricultura, silvicultura y pesca"], ["workforce", "builder", "Construcción y mantención"],
  ["workforce", "maker", "Producción y transporte"],
  ["age", "child", "Niños"], ["age", "young", "Jóvenes"], ["age", "elder", "Adultos mayores"],
  ["commute", "drove_alone", "Maneja solo"], ["commute", "transit", "Transporte público"], ["commute", "walk", "A pie"], ["commute", "home", "Trabaja en casa"],
  ["education", "graduate", "Posgrado"],
  ["nativity", "born_in_state", "Nacidos en la provincia"], ["nativity", "foreign_born", "Nacidos fuera de la región"],
];
function extendCitizens(data, cz) {
  const { metros } = data.levels;
  const vint = cz.vintage || "";
  // Which of the file's sources a row comes from: a per-row id in the file when it has one (`row_sources`), else the
  // file's source that also backs the matching township column (age, education), else the first source no other row
  // claimed (the occupation survey for the workforce row); a file with one source cites it for every row.
  const srcs = cz.sources || [];
  const kin = { age: "median_age", education: "bachelors", nativity: "foreign_born", commute: "commute" };
  const viaColumn = (row) => { const id = data.levels.counties?.field(kin[row])?.source; return id && srcs.includes(id) ? id : null; };
  const claimed = new Set(Object.keys(kin).map(viaColumn).filter(Boolean));
  const rest = srcs.find((id) => !claimed.has(id)) || srcs[0] || "";
  const srcOf = (row) => cz.row_sources?.[row] || (srcs.length > 1 ? viaColumn(row) || rest : srcs[0] || "");
  const csrc = rest;
  const label = new Map(Object.entries(cz.groups || {}).flatMap(([row, list]) => list.map((g) => [`${row}.${g.key}`, g.label])));
  const rowDesc = cz.rows || {};
  const rowName = { workforce: "ocupados", age: "población", commute: "quienes se desplazan al trabajo", education: "población adulta", nativity: "población" };
  const grp = { workforce: `${G.citizens}: trabajo`, age: `${G.citizens}: edad`, commute: `${G.citizens}: traslado`, education: `${G.citizens}: educación`, nativity: `${G.citizens}: lugar de nacimiento` };
  const minRatio = cz.rule?.specialist_high;
  // The columns are the categories the file itself lists (cz.groups: every row and key, with its own label); a file
  // without that list falls back to the fixed table above, keeping the categories some city has a share for.
  const pairs = cz.groups
    ? Object.entries(cz.groups).flatMap(([row, list]) => (list || []).map((g) => [row, g.key, g.label || g.key]))
    : CZ.filter(([row, key]) => Object.values(cz.cities || {}).some((c) => c?.[row]?.shares?.[key] != null));
  const used = new Set();
  const cols = pairs.map(([row, key, lbl]) => {
    let k = `cz_${key}`;
    if (used.has(k)) k = `cz_${row}_${key}`; // the same key in two rows
    used.add(k);
    return { row, key, lbl, k };
  });
  metros.addFields([
    ...cols.map(({ row, lbl, k }) => F4(k, lbl, "pct", {
      unit: `% de ${rowName[row] || "el total de la categoría"}`, source: srcOf(row), group: grp[row] || G.citizens,
      description: `${lbl}: proporción dentro de "${rowDesc[row] || rowName[row] || row}"${paren(vint)}. Vacío cuando la fuente no tiene el área.${row === "commute" ? " El denominador son los ocupados, no todos los habitantes." : ""}`,
    })),
    F4("cz_median_age", "Edad mediana (comuna)", "years", { unit: "años", source: srcOf("age"), group: grp.age, description: `Edad mediana de los habitantes${paren(vint)}: la mediana de la propia comuna, no una aproximación sumada desde otras áreas.` }),
    F4("cz_degree", "Educación superior", "pct", { unit: "% de la población adulta", source: srcOf("education"), group: grp.education, description: `Proporción de adultos con título universitario o más${paren(vint)}.` }),
    F4("cz_specialist", "Categoría más marcada", "text", { source: csrc, group: G.citizens, description: `Categoría cuya proporción más supera a la regional${fin(minRatio) ? ` (al menos ${minRatio} veces)` : ""}. ${cz.rule?.text || ""}` }),
  ]);
  for (const r of metros.rows) {
    const c = cz.cities?.[r.key];
    for (const { row, key, k } of cols) r.v[k] = c?.[row]?.shares?.[key] ?? null;
    r.v.cz_median_age = c?.age?.median ?? null;
    r.v.cz_degree = c?.education?.bachelors_plus ?? r.v.cz_degree ?? null;
    const sp = (c?.specialists || []).find((s) => s.ratio >= 1);
    r.v.cz_specialist = sp ? `${label.get(`${sp.row}.${sp.key}`) || sp.key} ×${sp.ratio.toFixed(1)}${c.reliable === false ? " (muestra pequeña, solo referencial)" : ""}` : null;
  }
}

/** The highlight for a set of rows of one level, with defaults (gold outline, other land dimmed when asked). */
export function rowsHighlight(level, rows, opts = {}) {
  if (!level || !rows || !rows.length) return null;
  const one = rows.length === 1 ? rows[0] : null;
  const label = opts.label ?? (one ? (one.level === "counties" ? placeLabel(one) : `${one.full || one.name}${one.sub ? ` (${one.sub})` : ""}`) : "");
  return { ...level.highlight(rows, opts), dimOthers: !!opts.dim, color: opts.color, label };
}
