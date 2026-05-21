// v17 lobby + ship-select + settings panel + perk picker
// Extracted verbatim from last_ship_sailing_v17.html

// ----- 1. SHIP-SELECT PANEL HTML + CSS -----

/* CSS (excerpt from <style>) */
/*
#ship-select {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(5,5,15,0.95); z-index: 100; display: none;
  flex-direction: column; align-items: stretch; justify-content: flex-start;
  color: #fff; cursor: default; padding: 0;
}
#ship-select.active { display: flex; }
#ship-select-header {
  padding: 14px 28px 10px;
  border-bottom: 1px solid rgba(80,80,120,0.25);
  background: linear-gradient(180deg, rgba(15,15,30,0.75) 0%, rgba(8,8,18,0.45) 100%);
  -webkit-backdrop-filter: blur(8px);
          backdrop-filter: blur(8px);
}
#ship-select-header h1 {
  font-family: 'Orbitron', sans-serif; font-weight: 700;
  font-size: 24px; margin: 0; letter-spacing: 5px; color: #ffaa00;
  text-shadow: 0 0 24px rgba(255,170,0,0.35);
}
#ship-select-header h2 {
  font-family: 'Rajdhani', sans-serif; font-weight: 500;
  font-size: 11px; margin: 3px 0 0; color: #888; letter-spacing: 2.5px;
  text-transform: uppercase;
}
#ship-select-body {
  flex: 1; display: flex; flex-direction: row; min-height: 0;
  // (v16a Phase DD) Clip any preview overflow inside the body so it
  // never spills into the bottom row's territory.
  overflow: hidden;
}
#ship-list {
  width: 200px; flex-shrink: 0;
  padding: 14px 12px; overflow-y: auto;
  border-right: 1px solid rgba(80,80,120,0.25);
}
.ship-list-entry {
  padding: 10px 14px; margin-bottom: 6px;
  border: 1px solid rgba(80,80,120,0.35); border-radius: 6px;
  background: rgba(20,20,40,0.45);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  color: #ddd; font-family: 'Rajdhani', sans-serif;
  font-size: 12px; letter-spacing: 1.2px; cursor: pointer;
  transition: all 0.18s ease; pointer-events: all;
  display: flex; flex-direction: column;
}
.ship-list-entry .sle-name {
  font-family: 'Orbitron', sans-serif; font-weight: 600;
  color: #ffaa00; font-size: 13px; letter-spacing: 1.6px;
}
.ship-list-entry .sle-class {
  font-family: 'Rajdhani', sans-serif; font-weight: 500;
  font-size: 9px; color: #888; margin-top: 2px; letter-spacing: 1.2px;
  text-transform: uppercase;
}
.ship-list-entry:hover { border-color: #ffaa00; background: rgba(30,30,50,0.75); transform: translateX(2px); }
.ship-list-entry.selected {
  border-color: #ffaa00; background: rgba(50,40,15,0.75);
  box-shadow: inset 0 0 16px rgba(255,170,0,0.30), 0 2px 12px rgba(0,0,0,0.4);
}
#ship-preview {
  flex: 1; display: flex; flex-direction: row; align-items: stretch;
  justify-content: center; padding: 20px; min-width: 0; gap: 28px;
}
#ship-preview-model {
  flex: 1; display: flex; align-items: center; justify-content: center;
  min-width: 0; position: relative;
}
#ship-preview-canvas {
  width: 100%; height: 100%; display: block;
  background: radial-gradient(ellipse at center,
    rgba(30,40,70,0.35) 0%, rgba(10,12,22,0.15) 55%, rgba(0,0,0,0) 100%);
}
#ship-preview-info {
  width: 380px; flex-shrink: 0; display: flex; flex-direction: column;
  align-items: stretch; justify-content: center; text-align: center;
  padding: 0 8px;
}
#ship-preview-name {
  font-family: 'Orbitron', sans-serif; font-weight: 700;
  font-size: 26px; letter-spacing: 5px; color: #ffaa00;
}
#ship-preview-stats {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px;
  margin: 14px 0 18px; pointer-events: none; width: 100%;
}
.sp-stat {
  font-family: 'Rajdhani', sans-serif; font-weight: 500;
  font-size: 11px; letter-spacing: 1.2px; color: #aaa;
  display: flex; justify-content: space-between;
  padding: 6px 10px; background: rgba(20,20,40,0.35);
  border-left: 2px solid rgba(80,80,120,0.5); border-radius: 0 4px 4px 0;
  text-transform: uppercase;
}
.sp-stat .sp-val { color: #fff; font-weight: 700; }
#ship-preview-weapon { color: #66bbff; font-size: 11px; margin-top: 5px; text-align: center; }
#ship-preview-abilities { color: #66cc66; font-size: 10px; text-align: center; margin-top: 2px; }
#ship-preview-core { color: #ffaa00; font-size: 10px; text-align: center; margin-top: 3px; opacity: 0.8; }
#ship-preview-confirm {
  margin-top: 18px; padding: 11px 32px;
  background: rgba(255,170,0,0.12);
  border: 2px solid #ffaa00; border-radius: 6px;
  color: #ffaa00; font-family: 'Orbitron', sans-serif; font-weight: 700;
  font-size: 12px; letter-spacing: 3.5px; text-transform: uppercase;
  cursor: pointer; transition: all 0.18s ease; pointer-events: all;
  align-self: center;
}
#ship-preview-confirm:disabled { opacity: 0.3; cursor: not-allowed; }
// (v16 perks) Perk picker row : sits between abilities/core and confirm button.
#ship-preview-perks {
  margin-top: 14px; display: flex; flex-direction: column; gap: 8px;
  padding: 10px 12px;
  background: rgba(0,0,0,0.22);
  border: 1px solid rgba(120,140,180,0.22);
  border-radius: 6px;
}
#ship-preview-perks .perks-label {
  font-family: 'Orbitron', sans-serif; font-size: 10px; letter-spacing: 3px;
  color: #88ccff; text-transform: uppercase; opacity: 0.85;
}
#perks-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.perk-card {
  flex: 1 1 80px; min-width: 70px; max-width: 110px;
  padding: 8px 6px; background: rgba(255,255,255,0.04);
  border: 1px solid rgba(120,140,180,0.25); border-radius: 4px;
  font-family: 'Orbitron', sans-serif;
  font-size: 9px; letter-spacing: 1px; text-transform: uppercase;
  color: #cdd; text-align: center;
  cursor: pointer; transition: all 0.14s ease;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.perk-card.selected {
  background: rgba(255,170,0,0.16); border-color: rgba(255,170,0,0.85);
  color: #ffd270; box-shadow: 0 0 14px rgba(255,170,0,0.30);
}
.perk-card-icon { font-size: 18px; line-height: 1; }
.perk-card-name { font-weight: 700; font-size: 9px; }
#perks-desc {
  font-family: 'Rajdhani', sans-serif; font-size: 11px; color: #aab;
  line-height: 1.4; min-height: 30px; padding: 4px 2px;
}
#ship-center-column { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
#teammates-strip {
  flex-shrink: 0;
  border-top: 1px solid rgba(80,80,120,0.25);
  padding: 12px 24px; display: flex; flex-direction: row;
  gap: 18px; align-items: stretch;
  background: rgba(8,8,18,0.7);
  min-height: 156px;
}
.fleet-half { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.fleet-half-header {
  display: flex; flex-direction: row; align-items: center; gap: 10px;
  font-family: 'Orbitron', sans-serif; font-size: 10px;
  letter-spacing: 2.0px; text-transform: uppercase;
}
.fleet-half.your-side .fleet-half-header .fleet-tag { color: #ffaa00; }
.fleet-half.enemy-side .fleet-half-header .fleet-tag { color: #ff5544; }
.fleet-chips { display: flex; flex-direction: row; gap: 10px; align-items: flex-start; flex: 1; min-height: 0; }
.fleet-chip {
  position: relative;
  display: flex; flex-direction: column; align-items: stretch;
  padding: 0; width: 130px; min-height: 116px; flex-shrink: 0;
  background: rgba(20,20,40,0.6); border: 1px solid rgba(80,80,120,0.35);
  overflow: hidden;
}
.fleet-chip .chip-thumb { width: 100%; height: 78px; display: block; object-fit: cover; }
.fleet-chip .chip-avatar-wrap {
  width: 100%; height: 78px; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, rgba(88,101,242,0.18), rgba(0,0,0,0.0) 65%);
  position: relative;
}
.fleet-chip .chip-avatar {
  width: 64px; height: 64px; border-radius: 50%; object-fit: cover;
  border: 2px solid #5865F2; background: #1a1a30;
}
.fleet-chip .chip-name { color: #ddd; font-size: 11px; font-weight: bold; padding: 4px 8px 0 8px; }
.fleet-chip .chip-ship { color: #ffaa00; font-size: 9px; padding: 1px 8px 6px 8px; }
.fleet-chip.you { border-color: #ffaa00; background: rgba(50,40,15,0.6); }
.fleet-chip.enemy { border-color: rgba(255,85,68,0.45); }
.fleet-chip.enemy .chip-ship { color: #ff8866; }
.fleet-chip .chip-ready-pip {
  position: absolute; top: 4px; right: 4px;
  font-family: 'Orbitron', sans-serif; font-size: 8px; letter-spacing: 1.4px;
  padding: 2px 6px; border-radius: 2px;
  background: rgba(0,0,0,0.6); color: #888;
  border: 1px solid rgba(120,120,120,0.4);
  pointer-events: none; text-transform: uppercase;
}
.fleet-chip.is-ready .chip-ready-pip {
  background: rgba(0,140,40,0.85); color: #cfc;
  border-color: #5dff8d; box-shadow: 0 0 6px rgba(80,255,140,0.5);
}
.fleet-chip.no-pip .chip-ready-pip { display: none; }
.fleet-divider {
  width: 1px; align-self: stretch;
  background: linear-gradient(to bottom,
    rgba(120,120,180,0.0), rgba(120,120,180,0.35), rgba(120,120,180,0.0));
  flex-shrink: 0;
}
// Countdown overlay shown while ship-select is still visible.
#ship-select-countdown {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 110; pointer-events: none; text-align: center;
  display: none;
}
#ship-select-countdown.active { display: block; }
#ship-select-countdown .cd-num {
  font-family: 'Orbitron', sans-serif; font-weight: 900;
  font-size: 180px; color: #ffaa00;
  text-shadow: 0 0 40px rgba(255,170,0,0.8), 0 0 80px rgba(255,100,0,0.4);
  letter-spacing: 0; line-height: 1;
  animation: cdPulse 0.9s ease-out forwards;
}
@keyframes cdPulse {
  0% { transform: scale(0.6); opacity: 0; }
  15% { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1.4); opacity: 0; }
}
*/

