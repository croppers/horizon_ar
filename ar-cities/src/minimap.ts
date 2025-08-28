import type { City, LatLon } from './types';
import { haversineDistanceKm, wrap180 } from './geo';

// Extremely simplified landmass polygons for major continents.
// Coordinates are [lon, lat]. This is intentionally low-res to keep payload tiny.
const LAND_POLYGONS: Array<Array<[number, number]>> = [
  // North America (very rough)
  [
    [-168, 72], [-140, 72], [-120, 70], [-95, 78], [-65, 83], [-52, 72], [-60, 60],
    [-75, 50], [-95, 45], [-110, 35], [-120, 30], [-125, 25], [-130, 30], [-140, 50], [-168, 72]
  ],
  // South America
  [
    [-81, 12], [-75, -4], [-70, -15], [-63, -22], [-54, -33], [-52, -47], [-38, -46], [-35, -8], [-59, 5], [-81, 12]
  ],
  // Europe (core)
  [
    [-10, 35], [0, 43], [10, 45], [20, 48], [24, 60], [30, 60], [40, 45], [30, 41], [19, 40], [10, 36], [-10, 35]
  ],
  // Scandinavia
  [
    [5, 58], [12, 62], [20, 66], [25, 70], [30, 70], [32, 65], [24, 60], [16, 58], [5, 58]
  ],
  // Africa
  [
    [-17, 37], [0, 35], [10, 34], [25, 31], [32, 24], [35, 15], [44, -10], [40, -20], [32, -35], [15, -35],
    [5, -25], [-5, -5], [-10, 10], [-17, 15], [-17, 37]
  ],
  // Middle East + West Asia (very rough)
  [
    [35, 33], [44, 36], [55, 35], [60, 40], [70, 45], [75, 35], [70, 25], [60, 24], [50, 20], [40, 25], [35, 33]
  ],
  // Central/East/Southeast Asia
  [
    [70, 45], [85, 50], [105, 50], [120, 45], [135, 48], [150, 45], [132, 25], [120, 20], [110, 15], [105, 10],
    [100, 8], [95, 12], [90, 15], [85, 20], [78, 8], [70, 25], [70, 45]
  ],
  // Japan + Korea (coarse)
  [
    [126, 37], [131, 39], [141, 43], [143, 41], [141, 36], [135, 34], [129, 33], [126, 37]
  ],
  // Australia
  [
    [113, -10], [153, -10], [153, -43], [114, -35], [113, -10]
  ],
  // Greenland
  [
    [-52, 72], [-40, 78], [-30, 82], [-20, 80], [-35, 70], [-45, 65], [-52, 72]
  ],
  // Antarctica (approximate northern edge)
  [
    [-180, -60], [-120, -60], [-60, -60], [0, -60], [60, -60], [120, -60], [180, -60], [-180, -60]
  ]
];

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

  // Land
  ctx.save();
  ctx.strokeStyle = 'rgba(120,160,120,0.6)';
  ctx.fillStyle = 'rgba(40,80,50,0.35)';
  ctx.lineWidth = 1;
  for (const poly of LAND_POLYGONS) {
    const first = projectEquirect(poly[0][0], poly[0][1], x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(first.px, first.py);
    for (let i = 1; i < poly.length; i++) {
      const { px, py } = projectEquirect(poly[i][0], poly[i][1], x, y, w, h);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

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


