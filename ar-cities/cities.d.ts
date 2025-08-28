// Ambient declarations for browsers missing these types

interface DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

declare class AbsoluteOrientationSensor {
  constructor(options?: { frequency?: number });
  quaternion?: [number, number, number, number];
  onreading: ((this: this, ev: Event) => any) | null;
  onerror: ((this: this, ev: Event) => any) | null;
  start(): void;
  stop(): void;
}

declare class RelativeOrientationSensor {
  constructor(options?: { frequency?: number });
  quaternion?: [number, number, number, number];
  onreading: ((this: this, ev: Event) => any) | null;
  onerror: ((this: this, ev: Event) => any) | null;
  start(): void;
  stop(): void;
}

// Allow importing JSON if needed
declare module '*.json' {
  const value: any;
  export default value;
}
