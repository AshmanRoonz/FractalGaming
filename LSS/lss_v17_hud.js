// v17 HUD + circumpunct canvas + scoreboard + killfeed
// Extracted verbatim from last_ship_sailing_v17.html

// ----- 1. HUD CANVAS SETUP (DOM + CSS + globals + 2D rendering helpers) -----

// --- HTML element (in <body>) ---
// <canvas id="circumpunct-hud"></canvas>

// --- CSS ---
/*
body.vr-active #circumpunct-hud,
body.vr-active #cockpit-frame,
body.vr-active #ability-overlay-frame,
body.vr-active #gun-layer,
body.vr-active #hud,
body.vr-active #ability-pie,
body.vr-active #gamepad-indicator,
body.vr-active .hit-marker { display: none !important; }

#crosshair { display: none; }

#circumpunct-hud {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  pointer-events: none; z-index: 20;
}
*/

// ---- CIRCUMPUNCT HUD ----
// Concentric rings centered on crosshair. Health, shield, core, abilities, ammo, speed
// all mapped into ring arcs, tick marks, and bracket geometry.
// The HUD is the circumpunct: dot (crosshair), field (rings), boundary (outer brackets).

const hudCanvas = document.getElementById('circumpunct-hud');
const hudCtx = hudCanvas.getContext('2d');
// Cache last-applied canvas dims so we don't reset (and reallocate the
// internal bitmap) every frame. Also cache the current font string so
// repeated `ctx.font = '10px Courier New'` writes skip the parse.
let _hudLastW = 0, _hudLastH = 0, _hudLastDPR = 0;
let _hudFontCache = '';
function hudFont(s) {
  if (s === _hudFontCache) return;
  _hudFontCache = s;
  hudCtx.font = s;
}

// (v16c Phase B) HUD trig + rgba string caches.
const _HUD_TICK_COUNT = 96;
const _hudTickBaseCos = new Float32Array(_HUD_TICK_COUNT);
const _hudTickBaseSin = new Float32Array(_HUD_TICK_COUNT);
for (let _i = 0; _i < _HUD_TICK_COUNT; _i++) {
  const _a = (Math.PI * 2 / _HUD_TICK_COUNT) * _i;
  _hudTickBaseCos[_i] = Math.cos(_a);
  _hudTickBaseSin[_i] = Math.sin(_a);
}
// Pre-built rgba string constants.
const _HUD_C = {
  w_092:'rgba(255,255,255,0.92)', w_09:'rgba(255,255,255,0.9)', w_07:'rgba(255,255,255,0.7)',
  w_06:'rgba(255,255,255,0.6)',   w_055:'rgba(255,255,255,0.55)', w_05:'rgba(255,255,255,0.5)',
  w_045:'rgba(255,255,255,0.45)', w_04:'rgba(255,255,255,0.4)',   w_035:'rgba(255,255,255,0.35)',
  w_02:'rgba(255,255,255,0.2)',   w_018:'rgba(255,255,255,0.18)', w_015:'rgba(255,255,255,0.15)',
  w_012:'rgba(255,255,255,0.12)', w_01:'rgba(255,255,255,0.1)',   w_008:'rgba(255,255,255,0.08)',
  w_006:'rgba(255,255,255,0.06)', w_005:'rgba(255,255,255,0.05)',
  c_08:'rgba(100,200,255,0.8)',  c_06:'rgba(100,200,255,0.6)',  c_04:'rgba(100,200,255,0.4)',
  c_085:'rgba(100,200,255,0.85)', c_015:'rgba(100,200,255,0.15)', c_01:'rgba(100,200,255,0.1)',
  c_008:'rgba(100,200,255,0.08)',
  a_095:'rgba(255,170,0,0.95)', a_09:'rgba(255,170,0,0.9)', a_085:'rgba(255,170,0,0.85)',
  a_08:'rgba(255,170,0,0.8)',   a_055:'rgba(255,170,0,0.55)', a_025:'rgba(255,170,0,0.25)',
  g_09:'rgba(100,255,150,0.9)', g_07:'rgba(100,255,150,0.7)', g_04:'rgba(100,255,150,0.4)',
  r_09:'rgba(255,50,30,0.9)',
};

// ----- 2. drawCircumpunctHUD (main canvas-based ring draw: health/shield/core, ammo, gun recoil, muzzle flash) -----

