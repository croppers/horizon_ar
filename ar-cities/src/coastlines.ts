import { geoAzimuthalEquidistant, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const EARTH_RADIUS_KM = 6371;

type LandGeo = GeoJSON.Polygon | GeoJSON.MultiPolygon;

let land: LandGeo | null = null;
let loadPromise: Promise<void> | null = null;

export async function ensureLandLoaded(url = './land-110m.json'): Promise<void> {
  if (land) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error('land-110m.json load failed');
    const topo = await res.json();
    const landFeat: any = feature(topo, (topo.objects as any).land);
    land = landFeat as LandGeo;
  })();
  return loadPromise;
}

export interface CoastlinesParams {
  ctx: CanvasRenderingContext2D;
  x: number; y: number; w: number; h: number; // inset rect
  userLon: number;
  userLat: number;
  headingDeg: number;
  hfovDeg: number;
  maxDistanceKm: number;
  styles?: { stroke?: string; fill?: string; lineWidth?: number; alpha?: number };
}

export function drawCoastlines(params: CoastlinesParams): void {
  if (!land) return;
  const { ctx, x, y, w, h, userLon, userLat, headingDeg, hfovDeg, maxDistanceKm, styles } = params;

  const cx = x + w / 2;
  const cy = y + h / 2;

  const scale = Math.min(w, h) * 0.47;

  const proj = geoAzimuthalEquidistant()
    .translate([cx, cy])
    .scale(scale)
    .rotate([-userLon, -userLat, headingDeg]);

  const path = geoPath(proj, ctx as any);

  // Card background
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = 'rgba(10,12,14,0.7)';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  const theta = (hfovDeg * Math.PI) / 180;
  const rPx = scale * (maxDistanceKm / EARTH_RADIUS_KM);

  // Clip to HFOV wedge pointing up
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, rPx, -Math.PI / 2 - theta / 2, -Math.PI / 2 + theta / 2, false);
  ctx.closePath();
  ctx.clip();

  // Land
  ctx.globalAlpha = styles?.alpha ?? 0.95;
  ctx.fillStyle = styles?.fill ?? 'rgba(60,90,70,0.25)';
  ctx.strokeStyle = styles?.stroke ?? 'rgba(255,255,255,0.45)';
  ctx.lineWidth = styles?.lineWidth ?? 0.8;

  ctx.beginPath();
  path(land as any);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
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
