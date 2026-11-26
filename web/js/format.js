// Number formatting for the Santiago map: Spanish large-number words (mil, M = millones, mil M = miles de millones,
// billones = 1e12, the Spanish billón), US-style digit grouping and decimal point (1,234.5), and Chilean pesos.
// Yield / field units that say "usd" in the data contracts are CLP here.
const UNITS = [[1e12, " billones"], [1e9, " mil M"], [1e6, " M"], [1e3, " mil"]];
const LOCALE = "en-US";

export const CURRENCY = "$";
export const hasCJK = (s) => /[㐀-鿿豈-﫿]/.test(String(s ?? ""));

/** |n| in the unit at UNITS[i]: thousands read whole from 10 up ("48 mil", not "48.3 mil"); other units keep one
 *  decimal under 100 ("7.4 M"); ".0" is dropped. */
function inUnit(a, i) {
  const q = a / UNITS[i][0];
  const whole = q >= 100 || (UNITS[i][1] === " mil" && q >= 10);
  return q.toFixed(whole ? 0 : 1).replace(/\.0+$/, "");
}

export function compact(n) {
  if (n == null || Number.isNaN(n)) return "–";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  let i = UNITS.findIndex(([d]) => a >= d);
  if (i < 0) {
    if (Math.round(a) < 1e3) return Math.round(n).toLocaleString(LOCALE);
    i = UNITS.length - 1; // 999.6 rounds up into mil
  }
  let s = inUnit(a, i);
  if (i > 0 && Number(s) >= 1000) s = inUnit(a, --i); // 999.6 mil reads 1 M, never 1000 mil
  return sign + Number(s).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + UNITS[i][1];
}

export const money = (n) => (n == null || Number.isNaN(n) ? "–" : (n < 0 ? "-" : "") + CURRENCY + compact(Math.abs(n)));
export const dollars = (n) =>
  n == null || Number.isNaN(n) ? "–" : (n < 0 ? "-" : "") + CURRENCY + Math.round(Math.abs(n)).toLocaleString(LOCALE);
export const int = (n) => (n == null ? "–" : Math.round(n).toLocaleString(LOCALE));
export const pct = (x, d = 1) => (x == null ? "–" : (x * 100).toFixed(d) + "%");

export function yieldValue(y, v) {
  return y.unit === "usd" ? money(v) : compact(v);
}

/** Population on a banner: 568 mil, 7.4 M, 850. */
export const popShort = (n) => compact(n);

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
