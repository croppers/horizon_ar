import { azimuthToScreenX, estimateVfovDeg, isWithinFov, edgeSide, pitchToScreenY } from './projection';
import { haversineDistanceKm, initialBearingDeg, wrap180 } from './geo';
import type { City, RendererInput } from './types';
import { drawCoastlines } from './coastlines';

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
  // Use a fixed line height to ensure consistent stacking across browsers
  const fixedLineHeight = 24; // px
  const w = m.width + 12; // horizontal padding
  return { w, h: fixedLineHeight };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

// Try to find a vertical position for a rect that doesn't overlap existing ones.
// Starts at rect.y and searches upward first, then downward, in row-sized steps.
function findNonOverlappingY(rect: Rect, placed: Rect[], height: number, maxSteps = 12): number | null {
  const tried = new Set<number>();
  const step = Math.max(12, rect.h + 6);
  const baseY = rect.y;

  const candidates: number[] = [baseY];
  for (let i = 1; i <= maxSteps; i++) candidates.push(baseY - i * step);
  for (let i = 1; i <= maxSteps; i++) candidates.push(baseY + i * step);

  for (let y of candidates) {
    y = Math.max(0, Math.min(height - rect.h, y));
    if (tried.has(y)) continue;
    tried.add(y);
    const test: Rect = { x: rect.x, y, w: rect.w, h: rect.h };
    if (!placed.some((p) => rectsOverlap(p, test))) return y;
  }
  return null;
}

export interface RenderResult { visibleCount: number; }

export function render(ctx: CanvasRenderingContext2D, input: RendererInput, now: number, lastNowRef: { v: number }): RenderResult {
  const { width, height, hfovDeg, pitchDeg, headingDeg, cities, user, units, maxDistanceKm, showOffscreenIndicators, showMinimap } = input;
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
  const edgeLeftPlaced: Rect[] = [];
  const edgeRightPlaced: Rect[] = [];
  const visibleKeys: Set<string> = new Set();
  const maxLabelHeight = 24;

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
    const yBase = Math.max(0, Math.min(height - maxLabelHeight, horizonY - 6));

    // Initial desired rect centered on azimuth, anchored above horizon
    const rect: Rect = { x: Math.max(4, Math.min(width - w - 4, x - w / 2)), y: yBase - h, w, h };

    if (!offscreen) {
      const maxSteps = Math.ceil(height / (rect.h + 6)) + 2;
      const yPlaced = findNonOverlappingY(rect, placed, height, maxSteps);
      if (yPlaced === null) continue;
      rect.y = yPlaced;
      placed.push({ ...rect });
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
      if (!showOffscreenIndicators) {
        // Do not show offscreen indicators when disabled, but keep alpha animation in sync
        visibleKeys.add(key);
        continue;
      }
      visibleKeys.add(key); // still animate alpha for edge indicator
      const alpha = labelAlpha.get(key) ?? 0;
      if (alpha <= 0.01) continue;
      const side = edgeSide(deltaAz);
      const margin = 6;
      // Build a lightweight rect for vertical placement along the edges
      const edgeRect: Rect = side === 'left'
        ? { x: margin, y: Math.max(0, Math.min(height - h, horizonY - h / 2)), w, h }
        : { x: width - margin - w, y: Math.max(0, Math.min(height - h, horizonY - h / 2)), w, h };
      const used = side === 'left' ? edgeLeftPlaced : edgeRightPlaced;
      const maxStepsEdge = Math.ceil(height / (edgeRect.h + 6)) + 2;
      const yPlaced = findNonOverlappingY(edgeRect, used, height, maxStepsEdge);
      if (yPlaced === null) continue;
      edgeRect.y = yPlaced;
      used.push({ ...edgeRect });

      const centerY = edgeRect.y + edgeRect.h / 2;
      const textY = edgeRect.y + edgeRect.h - 6;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (side === 'left') {
        ctx.moveTo(margin, centerY);
        ctx.lineTo(margin + 10, centerY - 6);
        ctx.moveTo(margin, centerY);
        ctx.lineTo(margin + 10, centerY + 6);
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillText(text, margin + 16, textY);
      } else {
        ctx.moveTo(width - margin, centerY);
        ctx.lineTo(width - margin - 10, centerY - 6);
        ctx.moveTo(width - margin, centerY);
        ctx.lineTo(width - margin - 10, centerY + 6);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(text, width - margin - 16, textY);
      }
      ctx.restore();
    }
  }

  updateAlpha(visibleKeys, dt);

  // Draw coastlines inset (bottom-right)
  if (showMinimap !== false) {
    const pad = 8;
    const wMini = Math.min(240, Math.floor(width * 0.5));
    const hMini = Math.min(140, Math.floor(height * 0.35));
    const xMini = width - pad - wMini;
    const yMini = height - pad - hMini;
    drawCoastlines({
      ctx,
      x: xMini,
      y: yMini,
      w: wMini,
      h: hMini,
      userLon: user.lon,
      userLat: user.lat,
      headingDeg,
      hfovDeg: hfovDeg,
      maxDistanceKm,
      styles: { stroke: 'rgba(255,255,255,0.45)', fill: 'rgba(60,90,70,0.25)', lineWidth: 0.8, alpha: 1 }
    });
  }

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
