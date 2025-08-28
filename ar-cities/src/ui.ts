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
    const lat = Number(latInput.value);
    const lon = Number(lonInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    state.onManualGeo?.({ lat, lon });
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