function drawCircumpunctHUD() {
  if (!player.chassis) return;
  // Cap DPR at 1.25 for hi-DPI perf.
  const dpr = Math.min(1.25, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  if (W !== _hudLastW || H !== _hudLastH || dpr !== _hudLastDPR) {
    hudCanvas.width = W * dpr; hudCanvas.height = H * dpr;
    hudCanvas.style.width = W + 'px'; hudCanvas.style.height = H + 'px';
    _hudLastW = W; _hudLastH = H; _hudLastDPR = dpr;
    _hudFontCache = '';
  }
  const ctx = hudCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Parallax: counter-shift HUD against shake so it reads cockpit-anchored.
  const hudShakeX = game.shakeOffset ? -game.shakeOffset.x * 0.35 : 0;
  const hudShakeY = game.shakeOffset ? -game.shakeOffset.y * 0.35 : 0;
  const cx = W / 2 + hudShakeX, cy = H / 2 + hudShakeY;
  const t = game.time;

  // ---- Derived ----
  const healthPct = Math.max(0, player.health / player.maxHealth);
  const shieldPct = player.maxShield > 0 ? Math.max(0, player.shield / player.maxShield) : 0;
  const corePct = Math.min(1, player.coreMeter / 100);
  const speedPct = Math.min(1, player.velocity.length() / (player.chassis.flightSpeed * 1.5));
  const isDoomed = player.doomed && player.shipState !== 'dead';
  const white='rgba(255,255,255,', cyan='rgba(100,200,255,', amber='rgba(255,170,0,',
        red='rgba(255,50,30,', green='rgba(100,255,150,';

  // Health color
  let hCol;
  if (isDoomed) { const flash = 0.4 + Math.abs(Math.sin(t * 6)) * 0.6; hCol = `rgba(255,30,0,${flash})`; }
  else if (healthPct < 0.3) hCol = _HUD_C.r_09;
  else if (healthPct < 0.6) hCol = _HUD_C.a_08;
  else hCol = _HUD_C.g_07;

  // ---- LAYER 0: CENTER DOT + CROSSHAIR ----
  if (player.loadoutKey === 'BLASTER' && player.blasterMode === 'close') {
    ctx.strokeStyle = _HUD_C.w_06; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = _HUD_C.w_07;
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = _HUD_C.w_09;
    ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = _HUD_C.w_04; ctx.lineWidth = 1.5;
    const chGap = 10, chLen = 28;
    ctx.beginPath();
    ctx.moveTo(cx - chGap - chLen, cy); ctx.lineTo(cx - chGap, cy);
    ctx.moveTo(cx + chGap, cy); ctx.lineTo(cx + chGap + chLen, cy);
    ctx.moveTo(cx, cy - chGap - chLen); ctx.lineTo(cx, cy - chGap);
    ctx.moveTo(cx, cy + chGap); ctx.lineTo(cx, cy + chGap + chLen);
    ctx.stroke();
  }

  // Blaster mode indicator
  if (player.loadoutKey === 'BLASTER') {
    if (player.blasterSwitchTimer > 0) {
      const blinkOn = Math.floor(t * 6) % 2 === 0;
      ctx.fillStyle = amber + (blinkOn ? '0.7)' : '0.3)');
      hudFont('10px Courier New'); ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText('SWITCHING', cx, cy + 32);
    } else {
      const modeLabel = player.blasterMode === 'close' ? 'CLOSE' : 'LONG';
      ctx.fillStyle = _HUD_C.w_04;
      hudFont('10px Courier New'); ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(modeLabel, cx, cy + 32);
    }
  }

  // ---- LAYER 1: INNER RING (Health) ----
  const r1 = 150;
  const healthArcStart = Math.PI * 0.65;
  const healthArcEnd = Math.PI * 2.35;
  const healthArcSpan = healthArcEnd - healthArcStart;
  const segments = player.chassis.healthSegments;
  const segGap = 0.04;
  ctx.strokeStyle = _HUD_C.w_01; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(cx, cy, r1, healthArcStart, healthArcEnd); ctx.stroke();
  for (let i = 0; i < segments; i++) {
    const segStart = healthArcStart + (healthArcSpan / segments) * i + segGap / 2;
    const segEnd = healthArcStart + (healthArcSpan / segments) * (i + 1) - segGap / 2;
    const segStartPct = i / segments;
    if (healthPct > segStartPct) {
      const fillPct = Math.min(1, (healthPct - segStartPct) / (1 / segments));
      const fillEnd = segStart + (segEnd - segStart) * fillPct;
      ctx.save();
      ctx.shadowColor = hCol; ctx.shadowBlur = 6 + (1 - healthPct) * 10;
      ctx.strokeStyle = hCol; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(cx, cy, r1, segStart, fillEnd); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = _HUD_C.w_015; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r1 - 5, segStart, fillEnd); ctx.stroke();
    }
    if (i > 0) {
      const tickAngle = healthArcStart + (healthArcSpan / segments) * i;
      const _tc = Math.cos(tickAngle), _ts = Math.sin(tickAngle);
      ctx.strokeStyle = _HUD_C.w_012; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + _tc * (r1 - 14), cy + _ts * (r1 - 14));
      ctx.lineTo(cx + _tc * (r1 + 14), cy + _ts * (r1 + 14));
      ctx.stroke();
    }
  }
  ctx.fillStyle = _HUD_C.w_06; hudFont('13px Courier New'); ctx.textAlign='center';
  ctx.fillText(Math.ceil(player.health) + '', cx, cy + r1 + 24);

  // ---- LAYER 2: SHIELD RING ----
  const r2 = 190;
  const shieldArcStart = -Math.PI * 0.85, shieldArcEnd = -Math.PI * 0.15;
  const shieldArcSpan = shieldArcEnd - shieldArcStart;
  ctx.strokeStyle = _HUD_C.c_01; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(cx, cy, r2, shieldArcStart, shieldArcEnd); ctx.stroke();
  if (shieldPct > 0) {
    const fillEnd = shieldArcStart + shieldArcSpan * shieldPct;
    ctx.save();
    ctx.shadowColor = _HUD_C.c_085; ctx.shadowBlur = 10;
    ctx.strokeStyle = _HUD_C.c_06; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, r2, shieldArcStart, fillEnd); ctx.stroke();
    ctx.restore();
  }
  // Tick marks (every 10%)
  for (let i = 0; i <= 10; i++) {
    const angle = shieldArcStart + shieldArcSpan * (i / 10);
    const major = i % 5 === 0;
    const inner = major ? r2 - 12 : r2 - 6, outer = major ? r2 + 12 : r2 + 6;
    const _c = Math.cos(angle), _s = Math.sin(angle);
    ctx.strokeStyle = major ? _HUD_C.c_015 : _HUD_C.c_008; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + _c * inner, cy + _s * inner);
    ctx.lineTo(cx + _c * outer, cy + _s * outer);
    ctx.stroke();
  }

  // ---- LAYER 2b: ABILITY CHARGE BARS (v16a Phase EE) ----
  // top tick->Q (slot 0), right->E (slot 1), left->F (slot 2)
  const _abilityBars = [
    { tickI: 5,  slot: 0, key: 'Q' },
    { tickI: 10, slot: 1, key: 'E' },
    { tickI: 0,  slot: 2, key: 'F' },
  ];
  const barOuter = r2 + 26, barWidth = 60, barThick = 5;
  for (const bar of _abilityBars) {
    const ab = player.abilities && player.abilities[bar.slot];
    if (!ab) continue;
    const cd = (player.abilityCooldowns && player.abilityCooldowns[bar.slot]) || 0;
    const isActive = player.abilityActive && player.abilityActive[bar.slot];
    const dur = ab.cooldown || 1, ready = cd <= 0;
    let fillPct;
    if (isActive) fillPct = 1; else if (ready) fillPct = 1;
    else fillPct = Math.max(0, Math.min(1, 1 - cd / dur));
    const angle = shieldArcStart + shieldArcSpan * (bar.tickI / 10);
    const ax = Math.cos(angle), ay = Math.sin(angle);
    const tx = -ay, ty = ax;
    const bcx = cx + ax * barOuter, bcy = cy + ay * barOuter;
    const x1 = bcx - tx*barWidth/2, y1 = bcy - ty*barWidth/2;
    const x2 = bcx + tx*barWidth/2, y2 = bcy + ty*barWidth/2;
    ctx.strokeStyle = _HUD_C.w_015; ctx.lineWidth = barThick; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    let fillCol;
    if (isActive) fillCol = _HUD_C.a_095;
    else if (ready) fillCol = _HUD_C.g_09;
    else fillCol = _HUD_C.g_04;
    const xfill = x1 + (x2 - x1) * fillPct, yfill = y1 + (y2 - y1) * fillPct;
    ctx.save();
    if (ready || isActive) { ctx.shadowColor = fillCol; ctx.shadowBlur = 8; }
    ctx.strokeStyle = fillCol; ctx.lineWidth = barThick;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(xfill, yfill); ctx.stroke();
    ctx.restore(); ctx.lineCap='butt';
    const labelOuter = barOuter + 18;
    ctx.fillStyle = (ready||isActive) ? _HUD_C.w_092 : _HUD_C.w_055;
    hudFont('700 12px Orbitron, Courier New'); ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(bar.key, cx + ax * labelOuter, cy + ay * labelOuter);
  }

  // ---- LAYER 2c: CORE CHARGE BAR (yellow bar in bottom gap of health ring) ----
  const _corePct = Math.min(100, (player.coreMeter || 0));
  {
    const barW=96, barH=6, barX=cx-barW/2, barY=cy+r1-barH/2;
    const ready = _corePct >= 100 && !player.coreActive;
    const firing = !!player.coreActive;
    let fillPct;
    if (firing) {
      const _dur = (player.loadout && player.loadout.core && player.loadout.core.duration) || 0.001;
      const _rem = Math.max(0, player.coreTimer || 0);
      fillPct = Math.max(0, Math.min(1, _rem / _dur));
    } else { fillPct = _corePct / 100; }
    const pulse = ready ? (0.75 + 0.25 * Math.sin(t * 4.5)) : 1.0;
    ctx.save();
    ctx.fillStyle = firing ? 'rgba(60,40,15,0.65)' : 'rgba(20,30,45,0.55)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = firing ? 'rgba(255,180,50,0.65)' : 'rgba(255,210,40,0.45)';
    ctx.lineWidth = 1; ctx.strokeRect(barX-0.5, barY-0.5, barW+1, barH+1);
    if (fillPct > 0) {
      const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      if (firing) {
        grad.addColorStop(0,'rgba(255,180,50,0.92)');
        grad.addColorStop(1,'rgba(255,210,90,0.92)');
      } else {
        grad.addColorStop(0,'rgba(255,210,40,'+(ready?(0.95*pulse).toFixed(2):'0.80')+')');
        grad.addColorStop(1,'rgba(255,235,90,'+(ready?(0.95*pulse).toFixed(2):'0.85')+')');
      }
      ctx.fillStyle = grad;
      if (ready) { ctx.shadowColor='rgba(255,210,40,0.85)'; ctx.shadowBlur = 10 * pulse; }
      else if (firing) { ctx.shadowColor='rgba(255,180,50,0.55)'; ctx.shadowBlur = 4; }
      ctx.fillRect(barX, barY, barW * fillPct, barH);
    }
    ctx.restore();
  }

  // ---- LAYER 3: SPEED ARC (left side) ----
  const r3 = 240;
  const speedArcStart = Math.PI * 0.55, speedArcEnd = Math.PI * 0.95;
  const speedSpan = speedArcEnd - speedArcStart;
  ctx.strokeStyle = _HUD_C.w_008; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r3, speedArcStart, speedArcEnd); ctx.stroke();
  if (speedPct > 0) {
    ctx.save();
    ctx.shadowColor = _HUD_C.w_06; ctx.shadowBlur = 5;
    ctx.strokeStyle = _HUD_C.w_045; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r3, speedArcStart, speedArcStart + speedSpan * speedPct); ctx.stroke();
    ctx.restore();
  }
  const speedAngle = (speedArcStart + speedArcEnd) / 2;
  const speedTx = cx + Math.cos(speedAngle) * (r3 + 22);
  const speedTy = cy + Math.sin(speedAngle) * (r3 + 22);
  ctx.fillStyle = _HUD_C.w_045; hudFont('11px Courier New'); ctx.textAlign='center';
  ctx.fillText(Math.floor(player.velocity.length()), speedTx, speedTy);

  // ---- LAYER 4: AMMO ARC (right side) ----
  const smartCoreAmmo = player.coreActive && player.loadoutKey === 'BLASTER';
  const ammoPct = (player.weapon.clipSize >= 999 || smartCoreAmmo) ? 1 : player.clipAmmo / player.maxClip;
  const ammoArcStart = Math.PI * 0.05, ammoArcEnd = Math.PI * 0.45;
  const ammoSpan = ammoArcEnd - ammoArcStart;
  ctx.strokeStyle = _HUD_C.w_008; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r3, ammoArcStart, ammoArcEnd); ctx.stroke();
  if (ammoPct > 0) {
    const ammoCol = player.reloading ? _HUD_C.a_055 : _HUD_C.w_045;
    ctx.strokeStyle = ammoCol; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r3, ammoArcStart, ammoArcStart + ammoSpan * ammoPct); ctx.stroke();
  }
  const ammoAngle = (ammoArcStart + ammoArcEnd) / 2;
  const ammoTx = cx + Math.cos(ammoAngle) * (r3 + 22);
  const ammoTy = cy + Math.sin(ammoAngle) * (r3 + 22);
  ctx.fillStyle = _HUD_C.w_045; hudFont('11px Courier New'); ctx.textAlign='center';
  const ammoStr = (player.weapon.clipSize >= 999 || smartCoreAmmo) ? 'INF' : player.clipAmmo + '';
  ctx.fillText(ammoStr, ammoTx, ammoTy);

  // ---- LAYER 5: OUTER RING (Core meter) ----
  const r4 = 290;
  ctx.strokeStyle = _HUD_C.w_006; ctx.lineWidth = 1.5; ctx.setLineDash([4,14]);
  ctx.beginPath(); ctx.arc(cx, cy, r4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  if (corePct > 0) {
    const coreStart = -Math.PI / 2, coreEnd = coreStart + Math.PI * 2 * corePct;
    const coreCol = corePct >= 1 ? amber + (0.4 + Math.sin(t*4)*0.2) + ')' : _HUD_C.a_025;
    ctx.save();
    ctx.shadowColor = _HUD_C.a_09;
    ctx.shadowBlur = 4 + corePct * 8 + (corePct >= 1 ? (4 + Math.sin(t*4)*3) : 0);
    ctx.strokeStyle = coreCol; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, r4, coreStart, coreEnd); ctx.stroke();
    ctx.restore();
  }
  if (corePct >= 1) {
    const pulse = 0.05 + Math.sin(t*3)*0.05;
    ctx.save();
    ctx.shadowColor = _HUD_C.a_07; ctx.shadowBlur = 14 + Math.sin(t*3)*6;
    ctx.strokeStyle = amber + pulse + ')'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(cx, cy, r4, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // ---- LAYER 6: FLOATING BRACKETS (Abilities) ----
  const r5 = 340;
  const bracketAngleWidth = 0.22;
  const abilityAngles = [-Math.PI/2 - 0.8, -Math.PI/2, -Math.PI/2 + 0.8];
  const abilityKeys = ['Q','E','F'];
  for (let i = 0; i < 3; i++) {
    const angle = abilityAngles[i];
    const cd = player.abilityCooldowns[i];
    const active = player.abilityActive[i];
    const maxCd = player.abilities[i] ? player.abilities[i].cooldown : 1;
    const cdPct = cd > 0 ? cd / maxCd : 0;
    const ready = cd <= 0;
    const bStart = angle - bracketAngleWidth/2, bEnd = angle + bracketAngleWidth/2;
    ctx.strokeStyle = _HUD_C.w_012; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r5, bStart, bEnd); ctx.stroke();
    for (const a of [bStart, bEnd]) {
      const _ec = Math.cos(a), _es = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + _ec * (r5-12), cy + _es * (r5-12));
      ctx.lineTo(cx + _ec * (r5+12), cy + _es * (r5+12));
      ctx.stroke();
    }
    if (cdPct > 0) {
      const sweepEnd = bStart + (bEnd - bStart) * (1 - cdPct);
      ctx.strokeStyle = _HUD_C.w_035; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r5, bStart, sweepEnd); ctx.stroke();
    } else {
      ctx.strokeStyle = active ? _HUD_C.a_085 : _HUD_C.c_04; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r5, bStart, bEnd); ctx.stroke();
    }
    const labelR = r5 + 22;
    ctx.fillStyle = ready ? (active ? _HUD_C.a_09 : _HUD_C.w_05) : _HUD_C.w_02;
    hudFont('11px Courier New'); ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(abilityKeys[i], cx + Math.cos(angle)*labelR, cy + Math.sin(angle)*labelR);
  }

  // ---- LAYER 7: rotating tick ring (96 ticks, optimized trig via angle-add identities) ----
  const r6 = 390;
  const _rotOffset7 = t * 0.08;
  const _rotC7 = Math.cos(_rotOffset7), _rotS7 = Math.sin(_rotOffset7);
  for (let i = 0; i < _HUD_TICK_COUNT; i++) {
    const _bc = _hudTickBaseCos[i], _bs = _hudTickBaseSin[i];
    const _ca = _bc * _rotC7 - _bs * _rotS7;
    const _sa = _bs * _rotC7 + _bc * _rotS7;
    const isMajor = i % 12 === 0, isMid = i % 4 === 0;
    const len = isMajor ? 16 : isMid ? 8 : 4;
    ctx.strokeStyle = isMajor ? _HUD_C.w_018 : isMid ? _HUD_C.w_01 : _HUD_C.w_005;
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + _ca * (r6 - len), cy + _sa * (r6 - len));
    ctx.lineTo(cx + _ca * (r6 + len), cy + _sa * (r6 + len));
    ctx.stroke();
  }

  // ---- LAYER 8: CORNER BRACKETS ----
  const r7 = 420, bracketSize = 40;
  const cornerAngles = [Math.PI*0.25, Math.PI*0.75, Math.PI*1.25, Math.PI*1.75];
  const rot2 = -t * 0.05;
  ctx.strokeStyle = _HUD_C.w_012; ctx.lineWidth = 2;
  const _bracketHalf = bracketSize * 0.5, _bracketPerp = bracketSize * 0.4;
  for (const base of cornerAngles) {
    const a = base + rot2;
    const _ac = Math.cos(a), _as = Math.sin(a);
    const bx = cx + _ac * r7, by = cy + _as * r7;
    const _radHX = _ac*_bracketHalf, _radHY = _as*_bracketHalf;
    const _perpHX = -_as*_bracketPerp, _perpHY = _ac*_bracketPerp;
    ctx.beginPath();
    ctx.moveTo(bx - _radHX, by - _radHY); ctx.lineTo(bx + _radHX, by + _radHY); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx - _radHX - _perpHX, by - _radHY - _perpHY);
    ctx.lineTo(bx + _radHX + _perpHX, by + _radHY + _perpHY);
    ctx.stroke();
  }

  // ---- LAYER 9: LARGE BRACKET ELEMENTS (quadrant markers) ----
  const r8 = 460;
  const qAngles = [0, Math.PI/2, Math.PI, Math.PI*1.5];
  const rot3 = t * 0.03;
  ctx.fillStyle = _HUD_C.w_005; ctx.strokeStyle = _HUD_C.w_01; ctx.lineWidth = 1;
  const _tHalf = t * 0.5;
  for (let qi = 0; qi < 4; qi++) {
    const qa = qAngles[qi] + rot3;
    const _qc = Math.cos(qa), _qs = Math.sin(qa);
    const qx = cx + _qc * r8, qy = cy + _qs * r8;
    const size = 28 + Math.sin(_tHalf + qi) * 6;
    const _half = size * 0.5;
    ctx.save(); ctx.translate(qx, qy); ctx.rotate(qa + Math.PI/4);
    ctx.fillRect(-_half, -_half, size, size);
    ctx.strokeRect(-_half, -_half, size, size);
    ctx.restore();
  }

  // ---- PUNCTURE RAILGUN CHARGE INDICATOR ----
  if (player.loadoutKey === 'PUNCTURE') {
    const chgPct = player.railgunCharge;
    const chgR = r1 - 25;
    const chgStart = Math.PI * 0.85, chgEnd = Math.PI * 1.15;
    const chgSpan = chgEnd - chgStart;
    ctx.strokeStyle = 'rgba(255,100,30,0.12)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, chgR, chgStart, chgEnd); ctx.stroke();
    if (chgPct > 0) {
      const chgCol = chgPct >= 1 ? `rgba(255,80,20,${0.6 + Math.sin(t*8)*0.3})` : 'rgba(255,120,40,0.7)';
      ctx.strokeStyle = chgCol; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(cx, cy, chgR, chgStart, chgStart + chgSpan * chgPct); ctx.stroke();
    }
    ctx.fillStyle = chgPct >= 1 ? 'rgba(255,80,20,0.9)' : 'rgba(255,120,40,0.5)';
    hudFont('10px Courier New'); ctx.textAlign='center';
    ctx.fillText(chgPct >= 1 ? 'MAX' : Math.floor(chgPct*100)+'%', cx, cy + chgR + 16);
  }

  // ---- BLASTER POWER SHOT CHARGE INDICATOR ----
  if (player.loadoutKey === 'BLASTER' && player.powerShotCharging) {
    const chgPct = player.powerShotCharge;
    const chgR = r1 - 25;
    const chgStart = Math.PI * 0.85, chgEnd = Math.PI * 1.15;
    const chgSpan = chgEnd - chgStart;
    ctx.strokeStyle = 'rgba(255,100,30,0.12)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, chgR, chgStart, chgEnd); ctx.stroke();
    if (chgPct > 0) {
      const chgCol = chgPct >= 1 ? `rgba(255,80,20,${0.6 + Math.sin(t*8)*0.3})` : 'rgba(255,120,40,0.7)';
      ctx.strokeStyle = chgCol; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(cx, cy, chgR, chgStart, chgStart + chgSpan * chgPct); ctx.stroke();
    }
    ctx.fillStyle = chgPct >= 1 ? 'rgba(255,80,20,0.9)' : 'rgba(255,120,40,0.5)';
    hudFont('10px Courier New'); ctx.textAlign='center';
    ctx.fillText('PWR', cx, cy + chgR + 16);
  }

  // ---- VORTEX ENERGY INDICATOR ----
  if (player.loadoutKey === 'VORTEX') {
    const nrgPct = player.vortexEnergy / player.vortexMaxEnergy;
    const nrgR = r1 - 25;
    const nrgStart = Math.PI * 0.85, nrgEnd = Math.PI * 1.15;
    const nrgSpan = nrgEnd - nrgStart;
    ctx.strokeStyle = 'rgba(60,180,255,0.12)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, nrgR, nrgStart, nrgEnd); ctx.stroke();
    if (nrgPct > 0) {
      const nrgCol = nrgPct < 0.2 ? `rgba(255,60,30,${0.5 + Math.sin(t*6)*0.3})` : 'rgba(60,180,255,0.7)';
      ctx.strokeStyle = nrgCol; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(cx, cy, nrgR, nrgStart, nrgStart + nrgSpan * nrgPct); ctx.stroke();
    }
    ctx.fillStyle = nrgPct < 0.2 ? 'rgba(255,60,30,0.8)' : 'rgba(60,180,255,0.5)';
    hudFont('10px Courier New'); ctx.textAlign='center';
    ctx.fillText('NRG ' + Math.floor(nrgPct*100) + '%', cx, cy + nrgR + 16);
  }

  // ---- DASH PIPS (small dots below center) ----
  const dashY = cy + r1 + 35, pipR = 5, pipGap = 14;
  const totalPipW = player.maxDashes * (pipR * 2 + pipGap) - pipGap;
  const pipStartX = cx - totalPipW / 2;
  for (let i = 0; i < player.maxDashes; i++) {
    const px = pipStartX + i * (pipR*2 + pipGap) + pipR;
    ctx.beginPath(); ctx.arc(px, dashY, pipR, 0, Math.PI*2);
    if (i < player.dashCharges) { ctx.fillStyle = _HUD_C.c_08; ctx.fill(); }
    else { ctx.strokeStyle = _HUD_C.w_018; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // ---- COCKPIT GUNS (recoil animation + muzzle flash) ----
  player.muzzleFlashTimer = Math.max(0, player.muzzleFlashTimer - (1/60));
  player.gunRecoilL = Math.max(0, player.gunRecoilL - (1/60) * 12);
  player.gunRecoilR = Math.max(0, player.gunRecoilR - (1/60) * 12);

  const gunLen = H * 0.45;
  const gunBaseW = W * 0.18;
  const gunTipW = W * 0.04;
  const tipInset = W * 0.22;
  const ARM_DOWN_SHIFT = 100, ARM_OUT_SHIFT = 50;
  const gunAccentCol = player.team === 'A' ? 'rgba(60,200,120,' : 'rgba(200,80,60,';

  function drawGun(side, recoil, flashActive) {
    const recoilAmt = recoil * 22;
    const sway = Math.sin(t * 1.2 + side * Math.PI) * 2;
    ctx.save();
    const baseY = H + 20 + recoilAmt + sway + ARM_DOWN_SHIFT;
    let tipY = H - gunLen + recoilAmt + sway + ARM_DOWN_SHIFT;
    const gunSlide = gunBaseW * 0.66 + ARM_OUT_SHIFT;
    let baseOuterX, baseInnerX, tipOuterX, tipInnerX;
    if (side === 0) {
      baseOuterX = -10 - gunSlide;
      baseInnerX = gunBaseW - 10 - gunSlide;
      tipOuterX = tipInset - gunTipW - gunSlide * 0.35;
      tipInnerX = tipInset - gunSlide * 0.35;
    } else {
      baseOuterX = W + 10 + gunSlide;
      baseInnerX = W - gunBaseW + 10 + gunSlide;
      tipOuterX = W - tipInset + gunTipW + gunSlide * 0.35;
      tipInnerX = W - tipInset + gunSlide * 0.35;
    }
    // Use cockpit frame muzzle hint if available
    const fm = player.cockpitFrameMuzzle;
    const useFrame = !!(fm && fm.left && fm.right
      && Number.isFinite(fm.left.x) && Number.isFinite(fm.left.y)
      && Number.isFinite(fm.right.x) && Number.isFinite(fm.right.y)
      && fm.imgW && fm.imgH);
    if (useFrame) {
      const tip = side === 0 ? fm.left : fm.right;
      const scr = frameImgToScreen(tip.x, tip.y, fm.imgW, fm.imgH, W, H);
      const tipCX = scr.x, tipCY = scr.y + recoilAmt + sway;
      const halfW = Math.max(10, W * 0.012);
      tipOuterX = tipCX - (side === 0 ? halfW : -halfW);
      tipInnerX = tipCX + (side === 0 ? halfW : -halfW);
      tipY = tipCY;
    }
    // Procedural arms now removed; cockpit art from per-titan frame PNG overlay.
    void flashActive;
    ctx.restore();
  }
  const flashL = player.muzzleFlashTimer > 0 && player.muzzleFlashSide === 0;
  const flashR = player.muzzleFlashTimer > 0 && player.muzzleFlashSide === 1;
  drawGun(0, player.gunRecoilL, flashL);
  drawGun(1, player.gunRecoilR, flashR);

  // ---- CENTER MUZZLE FLASH: concentric warm circles ----
  if (player.muzzleFlashTimer > 0) {
    const fi = player.muzzleFlashTimer / 0.08;
    const cx = W / 2, cy = H / 2;
    const warmColors = [
      [255,255,220],[255,220,100],[255,160,40],[255,100,20],[220,60,10],
    ];
    const ringCount = 3 + Math.floor(Math.random() * 3);
    for (let r = 0; r < ringCount; r++) {
      const radius = (8 + r * 12) * fi;
      const c = warmColors[r % warmColors.length];
      const alpha = (0.6 - r * 0.1) * fi;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, alpha)})`;
      ctx.lineWidth = (3 - r * 0.4) * fi;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.stroke();
    }
    ctx.fillStyle = `rgba(255,255,240,${0.8 * fi})`;
    ctx.beginPath(); ctx.arc(cx, cy, 4 * fi, 0, Math.PI*2); ctx.fill();
  }

  // ---- TRACKER LOCK-ON CIRCUMPUNCT INDICATORS ----
  if (player.loadoutKey === 'TRACKER') {
    const halfW = W / 2, halfH = H / 2;
    for (const bot of game.entities) {
      if (!bot.alive || bot.team === player.team) continue;
      const locks = player.trackerLocks[bot.id] || 0;
      if (locks <= 0) continue;
      const worldPos = bot.position.clone();
      const projected = worldPos.clone().project(camera);
      if (projected.z > 1) continue;
      const sx = (projected.x * halfW) + halfW;
      const sy = -(projected.y * halfH) + halfH;
      if (sx < -100 || sx > W + 100 || sy < -100 || sy > H + 100) continue;
      const baseR = 30;
      const lockAlpha = locks >= 3 ? (0.7 + Math.sin(t*8)*0.3) : 0.5;
      const lockColor = `rgba(255,170,0,${lockAlpha})`;
      const fullLockColor = `rgba(255,80,0,${lockAlpha})`;
      ctx.fillStyle = locks >= 3 ? fullLockColor : lockColor;
      ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI*2); ctx.fill();
      for (let ring = 0; ring < locks; ring++) {
        const ringR = baseR * (0.5 + ring * 0.4);
        const ringRotation = t * (2 + ring) * (ring % 2 === 0 ? 1 : -1);
        const dashLen = ring === 2 ? 0 : 0.15;
        ctx.strokeStyle = ring === 2 && locks >= 3 ? fullLockColor : lockColor;
        ctx.lineWidth = ring === 2 && locks >= 3 ? 2.5 : 1.5;
        if (dashLen > 0) {
          const gapStart = ringRotation % (Math.PI*2);
          const gapSize = dashLen * Math.PI * 2;
          ctx.beginPath(); ctx.arc(sx, sy, ringR, gapStart + gapSize, gapStart + Math.PI*2); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(sx, sy, ringR, 0, Math.PI*2); ctx.stroke();
        }
        if (ring < 2) {
          const tickLen = 6;
          for (let ti = 0; ti < 4; ti++) {
            const ta = ringRotation + (ti / 4) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(sx + Math.cos(ta) * (ringR - tickLen), sy + Math.sin(ta) * (ringR - tickLen));
            ctx.lineTo(sx + Math.cos(ta) * (ringR + tickLen), sy + Math.sin(ta) * (ringR + tickLen));
            ctx.stroke();
          }
        }
      }
      if (locks >= 3) {
        ctx.fillStyle = fullLockColor;
        hudFont('bold 10px Courier New'); ctx.textAlign='center';
        ctx.fillText('LOCKED', sx, sy + baseR * 1.8 + 8);
      }
    }
  }

  // ---- DOOMED: red pulse on inner ring ----
  if (isDoomed) {
    const doomPulse = 0.15 + Math.abs(Math.sin(t*5)) * 0.2;
    ctx.strokeStyle = red + doomPulse + ')';
    ctx.lineWidth = 30;
    ctx.beginPath(); ctx.arc(cx, cy, r1, 0, Math.PI*2); ctx.stroke();
  }
}

// ----- updateHUD wrapper (round info, doomed warning, lock-on warning, fleet scores) -----

function updateHUD() {
  if (!player.chassis) return;
  // Draw the circumpunct ring HUD
  drawCircumpunctHUD();

  // Core meter (keep DOM element updated for backward compat)
  const corePct = Math.min(100, player.coreMeter);
  _hudWidth(_hudEl('core-fill'), 'core-fill:w', corePct + '%');
  _hudText(_hudEl('core-value'), 'core-value:t', Math.floor(corePct) + '%');

  // Doomed warning + vignette
  const isDoomed = player.doomed && player.shipState !== 'dead';
  const doomDisp = isDoomed ? 'block' : 'none';
  _hudDisplay(_hudEl('doomed-warning'), 'doomed-warning:d', doomDisp);
  _hudDisplay(_hudEl('doomed-vignette'), 'doomed-vignette:d', doomDisp);

  // Enemy TRACKER lock-on warning
  let maxEnemyLocks = 0;
  for (const botId in player.enemyToneLocks) {
    const bot = game.entities.find(b => b.id === parseInt(botId));
    if (!bot || !bot.alive) { delete player.enemyToneLocks[botId]; continue; }
    if (player.enemyToneLocks[botId] > maxEnemyLocks) maxEnemyLocks = player.enemyToneLocks[botId];
  }
  player.enemyToneLockMax = maxEnemyLocks;
  const lockonEl = _hudEl('enemy-lockon-warning');
  if (maxEnemyLocks > 0 && player.shipState !== 'dead') {
    _hudDisplay(lockonEl, 'lockon:d', 'block');
    _hudClass(lockonEl, 'lockon:c', maxEnemyLocks >= 3 ? 'full-lock' : '');
    if (lockonEl) {
      const textEl = _hudLast['lockon:textEl'] || (_hudLast['lockon:textEl'] = lockonEl.querySelector('.lockon-text'));
      _hudText(textEl, 'lockon:t', maxEnemyLocks >= 3 ? 'WARNING: ENEMY LOCKED-ON' : 'WARNING: ENEMY LOCKING');
    }
    for (let p = 1; p <= 3; p++) {
      const pip = _hudEl('lockon-pip-' + p);
      _hudClass(pip, 'lockon-pip:c:' + p, p <= maxEnemyLocks ? 'lockon-pip filled' : 'lockon-pip');
    }
  } else {
    _hudDisplay(lockonEl, 'lockon:d', 'none');
  }

  // Round info
  let timerValue = game.state === 'warmup' ? game.warmupTimer : game.roundTimer;
  const minutes = Math.floor(Math.max(0, timerValue) / 60);
  const seconds = Math.floor(Math.max(0, timerValue) % 60);
  const _hideTimer = !!game.raceNoTimer && game.state !== 'warmup';
  _hudText(_hudEl('round-timer'), 'round-timer:t',
    _hideTimer ? '--' : (minutes + ':' + String(seconds).padStart(2, '0')));
  const stateText = game.state === 'warmup' ? 'WARMUP' :
    game.state === 'playing' ? 'ROUND ' + game.currentRound :
    game.state === 'roundEnd' ? 'ROUND OVER' :
    game.state === 'matchEnd' ? (game.scoreA >= LSS.ROUNDS_TO_WIN ? 'FLEET A WINS' : 'FLEET B WINS') : '';
  _hudText(_hudEl('round-state'), 'round-state:t', stateText);

  // Fleet score labels: friendly blue, enemy red
  const teamA = _hudLast['team-a:el'] || (_hudLast['team-a:el'] = document.querySelector('.team-a'));
  const teamB = _hudLast['team-b:el'] || (_hudLast['team-b:el'] = document.querySelector('.team-b'));
  _hudText(teamA, 'team-a:t', 'FLEET A: ' + game.scoreA);
  _hudText(teamB, 'team-b:t', 'FLEET B: ' + game.scoreB);
  const _palKey = (player && player.team === LSS.TEAM_FLEET_B) ? 'B' : 'A';
  if (_hudLast['team:pal'] !== _palKey) {
    _hudLast['team:pal'] = _palKey;
    const FRIEND_HEX = '#4fb6ff', ENEMY_HEX = '#ff4040';
    const aColor = (_palKey === 'A') ? FRIEND_HEX : ENEMY_HEX;
    const bColor = (_palKey === 'B') ? FRIEND_HEX : ENEMY_HEX;
    if (teamA) { teamA.style.color = aColor; teamA.style.borderBottomColor = aColor; }
    if (teamB) { teamB.style.color = bColor; teamB.style.borderBottomColor = bColor; }
  }
  // Update ability bar
  updateAbilityHUD();
}

// ----- 3. MINIMAP (canvas + state + updater) -----

// <canvas id="minimap"></canvas>  (inside #hud)

const _mm = {
  canvas: null,
  ctx: null,
  extent: 0,
  extentKey: null,
  lastTick: 0,
  forward: new THREE.Vector3(),
};
function invalidateMinimapExtent() {
  _mm.extent = 0;
  _mm.extentKey = null;
}

function updateMinimap() {
  if (!_mm.canvas) {
    _mm.canvas = document.getElementById('minimap');
    if (!_mm.canvas) return;
    _mm.ctx = _mm.canvas.getContext('2d');
    _mm.canvas.width = 150; _mm.canvas.height = 150;
  }
  const ctx = _mm.ctx;
  if (!ctx) return;
  // 20Hz throttle
  const now = (typeof game !== 'undefined' && game.time) || 0;
  if (_mm.lastTick && now - _mm.lastTick < 0.05) return;
  _mm.lastTick = now;
  ctx.clearRect(0, 0, 150, 150);
  ctx.strokeStyle = 'rgba(80,80,120,0.4)';
  ctx.strokeRect(0, 0, 150, 150);

  // Auto-fit radar to level geometry; cached per-map.
  const spheres = game.levelSpheres || [];
  const cyls = game.levelCylinders || [];
  const key = spheres.length * 131071 + cyls.length;
  if (_mm.extent === 0 || _mm.extentKey !== key) {
    let mapExtent = 1000;
    for (const s of spheres) {
      mapExtent = Math.max(mapExtent, Math.abs(s.cx) + s.r, Math.abs(s.cz) + s.r);
    }
    for (const c of cyls) {
      mapExtent = Math.max(mapExtent, Math.abs(c.ax) + c.r, Math.abs(c.bx) + c.r, Math.abs(c.az) + c.r, Math.abs(c.bz) + c.r);
    }
    _mm.extent = mapExtent * 1.15;
    _mm.extentKey = key;
  }
  const scale = 150 / (_mm.extent * 2);
  const cx = 75, cy = 75;

  // Tunnel cylinders
  ctx.strokeStyle = 'rgba(60,70,100,0.35)'; ctx.lineWidth = 2;
  for (const c of cyls) {
    const x1 = cx + c.ax * scale, y1 = cy + c.az * scale;
    const x2 = cx + c.bx * scale, y2 = cy + c.bz * scale;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  // Room spheres
  ctx.fillStyle = 'rgba(80,80,120,0.2)'; ctx.strokeStyle = 'rgba(80,90,130,0.4)'; ctx.lineWidth = 1;
  for (const s of spheres) {
    const sx = cx + s.cx * scale, sy = cy + s.cz * scale, sr = s.r * scale;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  }
  // Player
  const px = cx + player.position.x * scale, py = cy + player.position.z * scale;
  ctx.fillStyle = '#fff'; ctx.fillRect(px - 2, py - 2, 4, 4);
  // Direction line
  _mm.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(px, py); ctx.lineTo(px + _mm.forward.x * 15, py + _mm.forward.z * 15);
  ctx.stroke();
  // Bots (friendly=blue, enemy=red)
  const _localTeam = (typeof player !== 'undefined' && player && player.team) || null;
  const FRIEND_COL = '#4fb6ff', ENEMY_COL = '#ff4040';
  for (const bot of game.entities) {
    if (!bot.alive) continue;
    const bx = cx + bot.position.x * scale, by = cy + bot.position.z * scale;
    const isEnemy = (_localTeam == null) || (bot.team !== _localTeam);
    ctx.fillStyle = isEnemy ? ENEMY_COL : FRIEND_COL;
    ctx.fillRect(bx - 2, by - 2, 3, 3);
    if (bot.doomed) {
      ctx.strokeStyle = ENEMY_COL; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI*2); ctx.stroke();
    }
  }
  if (typeof net !== 'undefined' && net && net.networkPlayers) {
    for (const np of net.networkPlayers) {
      if (!np || !np.alive || !np.position) continue;
      const bx = cx + np.position.x * scale, by = cy + np.position.z * scale;
      const isEnemy = (_localTeam == null) || (np.team !== _localTeam);
      ctx.fillStyle = isEnemy ? ENEMY_COL : FRIEND_COL;
      ctx.fillRect(bx - 2, by - 2, 3, 3);
    }
  }
  // Stasis fields (pulsing cyan diamonds)
  for (const field of game.stasisFields) {
    if (!field.alive) continue;
    const fx = cx + field.position.x * scale, fy = cy + field.position.z * scale;
    const pulse = 0.5 + Math.sin(game.time * 4) * 0.3;
    ctx.fillStyle = `rgba(0,200,255,${pulse})`;
    ctx.beginPath();
    ctx.moveTo(fx, fy - 4); ctx.lineTo(fx + 3, fy);
    ctx.lineTo(fx, fy + 4); ctx.lineTo(fx - 3, fy);
    ctx.closePath(); ctx.fill();
  }
  if (game.mapWord) {
    ctx.fillStyle = 'rgba(255,170,0,0.4)';
    hudFont('8px Courier New'); ctx.textAlign='center';
    ctx.fillText(game.mapWord, 75, 145);
  }
}

// ----- 4. ABILITY HUD (build + ability pie SVG + update) -----

// DOM: <div id="abilities"></div>  and  <div id="ability-pie"><svg viewBox="0 0 200 200"></svg></div>

function buildAbilityHUD() {
  const container = document.getElementById('abilities');
  container.innerHTML = '';
  _abInvalidate(); // clear DOM-ref cache so next update requeries
  const keys = ['Q', 'E', 'F'];
  const gpLabels = ['LB', 'RB', 'Y'];
  for (let i = 0; i < 3; i++) {
    const ability = player.abilities[i];
    const slot = document.createElement('div');
    slot.className = 'ability-slot ready';
    slot.id = 'ab-slot-' + i;
    slot.innerHTML =
      '<div class="ab-cd-text"></div>' +
      '<div class="ab-name">' + (ability ? ability.name : '') + '</div>' +
      '<div class="ab-keys">' +
        '<span class="ab-key">' + keys[i] + '</span>' +
        '<span class="ab-gp">' + gpLabels[i] + '</span>' +
      '</div>' +
      '<div class="ab-cd-bar" style="width:100%"></div>';
    container.appendChild(slot);
  }
  // Core ability
  const coreSlot = document.createElement('div');
  coreSlot.className = 'ability-slot';
  coreSlot.id = 'ab-slot-core';
  coreSlot.innerHTML =
    '<div class="ab-cd-text"></div>' +
    '<div class="ab-name">' + (player.loadout ? player.loadout.core.name : 'CORE') + '</div>' +
    '<div class="ab-keys"><span class="ab-key">V</span><span class="ab-gp">D^</span></div>' +
    '<div class="ab-cd-bar" style="width:0%"></div>';
  container.appendChild(coreSlot);
  buildAbilityPie();
}

// Ability pie quarters (top=Q, right=E, bottom=F, left=core/V)
const _apQuarters = [
  { id: 'top',    t1: 225, t2: 315, key: 'Q', gp: 'LB', slotKey: 0 },
  { id: 'right',  t1: 315, t2: 405, key: 'E', gp: 'RB', slotKey: 1 },
  { id: 'bottom', t1:  45, t2: 135, key: 'F', gp: 'Y',  slotKey: 2 },
  { id: 'left',   t1: 135, t2: 225, key: 'V', gp: 'D^', slotKey: 'core' },
];
const _AP_INNER_R = 0, _AP_OUTER_R = 92, _AP_GAP_DEG = 3.0;
const _apCache = {};

function buildAbilityPie() {
  const svg = document.querySelector('#ability-pie svg');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  Object.keys(_apCache).forEach(k => delete _apCache[k]);
  const cx = 100, cy = 100;
  const inR = _AP_INNER_R, outR = _AP_OUTER_R;
  const labelR = outR * 0.58;
  const NS = 'http://www.w3.org/2000/svg';
  for (const q of _apQuarters) {
    const t1 = (q.t1 + _AP_GAP_DEG / 2) * Math.PI / 180;
    const t2 = (q.t2 - _AP_GAP_DEG / 2) * Math.PI / 180;
    const x1o = cx + outR * Math.cos(t1), y1o = cy + outR * Math.sin(t1);
    const x2o = cx + outR * Math.cos(t2), y2o = cy + outR * Math.sin(t2);
    let d;
    if (inR <= 0.001) {
      d = `M ${cx} ${cy} L ${x1o.toFixed(2)} ${y1o.toFixed(2)} A ${outR} ${outR} 0 0 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)} Z`;
    } else {
      const x1i = cx + inR * Math.cos(t1), y1i = cy + inR * Math.sin(t1);
      const x2i = cx + inR * Math.cos(t2), y2i = cy + inR * Math.sin(t2);
      d = `M ${x1i.toFixed(2)} ${y1i.toFixed(2)} L ${x1o.toFixed(2)} ${y1o.toFixed(2)} A ${outR} ${outR} 0 0 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)} L ${x2i.toFixed(2)} ${y2i.toFixed(2)} A ${inR} ${inR} 0 0 0 ${x1i.toFixed(2)} ${y1i.toFixed(2)} Z`;
    }
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'ap-quarter');
    path.setAttribute('id', 'ap-q-' + q.id);
    svg.appendChild(path);
    const tMid = ((q.t1 + q.t2) / 2) * Math.PI / 180;
    const lx = cx + labelR * Math.cos(tMid), ly = cy + labelR * Math.sin(tMid);
    const keyEl = document.createElementNS(NS, 'text');
    keyEl.setAttribute('class','ap-key'); keyEl.setAttribute('x', lx); keyEl.setAttribute('y', ly - 7);
    keyEl.textContent = q.key; svg.appendChild(keyEl);
    const nameEl = document.createElementNS(NS, 'text');
    nameEl.setAttribute('class','ap-label'); nameEl.setAttribute('x', lx); nameEl.setAttribute('y', ly + 5);
    nameEl.setAttribute('id', 'ap-name-' + q.id); nameEl.textContent = ''; svg.appendChild(nameEl);
    const cdEl = document.createElementNS(NS, 'text');
    cdEl.setAttribute('class','ap-cdtext'); cdEl.setAttribute('x', lx); cdEl.setAttribute('y', ly + 14);
    cdEl.setAttribute('id', 'ap-cd-' + q.id); cdEl.textContent = ''; svg.appendChild(cdEl);
    _apCache[q.id] = { path, keyEl, nameEl, cdEl, lastFill:'', lastName:'', lastCd:'' };
  }
}

function _apFillForState(cls, barW) {
  if (cls.indexOf('active-now') >= 0) return 'rgba(255,180,50,0.45)';
  if (cls.indexOf('ready') >= 0)      return 'rgba(40,210,90,0.36)';
  const p = Math.max(0, Math.min(1, (barW || 0) / 100));
  const hue = p * 120;
  return `hsla(${hue.toFixed(0)}, 78%, 48%, 0.36)`;
}
function _apShortName(s) {
  if (!s) return '';
  const w = String(s).split(/\s+/)[0];
  return w.length > 9 ? w.slice(0, 9) : w;
}

// Per-slot DOM ref cache (rebuilt whenever buildAbilityHUD reflows the slots)
const _abSlotCache = { slots: [null, null, null], core: null };
function _abSlot(i) {
  let e = _abSlotCache.slots[i];
  if (!e) {
    const slot = document.getElementById('ab-slot-' + i);
    if (!slot) return null;
    e = _abSlotCache.slots[i] = {
      slot,
      bar: slot.querySelector('.ab-cd-bar'),
      cdText: slot.querySelector('.ab-cd-text'),
      name: slot.querySelector('.ab-name'),
    };
  }
  return e;
}
function _abCore() {
  let e = _abSlotCache.core;
  if (!e) {
    const slot = document.getElementById('ab-slot-core');
    if (!slot) return null;
    e = _abSlotCache.core = {
      slot,
      bar: slot.querySelector('.ab-cd-bar'),
      cdText: slot.querySelector('.ab-cd-text'),
      name: slot.querySelector('.ab-name'),
    };
  }
  return e;
}
function _abInvalidate() {
  _abSlotCache.slots[0] = _abSlotCache.slots[1] = _abSlotCache.slots[2] = null;
  _abSlotCache.core = null;
}

function _apApplyFromSlot(qid, e) {
  const cache = _apCache[qid];
  if (!cache || !e || !e.slot) return;
  const cls = e.slot.className || '';
  const barW = e.bar && e.bar.style && e.bar.style.width
    ? parseFloat(e.bar.style.width) || 0 : 0;
  const fill = _apFillForState(cls, barW);
  if (fill !== cache.lastFill) { cache.path.style.fill = fill; cache.lastFill = fill; }
  const cdTxt = e.cdText ? (e.cdText.textContent || '') : '';
  if (cdTxt !== cache.lastCd) { cache.cdEl.textContent = cdTxt; cache.lastCd = cdTxt; }
  const nameTxt = _apShortName(e.name ? e.name.textContent : '');
  if (nameTxt !== cache.lastName) { cache.nameEl.textContent = nameTxt; cache.lastName = nameTxt; }
}

function updateAbilityHUD() {
  for (let i = 0; i < 3; i++) {
    const e = _abSlot(i);
    if (!e) continue;
    const ability = player.abilities[i];
    if (!ability) continue;
    const cd = player.abilityCooldowns[i];
    const active = player.abilityActive[i];
    const maxCd = ability.cooldown || 1;

    let cls = 'ability-slot' + (active ? ' active-now' : cd > 0 ? ' on-cooldown' : ' ready');
    let barW = (cd > 0 ? ((1 - cd / maxCd) * 100) : 100) + '%';

    let cdTextVal;
    if (active && ability.name === 'Body Shield' && player.gunShieldHP > 0) cdTextVal = String(Math.ceil(player.gunShieldHP));
    else if (active && ability.name === 'Fire Shield' && player.thermalShieldHP > 0) cdTextVal = String(Math.ceil(player.thermalShieldHP));
    else if (active) cdTextVal = '';
    else if (cd > 0) cdTextVal = Math.ceil(cd) + 's';
    else cdTextVal = '';

    // VORTEX energy override
    if (player.loadoutKey === 'VORTEX') {
      const energyPct = player.vortexEnergy / player.vortexMaxEnergy;
      if (cd <= 0) barW = (energyPct * 100) + '%';
      if (cd <= 0 && !active) cdTextVal = String(Math.floor(player.vortexEnergy));
    }
    // PYRO Fire Shield: bar shows power level
    if (player.loadoutKey === 'PYRO' && ability.name === 'Fire Shield') {
      const powerPct = player.thermalShieldHP / player.thermalShieldMaxHP;
      barW = (powerPct * 100) + '%';
      if (!active && player.thermalShieldHP > 0) cls = 'ability-slot ready';
      else if (!active && player.thermalShieldHP <= 0) cls = 'ability-slot on-cooldown';
      if (!active) cdTextVal = String(Math.floor(player.thermalShieldHP));
    }
    // PYRO Explosive Gas: charge-based
    if (player.loadoutKey === 'PYRO' && ability.name === 'Explosive Gas') {
      const charges = player.trapCharges || 0;
      const maxCharges = player.maxTrapCharges || 2;
      if (charges >= maxCharges) barW = '100%';
      else {
        const tt = player.trapCooldownTimer || 0;
        const cdMax = player.trapChargeCooldown || 12;
        barW = ((1 - tt / cdMax) * 100) + '%';
      }
      cls = charges > 0 ? 'ability-slot ready' : 'ability-slot on-cooldown';
      cdTextVal = charges + '/' + maxCharges;
    }
    _hudClass(e.slot, 'ab:' + i + ':c', cls);
    _hudWidth(e.bar, 'ab:' + i + ':w', barW);
    _hudText(e.cdText, 'ab:' + i + ':t', cdTextVal);
  }
  // Core slot
  const core = _abCore();
  if (core) {
    const corePct = Math.min(100, player.coreMeter) / 100;
    const coreActive = player.coreActive;
    const coreReady = player.coreReady && !coreActive;
    const cls = 'ability-slot' + (coreActive ? ' active-now' : coreReady ? ' ready' : ' on-cooldown');
    _hudClass(core.slot, 'ab:core:c', cls);
    _hudWidth(core.bar, 'ab:core:w', (corePct * 100) + '%');
    let cdTextVal;
    if (coreActive) cdTextVal = '';
    else if (!coreReady) cdTextVal = Math.floor(player.coreMeter) + '%';
    else cdTextVal = '';
    _hudText(core.cdText, 'ab:core:t', cdTextVal);
  }
  // Pie quarter colors + labels
  for (const q of _apQuarters) {
    const e = (q.slotKey === 'core') ? _abCore() : _abSlot(q.slotKey);
    _apApplyFromSlot(q.id, e);
  }
}

// ----- 5. TEAMMATE STRIP / FLEET CHIPS -----
// Two-fleet bottom strip (#teammates-list + #enemies-list). Local player + friendly peers/bots on
// the left, enemy peers/bots on the right. Discord avatars when available, baked GLB ship thumbnails
// otherwise, dashed empty placeholders for unfilled slots.
function updateTeammatesStrip() {
  const yourList = document.getElementById('teammates-list');
  const enemyList = document.getElementById('enemies-list');
  if (!yourList || !enemyList) return;
  yourList.innerHTML = ''; enemyList.innerHTML = '';

  const myTeam = (player && player.team !== undefined) ? player.team : LSS.TEAM_FLEET_A;
  const otherTeam = (myTeam === LSS.TEAM_FLEET_B) ? LSS.TEAM_FLEET_A : LSS.TEAM_FLEET_B;
  const inMultiplayer = !!(net && net.active);

  function makeChip(opts) {
    const chip = document.createElement('div');
    chip.className = 'fleet-chip';
    if (opts.isYou) chip.classList.add('you');
    if (opts.isEnemy) chip.classList.add('enemy');
    if (opts.isEmpty) chip.classList.add('empty');
    if (!opts.showPip) chip.classList.add('no-pip');
    if (opts.isReady) chip.classList.add('is-ready');
    let thumbHTML;
    if (!opts.isEmpty && opts.discordAvatarUrl) {
      const shipMini = opts.ship && opts.ship !== '---' ? `<span class="chip-ship-mini">${opts.ship}</span>` : '';
      thumbHTML = `<div class="chip-avatar-wrap"><img class="chip-avatar" src="${opts.discordAvatarUrl}" alt="${opts.name||''}">${shipMini}</div>`;
    } else {
      const thumbSrc = (!opts.isEmpty && opts.ship && _shipThumbCache[opts.ship]) ? _shipThumbCache[opts.ship] : null;
      if (thumbSrc) thumbHTML = `<img class="chip-thumb" src="${thumbSrc}" alt="${opts.ship}">`;
      else if (opts.isEmpty) thumbHTML = `<div class="chip-thumb-empty">EMPTY</div>`;
      else thumbHTML = `<div class="chip-thumb-empty">${opts.ship || '---'}</div>`;
    }
    const nameTxt = opts.name || '---', shipTxt = opts.ship || '---';
    chip.innerHTML = `${thumbHTML}<span class="chip-name">${nameTxt}</span><span class="chip-ship">${shipTxt}</span><span class="chip-ready-pip">${opts.isReady ? 'READY' : 'WAIT'}</span>`;
    return chip;
  }

  // YOUR FLEET: local player (YOU) + friendly peers + friendly bots, padded to 3 slots
  const yourShip = (player && player.loadoutKey) ? player.loadoutKey : '---';
  const youCommitted = !!(player && player.loadoutKey);
  const _meDc = (typeof discordCurrentUser === 'function') ? discordCurrentUser() : null;
  const _meAvatar = _meDc ? _discordAvatarUrlFor(_meDc, 64) : null;
  const _meName = _meDc ? (_meDc.global_name || _meDc.username) : 'YOU';
  yourList.appendChild(makeChip({
    name: _meName, ship: yourShip, isYou: true,
    showPip: inMultiplayer, isReady: youCommitted, discordAvatarUrl: _meAvatar,
  }));
  if (inMultiplayer && net.peers) {
    for (const [, peer] of net.peers.entries()) {
      if (peer.team === undefined) continue;
      if (peer.team !== myTeam) continue;
      const peerAvatar = peer.discord_id ? _discordAvatarUrlFor({ id: peer.discord_id, avatar: peer.discord_avatar }, 64) : null;
      yourList.appendChild(makeChip({
        name: peer.discord_name || 'PEER', ship: peer.loadoutKey || '---',
        isEmpty: !peer.loadoutKey, showPip: true, isReady: !!peer.loadoutKey, discordAvatarUrl: peerAvatar,
      }));
    }
  }
  const friendlies = (game.entities || []).filter(b => b.team === myTeam);
  for (const bot of friendlies) {
    yourList.appendChild(makeChip({
      name: (bot.loadout && bot.loadout.name) ? bot.loadout.name + ' BOT' : 'BOT',
      ship: bot.loadoutKey || '---', showPip: false,
    }));
  }
  while (yourList.children.length < 3) {
    yourList.appendChild(makeChip({ name: 'EMPTY', ship: '---', isEmpty: true, showPip: false }));
  }
  // ENEMY FLEET (mirror)
  if (inMultiplayer && net.peers) {
    for (const [, peer] of net.peers.entries()) {
      if (peer.team === undefined) continue;
      if (peer.team !== otherTeam) continue;
      const peerAvatar = peer.discord_id ? _discordAvatarUrlFor({ id: peer.discord_id, avatar: peer.discord_avatar }, 64) : null;
      enemyList.appendChild(makeChip({
        name: peer.discord_name || 'PEER', ship: peer.loadoutKey || '---', isEnemy: true,
        isEmpty: !peer.loadoutKey, showPip: true, isReady: !!peer.loadoutKey, discordAvatarUrl: peerAvatar,
      }));
    }
  }
  const enemies = (game.entities || []).filter(b => b.team === otherTeam);
  for (const bot of enemies) {
    enemyList.appendChild(makeChip({
      name: (bot.loadout && bot.loadout.name) ? bot.loadout.name + ' BOT' : 'BOT',
      ship: bot.loadoutKey || '---', isEnemy: true, showPip: false,
    }));
  }
  while (enemyList.children.length < 3) {
    enemyList.appendChild(makeChip({ name: 'EMPTY', ship: '---', isEnemy: true, isEmpty: true, showPip: false }));
  }
}

// ----- 6. DAMAGE INDICATORS (state + tick + directional edge flashes) -----

// game state init (inside the big `game` object literal):
// killFeed: [],
// damageIndicators: { top: 0, bottom: 0, left: 0, right: 0 },

// DOM (svg arrow polygons in 4 directions):
// <svg class="damage-indicator" id="dmg-top|bottom|left|right" viewBox="0 0 60 20">
//   <polygon points="10,20 30,2 50,20" fill="rgba(255,40,0,0.8)" .../>
// </svg>

// Compute screen-direction from attacker world position; set indicator to 1.0.
// (Called from playerTakeDamage / weapon hit handlers.)
// `toAttacker` = (attacker.position - player.position) normalized, projected
// into camera space; dominant axis decides which edge to pulse.
//   (see inside showDirectionalDamageFromAttacker; relevant tail):
// if (fDot < -0.3)            game.damageIndicators.bottom = 1.0;  // behind
// if (fDot >  0.3)            game.damageIndicators.top = 1.0;
// if (rDot >  0.3)            game.damageIndicators.right = 1.0;
// if (rDot < -0.3)            game.damageIndicators.left = 1.0;
// if (absF > 0.7) { ...secondary left/right at 0.5... }

function updateDamageIndicators(dt) {
  const dirs = ['top', 'bottom', 'left', 'right'];
  for (const dir of dirs) {
    if (game.damageIndicators[dir] > 0) {
      game.damageIndicators[dir] = Math.max(0, game.damageIndicators[dir] - dt * 2.5);
    }
    const el = document.getElementById('dmg-' + dir);
    if (el) el.style.opacity = game.damageIndicators[dir];
  }
}

// Cinematic directional edge-overlay (separate from the SVG arrow indicators).
// Pulses #ov-dmg-top|right|bottom|left one of which animates per incoming hit.
const _dmgEdgeWorld = new THREE.Vector3();
const _dmgEdgeView = new THREE.Vector3();
function showDirectionalDamage(attacker, projectile) {
  if (attacker && attacker.position) _dmgEdgeWorld.subVectors(attacker.position, player.position);
  else if (projectile && projectile.velocity) _dmgEdgeWorld.copy(projectile.velocity).multiplyScalar(-1);
  else return;
  if (_dmgEdgeWorld.lengthSq() < 0.0001) return;
  _dmgEdgeWorld.normalize();
  _dmgEdgeView.copy(_dmgEdgeWorld).applyQuaternion(camera.quaternion.clone().conjugate());
  const x = _dmgEdgeView.x, y = _dmgEdgeView.y;
  let edge;
  if (Math.abs(x) >= Math.abs(y)) edge = (x >= 0) ? 'right' : 'left';
  else                            edge = (y >= 0) ? 'top'   : 'bottom';
  const el = document.getElementById('ov-dmg-' + edge);
  if (!el) return;
  el.classList.remove('pulse');
  void el.offsetWidth; // force reflow so animation restarts on rapid hits
  el.classList.add('pulse');
}

// ----- 7. KILLFEED (array management + DOM render + expiry) -----

// DOM: <div id="kill-feed"></div>

function addKillFeed(killer, victim) {
  game.killFeed.unshift({ killer, victim, time: game.time });
  if (game.killFeed.length > 5) game.killFeed.pop();
  const container = document.getElementById('kill-feed');
  container.innerHTML = '';
  for (const entry of game.killFeed) {
    const div = document.createElement('div');
    div.className = 'kill-entry';
    div.innerHTML = `<span style="color:#ff6666">${entry.killer}</span> destroyed <span style="color:#66bb66">${entry.victim}</span>`;
    container.appendChild(div);
  }
}

// In-place expire of old kill-feed entries (called once per frame from the main update loop):
//   for (let i = game.killFeed.length - 1; i >= 0; i--) {
//     if (game.time - game.killFeed[i].time >= 8) game.killFeed.splice(i, 1);
//   }

// ----- 8. SCOREBOARD (DOM injection + Tab-key reveal + render) -----

const scoreboardCSS = document.createElement('style');
scoreboardCSS.textContent = `
#scoreboard {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 600px; background: rgba(5,8,18,0.92); border: 1px solid rgba(100,180,255,0.2);
  z-index: 50; pointer-events: none; display: none; color: #fff;
  font-family: 'Courier New', monospace; padding: 20px;
}
#scoreboard.visible { display: block; }
#scoreboard h2 { text-align: center; color: #ffaa00; font-size: 16px; letter-spacing: 3px; margin-bottom: 12px; }
.sb-team-header { font-size: 12px; letter-spacing: 2px; padding: 4px 8px; margin-top: 10px; }
.sb-team-a { color: #ff6666; border-bottom: 1px solid rgba(255,100,100,0.3); }
.sb-team-b { color: #66bb66; border-bottom: 1px solid rgba(100,200,100,0.3); }
.sb-row { display: flex; justify-content: space-between; padding: 3px 12px; font-size: 11px; }
.sb-row.player-row { color: #ffcc00; }
.sb-row .sb-name { flex: 2; }
.sb-row .sb-stat { flex: 1; text-align: center; color: #aaa; }
.sb-row .sb-stat-header { flex: 1; text-align: center; color: #666; font-size: 9px; text-transform: uppercase; }
.sb-header-row { display: flex; justify-content: space-between; padding: 2px 12px; margin-bottom: 4px; }
`;
document.head.appendChild(scoreboardCSS);

const scoreboardDiv = document.createElement('div');
scoreboardDiv.id = 'scoreboard';
document.body.appendChild(scoreboardDiv);

let scoreboardVisible = false;
let _scoreboardKeyHeld = false;
let _scoreboardGpHeld = false;
function _refreshScoreboardVisibility() {
  // Force scoreboard visible at matchEnd so players see final totals.
  const forced = (game.state === 'matchEnd');
  const want = forced || _scoreboardKeyHeld || _scoreboardGpHeld;
  if (want !== scoreboardVisible) { scoreboardVisible = want; updateScoreboard(); }
}

function updateScoreboard() {
  const sb = scoreboardDiv;
  if (!scoreboardVisible || !player.loadout) { sb.classList.remove('visible'); return; }
  sb.classList.add('visible');
  const teamA = game.entities.filter(b => b.team === LSS.TEAM_FLEET_A);
  const teamB = game.entities.filter(b => b.team === LSS.TEAM_FLEET_B);
  teamA.sort((a, b) => (b.kills || 0) - (a.kills || 0));
  teamB.sort((a, b) => (b.kills || 0) - (a.kills || 0));
  const statusOf = (e) => !e.alive ? 'DEAD' : e.doomed ? 'DOOMED' : 'ALIVE';
  const row = (name, status, kills, dmg, isPlayer) => (
    '<div class="sb-row' + (isPlayer ? ' player-row' : '') + '">' +
    '<div class="sb-name">' + name + '</div>' +
    '<div class="sb-stat">' + status + '</div>' +
    '<div class="sb-stat">' + (kills || 0) + '</div>' +
    '<div class="sb-stat">' + Math.floor(dmg || 0) + '</div>' +
    '</div>'
  );
  let html = '<h2>SCOREBOARD</h2>';
  html += '<div class="sb-header-row"><div class="sb-name sb-stat-header">SHIP</div><div class="sb-stat-header">STATUS</div><div class="sb-stat-header">KILLS</div><div class="sb-stat-header">DAMAGE</div></div>';
  html += '<div class="sb-team-header sb-team-a">FLEET A (' + game.scoreA + ' rounds)</div>';
  const pStatus = player.shipState === 'dead' ? 'DEAD' : player.doomed ? 'DOOMED' : 'ALIVE';
  html += row('YOU (' + (player.loadout ? player.loadout.name : '?') + ')', pStatus, player.kills, player.damageDealt, true);
  for (const bot of teamA) html += row(bot.loadout.name, statusOf(bot), bot.kills, bot.damageDealt, false);
  html += '<div class="sb-team-header sb-team-b">FLEET B (' + game.scoreB + ' rounds)</div>';
  for (const bot of teamB) html += row(bot.loadout.name, statusOf(bot), bot.kills, bot.damageDealt, false);
  for (const np of net.networkPlayers) {
    html += row('[NET] ' + (np.loadout ? np.loadout.name : '?'), statusOf(np), np.kills, np.damageDealt, false);
  }
  html += '<div style="text-align:center;color:#888;font-size:10px;margin-top:12px;letter-spacing:2px;">KILLS ' + (player.kills || 0) + '  &middot;  DEATHS ' + (player.deaths || 0) + '  &middot;  DAMAGE ' + Math.floor(player.damageDealt || 0) + '</div>';
  sb.innerHTML = html;
}

// Tab-key hold reveals scoreboard; only intercept in-combat (not in menus / ship-select).
function _scoreboardTabShouldIntercept() {
  if (game.state === 'select') return false;
  if (settingsOpen) return false;
  const sel = document.getElementById('ship-select');
  if (sel && sel.classList.contains('active')) return false;
  return true;
}
document.addEventListener('keydown', e => {
  const sbKey = (input.kbBindings && input.kbBindings.scoreboard) || 'tab';
  if (typeof e.key === 'string' && e.key.toLowerCase() === sbKey && _scoreboardTabShouldIntercept()) {
    e.preventDefault();
    _scoreboardKeyHeld = true;
    _refreshScoreboardVisibility();
  }
});
document.addEventListener('keyup', e => {
  const sbKey = (input.kbBindings && input.kbBindings.scoreboard) || 'tab';
  if (typeof e.key === 'string' && e.key.toLowerCase() === sbKey) {
    _scoreboardKeyHeld = false;
    _refreshScoreboardVisibility();
  }
});

// ----- 9. DOOMED WARNING / VIGNETTE, ENEMY LOCK-ON WARNING, STASIS WARNING -----

// DOM (inside #hud):
//   <div id="doomed-warning">! HULL CRITICAL !</div>
//   <div id="doomed-vignette"></div>
//   <div id="enemy-lockon-warning">
//     <div class="lockon-text">WARNING: ENEMY LOCKED-ON</div>
//     <div class="lockon-pips">
//       <div class="lockon-pip" id="lockon-pip-1"></div>
//       <div class="lockon-pip" id="lockon-pip-2"></div>
//       <div class="lockon-pip" id="lockon-pip-3"></div>
//     </div>
//   </div>
//
// Stasis HUD (top-level, outside #hud):
//   <div id="stasis-warning">
//     STASIS FIELD: SHIELDS RECHARGING
//     <div class="stasis-bar"><div class="stasis-fill" id="stasis-fill" style="width:0%"></div></div>
//   </div>
//   <div id="stasis-vignette"></div>

// Doomed + lockon UI is updated inside updateHUD() (above). Stasis is driven by
// enterStasis(field) / exit code in updatePlayerStasis. Tick reads:
//   document.getElementById('stasis-warning').style.display = 'block' / 'none';
//   document.getElementById('stasis-vignette').style.display = 'block' / 'none';
//   document.getElementById('stasis-fill').style.width = pct + '%';

function enterStasis(field) {
  // (excerpt) Set state + reveal stasis HUD.
  document.getElementById('stasis-warning').style.display = 'block';
  document.getElementById('stasis-vignette').style.display = 'block';
  // ...(rest of stasis init: snapshot velocity, start timer, etc.)
}
// Exit path (in tick): when stasis timer reaches 0,
//   document.getElementById('stasis-warning').style.display = 'none';
//   document.getElementById('stasis-vignette').style.display = 'none';

// ----- 10. HIT MARKERS + CINEMATIC OVERLAYS (Overlays.abilityFlash, edge glow) -----

// DOM hit-marker SVGs (global, near top of <body>):
//   <div class="hit-marker"      id="hit-marker">       <svg>4-corner X</svg></div>
//   <div class="hit-marker-kill" id="hit-marker-kill">  <svg>red killmark</svg></div>

function showHitMarker() {
  const el = document.getElementById('hit-marker');
  el.classList.remove('active');
  void el.offsetWidth;       // force reflow so the CSS animation restarts on rapid hits
  el.classList.add('active');
}
function showKillMarker() {
  const el = document.getElementById('hit-marker-kill');
  el.classList.remove('active');
  void el.offsetWidth;
  el.classList.add('active');
}

// Later in the file, both are wrapped to play SFX (and kill marker triggers a postFX killFlash):
const _origShowHitMarker = showHitMarker;
showHitMarker = function() { _origShowHitMarker(); playSound('hit'); };

const _origShowKillMarker = showKillMarker;
showKillMarker = function() {
  _origShowKillMarker();
  playSound('kill');
  // Inverse-bloom shutter flash: instant peak, postFX decays to ~0 in ~120ms.
  if (typeof postFX !== 'undefined' && postFX.compositeMat && postFX.compositeMat.uniforms.killFlash) {
    postFX.compositeMat.uniforms.killFlash.value = 1.0;
  }
};

// Cinematic Overlays module (ported from lss_overlays.jsx). Exposes:
//   damageVignette, killStreak, countdown, medal, abilityFlash, respawn, hideRespawn, banner
// Cooperates with DOM:
//   #ov-damage-vignette  #ov-killstreak  #ov-countdown  #ov-medals
//   #ov-ability  #ov-respawn  #ov-banner  #ov-sword-block
//   #ov-vortex-shield  #ov-gun-shield  #ov-thermal-shield
//   #ov-dmg-top|right|bottom|left
const ABILITY_COLORS = {
  dash:      '#00ccff', shield:    '#4488ff', overclock: '#ffaa00',
  cloak:     '#aa44ff', emp:       '#ff4400', heal:      '#44ff88',
  stasis:    '#00ffcc', missiles:  '#ff6600',
};
function abilityFlash(name, color) {
  const el = document.getElementById('ov-ability');
  if (!el) return;
  const c = color || ABILITY_COLORS[(name || '').toLowerCase()] || '#ffffff';
  el.style.setProperty('--ab-color', c);
  el.style.setProperty('--ab-color-soft', c + '80');
  el.querySelector('.ab-label').textContent = (name || 'ABILITY').toUpperCase() + ' ACTIVE';
  // replay = remove 'show' class, force reflow, re-add
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function damageVignette(intensity) {
  const el = document.getElementById('ov-damage-vignette');
  if (!el) return;
  const i = Math.max(0.15, Math.min(1, intensity));
  el.style.setProperty('--dmg-peak', i.toFixed(2));
  el.style.background = `radial-gradient(ellipse at center, transparent 30%, rgba(255,0,0,${0.25 + 0.45 * i}) 100%)`;
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function banner(text, subtext) {
  const el = document.getElementById('ov-banner');
  if (!el) return;
  el.querySelector('.ban-text').textContent = text || '';
  const sub = el.querySelector('.ban-sub');
  sub.textContent = subtext || ''; sub.style.display = subtext ? 'block' : 'none';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  el.querySelectorAll('.ban-line').forEach(ln => { ln.style.animation = 'none'; void ln.offsetWidth; ln.style.animation = ''; });
}
function countdown(n, label) {
  const el = document.getElementById('ov-countdown');
  if (!el) return;
  const isFight = (n === 0 || n === 'FIGHT');
  el.classList.toggle('fight', isFight);
  el.querySelector('.cd-label').textContent = label || '';
  el.querySelector('.cd-label').style.display = isFight ? 'none' : 'block';
  el.querySelector('.cd-number').textContent = isFight ? 'FIGHT' : String(n);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  const ring = el.querySelector('.cd-ring');
  if (ring) { ring.style.animation = 'none'; void ring.offsetWidth; ring.style.animation = ''; }
}
function killStreak(count) {
  const STREAK_DATA = [
    null, null,
    { label: 'DOUBLE KILL', color: '#ffcc00', scale: 1.10 },
    { label: 'TRIPLE KILL', color: '#ff8800', scale: 1.20 },
    { label: 'QUAD KILL',   color: '#ff4400', scale: 1.35 },
    { label: 'RAMPAGE',     color: '#ff0044', scale: 1.50 },
    { label: 'UNSTOPPABLE', color: '#cc00ff', scale: 1.60 },
    { label: 'GODLIKE',     color: '#ff00ff', scale: 1.70, glow: true },
  ];
  const el = document.getElementById('ov-killstreak');
  if (!el || count < 2) return;
  const d = STREAK_DATA[Math.min(count, STREAK_DATA.length - 1)] || STREAK_DATA[STREAK_DATA.length - 1];
  el.classList.toggle('godlike', !!d.glow);
  el.querySelector('.ks-label').textContent = d.label;
  el.querySelector('.ks-count').textContent = count + ' KILLS';
  el.style.setProperty('--ks-color', d.color);
  el.style.setProperty('--ks-color-soft', d.color + '88');
  el.style.setProperty('--ks-color-faint', d.color + '44');
  el.style.setProperty('--ks-scale', d.scale);
  el.style.setProperty('--ks-bar-w', (60 + count * 12) + 'px');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
// (medal/respawn/hideRespawn follow same pattern; exposed as window.Overlays.)
window.Overlays = { damageVignette, killStreak, countdown, abilityFlash, banner };

// ----- 11. HUD MEMOIZATION HELPERS (skip redundant DOM writes) -----
// HUD DOM ref + last-written-value cache. Lazy-initialized on first read so we
// don't re-query document every frame and don't write to the DOM unless the
// value actually changed (prevents layout/reflow on idle HUD).
const _hudEls = Object.create(null);
const _hudLast = Object.create(null);
function _hudEl(id) {
  let el = _hudEls[id];
  if (el === undefined) el = _hudEls[id] = document.getElementById(id) || null;
  return el;
}
function _hudText(el, key, v) {
  if (!el) return;
  if (_hudLast[key] === v) return;
  _hudLast[key] = v;
  el.textContent = v;
}
function _hudWidth(el, key, v) {
  if (!el) return;
  if (_hudLast[key] === v) return;
  _hudLast[key] = v;
  el.style.width = v;
}
function _hudDisplay(el, key, v) {
  if (!el) return;
  if (_hudLast[key] === v) return;
  _hudLast[key] = v;
  el.style.display = v;
}
function _hudClass(el, key, v) {
  if (!el) return;
  if (_hudLast[key] === v) return;
  _hudLast[key] = v;
  el.className = v;
}