/* HTML markup */
/*
<div id="ship-select">
  <div id="ship-select-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
    <div>
      <h1>LAST SHIP SAILING</h1>
      <h2>CHOOSE YOUR SHIP</h2>
    </div>
    <div style="display:flex;gap:10px;align-items:center;">
      <button id="lobby-back-btn" title="Return to main menu" ...>MAIN MENU</button>
      <button id="lobby-settings-btn" title="Open settings (Esc)" ...>SETTINGS</button>
    </div>
  </div>
  <div id="ship-select-body">
    <div id="ship-list"></div>
    <!-- (v16a Phase DD revised) Center column stacks the ship preview on top
         of the teammates strip. -->
    <div id="ship-center-column">
      <div id="ship-preview">
        <div id="ship-preview-empty">SELECT A SHIP FROM THE LIST</div>
        <div id="ship-preview-model" style="display:none;">
          <canvas id="ship-preview-canvas"></canvas>
        </div>
        <div id="ship-preview-info" style="display:none;">
          <div id="ship-preview-header" style="display:none;">
            <div id="ship-preview-name"></div>
            <div id="ship-preview-class"></div>
          </div>
          <div id="ship-preview-stats" style="display:none;"></div>
          <div id="ship-preview-weapon" style="display:none;"></div>
          <div id="ship-preview-abilities" style="display:none;"></div>
          <div id="ship-preview-core" style="display:none;"></div>
          <div id="ship-preview-perks" style="display:none;">
            <div class="perks-label">PILOT PERK</div>
            <div id="perks-grid"></div>
            <div id="perks-desc"></div>
          </div>
          <button id="ship-preview-confirm" style="display:none;">CONFIRM &amp; LAUNCH</button>
        </div>
      </div>
      <div id="teammates-strip">
        <div class="fleet-half your-side">
          <div class="fleet-half-header">
            <span class="fleet-tag">YOUR FLEET</span><span class="fleet-side">FLEET A</span>
          </div>
          <div class="fleet-chips" id="teammates-list"></div>
        </div>
        <div class="fleet-divider"></div>
        <div class="fleet-half enemy-side">
          <div class="fleet-half-header">
            <span class="fleet-tag">ENEMY FLEET</span><span class="fleet-side">FLEET B</span>
          </div>
          <div class="fleet-chips" id="enemies-list"></div>
        </div>
      </div>
    </div>
    <!-- Map selector : full-height right column -->
    <div id="map-select">
      <div id="map-select-label">MAP</div>
      <div id="map-window">
        <div id="map-window-name"></div>
        <div id="map-window-desc"></div>
      </div>
      <div id="map-select-row">
        <button class="map-arrow" id="map-prev" title="Previous map">&#9664;</button>
        <div id="map-indicator"></div>
        <button class="map-arrow" id="map-next" title="Next map">&#9654;</button>
      </div>
      <button class="map-load-btn" id="map-load-btn" title="Load level JSON exported from Map Lab">+ LOAD CUSTOM MAP</button>
      <input id="map-load-input" type="file" accept=".json,application/json" hidden />
      <div id="map-load-status"></div>
      <div id="race-mode-panel">
        <button class="map-load-btn" id="race-mode-toggle" data-on="0" title="Toggle Race Mode">RACE MODE: OFF</button>
      </div>
      <div id="gmaps-overlay-panel">
        <div id="gmaps-overlay-label">DROP ON LOCATION</div>
        <input id="gmaps-loc-input" type="text" placeholder="Empire State Building" autocomplete="off" />
        <input id="gmaps-loc-finish-input" type="text" placeholder="Finish location (race mode)" autocomplete="off" style="display:none;" />
        <div id="gmaps-overlay-row">
          <button class="map-load-btn" id="gmaps-loc-go">GO</button>
          <button class="map-load-btn" id="gmaps-loc-detach" title="Remove the city overlay">DETACH</button>
        </div>
        <div id="gmaps-loc-status"></div>
      </div>
      <div id="preset-select-section">
        <div id="preset-select-label">PRESET (B)</div>
        <div id="preset-window"><div id="preset-window-name">None</div></div>
        <div id="preset-select-row">
          <button class="sky-arrow" id="preset-prev" title="Previous preset">&#9664;</button>
          <button class="sky-arrow" id="preset-next" title="Next preset">&#9654;</button>
        </div>
        <div id="preset-locked-note" style="display:none;">Clear preset to use Custom Location</div>
      </div>
    </div>
  </div>
  <div style="padding:8px 24px;color:#555;font-size:10px;...">WASD: Move | SPACE/CTRL: Up/Down | MOUSE: Aim | SHIFT: Dash | Q/E/F: Abilities | V: Core | ESC: Settings ...</div>
  <div id="ship-select-countdown">
    <div class="cd-num">3</div>
    <div class="cd-sub">LAUNCH</div>
  </div>
</div>
*/

// ----- 2. SHIP-SELECT BUILD -----

function buildShipSelect() {
  const list = document.getElementById('ship-list');
  if (!list) return;
  list.innerHTML = '';
  for (const [key, loadout] of Object.entries(LOADOUTS)) {
    const ch = CHASSIS[loadout.chassis];
    const row = document.createElement('div');
    row.className = 'ship-list-entry';
    row.dataset.key = key;
    row.innerHTML = `
      <span class="sle-name">${loadout.name}</span>
      <span class="sle-class">${loadout.className}</span>
    `;
    row.addEventListener('click', () => previewLoadout(key));
    list.appendChild(row);
  }
  // Start the rotating-ship render loop now that the panel is visible.
  startShipPreviewLoop();
  // If the player already has a loadout (eg. coming back between rounds), pre-select it
  // so the center panel isn't empty.
  const initialKey = (player && player.loadoutKey) ? player.loadoutKey : null;
  if (initialKey && LOADOUTS[initialKey]) {
    previewLoadout(initialKey);
  } else {
    _previewedKey = null;
    // Show empty-state messaging in the preview panel, hide the 3D area + info stack.
    const emptyEl = document.getElementById('ship-preview-empty');
    if (emptyEl) emptyEl.style.display = 'block';
    for (const id of ['ship-preview-model', 'ship-preview-info',
                      'ship-preview-header', 'ship-preview-stats', 'ship-preview-weapon',
                      'ship-preview-abilities', 'ship-preview-core', 'ship-preview-perks',
                      'ship-preview-confirm']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  }
}

// Render the stats/weapon/abilities/core of a loadout into the center preview panel.
// Pure UI; does NOT mutate game state. The player only commits by clicking CONFIRM.
function previewLoadout(key) {
  const loadout = LOADOUTS[key];
  if (!loadout) return;
  const ch = CHASSIS[loadout.chassis];
  _previewedKey = key;

  // Highlight the selected entry in the left list.
  const entries = document.querySelectorAll('.ship-list-entry');
  entries.forEach(e => { e.classList.toggle('selected', e.dataset.key === key); });

  const emptyEl = document.getElementById('ship-preview-empty');
  if (emptyEl) emptyEl.style.display = 'none';

  // Show the rotating-GLB stage in the center and the info column on the right.
  const modelEl = document.getElementById('ship-preview-model');
  if (modelEl) modelEl.style.display = 'flex';
  const infoEl = document.getElementById('ship-preview-info');
  if (infoEl) infoEl.style.display = 'flex';
  try { setShipPreviewModel(key); } catch (e) {}

  const headerEl = document.getElementById('ship-preview-header');
  if (headerEl) {
    headerEl.style.display = 'block';
    document.getElementById('ship-preview-name').textContent = loadout.name;
    document.getElementById('ship-preview-class').textContent = loadout.className + ' ; ' + ch.name;
  }

  const statsEl = document.getElementById('ship-preview-stats');
  if (statsEl) {
    statsEl.style.display = 'grid';
    statsEl.innerHTML = `
      <div class="sp-stat"><span>HULL</span><span class="sp-val">${ch.maxHealth}</span></div>
      <div class="sp-stat"><span>SHIELD</span><span class="sp-val">${ch.maxShield}</span></div>
      <div class="sp-stat"><span>SPEED</span><span class="sp-val">${ch.flightSpeed}</span></div>
      <div class="sp-stat"><span>DASHES</span><span class="sp-val">${ch.maxDashes}</span></div>
    `;
  }

  const weaponEl = document.getElementById('ship-preview-weapon');
  if (weaponEl) {
    weaponEl.style.display = 'block';
    weaponEl.textContent = 'WEAPON: ' + loadout.weapon.name + ' (' + loadout.weapon.damage + ' dmg)';
  }

  const abilitiesEl = document.getElementById('ship-preview-abilities');
  if (abilitiesEl) {
    abilitiesEl.style.display = 'block';
    abilitiesEl.textContent = 'ABILITIES: ' + loadout.abilities.map(a => a.name).join(' / ');
  }

  const coreEl = document.getElementById('ship-preview-core');
  if (coreEl && loadout.core) {
    coreEl.style.display = 'block';
    coreEl.textContent = 'CORE: ' + loadout.core.name + ' ; ' + loadout.core.desc;
  }

  // (v16 perks) Render the perk picker row above the confirm button.
  _renderPerkPicker();

  const confirmBtn = document.getElementById('ship-preview-confirm');
  if (confirmBtn) {
    confirmBtn.style.display = 'inline-block';
    // Reset any prior click binding by cloning the node.
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', () => {
      if (typeof lssAutoFullscreen === 'function') lssAutoFullscreen();
      commitLoadout(key);
    });
  }
}

// ----- 3. SHIP PREVIEW RENDERER -----

// A small, isolated Three.js renderer for the ship-select center panel.
// Renders the currently-previewed GLB slowly rotating around Y. Completely
// independent of the main game renderer (separate canvas, scene, camera, rAF loop).
const _shipPreview3D = {
  renderer: null, scene: null, camera: null, canvas: null,
  model: null, lastKey: null, pendingKey: null, animId: null,
  rotationSpeed: 0.005, // radians per frame at 60fps (slow, graceful)
  initFailed: false, // set true if WebGL init throws; prevents retry storm
  yaw: 0,
  isMouseDragging: false,
  lastMouseX: 0,
  GAMEPAD_ROT_RATE: 2.6,   // radians/sec at full stick deflection
  MOUSE_ROT_RATE: 0.012,   // radians per pixel of horizontal mouse motion
};

function _initShipPreview3D() {
  if (_shipPreview3D.renderer) return _shipPreview3D.renderer;
  if (_shipPreview3D.initFailed) return null;
  if (typeof THREE === 'undefined') { _shipPreview3D.initFailed = true; return null; }
  const canvas = document.getElementById('ship-preview-canvas');
  if (!canvas) return null;
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: true,
      powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ('physicallyCorrectLights' in renderer) renderer.physicallyCorrectLights = true;
    if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace || 'srgb';
    else renderer.outputEncoding = THREE.sRGBEncoding || 3001;
    renderer.setClearColor(0x000000, 0); // transparent
    const scene = new THREE.Scene();
    if (typeof sceneEnvMap !== 'undefined') scene.environment = sceneEnvMap;
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const keyL = new THREE.DirectionalLight(0xbfd9ff, 0.65);
    keyL.position.set(180, 240, 160); scene.add(keyL);
    const fillL = new THREE.DirectionalLight(0xffb066, 0.28);
    fillL.position.set(-140, -80, -200); scene.add(fillL);
    const rimL = new THREE.DirectionalLight(0xffaa00, 0.18);
    rimL.position.set(0, 120, -260); scene.add(rimL);
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 8000);
    camera.position.set(0, 70, 320);
    camera.lookAt(0, 0, 0);
    _shipPreview3D.renderer = renderer;
    _shipPreview3D.scene = scene;
    _shipPreview3D.camera = camera;
    _shipPreview3D.canvas = canvas;
    // Mouse-drag rotation
    canvas.style.cursor = 'grab';
    canvas.addEventListener('mousedown', (e) => {
      _shipPreview3D.isMouseDragging = true;
      _shipPreview3D.lastMouseX = e.clientX;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => {
      if (!_shipPreview3D.isMouseDragging) return;
      _shipPreview3D.isMouseDragging = false;
      if (_shipPreview3D.canvas) _shipPreview3D.canvas.style.cursor = 'grab';
    });
    window.addEventListener('mousemove', (e) => {
      if (!_shipPreview3D.isMouseDragging) return;
      const dx = e.clientX - _shipPreview3D.lastMouseX;
      _shipPreview3D.lastMouseX = e.clientX;
      _shipPreview3D.yaw += dx * _shipPreview3D.MOUSE_ROT_RATE;
    });
    return renderer;
  } catch (e) {
    console.warn('[ship-preview] WebGL init failed:', e && e.message ? e.message : e);
    _shipPreview3D.initFailed = true;
    return null;
  }
}

function setShipPreviewModel(key) {
  if (!_shipPreview3D.renderer) _initShipPreview3D();
  if (!_shipPreview3D.renderer) return;
  _shipPreview3D.pendingKey = key;
  _applyShipPreviewModel(key);
}

