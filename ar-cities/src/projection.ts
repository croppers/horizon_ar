// Projection helpers: azimuth and pitch to screen coordinates
// Assumes horizon at vertical center; simple pinhole camera model.

export function azimuthToScreenX(deltaAzDeg: number, hfovDeg: number, width: number): number {
  // Map -hfov/2..+hfov/2 to 0..width
  const halfWidth = width / 2;
  const x = (deltaAzDeg / hfovDeg) * halfWidth + halfWidth;
  return Math.max(0, Math.min(width, x));
}

export function pitchToScreenY(pitchDeg: number, vfovDeg: number, height: number): number {
  // Positive pitch raises the horizon (moves labels down). Horizon at height/2.
  const halfHeight = height / 2;
  const y = (-pitchDeg / vfovDeg) * halfHeight + halfHeight;
  return Math.max(0, Math.min(height, y));
}

export function estimateVfovDeg(hfovDeg: number, width: number, height: number): number {
  // Simple proportional assumption; good enough for calibration slider.
  return hfovDeg * (height / Math.max(1, width));
}

export function isWithinFov(deltaAzDeg: number, hfovDeg: number): boolean {
  const half = hfovDeg / 2;
  return deltaAzDeg >= -half && deltaAzDeg <= half;
}

export function edgeSide(deltaAzDeg: number): 'left' | 'right' {
  return deltaAzDeg < 0 ? 'left' : 'right';
}
