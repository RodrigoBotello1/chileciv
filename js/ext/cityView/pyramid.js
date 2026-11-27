// City View age pyramid: men to the left, women to the right, one bar per five-year band (citizens.json `age.pyramid`,
// bands in `age_bands`), each as a share of the comuna's population so comunas of any size compare with the country.
// The national pyramid is drawn over it as a stepped outline.
//
//   pyramidHtml(c, row, nat, bands, cap) → HTML   the SVG, the read-out line and the legend
//   mountPyramid(host)                             the hover / focus / tap read-out
import { esc, pct } from "../../format.js";
import { compact } from "./fmt.js";
import { T } from "../../terms.js";

const MEN = "#6f9fd8";
const WOMEN = "#d98c6a";
const W = 320, H = 196, MID = 40, TOP = 4, AXIS = 14;
const SIDE = (W - MID) / 2;
const shortBand = (b) => b.replace(" a ", "–").replace(" o más", "+");

/** Shares of the total per band for each sex: { men: [...], women: [...] }. */
export function pyramidShares(p) {
  const total = [...p.men, ...p.women].reduce((a, b) => a + b, 0) || 1;
  return { men: p.men.map((v) => v / total), women: p.women.map((v) => v / total), total };
}

/** A round axis limit at or above x (a share): 1%, 2%, 3%, 4%, 5%, 6%, 8%, 10% … */
export function niceMax(x) {
  const steps = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2];
  return steps.find((s) => s >= x) || Math.ceil(x * 10) / 10;
}

export function pyramidHtml(c, row, nat, bands, cap) {
  const me = pyramidShares(row.pyramid);
  const us = nat?.pyramid ? pyramidShares(nat.pyramid) : null;
  const n = bands.length;
  const max = niceMax(Math.max(...me.men, ...me.women, ...(us ? [...us.men, ...us.women] : [])));
  const bh = (H - TOP - AXIS) / n;
  const y = (i) => TOP + (n - 1 - i) * bh; // band 0 (0 a 4) at the bottom
  const len = (s) => (s / max) * SIDE;
  const bars = bands.map((b, i) => {
    const m = me.men[i], f = me.women[i];
    const tip = `${b} años: hombres ${pct(m, 1)}, mujeres ${pct(f, 1)}${us ? ` (${T.nationShort} ${pct(us.men[i], 1)} y ${pct(us.women[i], 1)})` : ""}`;
    return `<g class="cv-pyr-b" data-i="${i}" tabindex="0" role="img" aria-label="${esc(tip)}">
      <rect x="0" y="${y(i).toFixed(1)}" width="${W}" height="${bh.toFixed(1)}" fill="transparent"/>
      <rect x="${(SIDE - len(m)).toFixed(1)}" y="${(y(i) + 1).toFixed(1)}" width="${len(m).toFixed(1)}" height="${(bh - 2).toFixed(1)}" rx="1.5" fill="${MEN}"/>
      <rect x="${SIDE + MID}" y="${(y(i) + 1).toFixed(1)}" width="${len(f).toFixed(1)}" height="${(bh - 2).toFixed(1)}" rx="1.5" fill="${WOMEN}"/>
      <text x="${SIDE + MID / 2}" y="${(y(i) + bh / 2 + 3).toFixed(1)}" text-anchor="middle">${esc(shortBand(b))}</text>
    </g>`;
  }).join("");
  // National outline: a stepped line along the outer end of each band, one per side.
  const step = (shares, side) => shares.map((s, i) => {
    const x = side < 0 ? SIDE - len(s) : SIDE + MID + len(s);
    return `${i ? "L" : "M"}${x.toFixed(1)} ${(y(i) + bh).toFixed(1)} L${x.toFixed(1)} ${y(i).toFixed(1)}`;
  }).join(" ");
  const outline = us ? `<path class="cv-pyr-us" d="${step(us.men, -1)}"/><path class="cv-pyr-us" d="${step(us.women, 1)}"/>` : "";
  const half = max / 2;
  const ticks = [[SIDE - len(max), max], [SIDE - len(half), half], [SIDE, 0], [SIDE + MID, 0], [SIDE + MID + len(half), half], [SIDE + MID + len(max), max]]
    .map(([x, v]) => `<text class="cv-pyr-t" x="${x.toFixed(1)}" y="${H - 3}" text-anchor="middle">${v ? pct(v, 0) : "0"}</text>`).join("");
  const menAll = me.men.reduce((a, b) => a + b, 0);
  const label = `Pirámide de edades de ${c.name}: ${pct(menAll, 0)} hombres y ${pct(1 - menAll, 0)} mujeres${us ? `, con la de ${T.nationShort} superpuesta` : ""}`;
  return `<div class="cv-cz-row cv-pyr" data-pyr>
    <div class="cv-cz-h"><b>Pirámide de edades</b><span>% de la población en cada tramo de 5 años</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(label)}">${bars}${outline}${ticks}</svg>
    <div class="cv-cz-out" aria-live="polite" data-default="${esc(cap)}">${esc(cap)}</div>
    <div class="cv-cz-legend">
      <span class="cv-cz-k"><i style="background:${MEN}"></i>Hombres <small>${pct(menAll, 0)}</small></span>
      <span class="cv-cz-k"><i style="background:${WOMEN}"></i>Mujeres <small>${pct(1 - menAll, 0)}</small></span>
      ${us ? `<span class="cv-cz-k"><i class="cv-pyr-key"></i>${esc(T.NationShort)}</span>` : ""}
    </div>
  </div>`;
}

export function mountPyramid(host, c, row, nat, bands) {
  const el = host?.querySelector("[data-pyr]");
  if (!el) return;
  const out = el.querySelector(".cv-cz-out");
  const me = pyramidShares(row.pyramid);
  const us = nat?.pyramid ? pyramidShares(nat.pyramid) : null;
  let pinned = null;
  const show = (i) => {
    el.querySelectorAll(".cv-pyr-b").forEach((g) => g.classList.toggle("lit", g.dataset.i === String(i)));
    el.classList.toggle("focus", i != null);
    if (i == null) {
      out.textContent = out.dataset.default;
      out.classList.remove("on");
      return;
    }
    const people = row.pyramid.men[i] + row.pyramid.women[i];
    out.innerHTML = `${esc(bands[i])} años: ${compact(people)} personas, ${pct(me.men[i] + me.women[i], 1)} de ${esc(c.name)}<small>Hombres ${pct(me.men[i], 1)} · mujeres ${pct(me.women[i], 1)}${
      us ? ` · en ${esc(T.nationShort)} este tramo es el ${pct(us.men[i] + us.women[i], 1)}` : ""}</small>`;
    out.classList.add("on");
  };
  const idx = (e) => e.target.closest?.(".cv-pyr-b")?.dataset.i;
  el.addEventListener("pointerover", (e) => { const i = idx(e); if (i != null) show(Number(i)); });
  el.addEventListener("pointerleave", () => show(pinned));
  el.addEventListener("focusin", (e) => { const i = idx(e); if (i != null) show(Number(i)); });
  el.addEventListener("focusout", () => show(pinned));
  el.addEventListener("click", (e) => {
    const i = idx(e);
    if (i == null) return;
    pinned = pinned === Number(i) ? null : Number(i);
    show(pinned);
  });
}