function _applyShipPreviewModel(key) {
  const s = _shipPreview3D;
  if (!s.renderer) return;
  if (s.pendingKey !== key) return;
  const proto = shipModelCache.loaded && shipModelCache.loaded[key];
  if (!proto) {
    if (shipModelCache.ready && typeof shipModelCache.ready.then === 'function') {
      shipModelCache.ready.then(() => {
        if (s.pendingKey === key) _applyShipPreviewModel(key);
      });
    }
    return;
  }
  if (s.lastKey === key && s.model) return;
  // (v16a Phase II) Cache cloned + materialized models per ship key.
  if (!s.modelByKey) s.modelByKey = Object.create(null);
  if (s.model) { s.scene.remove(s.model); s.model = null; }
  s.lastKey = key;
  let modelRoot = s.modelByKey[key];
  if (!modelRoot) {
    modelRoot = proto.clone(true);
    modelRoot.traverse(child => {
      if (child.isMesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const newMats = mats.map(m => {
          if (!m) return m;
          const copy = m.clone();
          if (copy.emissive) copy.emissive.setHex(0x121a26);
          if ('emissiveIntensity' in copy) copy.emissiveIntensity = 0.45;
          return copy;
        });
        child.material = newMats.length === 1 ? newMats[0] : newMats;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    // compileAsync runs the shader compile off main thread on supporting drivers
    try {
      if (typeof s.renderer.compileAsync === 'function') {
        s.renderer.compileAsync(modelRoot, s.scene, s.camera).catch(() => {});
      } else if (typeof s.renderer.compile === 'function') {
        s.scene.add(modelRoot);
        s.renderer.compile(s.scene, s.camera);
        s.scene.remove(modelRoot);
      }
    } catch (_) {}
    s.modelByKey[key] = modelRoot;
  }
  // Fit camera dolly to the model's bbox
  const box = new THREE.Box3().setFromObject(modelRoot);
  const sz = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(sz.x, sz.y, sz.z) || 100;
  const cam = s.camera;
  cam.position.set(0, maxDim * 0.35, maxDim * 2.2);
  cam.lookAt(0, 0, 0);
  modelRoot.rotation.set(0, 0, 0);
  s.yaw = 0;
  s.scene.add(modelRoot);
  s.model = modelRoot;
}

function _animateShipPreview() {
  const s = _shipPreview3D;
  if (!s.renderer || !s.canvas) return;
  // Skip the render entirely when the tab is hidden or when the ship-select
  // panel isn't actually on screen. We still rAF so we can resume seamlessly.
  const sel = document.getElementById('ship-select');
  const visible = !document.hidden && sel && sel.classList.contains('active');
  if (!visible) {
    s.animId = requestAnimationFrame(_animateShipPreview);
    return;
  }
  // Keep the backbuffer in sync with the CSS-sized canvas.
  const w = s.canvas.clientWidth | 0;
  const h = s.canvas.clientHeight | 0;
  if (w > 0 && h > 0) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wantW = Math.floor(w * dpr), wantH = Math.floor(h * dpr);
    if (s.renderer.domElement.width !== wantW || s.renderer.domElement.height !== wantH) {
      s.renderer.setSize(w, h, false);
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
    }
  }
  const _now = performance.now();
  const _last = s._lastAnimT || _now;
  const dt = Math.min(0.1, (_now - _last) / 1000);
  s._lastAnimT = _now;

  // Gamepad right-stick X
  const gpX = (typeof input !== 'undefined' && input && input.gpConnected) ? (input.gpLookX || 0) : 0;
  const userActive = Math.abs(gpX) > 0.01 || s.isMouseDragging;
  if (Math.abs(gpX) > 0.01) {
    s.yaw += gpX * s.GAMEPAD_ROT_RATE * dt;
  }
  // Auto-rotation continues only while neither input is active
  if (!userActive) {
    s.yaw += s.rotationSpeed;
  }
  if (s.model) s.model.rotation.y = s.yaw;
  s.renderer.render(s.scene, s.camera);
  s.animId = requestAnimationFrame(_animateShipPreview);
}

function startShipPreviewLoop() {
  if (_shipPreview3D.animId) return;
  if (!_shipPreview3D.renderer) _initShipPreview3D();
  if (!_shipPreview3D.renderer) return;
  _animateShipPreview();
}

function stopShipPreviewLoop() {
  if (_shipPreview3D.animId) cancelAnimationFrame(_shipPreview3D.animId);
  _shipPreview3D.animId = null;
}

// ----- 4. LOADOUT COMMIT FLOW -----

function commitLoadout(key) {
  // (v12m) Lobby validation : refuse to launch if neither a tunnel map
  // nor a gmaps overlay is configured.
  (function _v12mValidate() {
    const sel = game.selectedMap;
    const map = sel && MAP_DATA[sel];
    const isGmapsMap = !!(map && map.type === 'gmaps');
    const hasOverlay = !!game.pendingGmapsOverlay;
    if (!map) {
      _v12mLobbyError('Pick a map (tunnel or Custom Location).');
      throw new Error('lobby: no map');
    }
    if (isGmapsMap && !hasOverlay) {
      _v12mLobbyError('Custom Location selected but no place typed. Type into DROP and click GO, or pick a tunnel map.');
      throw new Error('lobby: gmaps map without overlay');
    }
  })();
  const loadout = LOADOUTS[key];
  const ch = CHASSIS[loadout.chassis];
  // midMatch: between-rounds swap. Skip the match reset + map rebuild + bot respawn.
  const midMatch = (game.state === 'warmup' && game.currentRound && game.currentRound > 1);

  player.loadout = loadout;
  player.loadoutKey = key;
  updateCockpitFrame();
  // (v17) Kick off the overlay-frame and gun-layer preloads
  try {
    _preloadAbilityOverlayFrames(key);
    _preloadGunLayer(key);
    player._abilityOverlayTrigger = null;
    player._abilityPrime = null;
    const _aof = document.getElementById('ability-overlay-frame');
    if (_aof) { _aof.classList.remove('active'); _aof.style.backgroundImage = ''; _aof._currentUrl = null; }
    const _gl = document.getElementById('gun-layer');
    if (_gl) { _gl.classList.remove('active'); _gl.style.backgroundImage = ''; _gl._currentUrl = null; }
  } catch (_) {}
  player.chassis = ch;
  player.health = ch.maxHealth;
  player.maxHealth = ch.maxHealth;
  player.shield = ch.maxShield;
  player.maxShield = ch.maxShield;
  player.coreMeter = 0;
  player.shipState = 'spawning';
  player.spawnProtection = LSS.SPAWN_PROTECTION;
  player.doomed = false; player.doomTimer = 0;
  player.dashCharges = ch.maxDashes;
  player.maxDashes = ch.maxDashes;
  // (v16 perks) Apply the player's selected perk to base stats.
  if (!player.perkId || !PILOT_PERKS[player.perkId]) {
    try {
      const stored = localStorage.getItem('lss_perk_id');
      player.perkId = (stored && PILOT_PERKS[stored]) ? stored : PILOT_PERK_DEFAULT;
    } catch (_) { player.perkId = PILOT_PERK_DEFAULT; }
  }
  const _perk = PILOT_PERKS[player.perkId];
  // (cloak 2026-05) ALWAYS clear cloak fields on every commit
  player.perkCloakActive = false;
  player.perkCloakActiveTimer = 0;
  player.perkCloakTimer = 0;
  player._lastCorePctForCloak = 0;
  if (_perk) {
    if (_perk.shieldBonus) { player.maxShield += _perk.shieldBonus; player.shield = player.maxShield; }
    if (_perk.dashBonus) { player.maxDashes += _perk.dashBonus; player.dashCharges = player.maxDashes; }
  }
  player.weapon = loadout.weapon;
  player.clipAmmo = loadout.weapon.clipSize;
  player.maxClip = loadout.weapon.clipSize;
  player.abilities = loadout.abilities;
  player.abilityCooldowns = [0, 0, 0];
  // ... (extensive state reset: dash, ability, vortex, blaster, etc.) ...

  if (player.mesh) scene.remove(player.mesh);
  player.mesh = createShipMesh(ch, 0xff4444, key);
  player.mesh.visible = false;
  scene.add(player.mesh);
  swapToModelMeshWhenReady(player, 0xff4444);

  document.getElementById('ship-name').textContent = loadout.name;
  document.getElementById('ship-class').textContent = loadout.className;

  // v8VR: ship-AI welcomes the pilot aboard the freshly-selected chassis.
  if (typeof ANN !== 'undefined' && ANN.welcomeAboard && !midMatch) {
    ANN.welcomeAboard(loadout.name);
  }
  document.getElementById('weapon-name').textContent = loadout.weapon.name;

  buildAbilityHUD();
  // NOTE: ship-select stays visible here; launchCountdown() hides it when the
  // 3-2-1-LAUNCH ticker finishes and the player actually warps into the arena.

  if (!midMatch) {
    // Fresh match: full map build, stasis reset, bot spawn, score reset.
    const buildWorld = () => {
      shuffleMapRotation();
      const level = getNextMap();
      buildRoomGraphLevel(level);
      spawnDynamicObjects(game.sdfRoomData);
      spawnOrganics(game.sdfRoomData);
      const teamCode = player.team === LSS.TEAM_FLEET_B ? 'B' : 'A';
      player.position.copy(getValidSpawnPoint(teamCode));
      // Reset stasis field state
      game.stasisFields.forEach(f => f.destroy());
      game.stasisFields = [];
      game.stasisSpawnTimer = 30;
      game.stasisFirstBatch = true;
      game.playerInStasis = false;
      game.playerStasisTimer = 0;
      document.getElementById('stasis-warning').style.display = 'none';
      document.getElementById('stasis-vignette').style.display = 'none';
      if (!net.active) spawnBots();
    };
    if (net.active && typeof net.worldSeed === 'number') {
      const roundSeed = getRoundSeed(1);
      withSeededRandom(roundSeed, buildWorld);
    } else {
      buildWorld();
    }
    if (typeof _warmupEffectShaders === 'function') _warmupEffectShaders();
    // (v6.7) After local build, world owner ships authoritative cluster manifest
    broadcastWorldObjects();

    game.state = 'warmup';
    if (typeof musicSetPattern === 'function') {
      try { musicSetPattern('warmup', { bpmTarget: 92, intensity: 1 }); } catch (_) {}
    }
    game.roundTimer = LSS.ROUND_TIME;
    game.scoreA = 0; game.scoreB = 0; game.currentRound = 1;
    game._matchStartedAtMs = Date.now();
    game._soloMatchId = null;
    _lastPostedMatchId = null;
    game.championField = null;
    game.championSpawned = false;
    game.championResult = null;
    game.championEndTimer = 0;
    game._championPlayerChargingTeam = null;
    startAmbientBed();
  } else {
    // Between-rounds swap: place player at their team's spawn.
    player.position.copy(getValidSpawnPoint(player.team === LSS.TEAM_FLEET_B ? 'B' : 'A'));
  }

  // Announce our loadout to peers. (v10) Include Discord identity.
  if (net.active && net.sendLoadout) {
    const _du = (typeof discordCurrentUser === 'function') ? discordCurrentUser() : null;
    net.sendLoadout({
      loadoutKey: player.loadoutKey,
      team: player.team,
      peerId: net.myPeerId,
      discord_id:     _du ? _du.id : undefined,
      discord_name:   _du ? (_du.global_name || _du.username) : undefined,
      discord_avatar: _du ? _du.avatar : undefined,
    });
  }

  if (!_countdownActive) {
    _anchorTimer('warmupTimer', LSS.LAUNCH_COUNTDOWN);
  }
  updateTeammatesStrip();
  warmupCombatShaders();
  // In multiplayer, picking a ship IS the "ready" signal. Don't launch alone;
  // the lowest-peerId peer proposes a synced launchAt timestamp once every peer
  // has committed. Solo launches immediately.
  if (net.active) {
    showShipSelectWaiting();
    checkAllLoadoutsReady();
  } else {
    launchCountdown();
  }
}

// Legacy entry point: anywhere still calling selectLoadout(key) jumps straight
// to the commit path.
function selectLoadout(key) { commitLoadout(key); }

// ----- 5. PILOT PERK PICKER -----

// (v16 perks) Build the perk picker tiles in the ship-select panel.
// Persists choice to localStorage AND to player.perkId so commitLoadout
// can apply effects on launch.
function _getStoredPerkId() {
  try {
    const stored = localStorage.getItem('lss_perk_id');
    if (stored && PILOT_PERKS[stored]) return stored;
  } catch (_) {}
  return PILOT_PERK_DEFAULT;
}
function _setStoredPerkId(id) {
  if (!PILOT_PERKS[id]) return;
  try { localStorage.setItem('lss_perk_id', id); } catch (_) {}
  if (typeof player !== 'undefined') player.perkId = id;
}
// (v16 perks) Gamepad LB/RB shoulder-button cycling for the perk picker.
function _cyclePerk(dir) {
  const ids = Object.keys(PILOT_PERKS);
  if (!ids.length) return;
  const curId = (player && player.perkId && PILOT_PERKS[player.perkId])
    ? player.perkId : _getStoredPerkId();
  let idx = ids.indexOf(curId);
  if (idx < 0) idx = 0;
  idx = (idx + (dir | 0) + ids.length) % ids.length;
  _setStoredPerkId(ids[idx]);
  _renderPerkPicker();
}

function _renderPerkPicker() {
  const panel = document.getElementById('ship-preview-perks');
  const grid = document.getElementById('perks-grid');
  const desc = document.getElementById('perks-desc');
  if (!panel || !grid || !desc) return;
  panel.style.display = 'flex';
  grid.innerHTML = '';
  const currentId = (player && player.perkId && PILOT_PERKS[player.perkId])
    ? player.perkId : _getStoredPerkId();
  if (player) player.perkId = currentId;
  for (const [id, p] of Object.entries(PILOT_PERKS)) {
    const card = document.createElement('div');
    card.className = 'perk-card' + (id === currentId ? ' selected' : '');
    card.dataset.perkId = id;
    card.innerHTML =
      '<div class="perk-card-icon" style="color:' +
        '#' + (p.color || 0xffffff).toString(16).padStart(6, '0') + ';">' + p.icon + '</div>' +
      '<div class="perk-card-name">' + p.name + '</div>';
    card.addEventListener('click', () => {
      _setStoredPerkId(id);
      _renderPerkPicker();
    });
    card.addEventListener('mouseenter', () => {
      desc.textContent = p.desc;
    });
    grid.appendChild(card);
  }
  const cur = PILOT_PERKS[currentId];
  if (cur) desc.textContent = cur.desc;
}

// ----- 6. MAP SELECTOR -----

function buildMapSelector() {
  const keys = _visibleMapKeys();
  if (keys.length === 0) return;

  // Default selection on first entry; otherwise keep the player's last choice
  // IF it's still valid for the current mode.
  if (!game.selectedMap || !MAP_DATA[game.selectedMap] || keys.indexOf(game.selectedMap) === -1) {
    game.selectedMap = keys[0];
  }

  // Build the indicator dots (one per map).
  const indicator = document.getElementById('map-indicator');
  if (indicator) {
    indicator.innerHTML = '';
    for (const k of keys) {
      const dot = document.createElement('div');
      dot.className = 'map-dot';
      dot.dataset.key = k;
      dot.addEventListener('click', () => selectMap(k));
      dot.style.cursor = 'pointer';
      dot.style.pointerEvents = 'all';
      indicator.appendChild(dot);
    }
  }

  // Rebind prev/next arrows (clone to drop any old handlers if buildMapSelector
  // is called multiple times in one session).
  const rebindArrow = (id, dir) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const fresh = btn.cloneNode(true);
    fresh.setAttribute('tabindex', '-1');
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => {
      cycleMap(dir);
      try { fresh.blur(); } catch (_) {}
    });
    fresh.addEventListener('mousedown', () => { try { fresh.blur(); } catch (_) {} });
  };
  rebindArrow('map-prev', -1);
  rebindArrow('map-next',  1);

  if (typeof _bindSkyArrows === 'function') _bindSkyArrows();
  if (typeof _updateSkyUI === 'function')   _updateSkyUI();

  selectMap(game.selectedMap);
  _syncMapButtonsDisabled();
}

