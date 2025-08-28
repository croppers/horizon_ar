// Geospatial and angle helpers without external deps
// All angles are in degrees unless specified.

export function toRad(deg: number): number { return (deg * Math.PI) / 180; }
export function toDeg(rad: number): number { return (rad * 180) / Math.PI; }

export function wrap360(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

export function wrap180(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  return d;
}

// Haversine distance in kilometers
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088; // mean Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Initial bearing from point 1 to point 2 (0..360°)
export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const brng = toDeg(Math.atan2(y, x));
  return wrap360(brng);
}
