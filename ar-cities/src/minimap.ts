import type { City, LatLon } from './types';
import { haversineDistanceKm, wrap180 } from './geo';

// Land/sea mask (0.1° grid) loader from public/surfrac0.1.PPS
// Supports PGM/PPM (P5/P6/P2/P3) and a simple ASCII grid fallback.
const LAND_MASK_URL = './surfrac0.1.PPS';
let landMaskCanvas: HTMLCanvasElement | null = null;
let landMaskLoading = false;

function parseHeaderTokens(text: string): { tokens: string[]; headerLen: number } {
  // Remove comments (# ... endline) and split by whitespace
  let header = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '#') {
      // skip to end of line
      while (i < text.length && text[i] !== '\n') i++;
    } else {
      header += ch;
    }
    i++;
    // Stop once we likely consumed magic + dims + maxval
    if (header.split(/\s+/).filter(Boolean).length >= 6 && header.includes('\n')) {
      // heuristic break; actual cut determined later
      if (header.length > 256) break;
    }
  }
  const tokens = header.trim().split(/\s+/);
  return { tokens, headerLen: header.length };
}

async function ensureLandMask(): Promise<void> {
  if (landMaskCanvas || landMaskLoading) return;
  landMaskLoading = true;
  try {
    const res = await fetch(LAND_MASK_URL, { cache: 'force-cache' });
    if (!res.ok) throw new Error('failed to fetch land mask');
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Try to parse as binary PGM/PPM (P5/P6)
    const headerText = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(2048, bytes.length)));
    if (headerText.startsWith('P5') || headerText.startsWith('P6') || headerText.startsWith('P2') || headerText.startsWith('P3')) {
      const { tokens, headerLen } = parseHeaderTokens(headerText);
      const magic = tokens[0];
      let idx = 1;
      const width = parseInt(tokens[idx++], 10);
      const height = parseInt(tokens[idx++], 10);
      const maxval = parseInt(tokens[idx++], 10) || 255;
      if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('invalid PNM dims');
      const isAscii = magic === 'P2' || magic === 'P3';
      const isColor = magic === 'P6' || magic === 'P3';
      let gray: Uint8ClampedArray;
      if (!isAscii) {
        // Binary: data starts after headerLen (approx). Find actual start by seeking first byte after maxval newline.
        // Find the first '\n' after occurrences of magic, dims, maxval accounting for comments.
        let dataStart = headerText.indexOf('\n', headerText.indexOf(String(maxval))) + 1;
        if (dataStart <= 0) dataStart = headerLen; // best-effort
        const data = bytes.subarray(dataStart);
        const bytesPerPixel = isColor ? 3 : 1;
        const expected = width * height * bytesPerPixel * (maxval < 256 ? 1 : 2);
        if (data.length < expected) throw new Error('PNM data truncated');
        gray = new Uint8ClampedArray(width * height);
        if (maxval < 256) {
          if (isColor) {
            for (let i = 0, j = 0; i < gray.length; i++, j += 3) {
              // luminance
              gray[i] = (data[j] * 0.2126 + data[j + 1] * 0.7152 + data[j + 2] * 0.0722) & 0xff;
            }
          } else {
            gray.set(data.subarray(0, gray.length));
          }
        } else {
          // 16-bit
          const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
          if (isColor) {
            let o = 0;
            for (let i = 0; i < gray.length; i++) {
              const r = dv.getUint16(o); o += 2;
              const g = dv.getUint16(o); o += 2;
              const b = dv.getUint16(o); o += 2;
              const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
              gray[i] = Math.round((y / maxval) * 255);
            }
          } else {
            let o = 0;
            for (let i = 0; i < gray.length; i++) {
              const v = dv.getUint16(o); o += 2;
              gray[i] = Math.round((v / maxval) * 255);
            }
          }
        }
      } else {
        // ASCII P2/P3
        const text = new TextDecoder('ascii').decode(bytes);
        // Remove comments, then split tokens
        const cleaned = text.replace(/#.*$/gm, ' ');
        const parts = cleaned.trim().split(/\s+/);
        // parts: magic, w, h, maxval, then samples
        const start = 4;
        gray = new Uint8ClampedArray(width * height);
        if (magic === 'P2') {
          for (let i = 0; i < gray.length; i++) {
            const v = parseFloat(parts[start + i]) || 0;
            gray[i] = Math.max(0, Math.min(255, Math.round((v / maxval) * 255)));
          }
        } else {
          // P3 RGB ascii
          for (let i = 0, j = start; i < gray.length; i++, j += 3) {
            const r = parseFloat(parts[j]) || 0;
            const g = parseFloat(parts[j + 1]) || 0;
            const b = parseFloat(parts[j + 2]) || 0;
            const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            gray[i] = Math.max(0, Math.min(255, Math.round((y / maxval) * 255)));
          }
        }
      }
      // Build mask canvas (downsample aggressively for perf)
      const targetW = 1024;
      const targetH = Math.max(1, Math.round((targetW * height) / width));
      const canvas = document.createElement('canvas');
      canvas.width = targetW; canvas.height = targetH;
      const cctx = canvas.getContext('2d')!;
      const img = cctx.createImageData(targetW, targetH);
      for (let ty = 0; ty < targetH; ty++) {
        const sy = Math.floor((ty / targetH) * height);
        for (let tx = 0; tx < targetW; tx++) {
          const sx = Math.floor((tx / targetW) * width);
          const v = gray[sy * width + sx];
          const land = v >= 128; // threshold at 0.5
          const o = (ty * targetW + tx) * 4;
          img.data[o] = land ? 100 : 0;
          img.data[o + 1] = land ? 180 : 0;
          img.data[o + 2] = land ? 120 : 0;
          img.data[o + 3] = land ? 220 : 0; // alpha
        }
      }
      cctx.putImageData(img, 0, 0);
      landMaskCanvas = canvas;
      return;
    }
    // Fallback: try ASCII grid of floats (0..1). We'll sample by scanning lines.
    const text = new TextDecoder('utf-8').decode(bytes);
    const values = text.trim().split(/\s+/);
    // Heuristic dims for 0.1°: 3600x1800
    const width = 3600, height = 1800;
    const total = width * height;
    const targetW = 1024;
    const targetH = Math.max(1, Math.round((targetW * height) / width));
    const canvas = document.createElement('canvas');
    canvas.width = targetW; canvas.height = targetH;
    const cctx = canvas.getContext('2d')!;
    const img = cctx.createImageData(targetW, targetH);
    // Sample nearest for speed
    for (let ty = 0; ty < targetH; ty++) {
      const sy = Math.floor((ty / targetH) * height);
      for (let tx = 0; tx < targetW; tx++) {
        const sx = Math.floor((tx / targetW) * width);
        const idx = sy * width + sx;
        const v = parseFloat(values[idx]) || 0;
        const land = v >= 0.5;
        const o = (ty * targetW + tx) * 4;
        img.data[o] = land ? 100 : 0;
        img.data[o + 1] = land ? 180 : 0;
        img.data[o + 2] = land ? 120 : 0;
        img.data[o + 3] = land ? 220 : 0;
      }
    }
    cctx.putImageData(img, 0, 0);
    landMaskCanvas = canvas;
  } catch {
    // ignore; fallback will draw nothing
  } finally {
    landMaskLoading = false;
  }
}