// Set the current map by key; update the window contents, the active dot, and
// the checkmark. Safe to call directly.
function selectMap(mapKey) {
  if (!MAP_DATA[mapKey]) return;
  // (v6.7) Echo guard: receivers re-call selectMap with the new key, which
  // would re-broadcast and bounce back.
  if (game.selectedMap === mapKey) return;
  game.selectedMap = mapKey;
  const mapData = MAP_DATA[mapKey];

  const nameEl = document.getElementById('map-window-name');
  if (nameEl) nameEl.textContent = mapData.name;
  const descEl = document.getElementById('map-window-desc');
  if (descEl) descEl.textContent = mapData.description;

  // Active dot
  const dots = document.querySelectorAll('#map-indicator .map-dot');
  dots.forEach(d => d.classList.toggle('active', d.dataset.key === mapKey));

  // (v6.7) Pre-match map sync. (v12m) Tag along the typed gmaps overlay so
  // peers stay in sync.
  if (net.active && net.sendEvent) {
    const ov = game.pendingGmapsOverlay;
    net.sendEvent({
      type: 'map_change',
      mapKey,
      gmapsOverlay: ov ? { lat: ov.lat, lng: ov.lng, name: ov.name } : null,
      // (v13r) Tag along the current race-mode flag so peers stay in sync.
      mode: LSS.MODE || 'classic'
    });
  }
}

// Cycle to the prev (-1) or next (+1) map, wrapping at either end.
function cycleMap(dir) {
  // (v13r) Cycle only through maps eligible for the active mode.
  const keys = _visibleMapKeys();
  if (keys.length === 0) return;
  if (!game.selectedMap || !MAP_DATA[game.selectedMap] || keys.indexOf(game.selectedMap) === -1) {
    selectMap(keys[0]);
    return;
  }
  const idx = keys.indexOf(game.selectedMap);
  const next = ((idx + dir) % keys.length + keys.length) % keys.length;
  selectMap(keys[next]);
}

// ----- 7. RACE MODE TOGGLE -----

// Definition in the LSS config (around line 2864):
// const LSS = {
//   ...
//   MODE: 'classic',           // 'classic' | 'race'
//   RACE_SPEED: 900,           // baseline race velocity for all chassis
//   RACE_DASH_SPEED: 1400,     // dash/afterburner velocity in race mode
// };

// (v13r) Race-mode toggle: flip LSS.MODE and rebroadcast the current
// map_change so peers stay in sync. When flipping ON, auto-select Pole Position.
const raceBtn = document.getElementById('race-mode-toggle');
if (raceBtn) {
  raceBtn.addEventListener('click', () => {
    const on = raceBtn.dataset.on !== '1';
    raceBtn.dataset.on = on ? '1' : '0';
    raceBtn.textContent = on ? 'RACE MODE: ON' : 'RACE MODE: OFF';
    raceBtn.classList.toggle('active', on);
    LSS.MODE = on ? 'race' : 'classic';
    // (v13r) Rebuild the carousel so the dots / arrows reflect the new
    // mode's filtered map list.
    if (typeof buildMapSelector === 'function') {
      try { buildMapSelector(); } catch (_) {}
    }
    // (v13r-2) Toggle the FINISH input + relabel the panel for race mode.
    try {
      const lbl = document.getElementById('gmaps-overlay-label');
      const fin = document.getElementById('gmaps-loc-finish-input');
      const startInp = document.getElementById('gmaps-loc-input');
      if (on) {
        if (lbl) lbl.textContent = 'RACE: START -> FINISH';
        if (fin) fin.style.display = '';
        if (startInp) startInp.placeholder = 'Start location (e.g. Stanley Park)';
      } else {
        if (lbl) lbl.textContent = 'DROP ON LOCATION';
        if (fin) fin.style.display = 'none';
        if (startInp) startInp.placeholder = 'Empire State Building';
      }
    } catch (_) {}
    // Convenience: when flipping ON, also set the race-default walls
    // to Datamosh Cube (preset 22).
    if (on && typeof setWallPattern === 'function') {
      try { setWallPattern(22); } catch (_) {}
    }
    // Convenience: when flipping ON, force-select Pole Position
    if (on && typeof selectMap === 'function' && MAP_DATA && MAP_DATA.race_pole_position) {
      if (game.selectedMap !== 'race_pole_position') {
        selectMap('race_pole_position');
        return;
      }
    }
    if (net && net.active && net.sendEvent && game.selectedMap) {
      const ov = game.pendingGmapsOverlay;
      net.sendEvent({
        type: 'map_change',
        mapKey: game.selectedMap,
        gmapsOverlay: ov ? { lat: ov.lat, lng: ov.lng, name: ov.name } : null,
        mode: LSS.MODE
      });
    }
  });
}

// ----- 8. DROP / GMAPS CUSTOM-LOCATION PANEL -----

function _v12mLobbyError(msg) {
  try {
    const stat = document.getElementById('gmaps-loc-status');
    if (stat) {
      stat.textContent = msg;
      stat.classList.remove('ok'); stat.classList.add('err');
      return;
    }
  } catch(_) {}
  alert(msg);
}

// (v12 patch13) Wire the lobby's DROP / DETACH buttons + Enter key on
// the location input to the gmaps overlay path. Bound once at boot.
(function _lssGmapsLobbyBindings() {
  const goBtn  = document.getElementById('gmaps-loc-go');
  const detBtn = document.getElementById('gmaps-loc-detach');
  const inp    = document.getElementById('gmaps-loc-input');
  const stat   = document.getElementById('gmaps-loc-status');
  if (!goBtn || !detBtn || !inp || !stat) return;
  function setStatus(msg, kind) {
    stat.textContent = msg || '';
    stat.classList.remove('err','ok');
    if (kind) stat.classList.add(kind);
  }
  let _pulseTimer = null;
  function stopPulse() { if (_pulseTimer) { clearInterval(_pulseTimer); _pulseTimer = null; } }
  async function doDrop() {
    const q = (inp.value || '').trim();
    if (!q) { setStatus('Type a location first.', 'err'); inp.focus(); return; }
    setStatus('Looking up ' + q + '...');
    let lat, lng, displayName;
    const coordMatch = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordMatch) {
      lat = parseFloat(coordMatch[1]); lng = parseFloat(coordMatch[2]);
      displayName = 'Custom (' + lat.toFixed(4) + ', ' + lng.toFixed(4) + ')';
    } else {
      try {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) throw new Error('Geocoder HTTP ' + resp.status);
        const arr = await resp.json();
        if (!Array.isArray(arr) || arr.length === 0) {
          setStatus('No match for: ' + q, 'err'); return;
        }
        lat = parseFloat(arr[0].lat); lng = parseFloat(arr[0].lon);
        displayName = arr[0].display_name || q;
      } catch (e) {
        setStatus('Geocoder failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
        return;
      }
    }
    // Store the typed location ; LAUNCH will use it.
    game.pendingGmapsOverlay = { lat, lng, name: displayName };
    // (v16a Phase V) Custom Location and Map Preset are mutually exclusive
    game.mapPreset = '';
    if (typeof _updateSkyUI === 'function') { try { _updateSkyUI(); } catch (_) {} }
    const shortName = displayName.length > 60 ? displayName.slice(0, 57) + '...' : displayName;

    // (v13r-2) Race-mode branch : if the FINISH input is also filled,
    // geocode it and procgen a race route.
    const finInp = document.getElementById('gmaps-loc-finish-input');
    if (LSS.MODE === 'race' && finInp && (finInp.value || '').trim()) {
      const fq = finInp.value.trim();
      let flat, flng, fname;
      const fcm = fq.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (fcm) {
        flat = parseFloat(fcm[1]); flng = parseFloat(fcm[2]);
        fname = 'Custom (' + flat.toFixed(4) + ', ' + flng.toFixed(4) + ')';
      } else {
        try {
          const furl = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(fq);
          const fresp = await fetch(furl, { headers: { 'Accept': 'application/json' } });
          if (!fresp.ok) throw new Error('Geocoder HTTP ' + fresp.status);
          const farr = await fresp.json();
          if (!Array.isArray(farr) || farr.length === 0) {
            setStatus('No match for finish: ' + fq, 'err'); return;
          }
          flat = parseFloat(farr[0].lat); flng = parseFloat(farr[0].lon);
          fname = farr[0].display_name || fq;
        } catch (e) {
          setStatus('Finish geocoder failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
          return;
        }
      }
      const raceFinish = { lat: flat, lng: flng, name: fname };
      const procgen = _buildRaceCustomMap({ lat, lng, name: displayName }, raceFinish);
      MAP_DATA.race_custom = procgen;
      game.pendingRaceRoute = { start: { lat, lng, name: displayName }, finish: raceFinish };
      game.raceNoTimer = true;
      setStatus('Race route armed : ' + shortName + ' -> ' + (fname.length > 40 ? fname.slice(0, 37) + '...' : fname), 'ok');
      try {
        if (typeof selectMap === 'function') {
          game.selectedMap = '__force_race_custom__';
          selectMap('race_custom');
        }
      } catch(_) {}
      if (typeof buildMapSelector === 'function') { try { buildMapSelector(); } catch(_) {} }
      return;
    }

    // (v12m) Broadcast to peers so they apply the same overlay.
    if (net && net.active && net.sendEvent) {
      net.sendEvent({
        type: 'map_change',
        mapKey: game.selectedMap,
        gmapsOverlay: { lat, lng, name: displayName },
        mode: LSS.MODE || 'classic'
      });
    }
    const sel = game.selectedMap;
    const isGmaps = sel && MAP_DATA[sel] && MAP_DATA[sel].type === 'gmaps';
    if (isGmaps) {
      const e = MAP_DATA[sel];
      e.lat = lat; e.lng = lng;
      e.name = shortName;
      e.description = 'Pure city flight. Lat ' + lat.toFixed(4) + ', Lng ' + lng.toFixed(4) + '.';
      const wasKey = sel; game.selectedMap = null; selectMap(wasKey);
      setStatus('Pure-city map selected: ' + shortName + '. LAUNCH to drop in.', 'ok');
    } else {
      const tunnelName = (MAP_DATA[sel] && MAP_DATA[sel].name) || sel;
      setStatus('Will overlay ' + shortName + ' under "' + tunnelName + '" on LAUNCH.', 'ok');
    }
  }
  goBtn.addEventListener('click', doDrop);
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doDrop(); } });
  detBtn.addEventListener('click', () => {
    stopPulse();
    _lssGmapsDetachCity();
    game.pendingGmapsOverlay = null;
    if (typeof _updateSkyUI === 'function') { try { _updateSkyUI(); } catch (_) {} }
    // (v13r-2) Also clear race-custom route on DETACH.
    game.pendingRaceRoute = null;
    game.raceNoTimer = false;
    if (MAP_DATA && MAP_DATA.race_custom) delete MAP_DATA.race_custom;
    if (typeof LSS._origArenaSize === 'number') LSS.ARENA_SIZE = LSS._origArenaSize;
    if (typeof LSS._origCameraFar === 'number') {
      camera.far = LSS._origCameraFar; camera.updateProjectionMatrix();
    }
    if (scene.fog && typeof LSS._origFogDensity === 'number') {
      scene.fog.density = LSS._origFogDensity;
    }
    if (game.selectedMap === 'race_custom') {
      if (typeof buildMapSelector === 'function') { try { buildMapSelector(); } catch(_) {} }
    }
    try {
      const fin = document.getElementById('gmaps-loc-finish-input');
      if (fin) fin.value = '';
    } catch (_) {}
    setStatus('Overlay cleared. Pick a tunnel map and LAUNCH for plain combat.', 'ok');
    try { const inp = document.getElementById('gmaps-loc-input'); if (inp) inp.disabled = false; } catch(_) {}
    // (v12m) Broadcast detach so peers also clear and unlock.
    if (net && net.active && net.sendEvent) {
      net.sendEvent({ type: 'map_change', mapKey: game.selectedMap, gmapsOverlay: null, mode: LSS.MODE || 'classic' });
    }
  });
  // ... raceBtn handler (above section 7) lives at end of this IIFE ...
})();

