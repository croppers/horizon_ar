import { initUI } from './ui';
import { startCamera, requestMotionPermissions, watchGeolocation, startOrientation } from './sensors';
import { estimateVfovDeg } from './projection';
import type { City, Settings } from './types';

const video = document.getElementById('camera') as HTMLVideoElement;
const canvas = document.getElementById('overlay') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let settings: Settings = { maxDistanceKm: 1000, units: 'km', hfovDeg: 60, headingOffsetDeg: 0, smoothing: 0.15, showOffscreenIndicators: false };

let user = { lat: 39.9960, lon: -74.0621 };
let haveLocation = false;
let cities: City[] = [];
let orientation = startOrientation({ smoothing: settings.smoothing, headingOffsetDeg: settings.headingOffsetDeg });
let lastFrameTs = performance.now();
let rateSamples: number[] = [];
let lastNowRef = { v: 0 };

const ui = initUI({
  settings,
  onSettingsChange: (s) => {
    settings = s;
    orientation.setSmoothing(s.smoothing);
    orientation.setHeadingOffset(s.headingOffsetDeg);
  },
  onStart: async () => {
    // Request geolocation first to preserve user activation for the permission prompt (iOS/Safari quirk)
    setupGeolocation();
    // Then request motion and camera without awaiting to avoid losing user activation
    requestMotionPermissions().catch(() => {});
    startCamera(video).catch(() => {});
  },
  onManualGeo: (pos) => {
    user = pos; haveLocation = true; uiHelpers.setGeoStatus(`${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)} (manual)`);
  }
});
const uiHelpers = ui;

function setupGeolocation() {
  uiHelpers.setGeoStatus('requesting…');
  const stop = watchGeolocation(
    (g) => {
      user = { lat: g.lat, lon: g.lon };
      haveLocation = true;
      uiHelpers.setGeoStatus(`${g.lat.toFixed(5)}, ${g.lon.toFixed(5)} ±${Math.round(g.accuracy || 0)}m`);
    },
    (err) => {
      console.warn('Geolocation error', err);
      let msg = 'location error';
      const anyErr = err as any;
      if (typeof anyErr?.code === 'number') {
        switch (anyErr.code) {
          case 1: msg = 'permission denied — check site settings'; break;
          case 2: msg = 'position unavailable'; break;
          case 3: msg = 'timeout — move outdoors or check settings'; break;
          default: msg = 'location error';
        }
      } else if (anyErr?.message) {
        msg = anyErr.message;
      }
      uiHelpers.setGeoStatus(msg);
      uiHelpers.showManualGeo(true);
    }
  );
  // Keep stop handle if needed: window.addEventListener('beforeunload', stop)
}

async function loadCities() {
  const res = await fetch('./cities.json');
  const arr = (await res.json()) as City[];
  cities = arr;
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
}

window.addEventListener('resize', resize);
resize();

// Orientation subscription updates debug rate
let lastEmitTs = performance.now();
let frames = 0;
orientation.subscribe((s) => {
  frames++;
  const now = performance.now();
  if (now - lastEmitTs > 1000) {
    rateSamples.push(frames);
    if (rateSamples.length > 4) rateSamples.shift();
    const avg = rateSamples.reduce((a, b) => a + b, 0) / rateSamples.length;
    uiHelpers.updateDebug(s.headingDeg, s.pitchDeg, s.rollDeg, s.source, avg);
    frames = 0; lastEmitTs = now;
  }
});

// Render loop
import { render } from './renderer';

function raf() {
  const now = performance.now();
  const dt = (now - lastFrameTs) / 1000;
  lastFrameTs = now;

  // Get latest orientation via last debug update stored in UI if needed
  // We will resubscribe and store; for simplicity we use an internal variable updated by subscription
  let latestHeading = (window as any).__arc_heading ?? 0;
  let latestPitch = (window as any).__arc_pitch ?? 0;
  let latestRoll = (window as any).__arc_roll ?? 0;

  // but we actually want the last emitted sample; attach once (cheap)
  // store on window to avoid circular import
  if (!(window as any).__arc_bound) {
    (window as any).__arc_bound = true;
    orientation.subscribe((s) => {
      (window as any).__arc_heading = s.headingDeg;
      (window as any).__arc_pitch = s.pitchDeg;
      (window as any).__arc_roll = s.rollDeg;
    });
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.floor(width * window.devicePixelRatio);
  canvas.height = Math.floor(height * window.devicePixelRatio);
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

  if (haveLocation && cities.length > 0) {
    render(ctx, {
      width,
      height,
      hfovDeg: settings.hfovDeg,
      pitchDeg: latestPitch,
      headingDeg: latestHeading,
      units: settings.units,
      maxDistanceKm: settings.maxDistanceKm,
      user,
      cities,
      populationOpacity: new Map(),
      showOffscreenIndicators: settings.showOffscreenIndicators,
    }, now, lastNowRef);
  } else {
    // Draw subtle text prompting start
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 16px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Press Start and allow permissions', width/2, height/2);
  }

  requestAnimationFrame(raf);
}

loadCities();
requestAnimationFrame(raf);

// Register service worker (public/sw.js)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