interface MinimapParams {
  canvasWidth: number;
  canvasHeight: number;
  user: LatLon;
  headingDeg: number;
  hfovDeg: number;
  maxDistanceKm: number;
  cities: City[];
  // Placement & size
  x: number;
  y: number;
  w: number;
  h: number;
}

function projectEquirect(lon: number, lat: number, x: number, y: number, w: number, h: number): { px: number; py: number } {
  const px = x + ((lon + 180) / 360) * w;
  const py = y + ((90 - lat) / 180) * h;
  return { px, py };
}

function toRad(deg: number): number { return (deg * Math.PI) / 180; }
function toDeg(rad: number): number { return (rad * 180) / Math.PI; }

function destinationPoint(latDeg: number, lonDeg: number, bearingDeg: number, distanceKm: number): { lat: number; lon: number } {
  const R = 6371; // km
  const δ = distanceKm / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(latDeg);
  const λ1 = toRad(lonDeg);
  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ), cosδ = Math.cos(δ);
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawMinimap(ctx: CanvasRenderingContext2D, p: MinimapParams) {
  const { x, y, w, h, user, headingDeg, hfovDeg, maxDistanceKm, cities } = p;

  // Background card
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = 'rgba(10,12,14,0.7)';
  drawRoundedRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.restore();

  // Land/sea mask layer
  if (!landMaskCanvas && !landMaskLoading) {
    // kick off load without blocking
    void ensureLandMask();
  }
  if (landMaskCanvas) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.drawImage(landMaskCanvas, 0, 0, landMaskCanvas.width, landMaskCanvas.height, x, y, w, h);
    ctx.restore();
  }

  // User point
  const up = projectEquirect(user.lon, user.lat, x, y, w, h);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(up.px, up.py, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Radius circle (geodesic approximated)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const steps = 128;
  for (let i = 0; i <= steps; i++) {
    const brg = (i / steps) * 360;
    const pt = destinationPoint(user.lat, user.lon, brg, maxDistanceKm);
    const pr = projectEquirect(pt.lon, pt.lat, x, y, w, h);
    if (i === 0) ctx.moveTo(pr.px, pr.py); else ctx.lineTo(pr.px, pr.py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // FOV wedge (two rays out to radius)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,220,120,0.7)';
  ctx.fillStyle = 'rgba(255,220,120,0.15)';
  ctx.lineWidth = 1;
  const leftBrg = wrap180(headingDeg - hfovDeg / 2);
  const rightBrg = wrap180(headingDeg + hfovDeg / 2);
  const pLeft = destinationPoint(user.lat, user.lon, leftBrg, maxDistanceKm);
  const pRight = destinationPoint(user.lat, user.lon, rightBrg, maxDistanceKm);
  const pl = projectEquirect(pLeft.lon, pLeft.lat, x, y, w, h);
  const pr = projectEquirect(pRight.lon, pRight.lat, x, y, w, h);
  ctx.beginPath();
  ctx.moveTo(up.px, up.py);
  ctx.lineTo(pl.px, pl.py);
  ctx.lineTo(pr.px, pr.py);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Cities: draw small dots, highlight those within radius and within FOV
  ctx.save();
  for (const c of cities) {
    const d = haversineDistanceKm(user.lat, user.lon, c.lat, c.lon);
    const visibleRadius = d <= maxDistanceKm;
    const { px, py } = projectEquirect(c.lon, c.lat, x, y, w, h);
    let alpha = 0.25;
    let color = 'rgba(180,220,255,'; // will append alpha
    if (visibleRadius) {
      // Check if within current HFOV (by bearing difference)
      const dy = c.lat - user.lat;
      const dx = c.lon - user.lon;
      // Rough bearing using equirectangular approximation (sufficient for wedge inclusion on small map)
      const bearing = (Math.atan2(
        Math.sin(toRad(dx)) * Math.cos(toRad(c.lat)),
        Math.cos(toRad(user.lat)) * Math.sin(toRad(c.lat)) - Math.sin(toRad(user.lat)) * Math.cos(toRad(c.lat)) * Math.cos(toRad(dx))
      ) * 180) / Math.PI;
      const delta = Math.abs(wrap180(bearing - headingDeg));
      if (delta <= hfovDeg / 2) {
        alpha = 0.9;
        color = 'rgba(255,255,255,';
      } else {
        alpha = 0.6;
        color = 'rgba(120,180,255,';
      }
    }
    ctx.fillStyle = `${color}${alpha})`;
    ctx.fillRect(px - 1, py - 1, 2, 2);
  }
  ctx.restore();
}