// ----- 9. SETTINGS PANEL -----

// (perf 2026-05) buildSettingsPage builds once and the cheap value-refresh path
// handles every subsequent call.
function buildSettingsPage() {
  if (_settingsBuilt) {
    _refreshSettingsValues();
    return;
  }
  _settingsBuilt = true;
  const overlay = document.getElementById('settings-overlay');
  overlay.innerHTML = `
    <h1>SETTINGS</h1>
    <h2>CONTROLS & INPUT</h2>
    <div class="settings-section">
      <h3>Mouse</h3>
      <div class="setting-row">
        <label>Mouse Sensitivity</label>
        <input type="range" id="set-mouse-sens" min="0.0005" max="0.01" step="0.0005" value="${input.sensitivity}">
        <div class="value-display" id="val-mouse-sens">${input.sensitivity.toFixed(4)}</div>
      </div>
    </div>
    <div class="settings-section">
      <h3>Gamepad - Sensitivity</h3>
      <div class="setting-row">
        <label>Look Sensitivity</label>
        <input type="range" id="set-gp-look-sens" min="1" max="10" step="0.5" value="${input.gpLookSensitivity}">
        <div class="value-display" id="val-gp-look-sens">${input.gpLookSensitivity.toFixed(1)}</div>
      </div>
      <div class="setting-row">
        <label>Move Sensitivity</label>
        <input type="range" id="set-gp-move-sens" min="1" max="10" step="0.5" value="${input.gpMoveSensitivity}">
        <div class="value-display" id="val-gp-move-sens">${input.gpMoveSensitivity.toFixed(1)}</div>
      </div>
      <div class="setting-row">
        <label>Look Response Curve</label>
        <input type="range" id="set-gp-look-curve" min="1" max="3" step="0.1" value="${input.gpLookCurve}">
      </div>
      <div class="setting-row">
        <label>Move Response Curve</label>
        <input type="range" id="set-gp-move-curve" min="1" max="3" step="0.1" value="${input.gpMoveCurve}">
      </div>
    </div>
    <div class="settings-section">
      <h3>Gamepad - Deadzone</h3>
      <div class="setting-row">
        <label>Stick Deadzone</label>
        <input type="range" id="set-gp-deadzone" min="0" max="0.5" step="0.01" value="${input.gpDeadzone}">
      </div>
      <div class="setting-row">
        <label>Trigger Threshold</label>
        <input type="range" id="set-gp-trigger" min="0.05" max="0.9" step="0.05" value="${input.triggerThreshold}">
      </div>
    </div>
    <div class="settings-section">
      <h3>Gamepad - Options</h3>
      <div class="setting-row">
        <label>Invert Look Y</label>
        <input type="checkbox" id="set-gp-invert-y" ${input.invertLookY ? 'checked' : ''}>
      </div>
      <div class="setting-row">
        <label>Swap Sticks (Southpaw)</label>
        <input type="checkbox" id="set-gp-swap" ${input.swapSticks ? 'checked' : ''}>
      </div>
    </div>
    <div class="settings-section">
      <h3>Gamepad - Button Mapping</h3>
      <div id="bind-rows"></div>
    </div>
    <div class="settings-section">
      <h3>VR Controllers - Button Mapping</h3>
      <div id="xr-bind-rows"></div>
      <div class="setting-row" style="margin-top:6px;">
        <label>Left thumbstick acts as D-Pad</label>
        <input type="checkbox" id="set-xr-leftstick-dpad" ${input.xrSynth && input.xrSynth.leftStickAsDpad ? 'checked' : ''}>
      </div>
      <div class="setting-row" style="margin-top:4px;">
        <button id="xr-reset-defaults">Reset VR Defaults</button>
      </div>
    </div>
    <div class="settings-section">
      <h3>VR - Head Aim Nudge</h3>
      <div class="setting-row"><label>Enable</label>
        <input type="checkbox" id="set-vrha-enabled" ${input.vrHeadAim && input.vrHeadAim.enabled ? 'checked' : ''}></div>
      <div class="setting-row"><label>Cone Radius (deg)</label>
        <input type="range" id="set-vrha-radius" min="2" max="40" step="1" value="${(input.vrHeadAim && input.vrHeadAim.radiusDeg) || 12}"></div>
      <div class="setting-row"><label>Nudge Sensitivity</label>
        <input type="range" id="set-vrha-sens" min="0.1" max="6" step="0.1" value="${(input.vrHeadAim && input.vrHeadAim.sensitivity) || 2.0}"></div>
      <div class="setting-row"><label>Invert Pitch</label>
        <input type="checkbox" id="set-vrha-invert" ${input.vrHeadAim && input.vrHeadAim.invertPitch ? 'checked' : ''}></div>
    </div>
    <div class="settings-section">
      <h3>VR - Performance</h3>
      <div class="setting-row">
        <label>Performance Mode</label>
        <select id="set-vr-perf" style="flex:1;">
          <option value="standard">Standard</option>
          <option value="lite">Quest Lite</option>
          <option value="fast">Quest Fast</option>
          <option value="max">Max FPS</option>
        </select>
      </div>
      <div class="setting-row">
        <label>VR Render Scale</label>
        <input type="range" id="set-vr-scale" min="0.35" max="1.2" step="0.05" value="${(typeof input.vrRenderScale === 'number') ? input.vrRenderScale : 0.7}">
      </div>
    </div>
    <div class="settings-section">
      <h3>Keyboard - Mapping</h3>
      <div id="kb-bind-rows"></div>
      <div class="setting-row" style="margin-top:4px;">
        <button id="kb-reset-defaults">Reset Keyboard Defaults</button>
      </div>
    </div>
    <h2>GRAPHICS</h2>
    <div class="settings-section"><h3>Active GPU</h3>
      <div class="setting-row"><label id="set-gpu-info">${(window.__v8GPU && window.__v8GPU.renderer) ? window.__v8GPU.renderer : 'detecting...'}</label></div>
    </div>
    <div class="settings-section"><h3>Cinematic Mode</h3>
      <div class="setting-row"><label>Enable</label>
        <input type="checkbox" id="set-showcase" ${(typeof showcase !== 'undefined' && showcase.active) ? 'checked' : ''}></div>
    </div>
    <div class="settings-section"><h3>Quality</h3>
      <div class="setting-row"><label>Preset</label>
        <select id="set-quality" style="flex:1;">
          <option value="potato" ${QUALITY.level === 'potato' ? 'selected' : ''}>Potato</option>
          <option value="low" ${QUALITY.level === 'low' ? 'selected' : ''}>Low</option>
          <option value="medium" ${QUALITY.level === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${QUALITY.level === 'high' ? 'selected' : ''}>High</option>
          <option value="ultra" ${QUALITY.level === 'ultra' ? 'selected' : ''}>Ultra</option>
        </select>
      </div>
      <div class="setting-row"><label>Field of View</label>
        <input type="range" id="set-fov" min="60" max="120" step="1" value="${(typeof input.fovDeg === 'number') ? input.fovDeg : 90}"></div>
    </div>
    <div class="settings-section"><h3>Wall Pattern</h3>
      <div class="setting-row"><label>Style</label>
        <select id="set-wall-pattern" style="flex:1;">
          ${WALL_PATTERN_NAMES.map((nm, i) => `<option value="${i}"${(game.wallPattern|0) === i ? ' selected' : ''}>${nm}</option>`).join('')}
        </select></div>
      <div class="setting-row"><label>Pure Black Base</label>
        <input type="checkbox" id="set-wall-black-base" ${game.wallBlackBase ? 'checked' : ''}></div>
      <div class="setting-row"><label>Wall opacity</label>
        <input type="range" id="set-wall-opacity" min="0" max="1" step="0.02" value="${(typeof game.wallOpacity === 'number') ? game.wallOpacity : 1.0}"></div>
      <div class="setting-row" style="margin-top:6px;">
        <button id="wall-import-btn">Import Lab Config</button>
        <button id="wall-reload-defaults">Reload LSS_WALLS.json</button>
        <button id="wall-lab-reset">Reset to Built-in</button>
        <input type="file" id="wall-import-file" accept="application/json,.json" style="display:none;">
      </div>
    </div>
    <div class="settings-section"><h3>Background</h3>
      <div class="setting-row"><label>Skybox</label>
        <select id="set-skybox" style="flex:1;">
          ${(typeof _skyboxLabels !== 'undefined' ? _skyboxLabels : []).map(([k, lbl]) => {
            const sel = (game.skyboxChoice || '') === k ? ' selected' : '';
            return '<option value="' + k + '"' + sel + '>' + lbl + '</option>';
          }).join('')}
        </select></div>
    </div>
    <h2>AUDIO</h2>
    <div class="settings-section"><h3>Volume</h3>
      <div class="setting-row"><label>Master</label>
        <input type="range" id="set-vol-master" min="0" max="1" step="0.01" value="${(audio && audio.userVol && typeof audio.userVol.master === 'number') ? audio.userVol.master : 0.8}"></div>
      <div class="setting-row"><label>SFX</label>
        <input type="range" id="set-vol-sfx" min="0" max="1" step="0.01" value="${(audio && audio.userVol && typeof audio.userVol.sfx === 'number') ? audio.userVol.sfx : 0.8}"></div>
      <div class="setting-row"><label>Ambient</label>
        <input type="range" id="set-vol-ambient" min="0" max="1" step="0.01" value="${(audio && audio.userVol && typeof audio.userVol.ambient === 'number') ? audio.userVol.ambient : 0.5}"></div>
      <div class="setting-row"><label>Music</label>
        <input type="range" id="set-vol-music" min="0" max="1" step="0.01" value="${(audio && audio.userVol && typeof audio.userVol.music === 'number') ? audio.userVol.music : 0.45}"></div>
    </div>
    <div class="settings-section"><h3>Music</h3>
      <div class="setting-row"><label>Music Enabled</label>
        <input type="checkbox" id="set-music-enabled" ${(audio && audio.musicEnabled !== false) ? 'checked' : ''}></div>
      <div class="setting-row"><label>Mute Music In Lobby</label>
        <input type="checkbox" id="set-music-mute-lobby" ${(audio && audio.musicMuteLobby) ? 'checked' : ''}></div>
      <div class="setting-row"><label>Intensity Ceiling</label>
        <select id="set-music-ceiling" style="flex:1;">
          <option value="chill"  ${(audio && audio.musicCeiling) === 'chill'  ? 'selected' : ''}>Chill</option>
          <option value="normal" ${!audio || !audio.musicCeiling || audio.musicCeiling === 'normal' ? 'selected' : ''}>Normal</option>
          <option value="wild"   ${(audio && audio.musicCeiling) === 'wild'   ? 'selected' : ''}>Wild</option>
        </select></div>
      <div class="setting-row"><label>Style</label>
        <select id="set-music-style" style="flex:1;">
          <option value="cosmic" ${!audio || !audio.musicStyle || audio.musicStyle === 'cosmic' ? 'selected' : ''}>Cosmic</option>
          <option value="cyber"  ${(audio && audio.musicStyle) === 'cyber'  ? 'selected' : ''}>Cyber</option>
          <option value="doom"   ${(audio && audio.musicStyle) === 'doom'   ? 'selected' : ''}>Doom</option>
          <option value="drift"  ${(audio && audio.musicStyle) === 'drift'  ? 'selected' : ''}>Drift</option>
          <option value="battle" ${(audio && audio.musicStyle) === 'battle' ? 'selected' : ''}>Battle</option>
          <option value="jazz"   ${(audio && audio.musicStyle) === 'jazz'   ? 'selected' : ''}>Jazz</option>
          <option value="techno" ${(audio && audio.musicStyle) === 'techno' ? 'selected' : ''}>Techno</option>
        </select></div>
    </div>
    <div class="settings-section"><h3>Announcer</h3>
      <div class="setting-row"><label>Enabled</label>
        <input type="checkbox" id="set-announcer-enabled" ${(typeof announcer !== 'undefined' && announcer.enabled !== false) ? 'checked' : ''}></div>
      <div class="setting-row"><label>Voice</label>
        <select id="set-announcer-voice" style="flex:1;"></select></div>
      <div class="setting-row" style="margin-top:4px;">
        <button id="set-announcer-audition">Audition Voice</button>
      </div>
    </div>
    <button id="settings-close">CLOSE</button>
    <button id="settings-reset">RESET TO DEFAULTS</button>
    <button id="settings-export">EXPORT</button>
    <button id="settings-import">IMPORT</button>
  `;
  // (port 2026-05-19) Wire the audio + music + announcer controls. The
  // earlier wiring lived inside a 600-line block dropped during extraction ;
  // we re-attach the minimum set needed to make sliders + checkboxes work.
  try {
    const wire = (id, handler, evt) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt || 'input', () => { try { handler(el); } catch (_) {} try { saveSettings(); } catch (_) {} });
    };
    // ---- Controls : mouse + gamepad ----
    wire('set-mouse-sens', (el) => {
      input.sensitivity = parseFloat(el.value);
      const disp = document.getElementById('val-mouse-sens');
      if (disp) disp.textContent = input.sensitivity.toFixed(4);
    });
    wire('set-gp-look-sens', (el) => {
      input.gpLookSensitivity = parseFloat(el.value);
      const disp = document.getElementById('val-gp-look-sens');
      if (disp) disp.textContent = input.gpLookSensitivity.toFixed(1);
    });
    wire('set-gp-move-sens', (el) => {
      input.gpMoveSensitivity = parseFloat(el.value);
      const disp = document.getElementById('val-gp-move-sens');
      if (disp) disp.textContent = input.gpMoveSensitivity.toFixed(1);
    });
    wire('set-gp-look-curve', (el) => { input.gpLookCurve = parseFloat(el.value); });
    wire('set-gp-move-curve', (el) => { input.gpMoveCurve = parseFloat(el.value); });
    wire('set-gp-deadzone',   (el) => { input.gpDeadzone   = parseFloat(el.value); });
    wire('set-gp-trigger',    (el) => { input.triggerThreshold = parseFloat(el.value); });
    wire('set-gp-invert-y',   (el) => { input.invertLookY  = el.checked; }, 'change');
    wire('set-gp-swap',       (el) => { input.swapSticks   = el.checked; }, 'change');
    // ---- Graphics : FOV + quality + wall pattern + skybox + showcase ----
    wire('set-fov', (el) => {
      input.fovDeg = parseFloat(el.value);
      try { if (typeof camera !== 'undefined' && camera) { camera.fov = input.fovDeg; camera.updateProjectionMatrix(); } } catch (_) {}
    });
    wire('set-quality', (el) => {
      if (typeof applyQualityPreset === 'function') applyQualityPreset(el.value);
    }, 'change');
    wire('set-wall-pattern', (el) => {
      game.wallPattern = parseInt(el.value, 10) || 0;
      // v17 uses applyMultiLayerPreset(idx % WALL_PATTERN_NAMES.length) ;
      // see arena.js:1063.
      try {
        if (typeof applyMultiLayerPreset === 'function' && typeof WALL_PATTERN_NAMES !== 'undefined') {
          applyMultiLayerPreset(game.wallPattern % WALL_PATTERN_NAMES.length);
        }
      } catch (_) {}
    }, 'change');
    wire('set-wall-black-base', (el) => { game.wallBlackBase = el.checked; }, 'change');
    wire('set-wall-opacity', (el) => {
      game.wallOpacity = parseFloat(el.value);
      try { if (typeof applyWallOpacity === 'function') applyWallOpacity(game.wallOpacity); } catch (_) {}
    });
    wire('set-skybox', (el) => {
      game.skyboxChoice = el.value;
      try { if (typeof applySkybox === 'function') applySkybox(game.skyboxChoice); } catch (_) {}
    }, 'change');
    wire('set-showcase', (el) => {
      try { if (typeof showcase !== 'undefined') showcase.active = el.checked; } catch (_) {}
      // (bugfix 2026-05-20 #304) Persist the Cinematic Mode preference
      // so the user's choice survives reloads. Paired with the boot
      // default in webGPU.html which reads 'lss_showcase' on init.
      try { localStorage.setItem('lss_showcase', el.checked ? '1' : '0'); } catch (_) {}
    }, 'change');
    wire('set-vol-master', (el) => {
      const v = parseFloat(el.value);
      if (audio && audio.userVol) audio.userVol.master = v;
      // v17 multiplies userVol.master by 0.85 to set masterGain.
      if (audio && audio.masterGain && audio.masterGain.gain) audio.masterGain.gain.value = 0.85 * v;
      if (audio && audio.spatial51Master && audio.spatial51Master.gain) audio.spatial51Master.gain.value = 0.85 * v;
    });
    wire('set-vol-sfx', (el) => {
      const v = parseFloat(el.value);
      if (audio && audio.userVol) audio.userVol.sfx = v;
      // v17 uses audio.sfxBus.gain (not sfxGain).
      if (audio && audio.sfxBus && audio.sfxBus.gain) audio.sfxBus.gain.value = v;
      if (audio && audio.spatial51Bus && audio.spatial51Bus.gain) audio.spatial51Bus.gain.value = v;
    });
    wire('set-vol-ambient', (el) => {
      const v = parseFloat(el.value);
      if (audio && audio.userVol) audio.userVol.ambient = v;
      // Ambient gain reads userVol.ambient each tick (see audio.js:596) ;
      // no direct gain.value setter required.
    });
    wire('set-vol-music', (el) => {
      const v = parseFloat(el.value);
      if (audio && audio.userVol) audio.userVol.music = v;
      if (audio && audio.musicGain && audio.musicGain.gain) audio.musicGain.gain.value = 0.30 * v;
    });
    wire('set-music-enabled', (el) => {
      if (audio) audio.musicEnabled = el.checked;
      if (typeof musicSetEnabled === 'function') musicSetEnabled(el.checked);
    }, 'change');
    wire('set-music-mute-lobby', (el) => {
      if (audio) audio.musicMuteLobby = el.checked;
    }, 'change');
    wire('set-music-ceiling', (el) => {
      if (audio) audio.musicCeiling = el.value;
      if (typeof musicSetCeiling === 'function') musicSetCeiling(el.value);
    }, 'change');
    wire('set-music-style', (el) => {
      if (audio) audio.musicStyle = el.value;
      if (typeof musicSetStyle === 'function') musicSetStyle(el.value);
    }, 'change');
    wire('set-announcer-enabled', (el) => {
      if (typeof announcer !== 'undefined') announcer.enabled = el.checked;
    }, 'change');
    // Populate announcer voice list lazily ; speechSynthesis voices load async.
    const populateVoices = () => {
      const sel = document.getElementById('set-announcer-voice');
      if (!sel || typeof announcerListVoices !== 'function') return;
      const voices = announcerListVoices() || [];
      sel.innerHTML = '';
      for (const v of voices) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.name + (v.lang ? '  ('+v.lang+')' : '');
        if (typeof announcer !== 'undefined' && announcer.voiceName === v.name) opt.selected = true;
        sel.appendChild(opt);
      }
    };
    populateVoices();
    try {
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.addEventListener('voiceschanged', populateVoices);
      }
    } catch (_) {}
    wire('set-announcer-voice', (el) => {
      if (typeof announcerSetVoiceByName === 'function') announcerSetVoiceByName(el.value);
    }, 'change');
    const audBtn = document.getElementById('set-announcer-audition');
    if (audBtn) audBtn.addEventListener('click', () => {
      try { if (typeof announcerAudition === 'function') announcerAudition(); } catch (_) {}
    });
    // (port 2026-05-19) Settings export : dump lss_settings localStorage
    // entry as a JSON file download. Useful for backing up complex
    // gamepad rebinds + audio volumes + map presets. saveSettings is
    // called first to make sure the on-disk JSON reflects the current
    // in-memory state.
    const exportBtn = document.getElementById('settings-export');
    if (exportBtn) exportBtn.addEventListener('click', () => {
      try { saveSettings(); } catch (_) {}
      try {
        const raw = localStorage.getItem('lss_settings') || '{}';
        const blob = new Blob([raw], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = 'lss_settings_' + ts + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) { console.warn('[settings-export]', e); }
    });
    // Settings import : open file picker, parse JSON, write to
    // localStorage, call loadSettings to apply. Rebuilds the settings
    // panel so all UI controls reflect the imported values.
    const importBtn = document.getElementById('settings-import');
    if (importBtn) importBtn.addEventListener('click', () => {
      try {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'application/json,.json';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              // Validate it parses as JSON before we overwrite storage.
              const _data = JSON.parse(reader.result);
              localStorage.setItem('lss_settings', JSON.stringify(_data));
              if (typeof loadSettings === 'function') loadSettings();
              // Rebuild UI so all controls reflect imported values.
              try { _settingsBuilt = false; buildSettingsPage(); } catch (_) {}
            } catch (err) {
              alert('Settings import failed : ' + err.message);
            }
          };
          reader.readAsText(file);
        });
        document.body.appendChild(fileInput);
        fileInput.click();
        setTimeout(() => { try { document.body.removeChild(fileInput); } catch (_) {} }, 1000);
      } catch (e) { console.warn('[settings-import]', e); }
    });
    // Close / reset buttons.
    const closeBtn = document.getElementById('settings-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { try { closeSettings(); } catch (_) {} });
    const resetBtn = document.getElementById('settings-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      try { if (typeof resetSettingsToDefaults === 'function') resetSettingsToDefaults(); } catch (_) {}
      try { _settingsBuilt = false; buildSettingsPage(); } catch (_) {}
    });
  } catch (_) {}
}

