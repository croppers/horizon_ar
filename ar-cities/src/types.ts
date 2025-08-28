export type Units = 'km' | 'mi';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface City {
  name: string;
  country: string;
  lat: number;
  lon: number;
  population: number;
}

export type OrientationSource = 'generic-sensor' | 'deviceorientation+motion' | 'deviceorientation' | 'virtual';

export interface OrientationSample {
  headingDeg: number; // 0..360
  pitchDeg: number;   // up positive
  rollDeg: number;
  source: OrientationSource;
  timestamp: number;  // ms
}

export interface SmoothedOrientation {
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export interface Settings {
  maxDistanceKm: number; // store in km internally
  units: Units;
  hfovDeg: number;
  headingOffsetDeg: number;
  smoothing: number; // 0..0.3
  showOffscreenIndicators: boolean;
}

export interface RendererInput {
  width: number;
  height: number;
  hfovDeg: number;
  pitchDeg: number;
  headingDeg: number;
  units: Units;
  maxDistanceKm: number;
  user: LatLon;
  cities: City[];
  populationOpacity: Map<string, number>; // key = `${name}|${country}`
  showOffscreenIndicators: boolean;
  showMinimap?: boolean;
}
