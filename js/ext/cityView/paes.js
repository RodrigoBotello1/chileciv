// City View "PAES" block (paes.json): the comuna's mean PAES score against the national one, and one row per school
// type. Figures are by the comuna of the school, not where the students live; a type with few test takers is hidden.
import { esc, int } from "../../format.js";
import { meter } from "./charts.js";

const TYPES = [["pagado", "Particular pagado"], ["subvencionado", "Particular subvencionado"], ["publico", "Público (municipal y SLEP)"]];
const MIN_TYPE = 10; // test takers a school type needs in the comuna to get a row
const MIN_COMUNA = 30; // below this the comuna mean is too noisy to compare with the nation

/** HTML of the PAES block for the model's city; "" when the comuna has no PAES data. data = paes.json (or null). */
export function paesHtml(m, data) {
  const rec = data?.comunas?.[m.city.id];
  if (!rec || !rec.n) return "";
  const nat = data.national;
  const max = 1000;
  const row = (label, n, mean, tick, big) => `
    <div class="cv-stat">
      <div class="cv-stat-top"><span class="sl">${esc(label)}</span>
        <span class="sv"><b>${int(Math.round(mean))}</b><small>${int(n)} rindentes${big ? ` · país ${int(Math.round(nat.mean))}` : ""}</small></span></div>
      ${meter(mean, tick, max, "high")}
    </div>`;
  const rows = TYPES.map(([k, label]) => {
    const d = rec.by_dep?.[k];
    return d && d.n >= MIN_TYPE ? row(label, d.n, d.mean, nat.by_dep?.[k]?.mean ?? nat.mean, false) : "";
  }).join("");
  const head = rec.n >= MIN_COMUNA
    ? row("Puntaje promedio (Lectora y M1)", rec.n, rec.mean, nat.mean, true)
    : `<p class="cv-note">Solo ${int(rec.n)} rindentes: muy pocos para dar un promedio de la comuna.</p>`;
  return `
    <h4 class="cv-h4">PAES <span class="muted">${esc(data.vintage?.match(/Admisión \d{4}/)?.[0] || "")}</span></h4>
    <div class="cv-stats">${head}${rows}</div>
    <p class="cv-note">Promedio de Competencia Lectora y Matemática 1 de los egresados del año que rindieron la PAES regular. Es por la comuna del colegio, no de residencia. La marca en cada barra es el promedio nacional de ese tipo de colegio. Se ocultan los tipos con menos de ${MIN_TYPE} rindentes.</p>`;
}