function openSettings() {
  settingsOpen = true;
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.add('open');
  overlay.style.display = '';
  document.exitPointerLock();
  // Reset gamepad focus to the first widget so d-pad nav has a predictable start
  _settingsFocusIdx = 0;
  setTimeout(_settingsApplyFocus, 0);
}

function closeSettings() {
  settingsOpen = false;
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.remove('open');
  overlay.style.display = 'none';
  _settingsClearFocus();
  // (v6.9) Cancel any half-finished keyboard rebind so re-opening settings
  // doesn't drop the user back into capture mode.
  _kbRebindAction = null;
  if (game.state !== 'select') _safeRequestPointerLock();
  try { _xrMaybeAutoResumeAfterSettings(); } catch (_) {}
}

// Gamepad d-pad navigation helpers
let _settingsFocusIdx = 0;
function _settingsFocusables() {
  const overlay = document.getElementById('settings-overlay');
  if (!overlay || !settingsOpen) return [];
  const nodes = overlay.querySelectorAll('input[type="range"], input[type="checkbox"], select, button');
  return Array.from(nodes);
}
function _settingsApplyFocus() {
  const list = _settingsFocusables();
  _settingsClearFocus();
  if (!list.length) return;
  if (_settingsFocusIdx < 0) _settingsFocusIdx = list.length - 1;
  if (_settingsFocusIdx >= list.length) _settingsFocusIdx = 0;
  const el = list[_settingsFocusIdx];
  el.classList.add('gp-focus');
  const row = el.closest('.setting-row');
  if (row) row.classList.add('gp-focus-row');
  try { el.focus({ preventScroll: true }); } catch (_) {}
}
function _settingsAdjustFocused(dir) {
  const list = _settingsFocusables();
  const el = list[_settingsFocusIdx];
  if (!el) return;
  if (el.tagName === 'INPUT' && el.type === 'range') {
    const min = parseFloat(el.min), max = parseFloat(el.max);
    const step = parseFloat(el.step) || 1;
    let v = parseFloat(el.value) + dir * step;
    if (v < min) v = min; if (v > max) v = max;
    v = Math.round(v / step) * step;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.tagName === 'SELECT') {
    const n = el.options.length;
    if (n > 0) {
      el.selectedIndex = (el.selectedIndex + dir + n) % n;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else if (el.tagName === 'INPUT' && el.type === 'checkbox') {
    el.checked = !el.checked;
  }
}

// ----- 10. SETTINGS PERSISTENCE -----

function saveSettings() {
  try {
    const data = {
      sensitivity: input.sensitivity,
      gpDeadzone: input.gpDeadzone,
      gpLookSensitivity: input.gpLookSensitivity,
      gpMoveSensitivity: input.gpMoveSensitivity,
      gpLookCurve: input.gpLookCurve,
      gpMoveCurve: input.gpMoveCurve,
      invertLookY: input.invertLookY,
      swapSticks: input.swapSticks,
      triggerThreshold: input.triggerThreshold,
      gpBindings: input.gpBindings,
      kbBindings: input.kbBindings,
      xrBindings: input.xrBindings,
      xrSynth:    input.xrSynth,
      vrHeadAim:  input.vrHeadAim,
      vrRenderScale: input.vrRenderScale,
      vrPerfMode: input.vrPerfMode || 'standard',
      fovDeg:        input.fovDeg,
      audioMaster: audio.userVol.master,
      audioSfx: audio.userVol.sfx,
      audioAmbient: audio.userVol.ambient,
      audioMusic: audio.userVol.music != null ? audio.userVol.music : 0.45,
      musicEnabled: audio.musicEnabled !== false,
      musicCeiling: audio.musicCeiling || 'normal',
      musicMuteLobby: !!audio.musicMuteLobby,
      musicStyle: audio.musicStyle || 'cosmic',
      // ship-AI announcer prefs
      annEnabled: announcer.enabled,
      annVoice:   announcer.voice ? announcer.voice.name : (announcer.voiceName || ''),
      annPitch:   announcer.pitch,
      annRate:    announcer.rate,
      annVolume:  announcer.volume,
      // spatial audio prefs
      reverbWet: (audio.reverbGain && audio.reverbGain.gain && typeof audio.reverbGain.gain.value === 'number') ? audio.reverbGain.gain.value : (audio.reverbWet != null ? audio.reverbWet : 0.40),
      ambientDuckEnabled: audio.ambientDuckEnabled !== false,
      wallPattern: (typeof game.wallPattern === 'number') ? game.wallPattern : 0,
      wallBlackBase: !!game.wallBlackBase,
      wallOpacity: (typeof game.wallOpacity === 'number') ? game.wallOpacity : 1.0,
      // (post-v6.9 patch) Per-pattern wallParams. Each slot saves under its pattern index.
      wallParamsByPattern: (function() {
        const out = {};
        const src = game.wallParamsByPattern || {};
        for (const k of Object.keys(src)) {
          out[k] = applyWallParamDefaults(Object.assign({}, src[k] || {}));
        }
        return out;
      })(),
      wallParams: applyWallParamDefaults(game.wallParams || {}),
      // (v16a) Skybox preference.
      skyboxChoice: (typeof game.skyboxChoice === 'string' && !/^blob:/i.test(game.skyboxChoice)) ? game.skyboxChoice : '',
      // (v16a Phase V) Map preset name.
      mapPreset:    (typeof game.mapPreset === 'string') ? game.mapPreset : '',
    };
    localStorage.setItem('lss_settings', JSON.stringify(data));
  } catch(e) {}
}

function loadSettings() {
  // First-run / cleared-storage seed: apply DEFAULT_WALL_CONFIG.
  try {
    if (localStorage.getItem('lss_settings') == null) {
      // [Seeds game.wallPattern, game.wallBlackBase, game.wallOpacity,
      //  game.wallParamsByPattern from DEFAULT_WALL_CONFIG; applies
      //  BAKED_DEFAULTS for input.* / audio.userVol.* / announcer.*]
      // ... (omitted: ~80 lines of first-run wall seeding + BAKED_DEFAULTS apply)
      return;
    }
  } catch(e) {}
  try {
    const raw = localStorage.getItem('lss_settings');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.sensitivity !== undefined) input.sensitivity = data.sensitivity;
    if (data.gpDeadzone !== undefined) input.gpDeadzone = data.gpDeadzone;
    if (data.gpLookSensitivity !== undefined) input.gpLookSensitivity = data.gpLookSensitivity;
    if (data.gpMoveSensitivity !== undefined) input.gpMoveSensitivity = data.gpMoveSensitivity;
    if (data.gpLookCurve !== undefined) input.gpLookCurve = data.gpLookCurve;
    if (data.gpMoveCurve !== undefined) input.gpMoveCurve = data.gpMoveCurve;
    if (data.invertLookY !== undefined) input.invertLookY = data.invertLookY;
    if (data.swapSticks !== undefined) input.swapSticks = data.swapSticks;
    if (data.triggerThreshold !== undefined) input.triggerThreshold = data.triggerThreshold;
    if (data.gpBindings) Object.assign(input.gpBindings, data.gpBindings);
    if (data.kbBindings) Object.assign(input.kbBindings, data.kbBindings);
    // (VR fork migration) force-fix old saved -1 (unbound) defaults
    if (input.gpBindings.cycleWallPattern == null || input.gpBindings.cycleWallPattern === -1) {
      input.gpBindings.cycleWallPattern = 16;
    }
    if (input.gpBindings.openSettings == null || input.gpBindings.openSettings === -1) {
      input.gpBindings.openSettings = 17;
    }
    // VR controller mapping migration: v1 -> v2 (string action names instead of indices)
    if (data.xrBindings) {
      const looksLikeV2 = Object.values(data.xrBindings).every(v => v == null || typeof v === 'string');
      if (looksLikeV2) Object.assign(input.xrBindings, data.xrBindings);
    }
    if (data.xrSynth) Object.assign(input.xrSynth, data.xrSynth);
    if (data.vrHeadAim)  Object.assign(input.vrHeadAim, data.vrHeadAim);
    if (typeof data.vrRenderScale === 'number') input.vrRenderScale = data.vrRenderScale;
    if (typeof data.vrPerfMode === 'string') input.vrPerfMode = data.vrPerfMode;
    if (typeof data.fovDeg === 'number') {
      input.fovDeg = data.fovDeg;
      if (typeof camera !== 'undefined' && camera) {
        camera.fov = input.fovDeg; camera.updateProjectionMatrix();
      }
    }
    // Audio volumes (applied later when initAudio creates the gain nodes)
    if (data.audioMaster !== undefined) audio.userVol.master = data.audioMaster;
    if (data.audioSfx !== undefined) audio.userVol.sfx = data.audioSfx;
    if (data.audioAmbient !== undefined) audio.userVol.ambient = data.audioAmbient;
    if (typeof data.audioMusic === 'number') audio.userVol.music = data.audioMusic;
    if (data.musicEnabled !== undefined) audio.musicEnabled = !!data.musicEnabled;
    if (typeof data.musicCeiling === 'string') audio.musicCeiling = data.musicCeiling;
    if (data.musicMuteLobby !== undefined) audio.musicMuteLobby = !!data.musicMuteLobby;
    if (typeof data.musicStyle === 'string') audio.musicStyle = data.musicStyle;
    // ship-AI announcer prefs
    if (typeof announcer !== 'undefined') {
      if (data.annEnabled !== undefined) announcer.enabled = !!data.annEnabled;
      if (typeof data.annPitch  === 'number') announcer.pitch  = data.annPitch;
      if (typeof data.annRate   === 'number') announcer.rate   = data.annRate;
      if (typeof data.annVolume === 'number') announcer.volume = data.annVolume;
      if (typeof data.annVoice  === 'string' && data.annVoice) {
        announcer.voiceName = data.annVoice;
        if (typeof speechSynthesis !== 'undefined') {
          const voices = speechSynthesis.getVoices() || [];
          const v = voices.find(x => x.name === data.annVoice);
          if (v) announcer.voice = v;
        }
      }
    }
    // spatial audio prefs
    if (typeof data.reverbWet === 'number') {
      audio.reverbWet = data.reverbWet;
      if (audio.reverbGain && audio.reverbGain.gain) {
        try { audio.reverbGain.gain.value = data.reverbWet; } catch (_) {}
      }
    }
    if (data.ambientDuckEnabled !== undefined) audio.ambientDuckEnabled = !!data.ambientDuckEnabled;
    // Wall pattern + opacity + black base
    if (data.wallPattern !== undefined) game.wallPattern = data.wallPattern | 0;
    if (data.wallBlackBase !== undefined) game.wallBlackBase = !!data.wallBlackBase;
    if (typeof data.wallOpacity === 'number') {
      game.wallOpacity = Math.max(0, Math.min(1, data.wallOpacity));
      if (game.levelMaterial && game.levelMaterial.uniforms && game.levelMaterial.uniforms.uOpacity) {
        game.levelMaterial.uniforms.uOpacity.value = game.wallOpacity;
      }
    }
    // (post-v6.9) Wall lab parameters now live per-pattern.
    game.wallParamsByPattern = {};
    if (data.wallParamsByPattern && typeof data.wallParamsByPattern === 'object') {
      for (const k of Object.keys(data.wallParamsByPattern)) {
        const idx = (k | 0);
        if (idx >= 0 && idx < WALL_PATTERN_NAMES.length) {
          game.wallParamsByPattern[idx] = applyWallParamDefaults(Object.assign({}, data.wallParamsByPattern[k] || {}));
        }
      }
    } else if (data.wallParams && typeof data.wallParams === 'object') {
      for (let i = 0; i < WALL_PATTERN_NAMES.length; i++) {
        game.wallParamsByPattern[i] = applyWallParamDefaults(Object.assign({}, data.wallParams));
      }
    }
    _switchToPatternSlot(game.wallPattern || 0);
    // (v16a) Restore skybox background.
    if (typeof hideStarfield === 'function') hideStarfield();
    if (typeof data.skyboxChoice === 'string' && data.skyboxChoice.length > 0) {
      game.skyboxChoice = data.skyboxChoice;
      if (typeof setSky === 'function') {
        try { setSky(data.skyboxChoice); } catch (e) {}
      }
    } else {
      game.skyboxChoice = '';
    }
    // (v16a Phase V) Restore map preset if persisted.
    if (typeof data.mapPreset === 'string' && data.mapPreset.length > 0 && typeof applyMapPreset === 'function') {
      try { applyMapPreset(data.mapPreset); } catch (e) {}
    }
  } catch (_) {}
}

// localStorage keys used:
//   'lss_settings'    -> JSON blob above
//   'lss_perk_id'     -> selected PILOT_PERKS key
//   'lss_custom_maps' -> user-loaded map JSONs
//   'lss_no_auto_fs'  -> '1' to skip auto-fullscreen on play

// input bindings table (input.kbBindings / input.gpBindings / input.xrBindings)
// shape: { actionName: keyOrButton }, e.g.
//   input.kbBindings = { forward:'KeyW', back:'KeyS', left:'KeyA', right:'KeyD',
//                        ascend:'Space', descend:'ControlLeft', dash:'ShiftLeft',
//                        fire:'Mouse0', ability1:'KeyQ', ability2:'KeyE',
//                        ability3:'KeyF', core:'KeyV', openSettings:'Escape',
//                        cycleWallPattern:'KeyP', cycleMapPreset:'KeyB' ... }
//   input.gpBindings = { fire:7, dash:5, ability1:2, ability2:1, ability3:3,
//                        core:0, openSettings:17, cycleWallPattern:16 ... }
//   input.xrBindings = { fire:'triggerRight', dash:'triggerLeft', ... }

// ----- 11. LOBBY ROOM CREATE/JOIN UI -----

/* Lobby HTML (excerpt — MULTIPLAYER panel inside the main lobby card) */
/*
<div style="background:rgba(20,30,45,0.45);border:1px solid rgba(120,200,255,0.28);
            border-radius:10px;padding:12px 14px;
            display:flex;flex-direction:column;gap:10px;">
  <div style="font-size:11px;color:#fff;letter-spacing:3px;font-weight:bold;">
    MULTIPLAYER <span style="font-size:9px;color:#7799bb;font-weight:normal;">(P2P MESH NETWORK)</span>
  </div>
  <div style="display:flex;gap:8px;align-items:stretch;">
    <input id="room-code" type="text" placeholder="ROOM CODE" maxlength="20" style="
      flex:1;background:rgba(15,22,32,0.6);border:1px solid rgba(120,200,255,0.3);
      color:#ffaa00;padding:10px 14px;font-size:14px;letter-spacing:2px;
      text-transform:uppercase;text-align:center;outline:none;border-radius:6px;"
      onfocus="this.style.borderColor='#ffaa00'"
      onblur="this.style.borderColor='rgba(120,200,255,0.3)'">
    <button id="btn-join" onclick="joinRoom()" type="button" style="
      background:rgba(60,45,15,0.3);border:1px solid rgba(255,170,0,0.7);
      color:#ffcc66;padding:10px 24px;font-size:13px;
      cursor:pointer;letter-spacing:3px;border-radius:6px;font-weight:bold;">CREATE / JOIN</button>
  </div>
  <div id="lobby-status" style="font-size:10px;color:#666;min-height:14px;text-align:center;"></div>
  <div id="lobby-peers" style="font-size:10px;color:#66bb66;min-height:14px;text-align:center;"></div>
</div>

<!-- SOLO + BOTS / TEST MODE row -->
<div style="display:flex;gap:10px;align-items:stretch;">
  <button id="btn-solo" onclick="startSolo()" type="button" style="...">PLAY SOLO + BOTS</button>
  <button id="btn-test" onclick="startTest()" type="button" style="...">TEST MODE</button>
</div>
*/

async function joinRoom() {
  // (v16a) Clear the test-mode flag so a previous TEST MODE session doesn't
  // bleed into multiplayer.
  game.testMode = false;
  const codeInput = document.getElementById('room-code');
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    document.getElementById('lobby-status').textContent = 'ENTER A ROOM CODE';
    document.getElementById('lobby-status').style.color = '#ff6666';
    return;
  }

  document.getElementById('lobby-status').textContent = 'CONNECTING TO MESH...';
  document.getElementById('lobby-status').style.color = '#ffaa00';
  document.getElementById('btn-join').disabled = true;
  document.getElementById('btn-solo').disabled = true;

  try {
    // Dynamic import of trystero (BitTorrent-tracker P2P signaling)
    const trystero = await import('https://esm.sh/@trystero-p2p/torrent');
    const { joinRoom: trysteroJoin, selfId } = trystero;
    net.myPeerId = selfId;
    net.active = true;
    net.solo = false;

    // Join the room via BitTorrent trackers
    net.room = trysteroJoin({ appId: 'last-ship-sailing-v1' }, code);
    net.roomCode = code;
    if (typeof startRoomHeartbeat === 'function') startRoomHeartbeat();

    // Set up data channels
    const [sendState, onState] = net.room.makeAction('state');
    const [sendHitClaim, onHitClaim] = net.room.makeAction('hit');
    const [sendHitVote, onHitVote] = net.room.makeAction('vote');
    const [sendEvent, onEvent] = net.room.makeAction('event');
    const [sendLoadout, onLoadout] = net.room.makeAction('loadout');
    const [sendProjectile, onProjectile] = net.room.makeAction('proj');
    net.sendState = sendState; net.sendHitClaim = sendHitClaim;
    net.sendHitVote = sendHitVote; net.sendEvent = sendEvent;
    net.sendLoadout = sendLoadout; net.sendProjectile = sendProjectile;

    onState((data, peerId) => { /* interp peer state */ });
    onHitClaim((claim, peerId) => { handleHitClaim(claim, peerId); });
    onHitVote((vote, peerId) => { handleHitVote(vote, peerId); });
    onEvent((evt, peerId) => { handleNetEvent(evt, peerId); });
    onLoadout((data, peerId) => {
      const peer = net.peers.get(peerId);
      if (peer) {
        peer.loadoutKey = data.loadoutKey;
        peer.team = data.team;
        if (data.discord_id) {
          peer.discord_id = data.discord_id;
          peer.discord_name = data.discord_name;
          peer.discord_avatar = data.discord_avatar;
        }
        updateNetworkPlayer(peerId, data);
        checkAllLoadoutsReady();
        try { updateTeammatesStrip(); } catch (_) {}
      }
    });
    onProjectile((data, peerId) => { spawnNetworkProjectile(data, peerId); });

    net.room.onPeerJoin(peerId => {
      net.peers.set(peerId, {
        state: null, prevState: null, lastUpdate: 0, interpT: 0,
        loadoutKey: null, team: null, networkPlayer: null,
        ready: false, // per-peer ready flag for the start handshake
      });
      updateLobbyPeers();
      checkAllReady();
      checkAllLoadoutsReady();
      try { updateTeammatesStrip(); } catch (_) {}
      // If we already have a loadout, announce it (with Discord identity).
      if (player.loadoutKey && net.sendLoadout) {
        const _du = (typeof discordCurrentUser === 'function') ? discordCurrentUser() : null;
        net.sendLoadout({
          loadoutKey: player.loadoutKey, team: player.team, peerId: net.myPeerId,
          discord_id: _du ? _du.id : undefined,
          discord_name: _du ? (_du.global_name || _du.username) : undefined,
          discord_avatar: _du ? _du.avatar : undefined,
        });
      }
      if (net.myReady && net.sendEvent) net.sendEvent({ type: 'ready', ready: true });
      if (game.clusters && game.clusters.length > 0) broadcastWorldObjects();
    });

    net.room.onPeerLeave(peerId => {
      const peer = net.peers.get(peerId);
      if (peer && peer.networkPlayer) {
        peer.networkPlayer.destroy();
        const idx = net.networkPlayers.indexOf(peer.networkPlayer);
        if (idx >= 0) net.networkPlayers.splice(idx, 1);
      }
      net.peers.delete(peerId);
      if (net.peerGameSync) net.peerGameSync.delete(peerId);
      updateLobbyPeers();
      checkAllReady();
      checkAllLoadoutsReady();
      try { updateTeammatesStrip(); } catch (_) {}
      if (game.clusters && game.clusters.length > 0) broadcastWorldObjects();
    });

    document.getElementById('lobby-status').textContent = 'CONNECTED: ROOM ' + code + ' ; WAITING FOR PLAYERS...';
    document.getElementById('lobby-status').style.color = '#66cc66';
    updateLobbyPeers();

    // (v6.7) After connecting, the JOIN button becomes a READY toggle.
    setTimeout(() => {
      const btn = document.getElementById('btn-join');
      btn.disabled = false;
      btn.textContent = 'READY';
      btn.onclick = () => toggleReady();
    }, 500);
  } catch(err) {
    console.error('Network error:', err);
    document.getElementById('lobby-status').textContent = 'CONNECTION FAILED: ' + err.message;
    document.getElementById('lobby-status').style.color = '#ff6666';
    document.getElementById('btn-join').disabled = false;
    document.getElementById('btn-solo').disabled = false;
  }
}

