import { azimuthToScreenX, estimateVfovDeg, isWithinFov, edgeSide, pitchToScreenY } from './projection';
import { haversineDistanceKm, initialBearingDeg, wrap180 } from './geo';
import type { City, RendererInput } from './types';

interface Rect { x: number; y: number; w: number; h: number; }

const keyOf = (c: City) => `${c.name}|${c.country}`;

// Module-local alpha state for fades
const labelAlpha: Map<string, number> = new Map();

function updateAlpha(targetVisible: Set<string>, dt: number) {
  const fadeInPerSec = 4; // alpha/sec
  const fadeOutPerSec = 3;
  const keys = new Set([...labelAlpha.keys(), ...targetVisible.keys()]);
  for (const k of keys) {
    const cur = labelAlpha.get(k) ?? 0;
    const vis = targetVisible.has(k);
    const next = vis ? Math.min(1, cur + fadeInPerSec * dt) : Math.max(0, cur - fadeOutPerSec * dt);
    if (next <= 0 && !vis) labelAlpha.delete(k); else labelAlpha.set(k, next);
  }
}

function measureLabel(ctx: CanvasRenderingContext2D, text: string): { w: number; h: number } {
  const m = ctx.measureText(text);
  const h = (m.actualBoundingBoxAscent || 12) + (m.actualBoundingBoxDescent || 4);
  const w = m.width + 12;
  return { w, h };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export interface RenderResult { visibleCount: number; }

export function render(ctx: CanvasRenderingContext2D, input: RendererInput, now: number, lastNowRef: { v: number }): RenderResult {
  const { width, height, hfovDeg, pitchDeg, headingDeg, cities, user, units, maxDistanceKm } = input;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if (ctx.canvas.width !== Math.floor(width * dpr) || ctx.canvas.height !== Math.floor(height * dpr)) {
    ctx.canvas.width = Math.floor(width * dpr);
    ctx.canvas.height = Math.floor(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Background horizon band
  const vfovDeg = estimateVfovDeg(hfovDeg, width, height);
  const horizonY = pitchToScreenY(pitchDeg, vfovDeg, height);
  ctx.save();
  ctx.strokeStyle = 'rgba(180,200,220,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(width, horizonY);
  ctx.stroke();
  ctx.restore();

  // Prepare cities with distances and bearings
  const kmToMi = 0.621371;
  const candidates = cities.map((c) => {
    const distKm = haversineDistanceKm(user.lat, user.lon, c.lat, c.lon);
    return {
      c,
      distKm,
      bearing: initialBearingDeg(user.lat, user.lon, c.lat, c.lon)
    };
  }).filter((x) => x.distKm <= maxDistanceKm);

  // Sort by population desc to declutter
  candidates.sort((a, b) => b.c.population - a.c.population);

  const placed: Rect[] = [];
  const visibleKeys: Set<string> = new Set();
  const maxLabelHeight = 22;

  // Time delta for fade animation
  const dt = lastNowRef.v ? Math.min(0.1, (now - lastNowRef.v) / 1000) : 0;
  lastNowRef.v = now;

  for (const item of candidates) {
    const key = keyOf(item.c);
    const deltaAz = wrap180(item.bearing - headingDeg);
    const offscreen = !isWithinFov(deltaAz, hfovDeg);

    // Compose text
    const dist = units === 'km' ? item.distKm : item.distKm * kmToMi;
    const distStr = dist >= 100 ? Math.round(dist).toString() : dist.toFixed(1);
    const pop = item.c.population;
    const popStr = pop >= 1_000_000 ? `~${(pop/1_000_000).toFixed(1)}M` : `~${Math.round(pop/1000)}k`;
    const text = `${item.c.name}, ${item.c.country} — ${distStr} ${units} — Pop ${popStr}`;

    ctx.font = '600 14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    const { w, h } = measureLabel(ctx, text);

    let x = azimuthToScreenX(deltaAz, hfovDeg, width);
    const y = Math.max(0, Math.min(height - maxLabelHeight, horizonY - 6));

    // Declutter: skip if box overlaps a placed box
    const rect: Rect = { x: Math.max(4, Math.min(width - w - 4, x - w / 2)), y: y - h, w, h };

    if (!offscreen) {
      if (placed.some((p) => rectsOverlap(p, rect))) {
        continue;
      }
      placed.push(rect);
      visibleKeys.add(key);

      const alpha = labelAlpha.get(key) ?? 0;
      if (alpha <= 0.01) continue;

      // Label background
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      const r = 6;
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
      ctx.fill();
      // Text
      ctx.fillStyle = 'white';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 2;
      ctx.fillText(text, rect.x + 6, rect.y + rect.h - 6);
      ctx.restore();
    } else {
      visibleKeys.add(key); // still animate alpha for edge indicator
      const alpha = labelAlpha.get(key) ?? 0;
      if (alpha <= 0.01) continue;
      const side = edgeSide(deltaAz);
      const margin = 6;
      const chevronY = Math.max(12, Math.min(height - 12, horizonY));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (side === 'left') {
        ctx.moveTo(margin, chevronY);
        ctx.lineTo(margin + 10, chevronY - 6);
        ctx.moveTo(margin, chevronY);
        ctx.lineTo(margin + 10, chevronY + 6);
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillText(text, margin + 16, chevronY + 5);
      } else {
        ctx.moveTo(width - margin, chevronY);
        ctx.lineTo(width - margin - 10, chevronY - 6);
        ctx.moveTo(width - margin, chevronY);
        ctx.lineTo(width - margin - 10, chevronY + 6);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(text, width - margin - 16, chevronY + 5);
      }
      ctx.restore();
    }
  }

  updateAlpha(visibleKeys, dt);

  return { visibleCount: placed.length };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
