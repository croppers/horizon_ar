import type { Settings, Units, LatLon } from './types';

const LS_KEY = 'arcities.settings.v2';

export interface UIState {
  settings: Settings;
  onSettingsChange?: (s: Settings) => void;
  onStart?: () => void;
  onManualGeo?: (pos: LatLon) => void;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Settings;
  } catch {}
  return { maxDistanceKm: 1000, units: 'km', hfovDeg: 60, headingOffsetDeg: 0, smoothing: 0.15, showOffscreenIndicators: false };
}

function saveSettings(s: Settings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

export function initUI(state: UIState) {
  const settings = state.settings || loadSettings();
  state.settings = settings;

  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  const helpBtn = document.getElementById('helpBtn') as HTMLButtonElement;
  const onboarding = document.getElementById('onboarding') as HTMLDialogElement;
  const collapseBtn = document.getElementById('collapseBtn') as HTMLButtonElement;
  const controlsBody = document.getElementById('controlsBody') as HTMLDivElement;

  const distance = document.getElementById('distance') as HTMLInputElement;
  const distanceValue = document.getElementById('distanceValue') as HTMLSpanElement;
  const unitsKm = document.getElementById('unitsKm') as HTMLInputElement;
  const unitsMi = document.getElementById('unitsMi') as HTMLInputElement;
  const hfov = document.getElementById('hfov') as HTMLInputElement;
  const hfovValue = document.getElementById('hfovValue') as HTMLSpanElement;
  const headingOffset = document.getElementById('headingOffset') as HTMLInputElement;
  const headingOffsetValue = document.getElementById('headingOffsetValue') as HTMLSpanElement;
  const smooth = document.getElementById('smooth') as HTMLInputElement;
  const smoothValue = document.getElementById('smoothValue') as HTMLSpanElement;
  const showOffscreen = document.getElementById('showOffscreen') as HTMLInputElement;

  const dbgHeading = document.getElementById('dbgHeading') as HTMLSpanElement;
  const dbgPitch = document.getElementById('dbgPitch') as HTMLSpanElement;
  const dbgRoll = document.getElementById('dbgRoll') as HTMLSpanElement;
  const dbgSource = document.getElementById('dbgSource') as HTMLSpanElement;
  const dbgRate = document.getElementById('dbgRate') as HTMLSpanElement;
  const dbgSmooth = document.getElementById('dbgSmooth') as HTMLSpanElement;

  const geoStatus = document.getElementById('geoText') as HTMLSpanElement;
  const manualGeo = document.getElementById('manualGeo') as HTMLDivElement;
  const latInput = document.getElementById('lat') as HTMLInputElement;
  const lonInput = document.getElementById('lon') as HTMLInputElement;
  const setGeo = document.getElementById('setGeo') as HTMLButtonElement;

  // Parse flexible coordinate strings like "41", "41N", "41.5°N", "41 30 0 N".
  function parseCoord(input: string, isLat: boolean): number | null {
    if (!input) return null;
    let s = input.trim().toUpperCase();
    // Replace commas with spaces
    s = s.replace(/,/g, ' ');
    // Remove extra labels
    s = s.replace(/[\s]+/g, ' ');
    // Extract direction
    let dir: 'N'|'S'|'E'|'W'|null = null;
    const dirMatch = s.match(/([NSEW])$/);
    if (dirMatch) { dir = dirMatch[1] as any; s = s.slice(0, -1).trim(); }

    // Split DMS components by degree, minute, second symbols or spaces
    // Examples supported: 41, 41.5, 41°30, 41°30', 41°30'15", 41 30, 41 30 15
    const parts: number[] = [];
    let rem = s.replace(/°/g, ' ').replace(/'/g, ' ').replace(/"/g, ' ');
    rem = rem.replace(/[\s]+/g, ' ').trim();
    if (!rem) return null;
    for (const token of rem.split(' ')) {
      if (!token) continue;
      const val = Number(token);
      if (!Number.isFinite(val)) return null;
      parts.push(val);
      if (parts.length === 3) break;
    }
    if (parts.length === 0) return null;
    const deg = parts[0];
    const min = parts[1] || 0;
    const sec = parts[2] || 0;
    let sign = 1;
    if (deg < 0) sign = -1;
    if (dir) {
      if (dir === 'S' || dir === 'W') sign = -1;
      if (dir === 'N' || dir === 'E') sign = 1;
    }
    let absDeg = Math.abs(deg) + Math.abs(min)/60 + Math.abs(sec)/3600;
    let val = sign * absDeg;
    // Clamp to valid ranges
    if (isLat) {
      if (Math.abs(val) > 90) return null;
    } else {
      if (Math.abs(val) > 180) return null;
    }
    return val;
  }

  // Onboarding
  if (!localStorage.getItem('arcities.onboarded')) {
    onboarding.showModal();
  }
  (document.getElementById('onboardingClose') as HTMLButtonElement).addEventListener('click', () => {
    localStorage.setItem('arcities.onboarded', '1');
  });
  helpBtn.addEventListener('click', () => onboarding.showModal());

  // Collapsible controls
  collapseBtn.addEventListener('click', () => {
    const expanded = collapseBtn.getAttribute('aria-expanded') === 'true';
    const next = !expanded;
    collapseBtn.setAttribute('aria-expanded', String(next));
    controlsBody.style.display = next ? 'block' : 'none';
    collapseBtn.textContent = next ? '▾' : '▸';
  });

  // Initialize values
  distance.value = String(settings.maxDistanceKm);
  hfov.value = String(settings.hfovDeg);
  headingOffset.value = String(settings.headingOffsetDeg);
  smooth.value = String(settings.smoothing);
  if (settings.units === 'km') unitsKm.checked = true; else unitsMi.checked = true;
  showOffscreen.checked = !!settings.showOffscreenIndicators;

  function fmtDistance(vKm: number, units: Units) {
    if (units === 'km') return `${Math.round(vKm)} km`;
    const mi = vKm * 0.621371;
    return `${Math.round(mi)} mi`;
  }

  function refreshLabels() {
    distanceValue.textContent = fmtDistance(Number(distance.value), settings.units);
    hfovValue.textContent = `${hfov.value}°`;
    headingOffsetValue.textContent = `${headingOffset.value}°`;
    smoothValue.textContent = `${Number(smooth.value).toFixed(2)}`;
  }
  refreshLabels();

  function pushChange() {
    saveSettings(settings);
    state.onSettingsChange?.(settings);
    refreshLabels();
  }

  distance.addEventListener('input', () => { settings.maxDistanceKm = Number(distance.value); pushChange(); });
  hfov.addEventListener('input', () => { settings.hfovDeg = Number(hfov.value); pushChange(); });
  headingOffset.addEventListener('input', () => { settings.headingOffsetDeg = Number(headingOffset.value); pushChange(); });
  smooth.addEventListener('input', () => { settings.smoothing = Number(smooth.value); pushChange(); });
  showOffscreen.addEventListener('change', () => { settings.showOffscreenIndicators = showOffscreen.checked; pushChange(); });

  unitsKm.addEventListener('change', () => { settings.units = 'km'; pushChange(); });
  unitsMi.addEventListener('change', () => { settings.units = 'mi'; pushChange(); });

  startBtn.addEventListener('click', () => state.onStart?.());

  setGeo.addEventListener('click', () => {
    const lat = parseCoord(latInput.value, true);
    const lon = parseCoord(lonInput.value, false);
    if (!Number.isFinite(lat as number) || !Number.isFinite(lon as number)) {
      const geoText = document.getElementById('geoText');
      if (geoText) geoText.textContent = 'invalid lat/lon format';
      return;
    }
    state.onManualGeo?.({ lat: lat as number, lon: lon as number });
  });

  return {
    setGeoStatus(text: string) { geoStatus.textContent = text; },
    showManualGeo(show: boolean) { manualGeo.classList.toggle('hidden', !show); },
    updateDebug(heading: number, pitch: number, roll: number, source: string, rateHz: number) {
      dbgHeading.textContent = heading.toFixed(1);
      dbgPitch.textContent = pitch.toFixed(1);
      dbgRoll.textContent = roll.toFixed(1);
      dbgSource.textContent = source;
      dbgRate.textContent = rateHz ? rateHz.toFixed(0) : '–';
      dbgSmooth.textContent = settings.smoothing.toFixed(2);
    },
    getSettings() { return settings; }
  };
}