function startSolo() {
  net.active = false;
  net.solo = true;
  game.testMode = false;
  enterShipSelect();
}

function startTest() {
  net.active = false;
  net.solo = true;
  game.testMode = true;
  enterShipSelect();
}

function enterShipSelect() {
  document.getElementById('lobby').style.display = 'none';
  const sel = document.getElementById('ship-select');
  sel.classList.add('active');
  const cd = document.getElementById('ship-select-countdown');
  if (cd) cd.classList.remove('active');
  buildShipSelect();
  buildMapSelector();
  updateTeammatesStrip();
}

// Ready/not-ready handshake (per docs/LSS/mesh_networking_concept.md): the match
// starts when every peer flips ready=true. No host; the lowest peerId proposes
// the synced startAt, and every peer follows it.

function updateLobbyPeers() {
  const el = document.getElementById('lobby-peers');
  if (!el) return;
  const count = net.peers.size;
  if (count === 0) { el.textContent = 'WAITING FOR PEERS...'; el.style.color = '#66bb66'; return; }
  // (v6.7) Show ready tally alongside peer count.
  let readyCount = net.myReady ? 1 : 0;
  for (const peer of net.peers.values()) { if (peer.ready) readyCount++; }
  const total = count + 1;
  el.textContent = readyCount + ' / ' + total + ' READY ('
    + count + ' PEER' + (count > 1 ? 'S' : '') + ' IN MESH)';
  el.style.color = readyCount === total ? '#66cc66' : '#ffaa00';
}

