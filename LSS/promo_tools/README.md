# LSS promo capture toolkit

Headless footage factory for Last Ship Sailing: captures smooth in-game GIF and video footage on any machine (no GPU needed) by running the game in headless Chromium on a virtual clock.

## How it works

`lib.js` patches `requestAnimationFrame` and `performance.now` before the game boots, so the engine believes it runs at a locked 60fps while the harness steps it frame by frame and screenshots the compositor after each render. Software rendering speed becomes irrelevant; output is always smooth.

## Setup

```
npm install playwright @ffmpeg-installer/ffmpeg
ln -sf node_modules/@ffmpeg-installer/linux-x64/ffmpeg ./ffmpeg
# serve the repo root:  python3 -m http.server 8777  (from FractalGaming/)
# three.js is served locally: npm install three@0.165.0 (lib.js reroutes the CDN importmap)
# set the chromium executablePath in lib.js for your machine
```

## Scripts

- `ships.js SHIP [frames] [mapOffset]`: solo match, third person, scripted thrust/fire/ability choreography
- `exhibition.js [frames] [ship]`: scenic Overworld freeflight footage
- `menu_attract.js`: menu background scene capture
- `cards.html` + `cards.js`: renders promo title cards to PNG
- `makegif.sh <framedir> <out.gif> [width] [outfps]`: two-pass palette GIF encode
- `promo_build.sh`: assembles the full promo MP4 (cards + clips + music) ; edit the segment table inside

Created: 2026-07-26
