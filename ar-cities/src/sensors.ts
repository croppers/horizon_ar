/*
  sensors.ts
  - Request permissions for motion/orientation (iOS via requestPermission), camera, and geolocation
  - Start camera stream with environment facing mode
  - Start orientation stream with preference for Generic Sensor API
  - Fallback to DeviceOrientation + DeviceMotion with a complementary filter
  - Expose subscribe(fn) API that emits fused orientation in degrees
  - Provide desktop fallback with mouse drag to adjust virtual heading/pitch
*/

import { wrap180, wrap360 } from './geo';
import type { OrientationSample, OrientationSource } from './types';

export interface OrientationOptions {
  smoothing: number; // 0..0.3
  headingOffsetDeg: number; // applied to output heading
}

export interface OrientationStream {
  subscribe(listener: (s: OrientationSample) => void): () => void;
  setSmoothing(v: number): void;
  setHeadingOffset(deg: number): void;
  getSource(): OrientationSource;
  stop(): void;
}

// Utility: exponential smoothing with circular handling for heading
function smoothAngle(prev: number, next: number, factor: number): number {
  // Use minimal angular delta
  const delta = wrap180(next - prev);
  return wrap360(prev + delta * (1 - Math.exp(-factor)));
}

function smoothLinear(prev: number, next: number, factor: number): number {
  return prev + (next - prev) * (1 - Math.exp(-factor));
}

// Request iOS motion/orientation permission if available.
export async function requestMotionPermissions(): Promise<void> {
  try {
    const anyWin = window as any;
    const dm = (anyWin.DeviceMotionEvent && typeof anyWin.DeviceMotionEvent.requestPermission === 'function')
      ? await anyWin.DeviceMotionEvent.requestPermission()
      : 'granted';
    const doPerm = (anyWin.DeviceOrientationEvent && typeof anyWin.DeviceOrientationEvent.requestPermission === 'function')
      ? await anyWin.DeviceOrientationEvent.requestPermission()
      : 'granted';
    if (dm !== 'granted' || doPerm !== 'granted') {
      // Continue anyway; some browsers return 'denied' but still provide data.
    }
  } catch {
    // ignore
  }
}

export async function startCamera(videoEl: HTMLVideoElement): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    return stream;
  } catch (err) {
    console.warn('Camera access failed', err);
    return null;
  }
}

export interface GeoState {
  lat: number;
  lon: number;
  accuracy?: number;
}

export function watchGeolocation(onUpdate: (g: GeoState) => void, onError: (e: GeolocationPositionError | DOMException) => void): () => void {
  if (!('geolocation' in navigator)) {
    onError(new DOMException('Geolocation not supported'));
    return () => {};
  }
  let watchId: number | null = null;
  try {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        onUpdate({ lat: latitude, lon: longitude, accuracy });
      },
      (err) => onError(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  } catch (e) {
    onError(e as DOMException);
  }
  return () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  };
}

// Generic Sensor API types (ambient declarations)
// Using 'any' to avoid failing on platforms without these types
interface GenericOrientationSensor extends EventTarget {
  quaternion?: [number, number, number, number];
  start(): void;
  stop(): void;
  onreading: ((this: GenericOrientationSensor, ev: Event) => any) | null;
  onerror: ((this: GenericOrientationSensor, ev: Event) => any) | null;
}

function quatToEuler(qx: number, qy: number, qz: number, qw: number): { yaw: number; pitch: number; roll: number } {
  // Convert quaternion to ZYX euler (yaw, pitch, roll) in degrees
  const ysqr = qy * qy;

  // roll (x-axis rotation)
  const t0 = 2 * (qw * qx + qy * qz);
  const t1 = 1 - 2 * (qx * qx + ysqr);
  const roll = Math.atan2(t0, t1);

  // pitch (y-axis rotation)
  let t2 = 2 * (qw * qy - qz * qx);
  t2 = Math.max(-1, Math.min(1, t2));
  const pitch = Math.asin(t2);

  // yaw (z-axis rotation)
  const t3 = 2 * (qw * qz + qx * qy);
  const t4 = 1 - 2 * (ysqr + qz * qz);
  const yaw = Math.atan2(t3, t4);

  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI, roll: (roll * 180) / Math.PI };
}