function toggleReady() {
  if (!net.active) return;
  net.myReady = !net.myReady;
  if (net.sendEvent) net.sendEvent({ type: 'ready', ready: net.myReady });
  updateReadyButton();
  updateLobbyPeers();
  checkAllReady();
  try { updateTeammatesStrip(); } catch (_) {}
}

function updateReadyButton() {
  const btn = document.getElementById('btn-join');
  if (!btn) return;
  if (net.myReady) {
    btn.textContent = 'READY ; CLICK TO CANCEL';
    btn.style.background = 'rgba(102,204,102,0.25)';
    btn.style.borderColor = '#66cc66';
    btn.style.color = '#66cc66';
  } else {
    btn.textContent = 'READY';
    btn.style.background = 'rgba(255,170,0,0.15)';
    btn.style.borderColor = '#ffaa00';
    btn.style.color = '#ffaa00';
  }
}

function allPeersReady() {
  if (net.peers.size === 0) return false;
  if (!net.myReady) return false;
  for (const peer of net.peers.values()) {
    if (!peer.ready) return false;
  }
  return true;
}

function checkAllReady() {
  if (!net.active) return;
  if (!allPeersReady()) {
    if (net.startTimer) {
      clearTimeout(net.startTimer);
      net.startTimer = null;
      net.startScheduledAt = null;
      const status = document.getElementById('lobby-status');
      if (status) { status.textContent = 'WAITING FOR PLAYERS...'; status.style.color = '#ffaa00'; }
    }
    return;
  }
  if (net.startScheduledAt) return;
  // Lowest peerId proposes the start time, map, and world seed.
  const allIds = [net.myPeerId, ...net.peers.keys()].sort();
  const proposer = allIds[0];
  if (proposer === net.myPeerId) {
    const startAt = Date.now() + 3000;
    const mapKey = (typeof game !== 'undefined' && game.selectedMap) || 'hourglass';
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    if (net.sendEvent) net.sendEvent({ type: 'match_start', startAt, mapKey, seed });
    applyWorldSync(mapKey, seed);
    scheduleMatchStart(startAt);
  }
}

function scheduleMatchStart(startAt) {
  if (net.startTimer) clearTimeout(net.startTimer);
  net.startScheduledAt = startAt;
  const delay = Math.max(0, startAt - Date.now());
  net.startTimer = setTimeout(() => {
    net.startTimer = null;
    net.startScheduledAt = null;
    enterShipSelect();
  }, delay);
  tickStartCountdown();
}

function tickStartCountdown() {
  const status = document.getElementById('lobby-status');
  if (!status || !net.startScheduledAt) return;
  const remaining = Math.max(0, net.startScheduledAt - Date.now());
  if (remaining > 0) {
    status.textContent = 'ALL READY ; STARTING IN ' + Math.ceil(remaining / 1000) + '...';
    status.style.color = '#66cc66';
    setTimeout(tickStartCountdown, 100);
  }
}

// ----- 12. MATCH END SCREEN -----

// LSS doesn't use a dedicated post-match overlay panel ; the existing in-match
// scoreboard div is force-shown for the matchEnd duration with the final totals,
// and a CSS-animated banner displays "VICTORY"/"DEFEAT" + winner. After 10s the
// game returns to the root menu (lobby + ship-select state).

// Round-end resolution: counts alive ships per fleet, awards a round-win to the
// surviving fleet (or HP-total tiebreaker on timer-out), broadcasts authoritative
// round_end to peers, plays personal "Round Won!" / "Round Lost" banner.
// When game.scoreA or scoreB reaches LSS.ROUNDS_TO_WIN, state transitions to
// 'matchEnd':
//
//   game.state = 'matchEnd';
//   _anchorTimer('matchEndTimer', 10);  // 10s scoreboard pause
//   if (typeof _refreshScoreboardVisibility === 'function') _refreshScoreboardVisibility();
//   // (v10 Phase 2) Post the match result to the LSS backend (D1 via Worker).
//   try { if (typeof postMatchResultToBackend === 'function') postMatchResultToBackend(); } catch (_) {}
//   if (window.Overlays) {
//     const winner = game.scoreA >= LSS.ROUNDS_TO_WIN ? 'FLEET A' : 'FLEET B';
//     Overlays.banner('VICTORY', winner + ' WINS');
//   }
//   // ship-AI declares victory or defeat depending on the player's team.
//   const _playerWonMatch = (game.scoreA >= LSS.ROUNDS_TO_WIN && player.team === LSS.TEAM_FLEET_A) ||
//                           (game.scoreB >= LSS.ROUNDS_TO_WIN && player.team === LSS.TEAM_FLEET_B);
//   if (typeof ANN !== 'undefined') {
//     if (_playerWonMatch) ANN.victory(); else ANN.defeat();
//   }
//   // Reactive band: match-end pattern.
//   if (typeof musicSetPattern === 'function') {
//     try {
//       musicSetPattern(_playerWonMatch ? 'matchEndVictory' : 'matchEndDefeat',
//                       { bpmTarget: 76, intensity: 1 });
//       if (typeof musicPlayRoundEndPhrase === 'function') musicPlayRoundEndPhrase(_playerWonMatch);
//     } catch (_) {}
//   }
//   if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }

// matchEnd state tick: hold scoreboard for ~10s, then return to root menu.
// } else if (game.state === 'matchEnd') {
//   if (game.matchEndTimer === undefined || game.matchEndTimerAnchorMs === undefined) {
//     _anchorTimer('matchEndTimer', 10);
//   } else {
//     _tickTimer('matchEndTimer');
//   }
//   if (game.matchEndTimer <= 0) {
//     returnToRootMenu();
//   }
// }

// returnToRootMenu(): brings game back to its cold-boot state with ship-select open,
// game.state === 'select', and all scores / rounds / match stats reset. Stops the
// room heartbeat, DELETEs the room from the rooms.html KV listing, cancels all
// pending launch / countdown timers, tears down deathCam, hides the respawn
// overlay, resets player.shipState to 'spawning', exitPointerLock, hides the
// scoreboard, wipes live entities/projectiles/stasis fields/cosmicAnomaly/effects/
// particles/dots/dynamicObjects/clusters/detachedGasPockets, disposes all
// worldEffects (mesh/plasmaMesh/coreMesh/edgeMesh/glow/meshes/puffMeshes), resets
// player position+velocity, then:
//   game.scoreA = 0;
//   game.scoreB = 0;
//   game.currentRound = 1;
//   game.matchEndTimer = 0;
//   game.warmupTimer  = LSS.WARMUP_TIME;
//   game.roundTimer   = LSS.ROUND_TIME;
//   game.roundEndTimer = 0;
//   // Wall-clock anchors cleared so the next warmup re-anchors cleanly.
//   game.warmupTimerAnchorMs = undefined; ...
//   net.myReady = false;
//   // Show lobby + ship-select again (state='select'), reopen the panels.

// The in-match scoreboard (the div that pops on TAB / shows on round-end) is
// the only "results" panel ; _refreshScoreboardVisibility() treats
// (game.state === 'matchEnd') as a force-show condition, so flipping state
// brings the scoreboard up with final totals. The Orbitron banner text reads
// "FLEET A WINS" or "FLEET B WINS" through window.Overlays.banner(title, sub).

// (port 2026-05-19) Expose lobby entry points on window so the inline
// pre-stubs in the html can locate them after this module loads.
try {
  window.startSolo = startSolo;
  window.startTest = startTest;
  window.enterShipSelect = enterShipSelect;
  window.openSettings = openSettings;
  window.closeSettings = closeSettings;
  window.saveSettings = saveSettings;
  window.buildSettingsPage = buildSettingsPage;
  window.updateLobbyPeers = updateLobbyPeers;
} catch (_) {}
