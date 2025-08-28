import type { City, LatLon } from './types';
import { haversineDistanceKm, wrap180 } from './geo';
import { feature, mesh } from 'topojson-client';

// Data source: Natural Earth via unpkg world-atlas (under permissive terms)
// We fetch small-scale (110m) data for low payload.
const LAND_TOPO_URL = 'https://unpkg.com/world-atlas@2/land-110m.json';
const COUNTRIES_TOPO_URL = 'https://unpkg.com/world-atlas@2/countries-110m.json';

let loadWorldPromise: Promise<void> | null = null;
let cachedLand: GeoJSON.MultiPolygon | GeoJSON.Polygon | null = null;
let cachedCountriesMesh: GeoJSON.MultiLineString | GeoJSON.LineString | null = null;

async function loadWorld(): Promise<void> {
  if (cachedLand && cachedCountriesMesh) return;
  if (loadWorldPromise) return loadWorldPromise;
  loadWorldPromise = (async () => {
    const [landRes, countriesRes] = await Promise.all([
      fetch(LAND_TOPO_URL, { cache: 'force-cache' }),
      fetch(COUNTRIES_TOPO_URL, { cache: 'force-cache' })
    ]);
    if (!landRes.ok || !countriesRes.ok) throw new Error('Failed to load world atlas');
    const [landTopo, countriesTopo] = await Promise.all([landRes.json(), countriesRes.json()]);
    const landFeat: any = feature(landTopo, (landTopo.objects as any).land);
    cachedLand = landFeat as any;
    const countriesMesh: any = mesh(countriesTopo, (countriesTopo.objects as any).countries, (a: any, b: any) => a !== b);
    cachedCountriesMesh = countriesMesh as any;
  })();
  try {
    await loadWorldPromise;
  } finally {
    // keep promise for subsequent awaiters until caches set; then null out
    loadWorldPromise = null;
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

function drawGeoJSONPolygon(ctx: CanvasRenderingContext2D, geom: GeoJSON.Polygon, x: number, y: number, w: number, h: number) {
  for (const ring of geom.coordinates) {
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      const { px, py } = projectEquirect(lon, lat, x, y, w, h);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
}

function drawGeoJSONMultiPolygon(ctx: CanvasRenderingContext2D, geom: GeoJSON.MultiPolygon, x: number, y: number, w: number, h: number) {
  for (const poly of geom.coordinates) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        const { px, py } = projectEquirect(lon, lat, x, y, w, h);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  }
}

function drawGeoJSONMultiLineString(ctx: CanvasRenderingContext2D, geom: GeoJSON.MultiLineString | GeoJSON.LineString, x: number, y: number, w: number, h: number) {
  const lines = (geom.type === 'LineString') ? [geom.coordinates] : geom.coordinates;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const [lon, lat] = line[i];
      const { px, py } = projectEquirect(lon, lat, x, y, w, h);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  }
}

export async function drawMinimap(ctx: CanvasRenderingContext2D, p: MinimapParams) {
  const { x, y, w, h, user, headingDeg, hfovDeg, maxDistanceKm, cities } = p;

  // Background card
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = 'rgba(10,12,14,0.7)';
  drawRoundedRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.restore();

  // Load world data on first draw
  try { await loadWorld(); } catch {}

  // Land fill
  if (cachedLand) {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,160,120,0.6)';
    ctx.fillStyle = 'rgba(40,80,50,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (cachedLand.type === 'Polygon') drawGeoJSONPolygon(ctx, cachedLand, x, y, w, h);
    else drawGeoJSONMultiPolygon(ctx, cachedLand as GeoJSON.MultiPolygon, x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Country boundaries overlay (semi-transparent)
  if (cachedCountriesMesh) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    drawGeoJSONMultiLineString(ctx, cachedCountriesMesh, x, y, w, h);
    ctx.stroke();
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
      // Rough great-circle bearing
      const bearing = (Math.atan2(
        Math.sin(toRad(c.lon - user.lon)) * Math.cos(toRad(c.lat)),
        Math.cos(toRad(user.lat)) * Math.sin(toRad(c.lat)) - Math.sin(toRad(user.lat)) * Math.cos(toRad(c.lat)) * Math.cos(toRad(c.lon - user.lon))
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