export function startOrientation(options: OrientationOptions): OrientationStream {
  let smoothing = options.smoothing;
  let headingOffsetDeg = options.headingOffsetDeg;

  let listeners = new Set<(s: OrientationSample) => void>();

  // Internal state
  let src: OrientationSource = 'deviceorientation+motion';
  let rafId: number | null = null;

  // Filter state
  let yaw = 0;  // heading
  let pitch = 0;
  let roll = 0;
  let lastGyroTs = 0; // ms

  let lastEmit: OrientationSample = { headingDeg: 0, pitchDeg: 0, rollDeg: 0, source: 'deviceorientation', timestamp: performance.now() };

  // Complementary filter gains
  const accelGain = 0.02; // how strongly to trust accelerometer for pitch/roll
  const yawCorrectionGain = 0.01; // gentle yaw correction from deviceorientation.alpha

  // DeviceOrientation heading measurement (magnetic)
  let headingMeas: number | null = null;

  // Generic Sensor path
  const anyWin = window as any;
  const Abs = anyWin.AbsoluteOrientationSensor as undefined | (new (opts?: any) => GenericOrientationSensor);
  const Rel = anyWin.RelativeOrientationSensor as undefined | (new (opts?: any) => GenericOrientationSensor);
  let genericSensor: GenericOrientationSensor | null = null;

  function emit(now: number) {
    // Apply offset and smoothing on output
    const targetHeading = wrap360(yaw + headingOffsetDeg);
    const targetPitch = pitch;
    const targetRoll = roll;

    const smoothedHeading = smoothAngle(lastEmit.headingDeg, targetHeading, smoothing);
    const smoothedPitch = smoothLinear(lastEmit.pitchDeg, targetPitch, smoothing);
    const smoothedRoll = smoothLinear(lastEmit.rollDeg, targetRoll, smoothing);

    const out: OrientationSample = {
      headingDeg: smoothedHeading,
      pitchDeg: smoothedPitch,
      rollDeg: smoothedRoll,
      source: src,
      timestamp: now
    };
    lastEmit = out;
    listeners.forEach((fn) => fn(out));
  }

  function startGenericSensor() {
    try {
      const SensorCtor = Abs || Rel;
      if (!SensorCtor) return false;
      const s = new SensorCtor({ frequency: 60 });
      genericSensor = s;
      src = 'generic-sensor';
      s.onreading = () => {
        const q = s.quaternion as any;
        if (!q) return;
        const { yaw: z, pitch: y, roll: x } = quatToEuler(q[0], q[1], q[2], q[3]);
        // Generic sensors tend to give yaw relative to arbitrary frame; assume magnetic when AbsoluteOrientationSensor
        yaw = wrap360(z);
        pitch = y;
        roll = x;
        emit(performance.now());
      };
      s.onerror = () => {};
      s.start();
      return true;
    } catch {
      return false;
    }
  }

  // DeviceOrientation + DeviceMotion complementary filter
  function startDeviceFusion() {
    src = 'deviceorientation+motion';

    function onDO(e: DeviceOrientationEvent) {
      const anyE = e as any;
      // iOS may expose webkitCompassHeading (0=north, clockwise)
      if (typeof anyE.webkitCompassHeading === 'number') {
        headingMeas = wrap360(anyE.webkitCompassHeading as number);
      } else if (typeof e.alpha === 'number') {
        headingMeas = wrap360(e.alpha!);
      }
    }

    function onDM(e: DeviceMotionEvent) {
      const now = performance.now();
      const dt = lastGyroTs ? (now - lastGyroTs) / 1000 : 0;
      lastGyroTs = now;

      const rr = e.rotationRate;
      if (rr) {
        const gz = rr.alpha ?? 0; // deg/s around Z (screen facing)
        const gx = rr.beta ?? 0;  // deg/s around X
        const gy = rr.gamma ?? 0; // deg/s around Y
        yaw = wrap360(yaw + gz * dt);
        pitch = pitch + gx * dt;
        roll = roll + gy * dt;
      }

      const ag = e.accelerationIncludingGravity;
      if (ag) {
        const ax = ag.x ?? 0;
        const ay = ag.y ?? 0;
        const az = ag.z ?? -9.8;
        // Compute pitch/roll from gravity vector (device coordinates). Formulas assume right-handed axes.
        const pitchAcc = (Math.atan2(-ax, Math.hypot(ay, az)) * 180) / Math.PI;
        const rollAcc = (Math.atan2(ay, az) * 180) / Math.PI;
        pitch = pitch * (1 - accelGain) + pitchAcc * accelGain;
        roll = roll * (1 - accelGain) + rollAcc * accelGain;
      }

      if (headingMeas != null) {
        const err = wrap180(headingMeas - yaw);
        yaw = wrap360(yaw + err * yawCorrectionGain);
      }

      emit(now);
    }

    window.addEventListener('deviceorientation', onDO, true);
    window.addEventListener('devicemotion', onDM, true);

    return () => {
      window.removeEventListener('deviceorientation', onDO, true);
      window.removeEventListener('devicemotion', onDM, true);
    };
  }

  let stopFns: Array<() => void> = [];

  // Desktop/No sensor fallback: virtual orientation controlled by mouse drag
  function startVirtual() {
    src = 'virtual';
    let dragging = false;
    let lastX = 0; let lastY = 0;
    const sensitivityHeading = 0.1; // deg per px
    const sensitivityPitch = 0.1;

    function onDown(ev: PointerEvent) { dragging = true; lastX = ev.clientX; lastY = ev.clientY; (ev.target as Element).setPointerCapture?.(ev.pointerId); }
    function onUp(ev: PointerEvent) { dragging = false; (ev.target as Element).releasePointerCapture?.(ev.pointerId); }
    function onMove(ev: PointerEvent) {
      if (!dragging) return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX; lastY = ev.clientY;
      yaw = wrap360(yaw + dx * sensitivityHeading);
      pitch = Math.max(-89, Math.min(89, pitch - dy * sensitivityPitch));
      emit(performance.now());
    }

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);

    stopFns.push(() => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointermove', onMove);
    });
  }

  // Start best available sensor path
  const startedGeneric = startGenericSensor();
  if (!startedGeneric) {
    const stopFusion = startDeviceFusion();
    stopFns.push(stopFusion);

    // If no events arrive after a short time, enable virtual fallback
    const timeout = setTimeout(() => {
      if (lastGyroTs === 0 && headingMeas == null) {
        startVirtual();
      }
    }, 2000);
    stopFns.push(() => clearTimeout(timeout));
  }

  function tick() {
    emit(performance.now());
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setSmoothing(v: number) { smoothing = Math.max(0, Math.min(0.3, v)); },
    setHeadingOffset(deg: number) { headingOffsetDeg = deg; },
    getSource() { return src; },
    stop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      stopFns.forEach((f) => f());
      genericSensor?.stop?.();
      listeners.clear();
    }
  };
}
