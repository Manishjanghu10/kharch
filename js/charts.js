/* Minimal canvas charts -- no external library, so the app stays fully
   offline-installable with nothing to fetch from a CDN. */

const PALETTE = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#eab308", "#ec4899", "#84cc16", "#f97316"];

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

// entries: [{label, value}], sorted desc by caller if desired
function drawDonut(canvas, entries) {
  const { ctx, w, h } = fitCanvas(canvas);
  if (w <= 0 || h <= 0) return; // canvas is hidden (e.g. Month tab not active yet)
  ctx.clearRect(0, 0, w, h);
  const total = entries.reduce((s, e) => s + e.value, 0);
  const cx = w / 2, cy = h / 2;
  const outerR = Math.min(w, h) / 2 - 4;
  const innerR = outerR * 0.6;

  if (total <= 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(147,168,156,0.25)";
    ctx.lineWidth = outerR - innerR;
    ctx.stroke();
    return;
  }

  let start = -Math.PI / 2;
  entries.forEach((e, i) => {
    const slice = (e.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, start, start + slice);
    ctx.arc(cx, cy, innerR, start + slice, start, true);
    ctx.closePath();
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.fill();
    start += slice;
  });

  ctx.fillStyle = "#e8f0ec";
  ctx.font = "600 13px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Total", cx, cy - 8);
  ctx.fillText("₹" + Math.round(total).toLocaleString("en-IN"), cx, cy + 10);
}

// entries: [{label, value}], oldest first
function drawTrendBars(canvas, entries) {
  const { ctx, w, h } = fitCanvas(canvas);
  if (w <= 0 || h <= 0) return;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...entries.map((e) => e.value));
  const padBottom = 22, padTop = 16, padSide = 8;
  const plotH = h - padBottom - padTop;
  const slotW = (w - padSide * 2) / entries.length;
  const barW = Math.min(34, slotW * 0.5);

  entries.forEach((e, i) => {
    const cx = padSide + slotW * i + slotW / 2;
    const barH = (e.value / max) * plotH;
    const y = padTop + (plotH - barH);
    ctx.fillStyle = i === entries.length - 1 ? "#22c55e" : "rgba(34,197,94,0.45)";
    ctx.beginPath();
    const r = Math.min(6, barW / 2);
    ctx.moveTo(cx - barW / 2, y + barH);
    ctx.lineTo(cx - barW / 2, y + r);
    ctx.arcTo(cx - barW / 2, y, cx - barW / 2 + r, y, r);
    ctx.lineTo(cx + barW / 2 - r, y);
    ctx.arcTo(cx + barW / 2, y, cx + barW / 2, y + r, r);
    ctx.lineTo(cx + barW / 2, y + barH);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#93a89c";
    ctx.font = "11px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(e.label, cx, h - 6);
  });
}

window.Charts = { drawDonut, drawTrendBars, PALETTE };
