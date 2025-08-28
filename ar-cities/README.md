# AR Cities — Horizon

Overlay major world cities at their magnetic bearing on the camera horizon. Mobile- and desktop-adaptive, TypeScript + Vite, no heavy deps.

## Setup

```bash
npm i
npm run dev      # http://localhost:5173
npm run dev:https # local HTTPS for iOS sensors/camera
npm run build
npm run preview
```

- iOS Safari requires a user gesture to grant Motion/Orientation. Tap Start.
- HTTPS is required for camera and motion sensors. Use `npm run dev:https` (self-signed) or serve via real HTTPS.

## Features
- Camera video background with transparent 2D canvas overlay
- Sensor fusion (Generic Sensor API when available; fallback to DeviceOrientation + DeviceMotion with complementary filter)
- Magnetic heading only (no true-north correction)
- Distance filter and km/mi toggle
- HFOV calibration and heading offset fine-tune
- Decluttering and edge chevrons
- PWA installable; offline-capable for static assets

## Data
- `public/cities.json` contains ~150 large metro areas with approximate populations.
- If you use a third-party dataset later, add attribution here.

## Deploy
### GitHub Pages
- Push to `main`. The GitHub Actions workflow builds and deploys `/dist` to Pages.

### Render (static site)
- Build locally or in CI and deploy the `/dist` folder as a static site on Render.

## Notes
- Use the HFOV and heading offset sliders to align labels with known landmarks.
- If geolocation is denied, use manual lat/lon inputs.
- If sensors are unavailable (desktop), drag with the mouse to adjust heading/pitch.

## License
MIT
