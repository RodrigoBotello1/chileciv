// Commute arcs: curved "flying" lines from the selected comuna to where its workers go (and, optionally, from where
// workers come). Drawn as a screen-space overlay above the banners. Pure drawing: index.js decides when.
import { SANS } from "../../fonts.js";
import { pct, compact } from "../../format.js";

export const OUT_COLOR = "#ffa23c";
export const IN_COLOR = "#5fd6cc";
const SEG = 40; // polyline segments per arc

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Points of a quadratic arc from a to b that bows upward; returns {pts, cum, len, c} (screen px). */
function arcPoints(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len, ny = dx / len;
  if (ny > 0) { nx = -nx; ny = -ny; } // bow towards the top of the screen
  const lift = Math.min(len * 0.4, 280); // control offset = 2 x apex height
  const c = { x: (a.x + b.x) / 2 + nx * lift, y: (a.y + b.y) / 2 + ny * lift, nx, ny };
  const pts = [], cum = [0];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG, u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
    if (i) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, len: cum[SEG], c };
}

function at(arc, d) {
  const { pts, cum } = arc;
  d = clamp(d, 0, arc.len);
  let i = 1;
  while (i < SEG && cum[i] < d) i++;
  const k = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  const p = pts[i - 1], q = pts[i];
  return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, ang: Math.atan2(q.y - p.y, q.x - p.x) };
}

function pill(ctx, x, y, text, color) {
  ctx.font = `700 11px ${SANS}`;
  const w = Math.ceil(ctx.measureText(text).width) + 10, h = 16;
  const r = { x: x - w / 2, y: y - h / 2, w, h };
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(r.x, r.y, w, h, 8) : ctx.rect(r.x, r.y, w, h);
  ctx.fillStyle = "rgba(18, 12, 6, 0.86)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#fff3d4";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
  return r;
}

const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * items: [{from:{x,y}, to:{x,y}, share, label, color, hot}]  (screen px; share scales the width)
 * opts: {t: ms, animate, zoom (0.85..1.5), view: {x0,y0,x1,y1}}
 */
export function drawArcs(ctx, items, { t = 0, animate = true, zoom = 1, view }) {
  const maxShare = Math.max(...items.map((i) => i.share), 1e-6);
  const arcs = items
    .map((it, k) => ({ it, k, arc: arcPoints(it.from, it.to) }))
    .filter((a) => a.arc.len >= 14);
  if (!arcs.length) return;
  const placed = [];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Draw the thinnest first so the thick (big share) arcs sit on top.
  arcs.sort((p, q) => p.it.share - q.it.share);
  for (const { it, k, arc } of arcs) {
    const w = (1.4 + 3.6 * Math.sqrt(it.share / maxShare)) * zoom;
    const head = 5 + w * 1.7;
    // The line stops where the arrowhead starts.
    const endD = Math.max(arc.len - head * 0.8, arc.len * 0.5);
    const path = new Path2D();
    path.moveTo(arc.pts[0].x, arc.pts[0].y);
    for (let i = 1; i <= SEG; i++) {
      if (arc.cum[i] >= endD) {
        const e = at(arc, endD);
        path.lineTo(e.x, e.y);
        break;
      }
      path.lineTo(arc.pts[i].x, arc.pts[i].y);
    }
    ctx.setLineDash([]);
    ctx.lineWidth = w + 2.5;
    ctx.strokeStyle = "rgba(20, 10, 0, 0.45)";
    ctx.stroke(path);
    ctx.lineWidth = w;
    ctx.strokeStyle = it.color;
    ctx.globalAlpha = 0.42;
    ctx.stroke(path);
    ctx.globalAlpha = 0.95;
    const dash = 7 * zoom, gap = 11 * zoom;
    ctx.setLineDash([dash, gap]);
    ctx.lineDashOffset = animate ? -((t / 1000) * 34 * (it.reverse ? -1 : 1)) : 0;
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // arrowhead at the destination
    const tip = at(arc, arc.len), back = at(arc, arc.len - head);
    const ang = Math.atan2(tip.y - back.y, tip.x - back.x);
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-head, -head * 0.5);
    ctx.lineTo(-head * 0.72, 0);
    ctx.lineTo(-head, head * 0.5);
    ctx.closePath();
    ctx.fillStyle = it.color;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(20, 10, 0, 0.7)";
    ctx.stroke();
    ctx.restore();

    // a glowing dot flying along the arc
    if (animate) {
      const period = 2600 + k * 230;
      const ph = (((t + k * 520) % period) / period);
      const d = (it.reverse ? 1 - ph : ph) * endD;
      const p = at(arc, d);
      const r = 2.2 + w * 0.55;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.2, 0, 7);
      ctx.fillStyle = it.color;
      ctx.globalAlpha = 0.28;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 7);
      ctx.fillStyle = "#fff6dc";
      ctx.fill();
    }
    it._arc = arc;
    it._w = w;
  }
  // Labels last, biggest share first, so the important ones win a crowded spot. The top three always draw.
  const byShare = [...arcs].sort((p, q) => q.it.share - p.it.share);
  const inView = (p) => !view || (p.x > view.x0 + 24 && p.x < view.x1 - 24 && p.y > view.y0 + 14 && p.y < view.y1 - 14);
  byShare.forEach(({ it, arc }, rank) => {
    const ts = [0.86, 0.72, 0.58, 0.44];
    for (const f of ts) {
      const d = arc.len * f - 6;
      const p = at(arc, d);
      if (!inView(p)) continue;
      // push the label off the line, away from the chord (towards the bow)
      const off = (it._w || 3) / 2 + 11;
      const px = p.x + arc.c.nx * off * 0.8, py = p.y + arc.c.ny * off * 0.8;
      ctx.font = `700 11px ${SANS}`;
      const w = Math.ceil(ctx.measureText(it.label).width) + 10;
      const r = { x: px - w / 2, y: py - 8, w, h: 16 };
      if (placed.some((q) => hit(r, q)) && rank >= 3) continue;
      if (placed.some((q) => hit(r, q)) && f !== ts[ts.length - 1]) continue;
      placed.push(pill(ctx, px, py, it.label, it.color));
      return;
    }
  });
  ctx.restore();
}

export const labelOut = (share) => pct(share, share >= 0.02 ? 0 : 1);
export const labelIn = (n) => compact(n);
