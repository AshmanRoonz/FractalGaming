// ==============================================================================
// LSS v17 Audio System (extracted verbatim from last_ship_sailing_v17.html)
// Source file: /Fractal_Reality/fractalgaming/LSS/old_versions/last_ship_sailing_v17.html
// Sections in order:
//   1) AudioContext + master bus setup (audio state, initAudio, resumeAudio, helpers)
//   2) Synth-engine code (triChord, playNoiseBurst, _safeOscType + recipe interpreter)
//   3) DEFAULT_SOUND_LIBRARY (all recipes, full data)
//   4) playSound + playSpatialSound (HRTF + 5.1 paths)
//   5) Music system (state, synths, patterns, scheduler, public API)
//   6) Announcer (ANN, announcerSay, ship-AI voice lines)
//   7) Notes on external dependencies (camera, game, player, renderer, THREE, QUALITY, LSS)
// ==============================================================================

// ----- External dependencies expected by this code (provide stubs as needed) -----
//   THREE       : the three.js library (used by spatial audio for Vector3 / Raycaster / Quaternion)
//   camera      : THREE.Camera (used by playSpatialSound for listener position/orientation)
//   renderer    : THREE.WebGLRenderer (used to detect VR via renderer.xr.isPresenting)
//   player      : { velocity:Vector3, health, maxHealth, doomed, ... } (ambient bed reacts to it)
//   game        : { state, mapMeshes, roundTimer, playerInStasis, shakeIntensity, time, ... }
//   QUALITY     : { isPotato() } (toggles HRTF -> equalpower + skips occlusion)
//   LSS         : { ROUND_TIME } (used by musicTickFromMain)
//   saveSettings: function() (called when announcer voice is changed)
//   speechSynthesis / SpeechSynthesisUtterance : browser Web Speech API (announcer)

// ============================================================================
// SECTION 1 : AudioContext + master setup
// ============================================================================
// ---- WEB AUDIO SOUND SYSTEM ----
// Procedural sounds using oscillators and noise; no external files needed.

const audio = {
  ctx: null,
  masterGain: null,
  masterComp: null,     // master bus compressor (glue)
  sfxBus: null,         // pre-master bus for all SFX (user "SFX" slider target)
  reverbGain: null,     // wet reverb signal
  dryGain: null,        // dry signal
  convolver: null,      // reverb input hub (fans out to wide + tight convolvers)
  convolverWide: null,  // 2.4s open-volume tail (open rooms)
  convolverTight: null, // 0.5s slap (tunnels)
  reverbWideGain: null, // wide-tail bus gain (crossfade target, 0..1)
  reverbTightGain: null,// tight-slap bus gain (crossfade target, 0..1)
  envOpenness: 0.7,     // smoothed 0..1, 1 = open volume, 0 = tunnel/tight
  convolverLong: null,  // 5s lush tail for explosion distance (low wet level)
  reverbLongGain: null, // long-tail bus gain (low wet, for explosion halos)
  _extraReverbSend: null, // when set, triChord/playNoiseBurst also tap this node
  ambientGain: null,    // ambient sound bed volume
  ambientNodes: [],     // oscillator nodes for ambient bed
  initialized: false,
  // User-facing volume multipliers (0..1.5), stacked on top of internal gain staging.
  // (v8_1VR) `music` is the Tier 3 reactive band slider. Default 0.10 ; the bus
  // multiplier below is 0.30, giving ~0.030 effective gain so the band sits
  // well under SFX out of the box. Ambient defaults to 0.85 (Ashman's preference);
  // the binaural bed reads cleanly under the SFX punch at that level.
  userVol: { master: 1.0, sfx: 1.0, ambient: 0.85, music: 0.10 },
  // (v8_1VR) Music bus + glue. Parallel to ambientGain ; both bypass the
  // SFX-bus voice budget so combat fire never starves the drums.
  musicGain: null,
  musicComp: null,
  musicEnabled: true,           // user toggle (settings UI)
  musicCeiling: 'normal',       // 'chill' | 'normal' | 'wild' ; intensity cap
  musicMuteLobby: false,
  musicStyle: 'techno',         // 'cosmic' | 'cyber' | 'doom' | 'drift' | 'battle' | 'jazz' | 'techno'
  // Side-chain duck factor for ambient bed: 1.0 = full, drops on loud SFX, ramps back.
  duckFactor: 1.0,
  duckTarget: 1.0,
  // When non-null, triChord/playNoiseBurst route their dry tap through this node
  // (used by playSpatialSound to insert a per-call HRTF PannerNode).
  _spatialSink: null,
};

// Generate a synthetic impulse response for metallic interior reverb.
// Simulates a large enclosed metal space (like the inside of a sphere/tunnel).
function generateImpulseResponse(ctx, duration, decay, preDelay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * duration);
  const preLen = Math.floor(rate * (preDelay || 0.01));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      if (i < preLen) { data[i] = 0; continue; }
      const t = (i - preLen) / (len - preLen);
      // Exponential decay with early reflection bumps
      let env = Math.exp(-t * decay);
      // Early reflections: sharp spikes that give sense of enclosed space
      if (t < 0.08) env += Math.exp(-t * 30) * 0.5 * (Math.random() > 0.7 ? 1 : 0);
      // Pure noise reverb (no tonal sine components; avoids high-pitch ringing)
      const noise = Math.random() * 2 - 1;
      data[i] = noise * env;
    }
  }
  return buf;
}

function initAudio() {
  if (audio.initialized) return;
  try {
    // (v8VR 2026-05-01) latencyHint 'playback' gives the audio thread the
    // largest enumerated buffer (~50-100 ms) so heavy combat with many
    // simultaneous oscillators / noise bursts doesn't underrun and cause
    // audible dropouts. Numeric forms (e.g. 0.20) sometimes work but some
    // Windows + Edge audio paths reject them silently and the context
    // ends up in a bad state under load (full audio drop, not just crackle),
    // so we stick with the string preset which is universally honored.
    const _AC = (window.AudioContext || window.webkitAudioContext);
    // (v8_2a 2026-05-01 followup) Request sampleRate=48000 explicitly.
    // Some audiophile / gamer audio devices run at 96k or 192k, and Chrome
    // matches whatever the device exposes when no hint is passed. The
    // entire audio graph then runs at that rate, doing 2x-4x the DSP work
    // per quantum. Pin to 48k so oscillators / gain / filters / panners /
    // merger / compressor process at a sane rate; Chrome resamples once
    // at the device boundary (cheap) instead of every node working at the
    // higher rate. Three-tier fallback: 48k+playback, then playback only,
    // then bare default. The middle tier handles browsers that reject
    // explicit sampleRate but accept latencyHint.
    try { audio.ctx = new _AC({ latencyHint: 'playback', sampleRate: 48000 }); }
    catch (_) {
      try { audio.ctx = new _AC({ latencyHint: 'playback' }); }
      catch (__) { audio.ctx = new _AC(); }
    }

    // High-frequency rolloff: gentle lowpass to tame harsh highs across all sounds
    audio.hiCut = audio.ctx.createBiquadFilter();
    audio.hiCut.type = 'lowpass';
    audio.hiCut.frequency.value = 3500; // roll off above 3.5kHz
    audio.hiCut.Q.value = 0.7; // gentle slope (no resonance peak)
    // (v15 backport 2026-05-10 fix, revised) Master clip-stop sits at the
    // END of the chain (after hiCut, before destination) so EVERY output
    // path (SFX, music, ambient, all of which sum at hiCut) gets caught.
    // Stops digital clipping at the AudioContext destination, which is
    // what recording / streaming software captures.
    //
    // First attempt used a DynamicsCompressor with brick-wall settings
    // (-1 dB, 20:1, 1 ms attack). It worked for the captured stream but
    // the 1 ms attack at 48 kHz is expensive enough that recording-app
    // CPU load caused WebAudio buffer underruns ; the user heard those
    // as crackles in live monitoring even though the recording stayed
    // clean. WaveShaper is a sample-by-sample table lookup with zero
    // time-domain processing, no attack/release artifacts, and
    // dramatically cheaper CPU-wise. Soft-clip curve : transparent up to
    // ~-1.4 dBFS (0.85 linear), smooth saturation above, hard ceiling at
    // ~-0.45 dBFS (0.95 linear). Pre/post gains scale signal so the
    // curve table can handle inputs up to ~2x unity (master slider max
    // 1.5x plus SFX sum headroom).
    audio.preLimiterGain = audio.ctx.createGain();
    audio.preLimiterGain.gain.value = 0.5;
    audio.masterShaper = audio.ctx.createWaveShaper();
    audio.masterShaper.curve = (function makeSoftClipCurve() {
      const samples = 8192;
      const curve = new Float32Array(samples);
      const thresh  = 0.425;  // 0.85 / 2.0
      const ceiling = 0.475;  // 0.95 / 2.0
      for (let i = 0; i < samples; i++) {
        const x = (i / (samples - 1)) * 2 - 1;
        const sign = x < 0 ? -1 : 1;
        const absX = Math.abs(x);
        if (absX <= thresh) {
          curve[i] = x;
        } else {
          const u = Math.min(1, (absX - thresh) / (1 - thresh));
          const uSmooth = 1 - (1 - u) * (1 - u);
          curve[i] = sign * (thresh + (ceiling - thresh) * uSmooth);
        }
      }
      return curve;
    })();
    audio.masterShaper.oversample = '4x';
    audio.postLimiterGain = audio.ctx.createGain();
    audio.postLimiterGain.gain.value = 2.0;
    audio.hiCut.connect(audio.preLimiterGain);
    audio.preLimiterGain.connect(audio.masterShaper);
    audio.masterShaper.connect(audio.postLimiterGain);
    audio.postLimiterGain.connect(audio.ctx.destination);

    // Master bus compressor (glue): keeps simultaneous SFX legible without clipping.
    // (v15 backport 2026-05-10) Softer settings to reduce pumping when many
    // sounds fire at once. Previous threshold -14 / ratio 3 / release
    // 120 ms compressed the mix down by 3-4 dB on every loud transient
    // and took 120 ms to recover, so sustained heavy fire read as
    // "audio cuts" during recording. New settings only engage on
    // genuinely-loud peaks (-9 dB), reduce by less per dB over threshold
    // (2.5:1), and recover smoothly (280 ms release). Brick-wall safety
    // still comes from the WaveShaper soft-clip downstream.
    audio.masterComp = audio.ctx.createDynamicsCompressor();
    audio.masterComp.threshold.value = -9;
    audio.masterComp.knee.value = 6;
    audio.masterComp.ratio.value = 2.5;
    audio.masterComp.attack.value = 0.005;
    audio.masterComp.release.value = 0.280;
    audio.masterComp.connect(audio.hiCut);

    // Master output. Base 0.75 multiplied by userVol.master so the user
    // slider scales the bus cleanly. Direct path into the compressor ; no
    // EQ filters between user sound recipes and the comp.
    audio.masterGain = audio.ctx.createGain();
    audio.masterGain.gain.value = 0.85 * audio.userVol.master;
    audio.masterGain.connect(audio.masterComp);

    // SFX bus: groups all gameplay SFX (dry + reverb rails) under a single user-facing
    // "SFX" slider, separate from the ambient bed. Lives between dry/reverb and master.
    audio.sfxBus = audio.ctx.createGain();
    audio.sfxBus.gain.value = audio.userVol.sfx;
    audio.sfxBus.connect(audio.masterGain);

    // Reverb chain: dry + wet mixed into SFX bus
    audio.dryGain = audio.ctx.createGain();
    audio.dryGain.gain.value = 0.80; // dry signal (most of the punch)
    audio.dryGain.connect(audio.sfxBus);

    audio.reverbGain = audio.ctx.createGain();
    // v8VR: honor any reverb wet level loaded from settings; default 0.40.
    audio.reverbGain.gain.value = (typeof audio.reverbWet === 'number') ? audio.reverbWet : 0.40;
    audio.reverbGain.connect(audio.sfxBus);

    // Dual convolvers with environment crossfade:
    //   wide = 2.4s decay, spacious open-volume tail
    //   tight = 0.5s decay, fast slap for tunnels
    // `audio.convolver` is repurposed as the reverb INPUT hub: all existing sources
    // that connect to `audio.convolver` fan out to both convolvers in parallel.
    audio.convolverWide = audio.ctx.createConvolver();
    audio.convolverWide.buffer = generateImpulseResponse(audio.ctx, 2.4, 3.5, 0.015);
    audio.convolverTight = audio.ctx.createConvolver();
    audio.convolverTight.buffer = generateImpulseResponse(audio.ctx, 0.5, 6.5, 0.004);
    audio.reverbWideGain = audio.ctx.createGain();
    audio.reverbTightGain = audio.ctx.createGain();
    // Initial crossfade weights favor open volume; updated per-frame in updateAmbientBed.
    audio.reverbWideGain.gain.value = 0.7;
    audio.reverbTightGain.gain.value = 0.3;
    audio.convolverWide.connect(audio.reverbWideGain);
    audio.convolverTight.connect(audio.reverbTightGain);
    audio.reverbWideGain.connect(audio.reverbGain);
    audio.reverbTightGain.connect(audio.reverbGain);
    // Input hub: GainNode so existing `gain.connect(audio.convolver)` calls still work.
    audio.convolver = audio.ctx.createGain();
    audio.convolver.gain.value = 1.0;
    audio.convolver.connect(audio.convolverWide);
    audio.convolver.connect(audio.convolverTight);

    // Long lush send for explosions: separate ~5 s IR at low wet level. Not fed by
    // the main reverb input hub; triChord/playNoiseBurst opt in via audio._extraReverbSend
    // set on the explosion case. Output mixes into the shared reverb bus so the long
    // tail carries the same mix/duck/compression path as the rest of the wet signal.
    audio.convolverLong = audio.ctx.createConvolver();
    // (v15 2026-05-10 cost reduction) Long reverb IR shortened from 5.0 s
    // to 2.5 s. WebAudio convolution cost scales with IR length ; the 5 s
    // tail was the most expensive node in the whole audio graph and a
    // significant contributor to underruns during heavy SFX while
    // recording. 2.5 s still gives a noticeable halo on explosions ; the
    // long-tail character isn't worth the CPU under combat load.
    audio.convolverLong.buffer = generateImpulseResponse(audio.ctx, 2.5, 2.2, 0.030);
    audio.reverbLongGain = audio.ctx.createGain();
    audio.reverbLongGain.gain.value = 0.18; // low wet level; noticeable as halo, not splash
    audio.convolverLong.connect(audio.reverbLongGain);
    audio.reverbLongGain.connect(audio.reverbGain);

    // Ambient sound bed gain (separate from SFX): bypasses master compressor so the
    // binaural bed isn't pumped by gunfire. Still passes through hi-cut for consistent top.
    audio.ambientGain = audio.ctx.createGain();
    audio.ambientGain.gain.value = 0; // starts silent, fades in when playing
    audio.ambientGain.connect(audio.hiCut);

    // (v8_1VR) Music bus: Tier 3 reactive band. Sits parallel to ambient,
    // downstream of its own glue compressor so the band has its own dynamic
    // shape and doesn't fight the SFX limiter. Routes through hiCut for the
    // shared top-end roll-off so the music sits in the same tonal space as
    // everything else. Release lengthened to 350 ms to match the master comp's
    // anti-pumping easing on desktops.
    audio.musicComp = audio.ctx.createDynamicsCompressor();
    audio.musicComp.threshold.value = -8;
    audio.musicComp.knee.value = 8;
    audio.musicComp.ratio.value = 2.5;
    audio.musicComp.attack.value = 0.010;
    audio.musicComp.release.value = 0.350;
    audio.musicComp.connect(audio.hiCut);

    audio.musicGain = audio.ctx.createGain();
    audio.musicGain.gain.value = 0.30 * (audio.userVol.music != null ? audio.userVol.music : 0.45);
    audio.musicGain.connect(audio.musicComp);

    // (v8_2a) Surround output detection + 5.1 spatial sub-bus.
    // The existing chain is stereo end-to-end; on 5.1 the destination
    // upmixes 2 -> 6 with FL/FR carrying the signal and C/LFE/SL/SR
    // silent, so the surround speakers get nothing meaningful and HRTF
    // pays full convolution cost for no audible benefit. v8_2a adds a
    // parallel 6-channel sub-bus for spatial sounds: per-voice the
    // source splits into 6 GainNodes (one per speaker), feeds a
    // ChannelMerger(6), and runs through its own gain stages and glue
    // compressor to destination. Stereo systems are unaffected.
    audio._is51 = false;
    try {
      const dst = audio.ctx.destination;
      const _maxCh = (dst && typeof dst.maxChannelCount === 'number') ? dst.maxChannelCount : 2;
      audio._destMaxCh = _maxCh;
      console.log('[v8_2a audio] AudioContext: sampleRate=' + audio.ctx.sampleRate +
        ' Hz, destination.channelCount=' + dst.channelCount +
        ', maxChannelCount=' + _maxCh +
        ', baseLatency=' + (audio.ctx.baseLatency != null ? audio.ctx.baseLatency.toFixed(4) : '?') + ' s' +
        ', outputLatency=' + (audio.ctx.outputLatency != null ? audio.ctx.outputLatency.toFixed(4) : '?') + ' s');
      if (_maxCh >= 6) {
        audio._is51 = true;
        // (v8_2a 2026-05-01 followup) Pin destination.channelCount = 6.
        // Web Audio default is 2, even when the device exposes 6. Without
        // this, our ChannelMerger(6) output gets downmixed back to stereo
        // at the destination via the 5.1->stereo matrix, so the rear /
        // center / sub speakers receive nothing meaningful. Setting
        // explicit + speakers + 6 makes the 6-channel signal reach the
        // hardware unmodified.
        try {
          dst.channelCount = 6;
          dst.channelCountMode = 'explicit';
          dst.channelInterpretation = 'speakers';
          console.log('[v8_2a audio] destination.channelCount pinned to 6 ' +
            '(was ' + dst.channelCount + ' by default).');
        } catch (e) {
          console.warn('[v8_2a audio] Could not pin destination to 6 channels (non-fatal):', e && e.message);
        }
        audio.spatial51Bus = audio.ctx.createGain();
        audio.spatial51Bus.channelCount = 6;
        audio.spatial51Bus.channelCountMode = 'explicit';
        audio.spatial51Bus.channelInterpretation = 'speakers';
        audio.spatial51Bus.gain.value = audio.userVol.sfx;

        audio.spatial51Master = audio.ctx.createGain();
        audio.spatial51Master.channelCount = 6;
        audio.spatial51Master.channelCountMode = 'explicit';
        audio.spatial51Master.channelInterpretation = 'speakers';
        audio.spatial51Master.gain.value = 0.85 * audio.userVol.master;

        audio.spatial51Comp = audio.ctx.createDynamicsCompressor();
        audio.spatial51Comp.threshold.value = -14;
        audio.spatial51Comp.knee.value = 8;
        audio.spatial51Comp.ratio.value = 3;
        audio.spatial51Comp.attack.value = 0.005;
        audio.spatial51Comp.release.value = 0.120;
        try {
          audio.spatial51Comp.channelCount = 6;
          audio.spatial51Comp.channelCountMode = 'explicit';
          audio.spatial51Comp.channelInterpretation = 'speakers';
        } catch (_) { /* fall back to default channel count if rejected */ }

        // (v15 backport 2026-05-10 fix, revised) Parallel WaveShaper
        // soft-clip for the 5.1 chain. Same rationale as the stereo
        // masterShaper above : brick-wall DynamicsCompressor with 1 ms
        // attack caused live crackles under recording CPU load while
        // keeping recordings clean. WaveShaper is sample-by-sample, no
        // time-domain cost. Reuses the same curve as the stereo path.
        audio.spatial51PreGain = audio.ctx.createGain();
        audio.spatial51PreGain.gain.value = 0.5;
        audio.spatial51Shaper = audio.ctx.createWaveShaper();
        audio.spatial51Shaper.curve = audio.masterShaper.curve;
        audio.spatial51Shaper.oversample = '4x';
        audio.spatial51PostGain = audio.ctx.createGain();
        audio.spatial51PostGain.gain.value = 2.0;
        try {
          audio.spatial51PreGain.channelCount = 6;
          audio.spatial51PreGain.channelCountMode = 'explicit';
          audio.spatial51PreGain.channelInterpretation = 'speakers';
          audio.spatial51Shaper.channelCount = 6;
          audio.spatial51Shaper.channelCountMode = 'explicit';
          audio.spatial51Shaper.channelInterpretation = 'speakers';
          audio.spatial51PostGain.channelCount = 6;
          audio.spatial51PostGain.channelCountMode = 'explicit';
          audio.spatial51PostGain.channelInterpretation = 'speakers';
        } catch (_) { /* fall back to default if rejected */ }
        audio.spatial51Bus.connect(audio.spatial51Master);
        audio.spatial51Master.connect(audio.spatial51Comp);
        audio.spatial51Comp.connect(audio.spatial51PreGain);
        audio.spatial51PreGain.connect(audio.spatial51Shaper);
        audio.spatial51Shaper.connect(audio.spatial51PostGain);
        audio.spatial51PostGain.connect(audio.ctx.destination);

        console.log('[v8_2a audio] 5.1 surround output detected. Spatial sounds ' +
          'will route per-speaker via VBAP instead of HRTF. Non-spatial sounds ' +
          'and reverb stay on the stereo chain.');
      } else {
        console.log('[v8_2a audio] Stereo output (maxChannelCount=' + _maxCh +
          '). Keeping HRTF spatial path; no behavior change vs v8_1VR.');
      }
    } catch (e) {
      console.warn('[v8_2a audio] 5.1 sub-bus setup failed (non-fatal):', e && e.message);
      audio._is51 = false;
    }

    audio.initialized = true;

    // (v8_1VR) Audio context watchdog. Some browser+driver combos (e.g. Edge
    // on Windows with 5.1+sub) push the audio thread into 'suspended' or
    // 'interrupted' state under heavy combat load and never recover on their
    // own. Poll every 500ms and force-resume if we detect a non-running
    // state. The 'statechange' listener also handles the immediate event.
    const _audioWatchdog = () => {
      if (!audio.ctx) return;
      if (audio.ctx.state === 'suspended' || audio.ctx.state === 'interrupted') {
        try { audio.ctx.resume(); } catch (_) {}
      }
    };
    audio.ctx.addEventListener('statechange', _audioWatchdog);
    setInterval(_audioWatchdog, 500);

    // (v8_1VR) Kick off the reactive band scheduler on first audio init.
    // musicSyncToGameState is fine to call before the engine has run a tick;
    // it just sets the pattern state. musicStart spins up the 50ms setInterval.
    try {
      if (typeof musicSyncToGameState === 'function') musicSyncToGameState();
      if (typeof musicStart === 'function') musicStart();
    } catch (_) {}
  } catch(e) { console.warn('Audio init failed:', e); }
}

// Resume audio context on user interaction (browser autoplay policy)
function resumeAudio() {
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  // (v8_1VR) Reactive band: kick off the music scheduler on first user
  // interaction (autoplay policy gate). Idempotent ; musicStart no-ops if
  // already running. Sync the pattern to whatever state the game is in.
  if (typeof musicSyncToGameState === 'function') {
    try { musicSyncToGameState(); } catch (_) {}
  }
  if (typeof musicStart === 'function') {
    try { musicStart(); } catch (_) {}
  }
}

// ============================================================================
// SECTION 1b : Ambient bed (phi-cascade binaural) + environment probe + duck
// ============================================================================
// ---- AMBIENT SOUND BED ----
// Low-frequency drone + filtered noise hiss that modulates with player speed.
// Creates sense of existing in a physical space.

let ambientStarted = false;

// ---- PHI-CASCADE BINAURAL AMBIENT ----
// Ship ambient sound: phi-cascade binaural adapted from phi_resonance.html "Deep Rest" preset.
// At rest: base 144Hz, 6 layers centered via base * PHI^(i-3), beat = PHI * 0.25 (~0.4Hz).
// At full speed: base winds up to 200Hz. The whole cascade shifts proportionally.
// This is the exact same architecture as the standalone phi_resonance tool.

const PHI = (1 + Math.sqrt(5)) / 2; // 1.6180339887...
const PHI_LAYERS = 6; // full 6-layer phi cascade (matching phi_resonance.html Deep Rest)
const PHI_REST_BASE = 69; // idle base frequency (deep hum at rest)
const PHI_SPEED_BASE = 144; // max speed base frequency (winds up to Deep Rest range)
const PHI_BEAT_STRENGTH = 0.25; // Deep Rest beat strength
const PHI_BEAT = PHI * PHI_BEAT_STRENGTH; // ~0.4045 Hz binaural beat

function startAmbientBed() {
  if (ambientStarted || !audio.ctx) return;
  ambientStarted = true;
  const ctx = audio.ctx;

  // Phi-cascade binaural layers (exact phi_resonance.html architecture)
  // 6 layers: base * PHI^(i-3), centered around the base frequency
  // At rest (69Hz): ~16Hz, ~26Hz, ~43Hz, 69Hz, ~112Hz, ~181Hz
  // At full speed (144Hz): ~34Hz, ~55Hz, ~89Hz, 144Hz, ~233Hz, ~377Hz
  audio.phiLayers = [];

  for (let i = 0; i < PHI_LAYERS; i++) {
    const layerFreq = PHI_REST_BASE * Math.pow(PHI, i - 3);
    const layerVol = 0.50 / PHI_LAYERS;

    // Left ear: carrier at layerFreq
    const oscL = ctx.createOscillator();
    oscL.type = 'sine';
    oscL.frequency.value = layerFreq;
    const gainL = ctx.createGain();
    gainL.gain.value = layerVol;
    const panL = ctx.createStereoPanner();
    panL.pan.value = -1;

    // LFO modulation at phi-derived rate (matching phi_resonance.html)
    const lfoL = ctx.createOscillator();
    lfoL.type = 'sine';
    lfoL.frequency.value = PHI / Math.pow(PHI, i);
    const lfoLGain = ctx.createGain();
    lfoLGain.gain.value = layerVol * 0.5; // modulation depth 0.5 (matched to Deep Rest)
    lfoL.connect(lfoLGain);
    lfoLGain.connect(gainL.gain);
    lfoL.start();

    oscL.connect(gainL);
    gainL.connect(panL);
    panL.connect(audio.ambientGain);
    oscL.start();
    audio.ambientNodes.push(oscL, lfoL);

    // Right ear: carrier at layerFreq + PHI_BEAT (creates the binaural beat)
    const oscR = ctx.createOscillator();
    oscR.type = 'sine';
    oscR.frequency.value = layerFreq + PHI_BEAT;
    const gainR = ctx.createGain();
    gainR.gain.value = layerVol;
    const panR = ctx.createStereoPanner();
    panR.pan.value = 1;

    const lfoR = ctx.createOscillator();
    lfoR.type = 'sine';
    lfoR.frequency.value = PHI / Math.pow(PHI, i);
    const lfoRGain = ctx.createGain();
    lfoRGain.gain.value = layerVol * 0.5;
    lfoR.connect(lfoRGain);
    lfoRGain.connect(gainR.gain);
    lfoR.start();

    oscR.connect(gainR);
    gainR.connect(panR);
    panR.connect(audio.ambientGain);
    oscR.start();
    audio.ambientNodes.push(oscR, lfoR);

    audio.phiLayers.push({
      oscL, oscR, gainL, gainR,
      layerIndex: i,
      layerVol: layerVol
    });
  }
}

// Modulate ambient bed based on player speed.
// The entire phi cascade shifts from 144Hz base (rest) to 200Hz base (full speed).
// This makes the whole harmonic structure wind up together, like an engine spooling.
// Environment probe: raycast in a few directions from camera; short average distance
// = tunnel (crossfade reverb toward tight slap), long average = open volume (toward wide tail).
// Called every few frames from updateAmbientBed for CPU economy.
const _envProbeDirs = [
  new THREE.Vector3( 1,  0,  0),
  new THREE.Vector3(-1,  0,  0),
  new THREE.Vector3( 0,  1,  0),
  new THREE.Vector3( 0, -1,  0),
  new THREE.Vector3( 0,  0,  1),
  new THREE.Vector3( 0,  0, -1),
];
const _envProbeRay = new THREE.Raycaster();
_envProbeRay.far = 2000;
let _envProbeCounter = 0;
function probeEnvironmentOpenness() {
  if (!camera || !game || !game.mapMeshes || !game.mapMeshes.length) return 0.7;
  const camPos = camera.getWorldPosition(_envProbeCamPos);
  let sum = 0;
  let hits = 0;
  for (const d of _envProbeDirs) {
    _envProbeRay.set(camPos, d);
    _envProbeRay.near = 0;
    _envProbeRay.far = 2000;
    const hit = _envProbeRay.intersectObjects(game.mapMeshes, false);
    if (hit && hit.length) {
      sum += hit[0].distance;
      hits++;
    } else {
      sum += 2000;
      hits++;
    }
  }
  const avg = hits ? sum / hits : 2000;
  // 200 u = very tight tunnel, 1200+ u = open room
  return Math.max(0, Math.min(1, (avg - 200) / 1000));
}

function updateAmbientBed() {
  if (!ambientStarted || !audio.ctx || !player.velocity) return;
  // Probe environment openness every 8th frame to drive reverb crossfade.
  if (audio.convolverWide && audio.convolverTight && audio.reverbWideGain && audio.reverbTightGain) {
    _envProbeCounter++;
    if ((_envProbeCounter & 7) === 0) {
      const openness = probeEnvironmentOpenness();
      audio.envOpenness += (openness - audio.envOpenness) * 0.25;
    }
    // Smooth crossfade; wideGain = openness, tightGain = (1 - openness)
    const wG = audio.envOpenness;
    const tG = 1 - audio.envOpenness;
    audio.reverbWideGain.gain.value += (wG - audio.reverbWideGain.gain.value) * 0.10;
    audio.reverbTightGain.gain.value += (tG - audio.reverbTightGain.gain.value) * 0.10;
  }
  const speed = player.velocity ? player.velocity.length() : 0;
  const maxSpeed = 800;
  const t = Math.min(1, speed / maxSpeed);

  // Fade ambient in when game is active. User's ambient slider scales the whole bed.
  const baseVol = (game.state === 'playing' || game.state === 'warmup') ? 1.0 : 0.08;
  // Side-chain duck: on loud SFX the duck target drops; factor eases back over ~400 ms.
  // Ramp back at ~0.04/frame â‰ˆ 400 ms at 60 FPS.
  audio.duckFactor += (audio.duckTarget - audio.duckFactor) * 0.04;
  audio.duckTarget += (1.0 - audio.duckTarget) * 0.08; // target also eases back
  // Health tremor: low-freq gain wobble scales with (1 - health%); peaks when doomed.
  // At full health tremor â‰ˆ 0; at 0 HP / doomed, Â±30% gain wobble at ~4 Hz.
  let tremorFactor = 1.0;
  if (player.maxHealth && player.health !== undefined) {
    const healthPct = Math.max(0, player.health / player.maxHealth);
    const tremorDepth = (1 - healthPct) * 0.30 + (player.doomed ? 0.10 : 0);
    if (tremorDepth > 0.001) {
      const t = (audio.ctx ? audio.ctx.currentTime : 0);
      const tremorFreq = 3.5 + (1 - healthPct) * 1.5; // 3.5 Hz â†’ 5 Hz toward doomed
      tremorFactor = 1.0 - tremorDepth * (0.5 - 0.5 * Math.cos(2 * Math.PI * tremorFreq * t));
    }
  }
  const targetVol = baseVol * audio.userVol.ambient * audio.duckFactor * tremorFactor;
  audio.ambientGain.gain.value += (targetVol - audio.ambientGain.gain.value) * 0.02;

  // Current base frequency: lerp from rest to speed
  const currentBase = PHI_REST_BASE + t * (PHI_SPEED_BASE - PHI_REST_BASE);

  // Shift all phi layers proportionally (the whole cascade winds up together)
  if (audio.phiLayers) {
    for (const layer of audio.phiLayers) {
      const layerFreq = currentBase * Math.pow(PHI, layer.layerIndex - 3);
      layer.oscL.frequency.value = layerFreq;
      layer.oscR.frequency.value = layerFreq + PHI_BEAT;
      // Volume swells gently with speed (pitch shift carries most of the energy)
      const vol = layer.layerVol * (1 + t * 0.8);
      layer.gainL.gain.value = vol;
      layer.gainR.gain.value = vol;
    }
  }
}

// Trigger a side-chain duck on the ambient bed. depth = target factor (0..1).
// Called on loud SFX (explosions, deaths, kills). Factor eases back to 1 over ~400 ms.
function duckAmbient(depth) {
  // Only deepen the duck; don't pull it up if a louder event is already ducking harder.
  if (depth < audio.duckTarget) audio.duckTarget = depth;
  if (depth < audio.duckFactor) audio.duckFactor = depth;
}

// ============================================================================
// SECTION 2 : Synth-engine code (recipe interpreter)
//   triChord       : multi-osc chord helper with chorus + dry/reverb routing
//   playNoiseBurst : filtered noise with lowpass + dry/reverb routing
//   _safeOscType   : normalize wave type to valid OscillatorNode.type
//   _jitterLabLayer / _runLabTriLayer / _runLabNoiseLayer : interpret a "lab recipe" layer
//   _playSoundFromLabRecipe : top-level recipe runner (used by playSound)
// ============================================================================
// Enhanced tri-chord helper with configurable ADSR envelopes.
// envelope = { attack, hold, decay } (in seconds). Defaults to instant attack + exponential decay.
// All SFX route through both dry and reverb (convolver) for spatial presence.
// Each oscillator gets a detuned chorus partner (Â±5 cents alternating, 30% mix) for
// procedural thickness; same ADSR envelope is shared so the partner tracks perfectly.
// Web Audio's OscillatorNode.type only accepts 'sine' | 'square' |
// 'sawtooth' | 'triangle'. Lab recipes (or stale localStorage imports of
// older recipe JSON) occasionally carry typos like 'sin' or 'saw' ; an
// invalid assignment throws synchronously inside triChord's forEach,
// silently kills the rest of that shot's audio, and spams the console
// (the "288 The provided value 'sin' is not a valid enum value of type
// OscillatorType" symptom). Normalize once at the boundary so a bad
// recipe degrades to a safe 'sine' instead of breaking the call.
const _VALID_OSC_TYPES = { sine: 1, square: 1, sawtooth: 1, triangle: 1 };
function _safeOscType(wave) {
  if (typeof wave !== 'string') return 'sine';
  if (_VALID_OSC_TYPES[wave]) return wave;
  // Common typos: 'sin' -> 'sine', 'saw' -> 'sawtooth', 'tri' -> 'triangle'.
  if (wave === 'sin') return 'sine';
  if (wave === 'saw') return 'sawtooth';
  if (wave === 'tri') return 'triangle';
  if (wave === 'sqr' || wave === 'sq') return 'square';
  return 'sine';
}

function triChord(freqs, wave, vol, dur, rampFreqs, rampTime, startOffset, envelope) {
  const ctx = audio.ctx;
  const now = ctx.currentTime + (startOffset || 0);
  const env = envelope || { attack: 0.003, hold: 0, decay: dur };
  const CHORUS_DETUNE_CENTS = 5;
  const CHORUS_MIX = 0.30;
  const safeWave = _safeOscType(wave);
  // (v15 2026-05-10 stress) Snapshot stress state once at call time so all
  // voices in this chord share the same simplified routing. Skips chorus
  // (halves oscillator count) and reverb sends (removes convolution input)
  // when the audio thread is under sustained load.
  const stressed = _audioStressed;
  freqs.forEach((freq, i) => {
    // Main oscillator and shared envelope gain
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = safeWave;
    osc.frequency.setValueAtTime(freq, now);
    // (v14g) Match the lab's triChord: treat a 0 / null rampFreq as "no
    // ramp" instead of ramping the pitch down to 1 Hz. Lab recipes encode
    // rampFreqs:[0,0] to mean "hold the start frequency" (e.g., sonar pings),
    // and the old behavior was sliding pings from 880 Hz to 1 Hz over 55 ms,
    // making them inaudible. This was the cause of "lab sounds don't match
    // in-game" for any recipe that used 0 to mean no ramp.
    if (rampFreqs && rampFreqs[i] != null && rampFreqs[i] > 0 && rampFreqs[i] !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, rampFreqs[i]), now + (rampTime || dur));
    }
    const peakVol = vol / 3;
    // ADSR: attack ramp, hold at peak, then decay
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(peakVol, now + env.attack);
    if (env.hold > 0) {
      gain.gain.setValueAtTime(peakVol, now + env.attack + env.hold);
    }
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);

    // Chorus partner: same envelope, detuned ±5 cents (alternating sign per i for stereo spread).
    // (v15 stress) Skip chorus under load.
    let chorusOsc = null;
    if (!stressed) {
      chorusOsc = ctx.createOscillator();
      const chorusGain = ctx.createGain();
      chorusOsc.type = safeWave;
      chorusOsc.frequency.setValueAtTime(freq, now);
      chorusOsc.detune.setValueAtTime((i % 2 === 0 ? 1 : -1) * CHORUS_DETUNE_CENTS, now);
      if (rampFreqs && rampFreqs[i] != null && rampFreqs[i] > 0 && rampFreqs[i] !== freq) {
        chorusOsc.frequency.exponentialRampToValueAtTime(Math.max(1, rampFreqs[i]), now + (rampTime || dur));
      }
      chorusGain.gain.value = CHORUS_MIX;
      chorusOsc.connect(chorusGain);
      chorusGain.connect(gain); // routes through the same ADSR envelope as main
    }

    // Route to dry + reverb for spatial presence. If a spatial panner is active,
    // the dry tap goes through it so the source is HRTF-positioned in world space.
    // (v15 stress) Skip reverb sends under load ; the existing reverb tail
    // from prior shots covers the gap so it's not perceptually missing.
    const drySink = audio._spatialSink || audio.dryGain || audio.masterGain;
    gain.connect(drySink);
    if (!stressed && audio.convolver) gain.connect(audio.convolver);
    if (!stressed && audio._extraReverbSend) gain.connect(audio._extraReverbSend);
    osc.start(now); osc.stop(now + dur + 0.01);
    if (chorusOsc) { chorusOsc.start(now); chorusOsc.stop(now + dur + 0.01); }
  });
}

// Filtered noise burst with optional bandpass for more character.
// filterFreq/filterQ: bandpass center and sharpness (null = unfiltered white noise).
function playNoiseBurst(duration, volume, startTime, filterFreq, filterQ) {
  if (!audio.ctx) return;
  const ctx = audio.ctx;
  const bufSize = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  if (filterFreq) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = Math.min(filterQ || 0.7, 1.0); // cap Q at 1.0 to prevent ringing
    src.connect(filter);
    filter.connect(gain);
  } else {
    src.connect(gain);
  }
  // Route to dry + reverb (dry routes through spatial panner if active)
  const drySink = audio._spatialSink || audio.dryGain || audio.masterGain;
  gain.connect(drySink);
  if (audio.convolver) gain.connect(audio.convolver);
  if (audio._extraReverbSend) gain.connect(audio._extraReverbSend);
  src.start(startTime);
}

function _jitterLabLayer(layer) {
  const out = Object.assign({}, layer);
  if (layer.kind === 'tri') {
    if (layer.pitchVar > 0) {
      const m = 1 + (Math.random() - 0.5) * layer.pitchVar;
      out.freqs = layer.freqs.map(f => (f || 0) * m);
      if (layer.rampFreqs) out.rampFreqs = layer.rampFreqs.map(f => (f || 0) * m);
    }
    if (layer.durVar > 0) {
      out.dur = layer.dur * (1 + (Math.random() - 0.5) * layer.durVar);
      if (layer.envelope) {
        out.envelope = Object.assign({}, layer.envelope);
        if (typeof out.envelope.decay === 'number') {
          out.envelope.decay = out.envelope.decay * (1 + (Math.random() - 0.5) * layer.durVar);
        }
      }
    }
    if (layer.volVar > 0) {
      out.vol = layer.vol * (1 + (Math.random() - 0.5) * layer.volVar);
    }
  } else if (layer.kind === 'noise') {
    if (layer.varDur > 0) out.duration = layer.duration * (1 + (Math.random() - 0.5) * layer.varDur);
    if (layer.varVol > 0) out.volume = layer.volume * (1 + (Math.random() - 0.5) * layer.varVol);
    if (layer.varFreq > 0 && layer.filterFreq) {
      out.filterFreq = layer.filterFreq * (1 + (Math.random() - 0.5) * layer.varFreq);
    }
  }
  return out;
}

function _runLabTriLayer(layer, atOffsetSec, volMul) {
  // Resolve wave: wavePool overrides wave once per call so all voices share.
  let wave = layer.wave || 'sine';
  if (Array.isArray(layer.wavePool) && layer.wavePool.length) {
    wave = layer.wavePool[Math.floor(Math.random() * layer.wavePool.length)];
  }
  // Pitch pool: dissonant cluster picks. perCall = one mul shared by all
  // voices ; perVoice = each voice picks independently. Default perVoice.
  const useCallMul = layer.pitchPick === 'perCall' && Array.isArray(layer.pitchPool) && layer.pitchPool.length;
  const usePerVoice = layer.pitchPick !== 'perCall' && Array.isArray(layer.pitchPool) && layer.pitchPool.length;
  const callMul = useCallMul ? layer.pitchPool[Math.floor(Math.random() * layer.pitchPool.length)] : 1;
  const freqs = [];
  const rampOut = layer.rampFreqs ? [] : null;
  for (let i = 0; i < layer.freqs.length; i++) {
    const f = layer.freqs[i] || 0;
    if (f <= 0) continue;
    const voiceMul = usePerVoice ? layer.pitchPool[Math.floor(Math.random() * layer.pitchPool.length)] : callMul;
    freqs.push(f * voiceMul);
    if (rampOut) rampOut.push((layer.rampFreqs[i] || 0) * voiceMul);
  }
  if (!freqs.length) return;
  triChord(freqs, wave, layer.vol * volMul, layer.dur,
    rampOut, layer.rampTime || layer.dur, atOffsetSec,
    layer.envelope || { attack: 0.003, hold: 0, decay: layer.dur });
}

function _runLabNoiseLayer(layer, atOffsetSec, volMul) {
  const ctx = audio.ctx;
  const dur = Math.max(0.003, layer.duration);
  const filterType = layer.filterType || 'lowpass';
  const startTime = ctx.currentTime + atOffsetSec;
  // Lowpass + standard envelope: route through the existing playNoiseBurst
  // (caps Q, handles dry+convolver routing). All other filter types and
  // reverseEnvelope take the custom path below.
  if (filterType === 'lowpass' && !layer.reverseEnvelope) {
    playNoiseBurst(dur, layer.volume * volMul, startTime, layer.filterFreq, layer.filterQ);
    return;
  }
  // Custom path for bandpass / peaking / highpass + reverse envelope.
  // Mirrors playNoiseBurst's routing so the lab-tuned sound lands in the
  // same dry+reverb mix as everything else in the game.
  const bufSize = Math.max(8, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (layer.reverseEnvelope) {
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  } else {
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  const vol = (layer.volume || 0.1) * volMul;
  if (layer.reverseEnvelope) {
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), startTime + dur);
  } else {
    gain.gain.setValueAtTime(vol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
  }
  let head = src;
  if (layer.filterFreq) {
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = Math.max(40, layer.filterFreq);
    if (filterType === 'lowpass' || filterType === 'highpass') {
      f.Q.value = Math.min(layer.filterQ || 0.7, 1.0);
    } else {
      f.Q.value = layer.filterQ || 1.0;
    }
    if (filterType === 'peaking') f.gain.value = layer.peakGain || 6;
    head.connect(f);
    head = f;
  }
  head.connect(gain);
  const drySink = audio._spatialSink || audio.dryGain || audio.masterGain;
  gain.connect(drySink);
  // (v15 stress) Skip reverb sends under load to recover audio thread CPU.
  if (!_audioStressed && audio.convolver) gain.connect(audio.convolver);
  if (!_audioStressed && audio._extraReverbSend) gain.connect(audio._extraReverbSend);
  src.start(startTime);
}

// Returns true if a recipe was registered for this type and was scheduled ;
// false if no recipe is loaded for this type, in which case playSound falls
// through to the original synthesis branches.
//
// recipeGain (per-recipe scalar set in the lab) folds into the layer volume
// multiplier so a single recipe can be made quieter or louder than its peers
// without touching individual layer volumes. Default 1.0 means recipes that
// pre-date this field are unaffected.
function _playSoundFromLabRecipe(type) {
  if (!audio.labRecipes) return false;
  const recipe = audio.labRecipes[type];
  if (!recipe || !Array.isArray(recipe.layers)) return false;
  const recipeGain = (typeof recipe.recipeGain === 'number') ? recipe.recipeGain : 1.0;
  for (const layer of recipe.layers) {
    if (typeof layer.chance === 'number' && layer.chance < 1 && Math.random() > layer.chance) continue;
    const baseOffset = layer.startOffset || 0;
    const count = Math.max(1, Math.floor(layer.count || 1));
    const spacing = layer.spacing || 0;
    const spacingVar = layer.spacingVar || 0;
    const countDecay = layer.countDecay || 0;
    let cursor = 0;
    for (let r = 0; r < count; r++) {
      const j = _jitterLabLayer(layer);
      const repeatVolMul = Math.max(0, 1 - r * countDecay) * recipeGain;
      if (j.kind === 'tri') _runLabTriLayer(j, baseOffset + cursor, repeatVolMul);
      else if (j.kind === 'noise') _runLabNoiseLayer(j, baseOffset + cursor, repeatVolMul);
      const stepJ = spacing > 0 ? spacing * (1 + (Math.random() - 0.5) * spacingVar) : 0;
      cursor += stepJ;
    }
  }
  return true;
}

// Import a JSON object exported by sound_lab.html. Accepts either the full
// library shape ({recipes:[{name, layers:[...]},...]}) or a single recipe
// ({name, layers:[...]}). Existing recipes for any name not in the import
// are preserved ; pass replace:true to wipe first. Persists via localStorage
// so the library survives reloads. Returns {ok, message}.
function importSoundLabLibrary(cfg, opts) {
  opts = opts || {};
  if (!cfg || typeof cfg !== 'object') {
    return { ok: false, message: 'Config is not an object.' };
  }
  let recipes = null;
  if (Array.isArray(cfg.recipes)) {
    recipes = cfg.recipes;
  } else if (cfg.name && Array.isArray(cfg.layers)) {
    recipes = [cfg];
  } else {
    return { ok: false, message: 'Expected {recipes:[...]} or a single {name, layers:[...]} recipe.' };
  }
  const baseMap = (opts.replace || !audio.labRecipes) ? {} : Object.assign({}, audio.labRecipes);
  let count = 0;
  for (const r of recipes) {
    if (!r || typeof r !== 'object' || !r.name || !Array.isArray(r.layers)) continue;
    baseMap[r.name] = r;
    count++;
  }
  if (count === 0) {
    return { ok: false, message: 'No valid recipes found.' };
  }
  audio.labRecipes = baseMap;
  try { localStorage.setItem('lss_sound_recipes', JSON.stringify({ recipes: Object.values(baseMap) })); } catch(e) {}
  return { ok: true, message: 'Loaded ' + count + ' recipe' + (count === 1 ? '' : 's') + ' (' + Object.keys(baseMap).length + ' total active).' };
}

// Force-reapply the embedded DEFAULT_SOUND_LIBRARY to
// localStorage and active recipes, wiping any stale or broken entries. Use
// this when the user wants a one-click factory reset to ship-sound defaults
// without going into DevTools to clear localStorage. Wired to a button in
// Settings; also exposed on window for console use.
function reloadDefaultSoundLibrary() {
  if (!DEFAULT_SOUND_LIBRARY || !Array.isArray(DEFAULT_SOUND_LIBRARY.recipes)) {
    return { ok: false, message: 'No embedded default library found.' };
  }
  return importSoundLabLibrary(DEFAULT_SOUND_LIBRARY, { replace: true });
}

// ============================================================================
// SECTION 3 : DEFAULT_SOUND_LIBRARY (verbatim, all recipes)
// ============================================================================
// Baked-in factory defaults from docs/LSS/LSS_SOUND.json.
// Used when localStorage has no recipes yet (first run, cleared storage,
// fresh file:// open). User edits via the Sound Lab persist to localStorage
// and override these on subsequent loads. Embedded inline as a JS object
// literal (JSON is a valid subset of JS) so the file works on file://
// without a fetch step.
const DEFAULT_SOUND_LIBRARY = {
  "version": 1,
  "exportedAt": "2026-05-09T07:24:07.897Z",
  "recipes": [
    {
      "name": "fire_hitscan",
      "description": "sharp transient crack, mid laser (Vortex Energy Blaster, Syphon XO-16)",
      "ships": [
        "VORTEX",
        "SYPHON"
      ],
      "layers": [
        {
          "kind": "tri",
          "wavePool": [
            "sine",
            "triangle"
          ],
          "freqs": [
            630,
            112,
            181
          ],
          "rampFreqs": [
            24,
            45,
            55
          ],
          "vol": 0.3,
          "dur": 0.22,
          "rampTime": 0.185,
          "startOffset": 0,
          "envelope": {
            "attack": 0.088,
            "hold": 0.047,
            "decay": 0.1
          },
          "pitchVar": 0.15,
          "durVar": 0.1,
          "volVar": 0.2,
          "chance": 1,
          "wave": "sine",
          "countDecay": 0.02,
          "spacingVar": 0.2,
          "spacing": 0.015,
          "count": 1,
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1,
      "category": "Other"
    },
    {
      "name": "fire_projectile",
      "description": "thump + launch (Pyro Thermite Launcher, Tracker 40mm)",
      "ships": [
        "PYRO",
        "TRACKER"
      ],
      "layers": [
        {
          "kind": "tri",
          "wavePool": [
            "sine"
          ],
          "freqs": [
            337,
            319,
            296
          ],
          "rampFreqs": [
            22,
            32,
            42
          ],
          "vol": 1,
          "dur": 0.96,
          "rampTime": 0.19,
          "startOffset": 0,
          "envelope": {
            "attack": 0.119,
            "hold": 0.393,
            "decay": 0.22
          },
          "pitchVar": 0.12,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "wave": "sine",
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.08,
          "volume": 0.385,
          "startOffset": 0.01,
          "filterFreq": 600,
          "filterQ": 1,
          "filterType": "lowpass",
          "varDur": 0.3,
          "varVol": 0.3,
          "varFreq": 0.3,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 1.975,
          "volume": 0.155,
          "startOffset": 0.03,
          "filterFreq": 900,
          "filterQ": 1,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.3,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1,
      "category": "Other"
    },
    {
      "name": "hit",
      "description": "enemy hit confirm, soft chord pop",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wavePool": [
            "sawtooth"
          ],
          "freqs": [
            768,
            785,
            665
          ],
          "rampFreqs": [
            80,
            100,
            120
          ],
          "vol": 0.065,
          "dur": 0.08,
          "rampTime": 0.1,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.12
          },
          "pitchVar": 0.1,
          "durVar": 0.2,
          "volVar": 0.15,
          "chance": 1,
          "wave": "sawtooth",
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "kill",
      "description": "kill confirm, double-stack chord with duck",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            130,
            156,
            196
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.18,
          "dur": 0.35,
          "rampTime": 0.35,
          "startOffset": 3,
          "envelope": {
            "attack": 0.005,
            "hold": 0.05,
            "decay": 0.3
          },
          "pitchVar": 0.08,
          "durVar": 0.12,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            198,
            216,
            98
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.15,
          "dur": 0.4,
          "rampTime": 0.4,
          "startOffset": 2.835,
          "envelope": {
            "attack": 0.005,
            "hold": 0.05,
            "decay": 0.35
          },
          "pitchVar": 0.08,
          "durVar": 0.12,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "damage_shield",
      "description": "shield absorbed, metal-on-plate thud + warm overtone",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            255,
            224,
            212
          ],
          "rampFreqs": [
            60,
            268,
            95
          ],
          "vol": 0.09,
          "dur": 0.485,
          "rampTime": 0.37,
          "startOffset": 0.003,
          "envelope": {
            "attack": 0.015,
            "hold": 0.065,
            "decay": 0.005
          },
          "pitchVar": 0.17,
          "durVar": 0,
          "volVar": 0,
          "chance": 1,
          "count": 2,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "damage",
      "description": "hull damage, dissonant 3-5 pulse cluster",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wavePool": [
            "square",
            "sawtooth",
            "triangle"
          ],
          "freqs": [
            66,
            63,
            60
          ],
          "rampFreqs": [
            36,
            33,
            30
          ],
          "vol": 0.465,
          "dur": 0.18,
          "rampTime": 0.03,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.035
          },
          "pitchVar": 0.48,
          "durVar": 0.3,
          "volVar": 0.25,
          "pitchPool": [
            1,
            1.059,
            1.122,
            1.414,
            1.498,
            1.682,
            1.888
          ],
          "pitchPick": "perVoice",
          "count": 4,
          "spacing": 0.025,
          "spacingVar": 0.3,
          "countDecay": 0.12,
          "chance": 1,
          "wave": "sawtooth"
        },
        {
          "kind": "noise",
          "duration": 0.555,
          "volume": 0.58,
          "startOffset": 0,
          "filterFreq": 600,
          "filterQ": 0.7,
          "filterType": "lowpass",
          "varDur": 0.3,
          "varVol": 0.3,
          "varFreq": 0.46,
          "count": 4,
          "spacing": 0.025,
          "spacingVar": 0.45,
          "countDecay": 0.1,
          "chance": 1,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "dash",
      "description": "thruster burst, rising whoosh",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            250,
            250,
            250
          ],
          "rampFreqs": [
            60,
            95,
            78
          ],
          "vol": 0.15,
          "dur": 1.385,
          "rampTime": 0.875,
          "startOffset": 0,
          "envelope": {
            "attack": 0.107,
            "hold": 0.488,
            "decay": 0.165
          },
          "pitchVar": 0.1,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "count": 2,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.2,
          "volume": 0.1,
          "startOffset": 0,
          "filterFreq": 1500,
          "filterQ": 0.8,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 3,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "reload",
      "description": "mechanical click + clip seat",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            220,
            330,
            440
          ],
          "rampFreqs": [
            200,
            320,
            440
          ],
          "vol": 0.6,
          "dur": 0.315,
          "rampTime": 0.15,
          "startOffset": 0,
          "envelope": {
            "attack": 0.391,
            "hold": 0.236,
            "decay": 0.005
          },
          "pitchVar": 0.1,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 10,
          "spacing": 0.04,
          "spacingVar": 0.15,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "square",
          "freqs": [
            312,
            344,
            240
          ],
          "rampFreqs": [
            204,
            198,
            196
          ],
          "vol": 0.005,
          "dur": 0.7,
          "rampTime": 0.15,
          "startOffset": 0.09,
          "envelope": {
            "attack": 0.058,
            "hold": 0.393,
            "decay": 0.54
          },
          "pitchVar": 0.06,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.05,
          "volume": 0.5,
          "startOffset": 0.11,
          "filterFreq": 1500,
          "filterQ": 0.8,
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 4,
          "spacing": 0.075,
          "spacingVar": 0,
          "countDecay": 0,
          "filterType": "lowpass",
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "ability",
      "description": "generic ability fire, two-stack chord",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            82,
            103,
            123
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.18,
          "dur": 0.15,
          "rampTime": 0.15,
          "startOffset": 0,
          "envelope": {
            "attack": 0.003,
            "hold": 0.03,
            "decay": 0.12
          },
          "pitchVar": 0.08,
          "durVar": 0.15,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            98,
            123,
            147
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.15,
          "dur": 0.18,
          "rampTime": 0.18,
          "startOffset": 0.08,
          "envelope": {
            "attack": 0.003,
            "hold": 0.03,
            "decay": 0.15
          },
          "pitchVar": 0.08,
          "durVar": 0.15,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 1.795,
          "volume": 0.275,
          "startOffset": 0.18,
          "filterFreq": 40,
          "filterQ": 0.8,
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 2,
          "spacing": 0.12,
          "filterType": "bandpass",
          "reverseEnvelope": false,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "core",
      "description": "core ready, low rising swell",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "square",
          "freqs": [
            500,
            50,
            60
          ],
          "rampFreqs": [
            727,
            138,
            165
          ],
          "vol": 0.095,
          "dur": 1.875,
          "rampTime": 0.55,
          "startOffset": 0,
          "envelope": {
            "attack": 0.05,
            "hold": 0.1,
            "decay": 0.55
          },
          "pitchVar": 0,
          "durVar": 0.1,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "core_titan",
      "description": "titan core stinger, sub + chord + shimmer",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            32,
            40,
            48
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.45,
          "dur": 1.2,
          "rampTime": 1.2,
          "startOffset": 0,
          "envelope": {
            "attack": 0.12,
            "hold": 0.2,
            "decay": 0.9
          },
          "pitchVar": 0.04,
          "durVar": 0.08,
          "volVar": 0.08,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.55,
          "volume": 0.18,
          "startOffset": 0.04,
          "filterFreq": 90,
          "filterQ": 0.5,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.12,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            65,
            98,
            130
          ],
          "rampFreqs": [
            82,
            123,
            164
          ],
          "vol": 0.38,
          "dur": 1,
          "rampTime": 0.75,
          "startOffset": 0.06,
          "envelope": {
            "attack": 0.02,
            "hold": 0.18,
            "decay": 0.85
          },
          "pitchVar": 0.04,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            98,
            147,
            196
          ],
          "rampFreqs": [
            123,
            185,
            247
          ],
          "vol": 0.26,
          "dur": 0.85,
          "rampTime": 0.65,
          "startOffset": 0.1,
          "envelope": {
            "attack": 0.02,
            "hold": 0.15,
            "decay": 0.75
          },
          "pitchVar": 0.04,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "square",
          "freqs": [
            392,
            523,
            659
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.08,
          "dur": 0.7,
          "rampTime": 0.7,
          "startOffset": 0.18,
          "envelope": {
            "attack": 0.03,
            "hold": 0.1,
            "decay": 0.55
          },
          "pitchVar": 0.04,
          "durVar": 0.1,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.1,
          "volume": 0.45,
          "startOffset": 0.08,
          "filterFreq": 4800,
          "filterQ": 0.9,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.1,
          "varFreq": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "explosion",
      "description": "destruction, dissonant pulse cluster + shrapnel + tail",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "noise",
          "duration": 1.37,
          "volume": 1,
          "startOffset": 0.29,
          "filterFreq": 145,
          "filterQ": 0.5,
          "filterType": "lowpass",
          "varDur": 0.01,
          "varVol": 0,
          "varFreq": 0.28,
          "chance": 1,
          "peakGain": 2.5,
          "count": 5,
          "spacingVar": 0,
          "spacing": 0.08,
          "reverseEnvelope": false,
          "countDecay": 0
        },
        {
          "kind": "tri",
          "wavePool": [],
          "freqs": [
            180,
            240
          ],
          "rampFreqs": [
            90,
            120
          ],
          "vol": 0.155,
          "dur": 0.57,
          "rampTime": 0.015,
          "startOffset": 0.29,
          "envelope": {
            "attack": 0.001,
            "hold": 0.885,
            "decay": 0.02
          },
          "pitchVar": 0.3,
          "durVar": 0.3,
          "volVar": 0.4,
          "count": 4,
          "spacing": 0.025,
          "spacingVar": 0.5,
          "countDecay": 0,
          "chance": 0.85,
          "wave": "square",
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            180,
            160,
            140
          ],
          "rampFreqs": [
            10,
            12,
            14
          ],
          "vol": 0.88,
          "dur": 1.475,
          "rampTime": 0.395,
          "startOffset": 0,
          "envelope": {
            "attack": 0.003,
            "hold": 0.893,
            "decay": 0.2
          },
          "pitchVar": 0.1,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "stasis",
      "description": "stasis charge, 3 s rising harmonic sweep + release",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            50,
            63,
            75
          ],
          "rampFreqs": [
            200,
            250,
            300
          ],
          "vol": 0.2,
          "dur": 3,
          "rampTime": 2.85,
          "startOffset": 0,
          "envelope": {
            "attack": 0.3,
            "hold": 1.5,
            "decay": 0.6
          },
          "pitchVar": 0.04,
          "durVar": 0.05,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            100,
            126,
            150
          ],
          "rampFreqs": [
            400,
            500,
            600
          ],
          "vol": 0.12,
          "dur": 2.55,
          "rampTime": 2.4,
          "startOffset": 0.3,
          "envelope": {
            "attack": 0.5,
            "hold": 1.05,
            "decay": 0.45
          },
          "pitchVar": 0.04,
          "durVar": 0.05,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            200,
            252,
            300
          ],
          "rampFreqs": [
            800,
            1000,
            1200
          ],
          "vol": 0.06,
          "dur": 2.1,
          "rampTime": 1.95,
          "startOffset": 0.6,
          "envelope": {
            "attack": 0.8,
            "hold": 0.45,
            "decay": 0.3
          },
          "pitchVar": 0.04,
          "durVar": 0.05,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 2.4,
          "volume": 0.04,
          "startOffset": 0,
          "filterFreq": 200,
          "filterQ": 0.5,
          "filterType": "lowpass",
          "varDur": 0.05,
          "varVol": 0.2,
          "varFreq": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 1.5,
          "volume": 0.03,
          "startOffset": 0.8,
          "filterFreq": 600,
          "filterQ": 0.6,
          "filterType": "lowpass",
          "varDur": 0.05,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.9,
          "volume": 0.02,
          "startOffset": 1.6,
          "filterFreq": 1200,
          "filterQ": 0.5,
          "filterType": "lowpass",
          "varDur": 0.05,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            300,
            378,
            450
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.15,
          "dur": 0.6,
          "rampTime": 0.6,
          "startOffset": 2.9,
          "envelope": {
            "attack": 0.02,
            "hold": 0.15,
            "decay": 0.43
          },
          "pitchVar": 0.05,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "death",
      "description": "ship death, descending drone + shrapnel + groan",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            35,
            35,
            35
          ],
          "rampFreqs": [
            25,
            25,
            25
          ],
          "vol": 0.45,
          "dur": 0.7,
          "rampTime": 0.7,
          "startOffset": 0,
          "envelope": {
            "attack": 0.005,
            "hold": 0.1,
            "decay": 0.6
          },
          "pitchVar": 0.15,
          "durVar": 0.1,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wavePool": [
            "sawtooth",
            "square"
          ],
          "freqs": [
            82,
            98,
            123
          ],
          "rampFreqs": [
            20,
            25,
            30
          ],
          "vol": 0.25,
          "dur": 1.3,
          "rampTime": 1.1,
          "startOffset": 0.42,
          "envelope": {
            "attack": 0.03,
            "hold": 0.1,
            "decay": 1.17
          },
          "pitchVar": 0.15,
          "durVar": 0.12,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wave": "sine",
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            200,
            194,
            190
          ],
          "rampFreqs": [
            20,
            16,
            12
          ],
          "vol": 0.72,
          "dur": 0.995,
          "rampTime": 0.315,
          "startOffset": 0,
          "envelope": {
            "attack": 0,
            "hold": 0.393,
            "decay": 0.89
          },
          "pitchVar": 0.07,
          "durVar": 0,
          "volVar": 0.15,
          "chance": 1,
          "wavePool": [],
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "round_start",
      "description": "rising chord progression with reverse-cymbal swell + resolve",
      "category": "GENERIC",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            65,
            82,
            98
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.18,
          "dur": 0.35,
          "rampTime": 0.35,
          "startOffset": 0,
          "envelope": {
            "attack": 0.01,
            "hold": 0.08,
            "decay": 0.26
          },
          "pitchVar": 0,
          "durVar": 0,
          "volVar": 0,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            73,
            92,
            110
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.18,
          "dur": 0.35,
          "rampTime": 0.35,
          "startOffset": 0.18,
          "envelope": {
            "attack": 0.01,
            "hold": 0.08,
            "decay": 0.26
          },
          "pitchVar": 0,
          "durVar": 0,
          "volVar": 0,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.36,
          "volume": 0.18,
          "startOffset": 0,
          "filterFreq": 1800,
          "filterQ": 0.7,
          "filterType": "highpass",
          "varDur": 0,
          "varVol": 0,
          "varFreq": 0,
          "reverseEnvelope": true,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            98,
            123,
            147
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.24,
          "dur": 0.5,
          "rampTime": 0.5,
          "startOffset": 0.36,
          "envelope": {
            "attack": 0.005,
            "hold": 0.18,
            "decay": 0.31
          },
          "pitchVar": 0,
          "durVar": 0,
          "volVar": 0,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "shield_hum",
      "description": "low electrical hum loop (Vortex Shield, Body Shield, Absorption, Plasma Shield)",
      "ships": [
        "VORTEX",
        "BLASTER",
        "SLAYER",
        "TRACKER"
      ],
      "layers": [
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            55,
            82,
            110
          ],
          "rampFreqs": [
            55,
            82,
            110
          ],
          "vol": 0.1,
          "dur": 3,
          "rampTime": 2.03,
          "startOffset": 0,
          "envelope": {
            "attack": 0.1,
            "hold": 2,
            "decay": 0.005
          },
          "pitchVar": 0,
          "durVar": 0,
          "volVar": 0,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [
            1,
            3
          ],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 0.55,
      "category": "Other"
    },
    {
      "name": "vortex_shield_hum",
      "description": "continuous low organ-drone tick (loops on 0.95 s cadence)",
      "category": "VORTEX",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            110,
            165
          ],
          "rampFreqs": [
            108,
            162
          ],
          "vol": 0.08,
          "dur": 0.95,
          "rampTime": 0.92,
          "startOffset": 0,
          "envelope": {
            "attack": 0.18,
            "hold": 0.2,
            "decay": 0.55
          },
          "pitchVar": 0.04,
          "durVar": 0.05,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            440
          ],
          "rampFreqs": [
            0
          ],
          "vol": 0.025,
          "dur": 0.45,
          "rampTime": 0,
          "startOffset": 0.1,
          "envelope": {
            "attack": 0.05,
            "hold": 0,
            "decay": 0.4
          },
          "pitchVar": 0.04,
          "durVar": 0.2,
          "volVar": 0.3,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "vortex_absorb",
      "description": "rising schwoop : projectile sucked into Vortex Shield",
      "category": "VORTEX",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            220,
            330,
            440
          ],
          "rampFreqs": [
            660,
            880,
            1320
          ],
          "vol": 0.18,
          "dur": 0.16,
          "rampTime": 0.14,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0.01,
            "decay": 0.13
          },
          "pitchVar": 0.1,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.05,
          "volume": 0.07,
          "startOffset": 0,
          "filterFreq": 2200,
          "filterQ": 2.5,
          "filterType": "lowpass",
          "varDur": 0.3,
          "varVol": 0.3,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "vortex_reflect",
      "description": "falling sawtooth + sub thump : Vortex Shield burst release",
      "category": "VORTEX",
      "layers": [
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            880,
            660
          ],
          "rampFreqs": [
            330,
            248
          ],
          "vol": 0.22,
          "dur": 0.2,
          "rampTime": 0.18,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0.005,
            "decay": 0.18
          },
          "pitchVar": 0.1,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.06,
          "volume": 0.1,
          "startOffset": 0,
          "filterFreq": 1400,
          "filterQ": 1.4,
          "filterType": "lowpass",
          "varDur": 0.25,
          "varVol": 0.25,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.04,
          "volume": 0.1,
          "startOffset": 0,
          "filterFreq": 80,
          "filterQ": 0.8,
          "filterType": "lowpass",
          "varDur": 0.25,
          "varVol": 0.25,
          "varFreq": 0.3,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "tripwire_detonate",
      "description": "electric snap + detonation thud : Plasma Mines orb triggered",
      "category": "VORTEX",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.93,
          "volume": 0.2,
          "startOffset": 0,
          "filterFreq": 3200,
          "filterQ": 1.88,
          "filterType": "bandpass",
          "varDur": 0.25,
          "varVol": 0.25,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            660,
            990
          ],
          "rampFreqs": [
            165,
            248
          ],
          "vol": 0.18,
          "dur": 0.12,
          "rampTime": 0.1,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.1
          },
          "pitchVar": 0.1,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.18,
          "volume": 0.3,
          "startOffset": 0.04,
          "filterFreq": 80,
          "filterQ": 0.7,
          "filterType": "lowpass",
          "varDur": 0.15,
          "varVol": 0.2,
          "varFreq": 0.3,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.1,
          "volume": 0.1,
          "startOffset": 0.05,
          "filterFreq": 450,
          "filterQ": 0.9,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.25,
          "varFreq": 0.3,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "trip_wire_deploy",
      "description": "capacitor thunk + electric snap : Plasma Mines (laser trap) deployment",
      "category": "VORTEX",
      "layers": [
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            110,
            165,
            220
          ],
          "rampFreqs": [
            330,
            495,
            660
          ],
          "vol": 0.4,
          "dur": 0.3,
          "rampTime": 0.28,
          "startOffset": 0,
          "envelope": {
            "attack": 0.02,
            "hold": 0.06,
            "decay": 0.25
          },
          "pitchVar": 0.06,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.25,
          "volume": 0.35,
          "startOffset": 0,
          "filterFreq": 75,
          "filterQ": 0.5,
          "filterType": "lowpass",
          "varDur": 0.12,
          "varVol": 0.12,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.1,
          "volume": 0.3,
          "startOffset": 0.04,
          "filterFreq": 2800,
          "filterQ": 3,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.15,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            660,
            990,
            1320
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.18,
          "dur": 0.3,
          "rampTime": 0,
          "startOffset": 0.08,
          "envelope": {
            "attack": 0.001,
            "hold": 0.04,
            "decay": 0.26
          },
          "pitchVar": 0.06,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 0.7
    },
    {
      "name": "laser_shot",
      "description": "sharp piercing zap (Vortex Laser ability)",
      "category": "VORTEX",
      "layers": [
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            1320,
            1980,
            2640
          ],
          "rampFreqs": [
            330,
            495,
            660
          ],
          "vol": 0.3,
          "dur": 0.18,
          "rampTime": 0.16,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.16
          },
          "pitchVar": 0.06,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.08,
          "volume": 0.2,
          "startOffset": 0,
          "filterFreq": 3200,
          "filterQ": 3.5,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.06,
          "volume": 0.1,
          "startOffset": 0,
          "filterFreq": 75,
          "filterQ": 0.6,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.25,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            220
          ],
          "rampFreqs": [
            0
          ],
          "vol": 0.1,
          "dur": 0.22,
          "rampTime": 0,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0.02,
            "decay": 0.2
          },
          "pitchVar": 0.06,
          "durVar": 0.2,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "laser_core_beam",
      "description": "4 s sustained energy beam (Vortex Mega Laser)",
      "category": "VORTEX",
      "layers": [
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            55,
            82
          ],
          "rampFreqs": [
            55,
            82
          ],
          "vol": 0.32,
          "dur": 4,
          "rampTime": 4,
          "startOffset": 0,
          "envelope": {
            "attack": 0.12,
            "hold": 3.4,
            "decay": 0.45
          },
          "pitchVar": 0.04,
          "durVar": 0.08,
          "volVar": 0.08,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            165,
            247,
            330
          ],
          "rampFreqs": [
            220,
            330,
            440
          ],
          "vol": 0.24,
          "dur": 4,
          "rampTime": 3.95,
          "startOffset": 0,
          "envelope": {
            "attack": 0.1,
            "hold": 3.45,
            "decay": 0.4
          },
          "pitchVar": 0.04,
          "durVar": 0.08,
          "volVar": 0.08,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 3.95,
          "volume": 0.1,
          "startOffset": 0.05,
          "filterFreq": 2400,
          "filterQ": 2.8,
          "filterType": "lowpass",
          "varDur": 0.05,
          "varVol": 0.1,
          "varFreq": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 3.95,
          "volume": 0.18,
          "startOffset": 0.02,
          "filterFreq": 110,
          "filterQ": 0.55,
          "filterType": "lowpass",
          "varDur": 0.05,
          "varVol": 0.1,
          "varFreq": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "fire_burn",
      "description": "firewall / gas cloud / incendiary trap / Mega Flame Chain (loops)",
      "category": "PYRO",
      "layers": [
        {
          "kind": "noise",
          "duration": 3,
          "volume": 0.1,
          "startOffset": 0,
          "filterFreq": 435,
          "filterQ": 0.8,
          "varDur": 0,
          "varVol": 0,
          "varFreq": 0.15,
          "chance": 1,
          "reverseEnvelope": true,
          "count": 6,
          "spacing": 0.175,
          "spacingVar": 0.85,
          "countDecay": 0,
          "filterType": "lowpass",
          "peakGain": 0
        }
      ],
      "recipeGain": 0.7
    },
    {
      "name": "fire_shield_hum",
      "description": "Pyro Fire Shield fiery roar (loops)",
      "category": "PYRO",
      "layers": [
        {
          "kind": "noise",
          "duration": 1,
          "volume": 0.22,
          "startOffset": 0,
          "filterFreq": 70,
          "filterQ": 0.55,
          "filterType": "bandpass",
          "varDur": 0.05,
          "varVol": 0.1,
          "varFreq": 0.16,
          "chance": 1,
          "count": 6,
          "spacing": 0.245,
          "spacingVar": 1,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": true
        }
      ],
      "recipeGain": 0.65
    },
    {
      "name": "thermal_shield_hum",
      "description": "warm crackling roar bed : Fire Shield held (loops 0.90 s)",
      "category": "PYRO",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.85,
          "volume": 0.1,
          "startOffset": 0,
          "filterFreq": 220,
          "filterQ": 0.7,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.85,
          "volume": 0.06,
          "startOffset": 0.02,
          "filterFreq": 1100,
          "filterQ": 1.1,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.25,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            82,
            110
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.06,
          "dur": 0.85,
          "rampTime": 0,
          "startOffset": 0,
          "envelope": {
            "attack": 0.2,
            "hold": 0.3,
            "decay": 0.4
          },
          "pitchVar": 0.05,
          "durVar": 0.05,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "thermal_burn",
      "description": "short crackling sting : Fire Shield burn-on-contact",
      "category": "PYRO",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.12,
          "volume": 0.16,
          "startOffset": 0,
          "filterFreq": 2400,
          "filterQ": 2.4,
          "filterType": "lowpass",
          "varDur": 0.25,
          "varVol": 0.25,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            440,
            660
          ],
          "rampFreqs": [
            220,
            330
          ],
          "vol": 0.1,
          "dur": 0.1,
          "rampTime": 0.08,
          "startOffset": 0,
          "envelope": {
            "attack": 0.002,
            "hold": 0,
            "decay": 0.08
          },
          "pitchVar": 0.1,
          "durVar": 0.2,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.69,
          "volume": 0.845,
          "startOffset": 0,
          "filterFreq": 340,
          "filterQ": 2.2,
          "varDur": 0,
          "varVol": 0.02,
          "varFreq": 0,
          "chance": 1,
          "count": 5,
          "spacing": 0.05
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "firewall_roar",
      "description": "sustained jet-engine fire bed : Flame Chain ability (loops 0.55 s)",
      "category": "PYRO",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.55,
          "volume": 0.18,
          "startOffset": 0,
          "filterFreq": 160,
          "filterQ": 0.6,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.5,
          "volume": 0.08,
          "startOffset": 0.02,
          "filterFreq": 900,
          "filterQ": 1.4,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.25,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.3,
          "volume": 0.04,
          "startOffset": 0.05,
          "filterFreq": 2800,
          "filterQ": 2,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.3,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "incendiary_ignite",
      "description": "deep WHOOSH + rising flame tail : Explosive Gas ignites",
      "category": "PYRO",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.3,
          "volume": 0.25,
          "startOffset": 0,
          "filterFreq": 180,
          "filterQ": 0.6,
          "filterType": "lowpass",
          "varDur": 0.15,
          "varVol": 0.2,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.4,
          "volume": 0.15,
          "startOffset": 0.04,
          "filterFreq": 700,
          "filterQ": 1.2,
          "filterType": "lowpass",
          "varDur": 0.15,
          "varVol": 0.25,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.3,
          "volume": 0.08,
          "startOffset": 0.1,
          "filterFreq": 2400,
          "filterQ": 1.8,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.3,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            55,
            82
          ],
          "rampFreqs": [
            180,
            270
          ],
          "vol": 0.1,
          "dur": 0.4,
          "rampTime": 0.35,
          "startOffset": 0,
          "envelope": {
            "attack": 0.04,
            "hold": 0,
            "decay": 0.35
          },
          "pitchVar": 0,
          "durVar": 0.2,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "flame_core_blast",
      "description": "massive ignition front + rising whoosh (Mega Flame Chain, with duck)",
      "category": "PYRO",
      "layers": [
        {
          "kind": "noise",
          "duration": 2.75,
          "volume": 0.97,
          "startOffset": 0,
          "filterFreq": 110,
          "filterQ": 0.5,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.1,
          "varFreq": 0.2,
          "chance": 1,
          "count": 5,
          "spacing": 0.19,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 14.5,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 3,
          "volume": 1,
          "startOffset": 0.04,
          "filterFreq": 280,
          "filterQ": 3.72,
          "filterType": "lowpass",
          "varDur": 0.12,
          "varVol": 0.15,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 2.83,
          "volume": 0.775,
          "startOffset": 0.1,
          "filterFreq": 280,
          "filterQ": 0.57,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 14.5,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            80,
            141,
            80
          ],
          "rampFreqs": [
            60,
            39,
            100
          ],
          "vol": 0.41,
          "dur": 1.26,
          "rampTime": 0.15,
          "startOffset": 0,
          "envelope": {
            "attack": 0.003,
            "hold": 0,
            "decay": 0.2
          },
          "pitchVar": 0.1,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 4,
          "spacing": 0.065
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            100,
            100,
            120
          ],
          "rampFreqs": [
            60,
            60,
            39
          ],
          "vol": 0.84,
          "dur": 2.4,
          "rampTime": 0.84,
          "startOffset": 0,
          "envelope": {
            "attack": 0.229,
            "hold": 0.285,
            "decay": 0.2
          },
          "pitchVar": 0.1,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "fire_railgun",
      "description": "charged swell + metallic ring",
      "category": "PUNCTURE",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            74,
            35,
            82
          ],
          "rampFreqs": [
            20,
            25,
            30
          ],
          "vol": 0.2,
          "dur": 0.61,
          "rampTime": 0.99,
          "startOffset": 0,
          "envelope": {
            "attack": 0.003,
            "hold": 0.306,
            "decay": 0.32
          },
          "pitchVar": 0.1,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "wavePool": [],
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            4000,
            2063,
            354
          ],
          "rampFreqs": [
            40,
            30,
            20
          ],
          "vol": 0.065,
          "dur": 1.295,
          "rampTime": 0.5,
          "startOffset": 0.175,
          "envelope": {
            "attack": 0.093,
            "hold": 0.203,
            "decay": 0.785
          },
          "pitchVar": 0.1,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "railgun_charge",
      "description": "Puncture railgun spool, 2.5 s rising hum + electrical bed",
      "category": "PUNCTURE",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            69,
            63,
            60
          ],
          "rampFreqs": [
            690,
            630,
            600
          ],
          "vol": 0.415,
          "dur": 2.5,
          "rampTime": 2.495,
          "startOffset": 0,
          "envelope": {
            "attack": 0.228,
            "hold": 2,
            "decay": 2.235
          },
          "pitchVar": 0,
          "durVar": 0,
          "volVar": 0,
          "chance": 1,
          "count": 3,
          "spacing": 0.035,
          "wavePool": [
            "triangle",
            "sine"
          ],
          "spacingVar": 0,
          "countDecay": 0,
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 0.39
    },
    {
      "name": "firework_pop",
      "description": "cluster missile firework crackle, bright + short",
      "category": "PUNCTURE",
      "layers": [
        {
          "kind": "tri",
          "wavePool": [],
          "freqs": [
            66,
            111,
            222
          ],
          "rampFreqs": [
            144,
            11,
            4
          ],
          "vol": 0.225,
          "dur": 1.545,
          "rampTime": 1.43,
          "startOffset": 0,
          "envelope": {
            "attack": 0,
            "hold": 2,
            "decay": 0.39
          },
          "pitchVar": 0.05,
          "durVar": 0.2,
          "volVar": 0,
          "chance": 1,
          "count": 5,
          "spacing": 0.5,
          "spacingVar": 0.5,
          "countDecay": 0,
          "wave": "sine",
          "pitchPool": [
            1,
            2
          ],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 0.8
    },
    {
      "name": "cluster_split",
      "description": "metal pop + shrapnel scatter : Cluster Missile sub-munitions",
      "category": "PUNCTURE",
      "layers": [
        {
          "kind": "tri",
          "wavePool": [
            "triangle",
            "sawtooth"
          ],
          "freqs": [
            330,
            495,
            660
          ],
          "rampFreqs": [
            220,
            330,
            440
          ],
          "vol": 0.15,
          "dur": 0.1,
          "rampTime": 0.08,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.08
          },
          "pitchVar": 0.1,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wave": "sine",
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.06,
          "volume": 0.18,
          "startOffset": 0,
          "filterFreq": 1800,
          "filterQ": 1.8,
          "filterType": "lowpass",
          "varDur": 0.25,
          "varVol": 0.2,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.03,
          "volume": 0.06,
          "startOffset": 0.05,
          "filterFreq": 2400,
          "filterQ": 2.5,
          "filterType": "lowpass",
          "varDur": 0.3,
          "varVol": 0.3,
          "varFreq": 0.3,
          "count": 3,
          "spacing": 0.04,
          "spacingVar": 0.6,
          "chance": 1,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "tether_caught",
      "description": "rubber-band twang + low captured drone : Stasis Trap snare",
      "category": "PUNCTURE",
      "layers": [
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            220,
            330
          ],
          "rampFreqs": [
            110,
            165
          ],
          "vol": 0.2,
          "dur": 0.18,
          "rampTime": 0.16,
          "startOffset": 0,
          "envelope": {
            "attack": 0.002,
            "hold": 0.01,
            "decay": 0.15
          },
          "pitchVar": 0.1,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.06,
          "volume": 0.12,
          "startOffset": 0,
          "filterFreq": 900,
          "filterQ": 1.2,
          "filterType": "lowpass",
          "varDur": 0.25,
          "varVol": 0.25,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            82,
            110
          ],
          "rampFreqs": [
            70,
            95
          ],
          "vol": 0.08,
          "dur": 0.4,
          "rampTime": 0.36,
          "startOffset": 0.1,
          "envelope": {
            "attack": 0.04,
            "hold": 0,
            "decay": 0.34
          },
          "pitchVar": 0.1,
          "durVar": 0.2,
          "volVar": 0.2,
          "chance": 1,
          "count": 3,
          "spacing": 0.095,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "tether_trap_deploy",
      "description": "magnetic-coil thunk + radial pulse : Stasis Trap deployment",
      "category": "PUNCTURE",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.3,
          "volume": 0.4,
          "startOffset": 0,
          "filterFreq": 70,
          "filterQ": 0.45,
          "filterType": "lowpass",
          "varDur": 0.15,
          "varVol": 0.1,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            110,
            165,
            247
          ],
          "rampFreqs": [
            220,
            330,
            495
          ],
          "vol": 0.4,
          "dur": 0.35,
          "rampTime": 0.32,
          "startOffset": 0,
          "envelope": {
            "attack": 0.02,
            "hold": 0.05,
            "decay": 0.3
          },
          "pitchVar": 0.06,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            440,
            660,
            880
          ],
          "rampFreqs": [
            220,
            330,
            440
          ],
          "vol": 0.25,
          "dur": 0.25,
          "rampTime": 0.22,
          "startOffset": 0.1,
          "envelope": {
            "attack": 0.001,
            "hold": 0.04,
            "decay": 0.2
          },
          "pitchVar": 0.06,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.18,
          "volume": 0.18,
          "startOffset": 0.04,
          "filterFreq": 900,
          "filterQ": 1.6,
          "filterType": "lowpass",
          "varDur": 0.15,
          "varVol": 0.15,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 0.62
    },
    {
      "name": "cluster_missile_fire",
      "description": "heavy missile launch : sub kick + body whoosh + thrust roar",
      "category": "PUNCTURE",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.3,
          "volume": 0.45,
          "startOffset": 0,
          "filterFreq": 60,
          "filterQ": 0.4,
          "filterType": "lowpass",
          "varDur": 0.12,
          "varVol": 0.1,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            82,
            110,
            165
          ],
          "rampFreqs": [
            220,
            330,
            440
          ],
          "vol": 0.4,
          "dur": 0.4,
          "rampTime": 0.35,
          "startOffset": 0,
          "envelope": {
            "attack": 0.01,
            "hold": 0.05,
            "decay": 0.35
          },
          "pitchVar": 0.06,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.4,
          "volume": 0.2,
          "startOffset": 0.05,
          "filterFreq": 550,
          "filterQ": 1,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.15,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.1,
          "volume": 0.2,
          "startOffset": 0,
          "filterFreq": 2400,
          "filterQ": 2.4,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "afterburner",
      "description": "sub-kick whoosh + rising engine spool : Afterburner ignition",
      "category": "PUNCTURE",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.3,
          "volume": 0.25,
          "startOffset": 0,
          "filterFreq": 85,
          "filterQ": 0.55,
          "filterType": "lowpass",
          "varDur": 0.15,
          "varVol": 0.15,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.4,
          "volume": 0.18,
          "startOffset": 0.02,
          "filterFreq": 900,
          "filterQ": 1.3,
          "filterType": "lowpass",
          "varDur": 0.12,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            82,
            110,
            165
          ],
          "rampFreqs": [
            220,
            290,
            440
          ],
          "vol": 0.22,
          "dur": 0.4,
          "rampTime": 0.36,
          "startOffset": 0,
          "envelope": {
            "attack": 0.04,
            "hold": 0,
            "decay": 0.36
          },
          "pitchVar": 0.06,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "barrage_core_thrust",
      "description": "sustained thrust roar + rising power tone (Mega Barrage, with duck)",
      "category": "PUNCTURE",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.55,
          "volume": 0.35,
          "startOffset": 0,
          "filterFreq": 140,
          "filterQ": 0.6,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.1,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.5,
          "volume": 0.18,
          "startOffset": 0.02,
          "filterFreq": 1100,
          "filterQ": 1.4,
          "filterType": "lowpass",
          "varDur": 0.1,
          "varVol": 0.15,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            82,
            110,
            165
          ],
          "rampFreqs": [
            220,
            290,
            440
          ],
          "vol": 0.3,
          "dur": 0.5,
          "rampTime": 0.45,
          "startOffset": 0,
          "envelope": {
            "attack": 0.05,
            "hold": 0,
            "decay": 0.45
          },
          "pitchVar": 0.06,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "fire_spread",
      "description": "shotgun pellet scatter (1-3 random pops)",
      "category": "SLAYER",
      "layers": [
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            78,
            544,
            768
          ],
          "rampFreqs": [
            95,
            75,
            43
          ],
          "vol": 0.35,
          "dur": 0.905,
          "rampTime": 0.19,
          "startOffset": 0,
          "envelope": {
            "attack": 0,
            "hold": 0.229,
            "decay": 0.685
          },
          "pitchVar": 0.06,
          "durVar": 0.12,
          "volVar": 0.15,
          "chance": 1,
          "wavePool": [],
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "stun",
      "description": "electric crackle + wobbling sawtooth + sub thump + disorient blip",
      "category": "SLAYER",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.265,
          "volume": 0.18,
          "startOffset": 0,
          "filterFreq": 2400,
          "filterQ": 2.2,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "noise",
          "duration": 0.14,
          "volume": 0.1,
          "startOffset": 0.01,
          "filterFreq": 900,
          "filterQ": 1.2,
          "filterType": "lowpass",
          "varDur": 0.25,
          "varVol": 0.25,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            440,
            660
          ],
          "rampFreqs": [
            290,
            435
          ],
          "vol": 0.18,
          "dur": 0.815,
          "rampTime": 1.205,
          "startOffset": 0,
          "envelope": {
            "attack": 0.086,
            "hold": 0.02,
            "decay": 0.27
          },
          "pitchVar": 0.1,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            880
          ],
          "rampFreqs": [
            330
          ],
          "vol": 0.1,
          "dur": 0.1,
          "rampTime": 0.09,
          "startOffset": 0.05,
          "envelope": {
            "attack": 0.003,
            "hold": 0.01,
            "decay": 0.08
          },
          "pitchVar": 0.1,
          "durVar": 0.2,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "phase_dash",
      "description": "phasing whoosh + sub doppler tail : Slayer Teleport",
      "category": "SLAYER",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            220,
            440
          ],
          "rampFreqs": [
            660,
            330
          ],
          "vol": 0.25,
          "dur": 0.3,
          "rampTime": 0.25,
          "startOffset": 0,
          "envelope": {
            "attack": 0.005,
            "hold": 0,
            "decay": 0.25
          },
          "pitchVar": 0.08,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.2,
          "volume": 0.2,
          "startOffset": 0,
          "filterFreq": 1600,
          "filterQ": 1,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.3,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            120,
            180
          ],
          "rampFreqs": [
            60,
            90
          ],
          "vol": 0.18,
          "dur": 0.35,
          "rampTime": 0.3,
          "startOffset": 0.04,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.3
          },
          "pitchVar": 0.08,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "sword_core_swing",
      "description": "rapid descending chord + metallic ring : Mega Stun Bolt activation",
      "category": "SLAYER",
      "layers": [
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            222,
            345,
            488
          ],
          "rampFreqs": [
            220,
            275,
            330
          ],
          "vol": 0.3,
          "dur": 0.785,
          "rampTime": 0.35,
          "startOffset": 0,
          "envelope": {
            "attack": 0.117,
            "hold": 0.193,
            "decay": 0.25
          },
          "pitchVar": 0.05,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.415,
          "volume": 0.025,
          "startOffset": 0.06,
          "filterFreq": 3200,
          "filterQ": 2.8,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.15,
          "chance": 1,
          "count": 3,
          "spacing": 0.06,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            120,
            162,
            182
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.2,
          "dur": 0.59,
          "rampTime": 0.075,
          "startOffset": 0.2,
          "envelope": {
            "attack": 0,
            "hold": 0.234,
            "decay": 0.4
          },
          "pitchVar": 0.05,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "stun_core_zap",
      "description": "5 s sustained low-pitch electrical drone + rhythmic zap clicks (Mega Stun Bolt core)",
      "category": "SLAYER",
      "layers": [
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            50,
            75
          ],
          "rampFreqs": [
            50,
            75
          ],
          "vol": 0.22,
          "dur": 5,
          "rampTime": 5,
          "startOffset": 0,
          "envelope": {
            "attack": 0.08,
            "hold": 4.5,
            "decay": 0.4
          },
          "pitchVar": 0.05,
          "durVar": 0.05,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            102,
            130
          ],
          "rampFreqs": [
            110,
            145
          ],
          "vol": 0.14,
          "dur": 5,
          "rampTime": 4.8,
          "startOffset": 0.02,
          "envelope": {
            "attack": 0.1,
            "hold": 4.4,
            "decay": 0.45
          },
          "pitchVar": 0.07,
          "durVar": 0.05,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 4.8,
          "volume": 0.08,
          "startOffset": 0.1,
          "filterFreq": 480,
          "filterQ": 1.4,
          "filterType": "bandpass",
          "varDur": 0.05,
          "varVol": 0.15,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "square",
          "freqs": [
            180,
            220
          ],
          "rampFreqs": [
            60,
            90
          ],
          "vol": 0.18,
          "dur": 0.12,
          "rampTime": 0.1,
          "startOffset": 0.15,
          "envelope": {
            "attack": 0.002,
            "hold": 0.02,
            "decay": 0.1
          },
          "pitchVar": 0.15,
          "durVar": 0.3,
          "volVar": 0.25,
          "chance": 1,
          "count": 18,
          "spacing": 0.27,
          "spacingVar": 0.06,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "tracker_rockets",
      "description": "Tracker Rockets : same shape as Syphon Rocket Salvo (5 launches + sub dive)",
      "category": "TRACKER",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [70, 85],
          "rampFreqs": [200, 240],
          "vol": 0.7,
          "dur": 0.22,
          "rampTime": 0.18,
          "startOffset": 0,
          "envelope": { "attack": 0.006, "hold": 0.04, "decay": 0.2 },
          "pitchVar": 0.08,
          "durVar": 0.15,
          "volVar": 0.18,
          "count": 5,
          "spacing": 0.07,
          "spacingVar": 0.02,
          "countDecay": 0,
          "chance": 1,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.16,
          "volume": 1,
          "startOffset": 0,
          "filterFreq": 95,
          "filterQ": 0.7,
          "filterType": "bandpass",
          "varDur": 0.2,
          "varVol": 0.25,
          "varFreq": 0.25,
          "count": 5,
          "spacing": 0.07,
          "spacingVar": 0.02,
          "chance": 1,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [0, 0, 453],
          "rampFreqs": [0, 0, 32],
          "vol": 0.195,
          "dur": 1.455,
          "rampTime": 1.8,
          "startOffset": 0.175,
          "envelope": { "attack": 0.284, "hold": 0.367, "decay": 0.2 },
          "pitchVar": 0.1,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 5,
          "spacing": 0.025
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "sonar_pulse",
      "description": "Sonar Beacon detonation : wide pulse + sub thump + shimmer",
      "category": "TRACKER",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [60, 90, 140],
          "rampFreqs": [30, 45, 70],
          "vol": 0.6,
          "dur": 0.5,
          "rampTime": 0.45,
          "startOffset": 0,
          "envelope": { "attack": 0.01, "hold": 0.08, "decay": 0.45 },
          "pitchVar": 0.05,
          "durVar": 0.1,
          "volVar": 0.1,
          "count": 1,
          "spacing": 0,
          "chance": 1
        },
        {
          "kind": "noise",
          "duration": 0.4,
          "volume": 0.45,
          "startOffset": 0,
          "filterFreq": 1800,
          "filterQ": 2.0,
          "filterType": "bandpass",
          "varDur": 0.1,
          "varVol": 0.15,
          "varFreq": 0.2,
          "count": 1,
          "spacing": 0,
          "chance": 1,
          "peakGain": 0,
          "reverseEnvelope": true
        },
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [880, 1320],
          "rampFreqs": [440, 660],
          "vol": 0.18,
          "dur": 0.35,
          "rampTime": 0.3,
          "startOffset": 0.05,
          "envelope": { "attack": 0.02, "hold": 0.04, "decay": 0.3 },
          "pitchVar": 0.08,
          "durVar": 0.1,
          "volVar": 0.15,
          "count": 1,
          "spacing": 0,
          "chance": 1
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "fire_salvo",
      "description": "missile launch, whoosh + rise",
      "category": "TRACKER",
      "layers": [
        {
          "kind": "tri",
          "wavePool": [],
          "freqs": [
            260,
            258,
            248
          ],
          "rampFreqs": [
            55,
            53,
            51
          ],
          "vol": 0.22,
          "dur": 0.43,
          "rampTime": 0.085,
          "startOffset": 0.045,
          "envelope": {
            "attack": 0.008,
            "hold": 0.211,
            "decay": 0.44
          },
          "pitchVar": 0.15,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "wave": "sine",
          "count": 4,
          "spacing": 0.08,
          "spacingVar": 0,
          "countDecay": 0,
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 3,
          "volume": 0.1,
          "startOffset": 0,
          "filterFreq": 480,
          "filterQ": 2.29,
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "filterType": "lowpass",
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "sonar_ping_1",
      "description": "Sonar Beacon / Pulse impact + lock level 1 (single soft pip)",
      "category": "TRACKER",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            880,
            1320
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.08,
          "dur": 0.055,
          "rampTime": 0.055,
          "startOffset": 0,
          "envelope": {
            "attack": 0.002,
            "hold": 0,
            "decay": 0.05
          },
          "pitchVar": 0.03,
          "durVar": 0.05,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "sonar_ping_2",
      "description": "Sonar Pulse lock level 2 (double pip)",
      "category": "TRACKER",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            1100,
            1650
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.08,
          "dur": 0.055,
          "rampTime": 0.055,
          "startOffset": 0,
          "envelope": {
            "attack": 0.002,
            "hold": 0,
            "decay": 0.05
          },
          "pitchVar": 0.03,
          "durVar": 0.05,
          "volVar": 0.2,
          "count": 2,
          "spacing": 0.09,
          "spacingVar": 0.05,
          "countDecay": 0,
          "chance": 1,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "sonar_ping_3",
      "description": "Sonar Pulse lock level 3 / full lock (4-pip + sub)",
      "category": "TRACKER",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            1480,
            2220
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.08,
          "dur": 0.055,
          "rampTime": 0.055,
          "startOffset": 0,
          "envelope": {
            "attack": 0.002,
            "hold": 0,
            "decay": 0.05
          },
          "pitchVar": 0.03,
          "durVar": 0.05,
          "volVar": 0.2,
          "count": 4,
          "spacing": 0.055,
          "spacingVar": 0.05,
          "countDecay": 0,
          "chance": 1,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            70,
            90
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.06,
          "dur": 0.12,
          "rampTime": 0.12,
          "startOffset": 0,
          "envelope": {
            "attack": 0.003,
            "hold": 0,
            "decay": 0.1
          },
          "pitchVar": 0,
          "durVar": 0,
          "volVar": 0,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "salvo_core_burst",
      "description": "four staggered missile launches over 0.3 s (Mega Tracker Rockets, with duck)",
      "category": "TRACKER",
      "layers": [
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            50,
            63
          ],
          "rampFreqs": [
            150,
            190
          ],
          "vol": 1,
          "dur": 0.605,
          "rampTime": 0.22,
          "startOffset": 0,
          "envelope": {
            "attack": 0.008,
            "hold": 0.04,
            "decay": 0.555
          },
          "pitchVar": 0.14,
          "durVar": 0.09,
          "volVar": 0.09,
          "count": 12,
          "spacing": 0.08,
          "spacingVar": 1,
          "countDecay": 0,
          "chance": 1,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.8,
          "volume": 0.24,
          "startOffset": 0,
          "filterFreq": 700,
          "filterQ": 0.8,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.25,
          "varFreq": 0.25,
          "count": 12,
          "spacing": 0.08,
          "spacingVar": 0,
          "chance": 1,
          "countDecay": 0.19,
          "peakGain": 0,
          "reverseEnvelope": true
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "fire_minigun",
      "description": "rapid-fire chatter grain (per-tick)",
      "category": "BLASTER",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.04,
          "volume": 0.055,
          "startOffset": 0,
          "filterFreq": 2545,
          "filterQ": 0.9,
          "filterType": "peaking",
          "varDur": 0.25,
          "varVol": 0.3,
          "varFreq": 0.35,
          "count": 3,
          "spacing": 0.012,
          "spacingVar": 0.4,
          "countDecay": 0.1,
          "chance": 1,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            33,
            43,
            66
          ],
          "rampFreqs": [
            220,
            164,
            147
          ],
          "vol": 0.2,
          "dur": 0.2,
          "rampTime": 0.15,
          "startOffset": 0,
          "envelope": {
            "attack": 0.003,
            "hold": 0,
            "decay": 0.2
          },
          "pitchVar": 0.1,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "powershot_charge",
      "description": "Blaster Charge Shot, 1 s aggressive build to auto-fire",
      "category": "BLASTER",
      "layers": [
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            47,
            50,
            53
          ],
          "rampFreqs": [
            316,
            320,
            324
          ],
          "vol": 0.2,
          "dur": 1.07,
          "rampTime": 0.985,
          "startOffset": 0,
          "envelope": {
            "attack": 0.04,
            "hold": 0.635,
            "decay": 0.005
          },
          "pitchVar": 0,
          "durVar": 0,
          "volVar": 0,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "power_shot_release",
      "description": "meaty cannon BOOM after the charge (Charge Shot release, with duck)",
      "category": "BLASTER",
      "layers": [
        {
          "kind": "noise",
          "duration": 0.06,
          "volume": 0.3,
          "startOffset": 0,
          "filterFreq": 2400,
          "filterQ": 3,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.15,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sawtooth",
          "freqs": [
            100,
            243
          ],
          "rampFreqs": [
            110,
            165
          ],
          "vol": 0.625,
          "dur": 0.635,
          "rampTime": 0.215,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.14
          },
          "pitchVar": 0.06,
          "durVar": 0.12,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.905,
          "volume": 1,
          "startOffset": 0.02,
          "filterFreq": 60,
          "filterQ": 0.4,
          "filterType": "lowpass",
          "varDur": 0.15,
          "varVol": 0.1,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            45,
            67,
            90
          ],
          "rampFreqs": [
            35,
            55,
            75
          ],
          "vol": 0.865,
          "dur": 0.45,
          "rampTime": 0.4,
          "startOffset": 0.04,
          "envelope": {
            "attack": 0.001,
            "hold": 0.05,
            "decay": 0.4
          },
          "pitchVar": 0.06,
          "durVar": 0.15,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "mode_switch",
      "description": "two clean mechanical clicks : Blaster cannon close/long flip",
      "category": "BLASTER",
      "layers": [
        {
          "kind": "tri",
          "wave": "square",
          "freqs": [
            880,
            1320
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.1,
          "dur": 0.04,
          "rampTime": 0,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.04
          },
          "pitchVar": 0.06,
          "durVar": 0.2,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.03,
          "volume": 0.1,
          "startOffset": 0,
          "filterFreq": 2400,
          "filterQ": 2.5,
          "filterType": "lowpass",
          "varDur": 0.25,
          "varVol": 0.25,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "square",
          "freqs": [
            660,
            990
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.1,
          "dur": 0.05,
          "rampTime": 0,
          "startOffset": 0.1,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.05
          },
          "pitchVar": 0.06,
          "durVar": 0.2,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.03,
          "volume": 0.08,
          "startOffset": 0.1,
          "filterFreq": 1800,
          "filterQ": 2,
          "filterType": "lowpass",
          "varDur": 0.25,
          "varVol": 0.25,
          "varFreq": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "rocket_salvo",
      "description": "Syphon Rocket Salvo : 5 staggered rocket launches over 0.35 s",
      "category": "SYPHON",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [70, 85],
          "rampFreqs": [200, 240],
          "vol": 0.7,
          "dur": 0.22,
          "rampTime": 0.18,
          "startOffset": 0,
          "envelope": { "attack": 0.006, "hold": 0.04, "decay": 0.2 },
          "pitchVar": 0.08,
          "durVar": 0.15,
          "volVar": 0.18,
          "count": 5,
          "spacing": 0.07,
          "spacingVar": 0.02,
          "countDecay": 0,
          "chance": 1,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.16,
          "volume": 1,
          "startOffset": 0,
          "filterFreq": 95,
          "filterQ": 0.7,
          "filterType": "bandpass",
          "varDur": 0.2,
          "varVol": 0.25,
          "varFreq": 0.25,
          "count": 5,
          "spacing": 0.07,
          "spacingVar": 0.02,
          "chance": 1,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [0, 0, 453],
          "rampFreqs": [0, 0, 32],
          "vol": 0.195,
          "dur": 1.455,
          "rampTime": 1.8,
          "startOffset": 0.175,
          "envelope": { "attack": 0.284, "hold": 0.367, "decay": 0.2 },
          "pitchVar": 0.1,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 5,
          "spacing": 0.025
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "siphon_drain",
      "description": "shimmery upper-mid pluck : Energy Syphon drain (loops 0.18 s)",
      "category": "SYPHON",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            727,
            447
          ],
          "rampFreqs": [
            538,
            727
          ],
          "vol": 0.04,
          "dur": 1.24,
          "rampTime": 0.805,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.14
          },
          "pitchVar": 0.06,
          "durVar": 0.2,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        }
      ],
      "recipeGain": 1.24
    },
    {
      "name": "siphon_hit",
      "description": "descending blip + reverse-cymbal swell : Energy Syphon lands",
      "category": "SYPHON",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            660,
            880,
            1100
          ],
          "rampFreqs": [
            220,
            330,
            440
          ],
          "vol": 0.18,
          "dur": 0.2,
          "rampTime": 0.18,
          "startOffset": 0,
          "envelope": {
            "attack": 0.002,
            "hold": 0,
            "decay": 0.18
          },
          "pitchVar": 0.1,
          "durVar": 0.15,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.1,
          "volume": 0.08,
          "startOffset": 0,
          "filterFreq": 2200,
          "filterQ": 2,
          "filterType": "lowpass",
          "varDur": 0.25,
          "varVol": 0.25,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "rearm_reset",
      "description": "three rapid rising beeps + resolve chord : Inner Spark capacitor dump",
      "category": "SYPHON",
      "layers": [
        {
          "kind": "tri",
          "wave": "square",
          "freqs": [
            440
          ],
          "rampFreqs": [
            0
          ],
          "vol": 0.08,
          "dur": 0.06,
          "rampTime": 0,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.05
          },
          "pitchVar": 0.06,
          "durVar": 0,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "square",
          "freqs": [
            660
          ],
          "rampFreqs": [
            0
          ],
          "vol": 0.08,
          "dur": 0.06,
          "rampTime": 0,
          "startOffset": 0.06,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.05
          },
          "pitchVar": 0.06,
          "durVar": 0,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "square",
          "freqs": [
            880
          ],
          "rampFreqs": [
            0
          ],
          "vol": 0.1,
          "dur": 0.06,
          "rampTime": 0,
          "startOffset": 0.12,
          "envelope": {
            "attack": 0.001,
            "hold": 0,
            "decay": 0.05
          },
          "pitchVar": 0.06,
          "durVar": 0,
          "volVar": 0.2,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            440,
            660,
            880
          ],
          "rampFreqs": [
            0,
            0,
            0
          ],
          "vol": 0.18,
          "dur": 0.3,
          "rampTime": 0,
          "startOffset": 0.2,
          "envelope": {
            "attack": 0.005,
            "hold": 0.05,
            "decay": 0.25
          },
          "pitchVar": 0.06,
          "durVar": 0,
          "volVar": 0.15,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.18,
          "volume": 0.06,
          "startOffset": 0.2,
          "filterFreq": 1800,
          "filterQ": 2,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.25,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    },
    {
      "name": "upgrade_core",
      "description": "three rising chimes + confident downbeat (Syphon tier acquired)",
      "category": "SYPHON",
      "layers": [
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            440,
            660
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.18,
          "dur": 0.1,
          "rampTime": 0,
          "startOffset": 0,
          "envelope": {
            "attack": 0.001,
            "hold": 0.01,
            "decay": 0.1
          },
          "pitchVar": 0.04,
          "durVar": 0.12,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            587,
            880
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.18,
          "dur": 0.1,
          "rampTime": 0,
          "startOffset": 0.1,
          "envelope": {
            "attack": 0.001,
            "hold": 0.01,
            "decay": 0.1
          },
          "pitchVar": 0.04,
          "durVar": 0.12,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "sine",
          "freqs": [
            784,
            1100
          ],
          "rampFreqs": [
            0,
            0
          ],
          "vol": 0.2,
          "dur": 0.12,
          "rampTime": 0,
          "startOffset": 0.2,
          "envelope": {
            "attack": 0.001,
            "hold": 0.01,
            "decay": 0.12
          },
          "pitchVar": 0.04,
          "durVar": 0.12,
          "volVar": 0.12,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "tri",
          "wave": "triangle",
          "freqs": [
            165,
            220,
            330
          ],
          "rampFreqs": [
            365,
            427,
            549
          ],
          "vol": 0.3,
          "dur": 0.45,
          "rampTime": 0.4,
          "startOffset": 0.32,
          "envelope": {
            "attack": 0.005,
            "hold": 0.08,
            "decay": 0.4
          },
          "pitchVar": 0.04,
          "durVar": 0.1,
          "volVar": 0.1,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "wavePool": [],
          "pitchPool": [],
          "pitchPick": "perVoice"
        },
        {
          "kind": "noise",
          "duration": 0.12,
          "volume": 0.1,
          "startOffset": 0.32,
          "filterFreq": 2400,
          "filterQ": 2,
          "filterType": "lowpass",
          "varDur": 0.2,
          "varVol": 0.2,
          "varFreq": 0.25,
          "chance": 1,
          "count": 1,
          "spacing": 0,
          "spacingVar": 0,
          "countDecay": 0,
          "peakGain": 0,
          "reverseEnvelope": false
        }
      ],
      "recipeGain": 1
    }
  ]
};

// ============================================================================
// SECTION 3b : Persisted recipe loader + tickSoundLoop + railgun charge synth
// ============================================================================
// (v11b) Puncture railgun charge synth. The lab-recipe path plays the
// charge as a fire-and-forget 2.5 s sound, so when a player tap-released
// the alt-fire the audio kept ramping up to peak pitch while the charge
// meter was already decaying â€” the sound and the visual charge fell out
// of sync. This synth builds the same recipe (3 sine voices, 69/63/60 Hz
// ramping to 690/630/600 Hz over 2.495 s, attack 0.228 / hold 2.0 / decay
// 2.235) directly with oscillator nodes so we can hold a stop handle and
// cut it off when the player releases the trigger or fires.
function _startRailgunChargeSound() {
  if (!audio || !audio.initialized || !audio.ctx) return null;
  resumeAudio();
  const ctx = audio.ctx;
  const now = ctx.currentTime;
  const dur      = 2.5;
  const rampTime = 2.495;
  const attack   = 0.228;
  const hold     = 2.0;
  const decay    = 2.235;
  const finalVol = 0.415 * 0.39;          // recipe vol * recipeGain
  const freqStart = [69, 63, 60];
  const freqEnd   = [690, 630, 600];
  const spacing   = 0.035;
  const oscs  = [];
  const gains = [];
  const dest = audio.sfxBus || audio.masterGain || ctx.destination;
  for (let i = 0; i < 3; i++) {
    const t0 = now + i * spacing;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqStart[i], t0);
    osc.frequency.linearRampToValueAtTime(freqEnd[i], t0 + rampTime);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(finalVol, t0 + attack);
    g.gain.setValueAtTime(finalVol, t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + attack + hold + decay + 0.05);
    oscs.push(osc);
    gains.push(g);
  }
  return { oscs, gains, startTime: now };
}

function _stopRailgunChargeSound(handle) {
  if (!handle || !audio || !audio.ctx) return;
  const ctx = audio.ctx;
  const now = ctx.currentTime;
  // Quick fade to zero so the cutoff doesn't click. Then hard-stop the
  // oscillators ~80 ms later.
  for (const g of handle.gains) {
    try {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    } catch (_) {}
  }
  for (const o of handle.oscs) {
    try { o.stop(now + 0.10); } catch (_) {}
  }
}

if (typeof window !== 'undefined') {
  window._startRailgunChargeSound = _startRailgunChargeSound;
  window._stopRailgunChargeSound  = _stopRailgunChargeSound;
}

// (v6.9) Sound loop ticker. Re-triggers a sound at a fixed interval as
// long as it's called every frame. Used by held shields (Vortex / Gun /
// Plasma Shield / Thermal) and persistent fire effects (firewall /
// incendiary trap / gas cloud / Mega Flame Chain) so a continuous source reads
// as a sustained hum/roar without needing a streaming-buffer playback path.
//
//   _tickSoundLoop(player, '_vortexShieldHumTimer', dt, 0.95, 'shield_hum');
//
// host stores the timer state; pick a unique stateKey per source so two
// hums on the same host don't fight. interval should match (or slightly
// undercut) the recipe's duration so successive triggers crossfade.
function _tickSoundLoop(host, stateKey, dt, interval, soundType) {
  if (!host) return;
  if (host[stateKey] == null) host[stateKey] = 0;
  host[stateKey] -= dt;
  if (host[stateKey] <= 0) {
    try { playSound(soundType); } catch (e) {}
    host[stateKey] = interval;
  }
}


// Boot-time restore: pull the persisted library from localStorage. Called
// once at module init ; safe to call before audio.ctx exists because we
// just attach the recipes dict, no audio nodes built here.
function _loadPersistedSoundRecipes() {
  try {
    const raw = localStorage.getItem('lss_sound_recipes');
    if (!raw) {
      // First-run / cleared-storage seed: fall back to the baked-in factory
      // defaults (DEFAULT_SOUND_LIBRARY, embedded above from LSS_SOUND.json).
      // Persist them back to localStorage so the import-status row picks up
      // the count and so subsequent runs hit the normal path below. User
      // edits via the Sound Lab persist over this seed.
      try {
        if (DEFAULT_SOUND_LIBRARY && Array.isArray(DEFAULT_SOUND_LIBRARY.recipes)) {
          const map = {};
          for (const r of DEFAULT_SOUND_LIBRARY.recipes) {
            if (r && r.name && Array.isArray(r.layers)) map[r.name] = r;
          }
          if (Object.keys(map).length) {
            audio.labRecipes = map;
            try {
              localStorage.setItem('lss_sound_recipes', JSON.stringify(DEFAULT_SOUND_LIBRARY));
            } catch(e) {}
          }
        }
      } catch(e) {}
      return;
    }
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.recipes)) {
      // Sanitize EVERY recipe in-place: walk each layer's wave + wavePool
      // through _safeOscType so a stale localStorage import (e.g., the
      // pre-fix v6_9 build that shipped 'sin' in fire_hitscan's wavePool)
      // gets corrected at load time. Any change re-persists, so the bad
      // value is gone for good after the first load. This is belt and
      // suspenders: triChord also normalizes at the oscillator boundary.
      let sanitized = false;
      for (const r of parsed.recipes) {
        if (!r || !Array.isArray(r.layers)) continue;
        for (const layer of r.layers) {
          if (layer.kind !== 'tri') continue;
          if (typeof layer.wave === 'string') {
            const fixed = _safeOscType(layer.wave);
            if (fixed !== layer.wave) { layer.wave = fixed; sanitized = true; }
          }
          if (Array.isArray(layer.wavePool)) {
            for (let i = 0; i < layer.wavePool.length; i++) {
              const fixed = _safeOscType(layer.wavePool[i]);
              if (fixed !== layer.wavePool[i]) { layer.wavePool[i] = fixed; sanitized = true; }
            }
          }
        }
      }
      const map = {};
      for (const r of parsed.recipes) {
        if (r && r.name && Array.isArray(r.layers)) map[r.name] = r;
      }
      if (Object.keys(map).length) audio.labRecipes = map;
      // Persist the cleaned copy so this is a one-shot migration.
      if (sanitized) {
        try { localStorage.setItem('lss_sound_recipes', JSON.stringify(parsed)); } catch(e) {}
      }
    }
  } catch(e) {}
}
_loadPersistedSoundRecipes();

// ============================================================================
// SECTION 4 : playSound + playSpatialSound (HRTF + 5.1)
//   Rate-limit table, voice budget, stress flag, playSound, _playSpatialSoundHRTF,
//   _playSpatialSound51 (VBAP), playSpatialSound dispatcher
// ============================================================================
// Per-type minimum gap (seconds) between successive playSound() calls.
// Sustained heavy fire (Predator at 20 Hz + bot return fire + hits + damage
// sounds) was overloading Chrome's audio thread and dropping a buffer
// (audible as a 1-2s cutout). Capping the spawn rate of high-rate sounds
// to slightly above their natural fire rate lets every shot through in
// the common case but folds duplicate stacking from multiple sources
// (other players' minigun streams, multi-pellet hits) into a single
// audible event. Gaps are picked per-type so the rate-limit is invisible
// during normal play.
const _SOUND_MIN_GAP = {
  // Weapon fire: cap a hair below each weapon's natural fire rate so the
  // local player's stream always passes ; concurrent enemy streams get
  // folded into the same audible burst instead of doubling the load.
  fire_minigun:    0.040, // 25 Hz cap (Predator fires 20 Hz)
  fire_hitscan:    0.045, // 22 Hz cap (Blaster long mode 12.5 Hz, Syphon 11 Hz)
  fire_spread:     0.080, // 12 Hz cap (shotgun-class)
  fire_projectile: 0.080,
  fire_railgun:    0.060,
  fire_salvo:      0.080,
  // Hits / damage / shields can pile up when pellets land or shields chip;
  // 25-40 Hz is plenty to feel responsive without thrashing.
  hit:             0.025,
  damage:          0.040,
  damage_shield:   0.040,
};
const _lastSoundTime = {};

// (v8VR 2026-05-01) Global active-voice budget. Each playSound call is
// estimated at ~5-10 oscillator/buffer-source nodes; under heavy combat
// (multi-ship gunfights + Pyro flames + impact sparks) the audio thread
// can underrun and cause audible dropouts. Track active voices by
// counting recent playSound dispatches in a sliding window; skip the
// cheapest sounds when over budget.
// (v15 backport 2026-05-10) Tighter voice budget : the previous 24/0.6s
// allowed up to 40 voices/sec, and combined with chorus + 3 convolution
// reverbs, audio thread CPU could run out during heavy combat while
// recording. Drop to 16 voices per 0.4s window.
const _AUDIO_VOICE_BUDGET = 16;
const _AUDIO_VOICE_WINDOW = 0.4;
const _audioRecentVoices = [];           // ctx-time stamps of recent plays
// (v15 2026-05-10 stress system) When the budget is 70%+ full, the audio
// thread is under sustained load. Downstream synth code (triChord,
// _runLabNoiseLayer) checks this flag and degrades gracefully : skip
// chorus oscillator (halves voice oscillator count), skip reverb send
// (removes convolution input). The sound still plays ; it just doesn't
// add expensive partners. This recovers headroom during peaks so the
// audio thread doesn't underrun under recording CPU load.
let _audioStressed = false;
const _AUDIO_STRESS_RATIO = 0.7;
// Sounds that are OK to skip when over budget (cosmetic, replaceable).
// Critical sounds (death, round_start, ability) always pass through.
// (v15 backport 2026-05-10) Expanded skippable list so the budget has
// more to drop without killing critical feedback.
const _AUDIO_SKIPPABLE = {
  fire_hitscan: 1, fire_minigun: 1, fire_spread: 1, fire_projectile: 1,
  fire_railgun: 1, fire_salvo: 1, fire_burn: 1,
  hit: 1, damage: 1, damage_shield: 1,
  shield_hum: 1, fire_shield_hum: 1,
  rocket_salvo: 1, tracker_rockets: 1, sonar_pulse: 1,
  fire_arc_wave: 1, fire_buckshot: 1, fire_leadwall: 1,
  laser_core: 1, blaster_power: 1, plasma_railgun: 1,
};

function playSound(type) {
  if (!audio.initialized || !audio.ctx) return;
  resumeAudio();
  const _ctxT = audio.ctx.currentTime;
  // Sliding-window voice budget: drop oldest stamps that fell out the back.
  while (_audioRecentVoices.length && (_ctxT - _audioRecentVoices[0]) > _AUDIO_VOICE_WINDOW) {
    _audioRecentVoices.shift();
  }
  // Over-budget skip for cosmetic sounds. Critical SFX always play.
  if (_audioRecentVoices.length >= _AUDIO_VOICE_BUDGET && _AUDIO_SKIPPABLE[type]) {
    return;
  }
  _audioRecentVoices.push(_ctxT);
  // (v15 stress system) Update the stress flag for downstream synth code
  // to read. Sticky : once we cross the threshold, stays on until budget
  // drops well below. Hysteresis avoids rapid flapping during borderline
  // load. Threshold set so normal combat (~10 voices/0.4s) stays unstressed
  // while sustained heavy fire (~12+/0.4s) triggers degradation.
  const stressOn  = _AUDIO_VOICE_BUDGET * _AUDIO_STRESS_RATIO;       // ~11
  const stressOff = _AUDIO_VOICE_BUDGET * (_AUDIO_STRESS_RATIO - 0.2); // ~8
  // (v16a Potato) Pin _audioStressed = true regardless of voice budget. The
  // stress system already gates convolver-reverb sends (line ~46365) and
  // chorus oscillators ; in Potato we want those off all the time, not just
  // during heavy fights. Convolution against a 2.4s impulse response on every
  // SFX is the most expensive single thing in the audio graph ; skipping the
  // send fixes the bulk of the audio-thread CPU load.
  if (typeof QUALITY !== 'undefined' && QUALITY.isPotato && QUALITY.isPotato()) {
    _audioStressed = true;
  } else if (!_audioStressed && _audioRecentVoices.length >= stressOn) _audioStressed = true;
  else if (_audioStressed && _audioRecentVoices.length <= stressOff) _audioStressed = false;
  // Rate-limit per type. ctx.currentTime is monotonic and tracks audio-thread
  // time, which is what we actually want here (real time can drift if the
  // tab loses focus).
  const gap = _SOUND_MIN_GAP[type];
  if (gap) {
    const t = audio.ctx.currentTime;
    const last = _lastSoundTime[type] || 0;
    if (t - last < gap) return;
    _lastSoundTime[type] = t;
  }
  // (v14g) Recipe lookup is the sole audio path. DEFAULT_SOUND_LIBRARY is
  // always seeded into audio.labRecipes on boot ; if a recipe lookup somehow
  // misses, the call is a silent no-op (the legacy hardcoded synth fallback
  // that lived here through v14f was deleted in v14g once the lab covered
  // every type).
  _playSoundFromLabRecipe(type);
}

// ---- HRTF spatial playback wrapper ----
// Wraps playSound so its dry tap is routed through a per-call PannerNode positioned
// relative to the camera. Ambient bed stays unspatialized (bypasses sfxBus entirely).
// Reverb tap goes to the shared convolver so every spatial source shares room tone.
// A BiquadFilter sits between panner and sfxBus: if the line from camera to source
// passes through level geometry, cutoff drops so high frequencies attenuate (occlusion).
const _spatialRelPos = new THREE.Vector3();
const _spatialInvQuat = new THREE.Quaternion();
const _spatialCamPos = new THREE.Vector3();
const _spatialDir = new THREE.Vector3();
const _spatialRaycaster = new THREE.Raycaster();
_spatialRaycaster.firstHitOnly = true;
// Pool of { panner, occl, occlGain } triples. Each call to playSpatialSound
// acquires a triple, uses it for ~4s, then releases it back. Nodes are reset on
// release (cancelScheduledValues + disconnect) so they come back to acquire()
// in a known-clean state. Keeps GC steady under rapid fire (minigun, salvos).
const _spatialPool = [];
const _SPATIAL_POOL_MAX = 32;
function _acquireSpatialTriple(ctx) {
  if (_spatialPool.length) return _spatialPool.pop();
  return {
    panner: ctx.createPanner(),
    occl: ctx.createBiquadFilter(),
    occlGain: ctx.createGain(),
  };
}
function _releaseSpatialTriple(triple) {
  if (!triple) return;
  const { panner, occl, occlGain } = triple;
  try { panner.disconnect(); } catch (e) {}
  try { occl.disconnect(); } catch (e) {}
  try { occlGain.disconnect(); } catch (e) {}
  // Clear any pending automation so a reused node doesn't inherit stale values.
  const now = (audio && audio.ctx) ? audio.ctx.currentTime : 0;
  try { panner.positionX.cancelScheduledValues(now); } catch (e) {}
  try { panner.positionY.cancelScheduledValues(now); } catch (e) {}
  try { panner.positionZ.cancelScheduledValues(now); } catch (e) {}
  try { occl.frequency.cancelScheduledValues(now); } catch (e) {}
  try { occl.Q.cancelScheduledValues(now); } catch (e) {}
  try { occlGain.gain.cancelScheduledValues(now); } catch (e) {}
  if (_spatialPool.length < _SPATIAL_POOL_MAX) _spatialPool.push(triple);
}
// (v8_2a) HRTF body renamed to _playSpatialSoundHRTF; the public
// playSpatialSound below dispatches between this (stereo / headphones)
// and _playSpatialSound51 (real 5.1 surround output).
function _playSpatialSoundHRTF(type, worldPos, opts) {
  if (!audio.initialized || !audio.ctx) return;
  if (!worldPos || !camera) return playSound(type);
  const triple = _acquireSpatialTriple(audio.ctx);
  const { panner, occl, occlGain } = triple;
  try {
    // (v16a Potato) HRTF panning convolves every sample against a head-related
    // impulse response per active voice ; equalpower is just two gain factors.
    // 10-100x cheaper per voice on the audio thread. Lose precise 3D
    // localization, keep L/R stereo placement.
    panner.panningModel = (typeof QUALITY !== 'undefined' && QUALITY.isPotato && QUALITY.isPotato()) ? 'equalpower' : 'HRTF';
    panner.distanceModel = 'inverse';
    // Optional range override: some sounds (titan core activation) should carry farther.
    // refDistance = how close before attenuation begins; higher = louder at distance.
    // rolloffFactor < 1 = slower falloff with distance.
    panner.refDistance = (opts && opts.refDistance) || 250;
    panner.maxDistance = (opts && opts.maxDistance) || 8000;
    panner.rolloffFactor = (opts && opts.rolloffFactor) || 1.0;
    // Compute listener-relative position (camera at origin, looking -Z in local space).
    camera.getWorldPosition(_spatialCamPos);
    _spatialRelPos.subVectors(worldPos, _spatialCamPos);
    const distToSource = _spatialRelPos.length();
    _spatialInvQuat.copy(camera.quaternion).invert();
    _spatialRelPos.applyQuaternion(_spatialInvQuat);
    const t = audio.ctx.currentTime;
    // Web Audio listener looks down -Z by default; Three.js camera looks down -Z; after
    // inverse-camera-rotation our local -Z matches the listener's forward.
    panner.positionX.setValueAtTime(_spatialRelPos.x, t);
    panner.positionY.setValueAtTime(_spatialRelPos.y, t);
    panner.positionZ.setValueAtTime(_spatialRelPos.z, t);
    // Occlusion lowpass: raycast camera -> source against level meshes. If occluded,
    // drop cutoff so high freqs get eaten by the wall. Also drop gain slightly.
    occl.type = 'lowpass';
    let cutoff = 18000;
    let occludedGain = 1.0;
    // (v16a Potato) Skip the per-voice raycast against game.mapMeshes (often
    // 30+ wall meshes). During dense fire this runs hundreds of times per
    // second on the main thread, blocking the render frame. Cutoff stays at
    // 18 kHz and gain stays at 1.0 ; you can hear sounds through walls, which
    // is the same trade-off any plain stereo mixer makes.
    const _potatoSkipOcclusion = (typeof QUALITY !== 'undefined' && QUALITY.isPotato && QUALITY.isPotato());
    if (!_potatoSkipOcclusion && distToSource > 1 && game && game.mapMeshes && game.mapMeshes.length) {
      _spatialDir.subVectors(worldPos, _spatialCamPos).normalize();
      _spatialRaycaster.set(_spatialCamPos, _spatialDir);
      _spatialRaycaster.near = 0;
      _spatialRaycaster.far = distToSource * 0.99;
      const hits = _spatialRaycaster.intersectObjects(game.mapMeshes, false);
      if (hits && hits.length) {
        // A hit between listener and source = occluded. Shorter path inside geometry
        // = thinner wall = less attenuation. Use ray distance ratio as a rough proxy.
        const h = hits[0];
        const penetration = distToSource - h.distance;
        // 100 u = thin wall, 1000+ u = deep occlusion
        const wallDepth = Math.min(1.0, penetration / 600);
        cutoff = 2400 - 1500 * wallDepth; // 2400 Hz thin, ~900 Hz deep
        occludedGain = 0.55 - 0.20 * wallDepth; // -5 dB thin, -9 dB deep
      }
    }
    occl.frequency.setValueAtTime(cutoff, t);
    occl.Q.setValueAtTime(0.707, t);
    occlGain.gain.setValueAtTime(occludedGain, t);
    panner.connect(occl);
    occl.connect(occlGain);
    occlGain.connect(audio.sfxBus || audio.masterGain);
    audio._spatialSink = panner;
    playSound(type);
    audio._spatialSink = null;
    // Return to pool after the sound tail has played out. 4s is well past the
    // longest sfx envelope; keeps the pool saturated under rapid fire.
    setTimeout(() => { _releaseSpatialTriple(triple); }, 4000);
  } catch (e) {
    audio._spatialSink = null;
    _releaseSpatialTriple(triple);
    playSound(type);
  }
}

// ============================================================
// === v8_2a: 5.1 surround spatial path (real per-speaker) ====
// ============================================================
// On systems with maxChannelCount >= 6 the public playSpatialSound
// dispatches into _playSpatialSound51 below. VBAP (vector base
// amplitude panning) computes per-speaker gains from listener-local
// azimuth, sums them via ChannelMerger(6), and feeds the parallel
// spatial51Bus chain set up in initAudio. Cheaper per-voice than
// HRTF and actually drives the rear/center/sub speakers.

// 5.1 'speakers' channel index map (Web Audio):
//   0 FL, 1 FR, 2 C, 3 LFE, 4 SL, 5 SR
const _SPK51_FL  = 0;
const _SPK51_FR  = 1;
const _SPK51_C   = 2;
const _SPK51_LFE = 3;
const _SPK51_SL  = 4;
const _SPK51_SR  = 5;

// Speaker azimuth in radians (counter-clockwise from forward, left positive).
const _SPK51_AZ_FL = ( 30 * Math.PI) / 180;
const _SPK51_AZ_FR = (-30 * Math.PI) / 180;
const _SPK51_AZ_SL = (110 * Math.PI) / 180;
const _SPK51_AZ_SR = (-110 * Math.PI) / 180;

// Pool of 5.1 panner triples: 9 nodes per voice (occl filter, LFE
// crossover, 6 per-speaker gains, 1 channel merger).
const _spatial51Pool = [];
const _SPATIAL51_POOL_MAX = 32;
function _acquireSpatial51(ctx) {
  if (_spatial51Pool.length) return _spatial51Pool.pop();
  return {
    occl:   ctx.createBiquadFilter(),
    lpfLFE: ctx.createBiquadFilter(),
    gFL:    ctx.createGain(),
    gFR:    ctx.createGain(),
    gC:     ctx.createGain(),
    gLFE:   ctx.createGain(),
    gSL:    ctx.createGain(),
    gSR:    ctx.createGain(),
    merger: ctx.createChannelMerger(6),
  };
}
function _releaseSpatial51(triple) {
  if (!triple) return;
  const now = (audio && audio.ctx) ? audio.ctx.currentTime : 0;
  for (const k in triple) {
    const n = triple[k];
    try { n.disconnect(); } catch (_) {}
    if (n && n.gain && n.gain.cancelScheduledValues) {
      try { n.gain.cancelScheduledValues(now); } catch (_) {}
    }
    if (n && n.frequency && n.frequency.cancelScheduledValues) {
      try { n.frequency.cancelScheduledValues(now); } catch (_) {}
    }
    if (n && n.Q && n.Q.cancelScheduledValues) {
      try { n.Q.cancelScheduledValues(now); } catch (_) {}
    }
  }
  if (_spatial51Pool.length < _SPATIAL51_POOL_MAX) _spatial51Pool.push(triple);
}

// Constant-power VBAP for 5.1. Source azimuth in radians (counter-
// clockwise from forward). Returns { fl, fr, c, sl, sr } in [0, 1].
// No rear-center speaker; back zone splits between SL and SR at half
// power so directly behind the listener reads as a wide rear pair.
function _vbap51(azRad) {
  let az = azRad;
  while (az >  Math.PI) az -= 2 * Math.PI;
  while (az < -Math.PI) az += 2 * Math.PI;
  let fl = 0, fr = 0, c = 0, sl = 0, sr = 0;
  if (az >= 0) {
    if (az <= _SPK51_AZ_FL) {
      const t = az / _SPK51_AZ_FL;
      c  = Math.cos(t * Math.PI / 2);
      fl = Math.sin(t * Math.PI / 2);
    } else if (az <= _SPK51_AZ_SL) {
      const t = (az - _SPK51_AZ_FL) / (_SPK51_AZ_SL - _SPK51_AZ_FL);
      fl = Math.cos(t * Math.PI / 2);
      sl = Math.sin(t * Math.PI / 2);
    } else {
      const t = (az - _SPK51_AZ_SL) / (Math.PI - _SPK51_AZ_SL);
      sl = Math.cos(t * Math.PI / 4);
      sr = Math.sin(t * Math.PI / 4);
    }
  } else {
    if (az >= _SPK51_AZ_FR) {
      const t = az / _SPK51_AZ_FR;
      c  = Math.cos(t * Math.PI / 2);
      fr = Math.sin(t * Math.PI / 2);
    } else if (az >= _SPK51_AZ_SR) {
      const t = (az - _SPK51_AZ_FR) / (_SPK51_AZ_SR - _SPK51_AZ_FR);
      fr = Math.cos(t * Math.PI / 2);
      sr = Math.sin(t * Math.PI / 2);
    } else {
      const t = (az - _SPK51_AZ_SR) / (-Math.PI - _SPK51_AZ_SR);
      sr = Math.cos(t * Math.PI / 4);
      sl = Math.sin(t * Math.PI / 4);
    }
  }
  return { fl, fr, c, sl, sr };
}

function _playSpatialSound51(type, worldPos, opts) {
  if (!audio.initialized || !audio.ctx) return;
  if (!worldPos || !camera) return playSound(type);
  if (!audio.spatial51Bus) return _playSpatialSoundHRTF(type, worldPos, opts);
  const triple = _acquireSpatial51(audio.ctx);
  const { occl, lpfLFE, gFL, gFR, gC, gLFE, gSL, gSR, merger } = triple;
  try {
    camera.getWorldPosition(_spatialCamPos);
    _spatialRelPos.subVectors(worldPos, _spatialCamPos);
    const distToSource = _spatialRelPos.length();
    _spatialInvQuat.copy(camera.quaternion).invert();
    _spatialRelPos.applyQuaternion(_spatialInvQuat);
    // camera-local: -Z forward, +X right; az = atan2(-x, -z) so left is positive.
    const az = Math.atan2(-_spatialRelPos.x, -_spatialRelPos.z);

    const refDist = (opts && opts.refDistance)  || 250;
    const maxDist = (opts && opts.maxDistance)  || 8000;
    const rolloff = (opts && opts.rolloffFactor) || 1.0;
    let distGain;
    if (distToSource <= refDist) distGain = 1.0;
    else if (distToSource >= maxDist) distGain = 0.0;
    else distGain = refDist / (refDist + rolloff * (distToSource - refDist));

    const pan = _vbap51(az);
    const _cScale = 0.85;
    const _lfeScale = 0.35;

    occl.type = 'lowpass';
    let cutoff = 18000;
    let occludedGain = 1.0;
    if (distToSource > 1 && game && game.mapMeshes && game.mapMeshes.length) {
      _spatialDir.subVectors(worldPos, _spatialCamPos).normalize();
      _spatialRaycaster.set(_spatialCamPos, _spatialDir);
      _spatialRaycaster.near = 0;
      _spatialRaycaster.far = distToSource * 0.99;
      const hits = _spatialRaycaster.intersectObjects(game.mapMeshes, false);
      if (hits && hits.length) {
        const h = hits[0];
        const penetration = distToSource - h.distance;
        const wallDepth = Math.min(1.0, penetration / 600);
        cutoff = 2400 - 1500 * wallDepth;
        occludedGain = 0.55 - 0.20 * wallDepth;
      }
    }
    const t = audio.ctx.currentTime;
    occl.frequency.setValueAtTime(cutoff, t);
    occl.Q.setValueAtTime(0.707, t);

    const g = distGain * occludedGain;
    gFL.gain.setValueAtTime(pan.fl * g,           t);
    gFR.gain.setValueAtTime(pan.fr * g,           t);
    gC .gain.setValueAtTime(pan.c  * g * _cScale, t);
    gSL.gain.setValueAtTime(pan.sl * g,           t);
    gSR.gain.setValueAtTime(pan.sr * g,           t);
    gLFE.gain.setValueAtTime(g * _lfeScale,       t);

    lpfLFE.type = 'lowpass';
    lpfLFE.frequency.setValueAtTime(80, t);
    lpfLFE.Q.setValueAtTime(0.707, t);

    occl.connect(gFL);    gFL .connect(merger, 0, _SPK51_FL);
    occl.connect(gFR);    gFR .connect(merger, 0, _SPK51_FR);
    occl.connect(gC);     gC  .connect(merger, 0, _SPK51_C);
    occl.connect(lpfLFE); lpfLFE.connect(gLFE); gLFE.connect(merger, 0, _SPK51_LFE);
    occl.connect(gSL);    gSL .connect(merger, 0, _SPK51_SL);
    occl.connect(gSR);    gSR .connect(merger, 0, _SPK51_SR);
    merger.connect(audio.spatial51Bus);

    audio._spatialSink = occl;
    playSound(type);
    audio._spatialSink = null;

    setTimeout(() => { _releaseSpatial51(triple); }, 4000);
  } catch (e) {
    audio._spatialSink = null;
    _releaseSpatial51(triple);
    playSound(type);
  }
}

// (v8_2a) Public spatial-sound entry. Dispatches to the 5.1 path when
// the system has a multi-channel destination, otherwise the HRTF path.
function playSpatialSound(type, worldPos, opts) {
  if (audio && audio._is51) return _playSpatialSound51(type, worldPos, opts);
  return _playSpatialSoundHRTF(type, worldPos, opts);
}

// ============================================================================
// SECTION 5 : Music system (Tier 3 reactive band)
// ============================================================================
// ============================================================
// === LSS BAND v1 (Tier 3 reactive music) ====================
// ============================================================
// Procedural in-game band that scores the match in real time.
// Synth recipes lifted from framework_dancing_cosmos_band.html
// (drums, bass, pad, lead). The scheduler is a tiny lookahead
// clock; reactive hooks below feed it gameplay events.
//
// First principles (LSS_music_tier3_plan-may01-2026.md, sec. 0):
//   1. A steady beat is the most important part.
//   2. Rhythms are built on beats, not wall-clock.
//   3. Chords have to fit together (voice leading).
//   4. Chords are tuned to important game frequencies. Default
//      tonic is C#2 (~69.3 Hz), matching PHI_REST_BASE so the
//      pad shares its root with the ambient bed.
// ============================================================

// Default tonic: 69 Hz = ~C#2, same as PHI_REST_BASE on the
// ambient bed. The band's pad root sits ON the drone fundamental.
const MUSIC_DEFAULT_KEY_HZ = 69; // C#2 (69.30 Hz exact)

// MIDI note for C#2 = 37. We store keys as MIDI numbers so the
// synth helpers can convert to Hz cleanly.
const MUSIC_DEFAULT_KEY_MIDI = 37; // C#2

// Scale degree tables (semitone offsets from root).
const MUSIC_SCALE_AEOLIAN  = [0, 2, 3, 5, 7, 8, 10];  // natural minor
const MUSIC_SCALE_PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];  // b2 unease (LSS aesthetic)
const MUSIC_PENTATONIC_MIN = [0, 3, 5, 7, 10];        // safe-over-anything lead palette

// Music engine state. Separate from `audio` so hot-reloads of the
// band code don't blow away the audio bus, and vice versa.
const music = {
  enabled: true,                // master on/off (settings + autoplay gate)
  volume: 0.55,                 // userVol.music mirror, drives audio.musicGain
  ctx: null,                    // resolved in musicEnsureCtx()
  out: null,                    // audio.musicGain
  // Clock
  bpm: 96,
  bpmTarget: 96,
  beat: 0,
  bar: 0,
  nextBeatAt: 0,                // ctx.currentTime of next scheduled beat
  lookaheadSec: 0.18,           // schedule this far ahead
  schedTimer: null,             // setInterval handle
  // Key + mode
  keyMidi: MUSIC_DEFAULT_KEY_MIDI,
  mode: 'aeolian',              // 'aeolian' | 'phrygian'
  scale: MUSIC_SCALE_AEOLIAN,   // active scale array
  // Style: shapes BPM, key, mode, waveforms, and per-pattern riff overrides.
  styleId: 'cosmic',
  leadWave: 'triangle',
  bassWave: 'sawtooth',
  padWave: 'sawtooth',
  bpmScale: 1.0,                // multiplier on top of pattern bpmTarget
  // Pattern + dynamic state
  patternId: 'silent',
  intensity: 1,                 // 0..3 (capped by musicCeiling)
  ceiling: 3,
  // Reactive state
  drumsSuspended: false,        // stasis-field silence
  doomedMode: false,            // Phrygian drone overlay
  lastKillBeat: -999,
  multikillCount: 0,
  // Active voices for cleanup on pattern change.
  activeVoices: [],
  // Pad chord memory for voice leading.
  lastPadVoicing: null,
  // Anti-redundant: don't reschedule pad chord on every beat.
  lastChordKey: null,
  // Bookkeeping for the lead phrase queue (kill-triggered notes).
  pendingLeadNotes: [],         // [{atBeat, note, dur, vel}]
};

// Convert MIDI note number to Hz.
function _musicMidiHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

// === SYNTH RECIPES (lifted from framework_dancing_cosmos_band.html) ===

// Drum: kick (note 35/36), snare (38/40), crash (49/57), default = hat.
// (v15m music upgrade) Improved drum kit.
//   Kick : pitched body sweep + click transient (the "thump + tick").
//   Snare : tuned body tone + noise crack, both shaped (the "ka-snap").
//   Crash : longer noise sweep with darker tail (not just bright sizzle).
//   Hat : tightened transient + tiny pitched accent.
function _musicSynthDrum(note, g, when, out) {
  const ctx = music.ctx;
  if (!ctx) return null;
  // ----- KICK (note 35 / 36) -----
  if (note === 35 || note === 36) {
    // Body : pitched sine sweep (the thump)
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(180, when);
    body.frequency.exponentialRampToValueAtTime(42, when + 0.10);
    const bodyAmp = ctx.createGain();
    bodyAmp.gain.setValueAtTime(0.95 * g, when);
    bodyAmp.gain.exponentialRampToValueAtTime(0.01, when + 0.32);
    body.connect(bodyAmp).connect(out);
    // Click transient : short triangle blip for the attack pop
    const click = ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(1200, when);
    click.frequency.exponentialRampToValueAtTime(200, when + 0.008);
    const clickAmp = ctx.createGain();
    clickAmp.gain.setValueAtTime(0.30 * g, when);
    clickAmp.gain.exponentialRampToValueAtTime(0.001, when + 0.012);
    click.connect(clickAmp).connect(out);
    body.start(when); body.stop(when + 0.40);
    click.start(when); click.stop(when + 0.015);
    return { stop: (t) => { try { body.stop(Math.max(when + 0.01, t)); click.stop(Math.max(when + 0.01, t)); } catch (_) {} } };
  }
  // ----- SNARE (note 38 / 40) -----
  if (note === 38 || note === 40) {
    // Body tone : 200 Hz triangle quickly fading (the "ka")
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = 200;
    const bodyAmp = ctx.createGain();
    bodyAmp.gain.setValueAtTime(0.45 * g, when);
    bodyAmp.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    body.connect(bodyAmp).connect(out);
    // Noise crack (the "snap") through a bandpass
    const buf = ctx.createBuffer(1, 4096, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.0;
    const noiseAmp = ctx.createGain();
    noiseAmp.gain.setValueAtTime(0.75 * g, when);
    noiseAmp.gain.exponentialRampToValueAtTime(0.01, when + 0.16);
    src.connect(bp).connect(noiseAmp).connect(out);
    body.start(when); body.stop(when + 0.08);
    src.start(when); src.stop(when + 0.20);
    return { stop: (t) => { try { src.stop(Math.max(when + 0.01, t)); body.stop(Math.max(when + 0.01, t)); } catch (_) {} } };
  }
  // ----- CRASH (note 49 / 57) -----
  if (note === 49 || note === 57) {
    const buf = ctx.createBuffer(1, 8192, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    // Sweeping highpass : starts bright, drops over time for darker tail.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(7000, when);
    hp.frequency.exponentialRampToValueAtTime(2500, when + 0.8);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.38 * g, when);
    amp.gain.exponentialRampToValueAtTime(0.005, when + 1.3);
    src.connect(hp).connect(amp).connect(out);
    src.start(when); src.stop(when + 1.4);
    return { stop: (t) => { try { src.stop(Math.max(when + 0.01, t)); } catch (_) {} } };
  }
  // ----- HAT (default, closed) -----
  const buf = ctx.createBuffer(1, 1024, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Tight highpass + bandpass mix : pitched hat with crisp transient.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7500;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.40 * g, when);
  amp.gain.exponentialRampToValueAtTime(0.005, when + 0.05);
  src.connect(hp).connect(amp).connect(out);
  // Pitched accent : tiny triangle ping for hat tonality
  const ping = ctx.createOscillator();
  ping.type = 'triangle';
  ping.frequency.value = 9000;
  const pingAmp = ctx.createGain();
  pingAmp.gain.setValueAtTime(0.06 * g, when);
  pingAmp.gain.exponentialRampToValueAtTime(0.001, when + 0.02);
  ping.connect(pingAmp).connect(out);
  src.start(when); src.stop(when + 0.07);
  ping.start(when); ping.stop(when + 0.025);
  return { stop: (t) => { try { src.stop(Math.max(when + 0.01, t)); ping.stop(Math.max(when + 0.01, t)); } catch (_) {} } };
}

// (v15m music upgrade) Fattened bass voice. Main saw + sub-octave sine
// for low-end weight, tanh saturation for harmonic content (the "growl"),
// and a filter envelope that opens for transient punch then closes for
// sustained body. Much more present than the previous single-sawtooth
// version.
// _bassSatCurve : computed once at module-load, reused per note.
const _bassSatCurve = (function() {
  const curve = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    const x = (i / 255.5) - 1;
    curve[i] = Math.tanh(x * 1.7);   // soft saturation
  }
  return curve;
})();
function _musicSynthBass(freq, g, when, out, durSec) {
  const ctx = music.ctx;
  if (!ctx) return null;
  // Main oscillator (saw — the timbral body)
  const osc = ctx.createOscillator();
  osc.type = music.bassWave || 'sawtooth';
  osc.frequency.value = freq;
  // Sub-octave sine for low-end foundation
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freq * 0.5;
  // Saturation on the main oscillator path for harmonic richness
  const sat = ctx.createWaveShaper();
  sat.curve = _bassSatCurve;
  // Lowpass filter with envelope :
  //   - At note-on : opens to 1800 Hz briefly (transient punch — bright click)
  //   - Closes to 400 Hz over 80 ms (sustained body — round low end)
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2.5;
  lp.frequency.setValueAtTime(1800, when);
  lp.frequency.exponentialRampToValueAtTime(400, when + 0.08);
  // Per-layer gain (sub balanced against main)
  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;
  // Master amp envelope (fast attack, hold, then release)
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.50 * g, when + 0.008);
  amp.gain.linearRampToValueAtTime(0.32 * g, when + 0.15);
  // Routing
  osc.connect(sat).connect(lp);
  sub.connect(subGain).connect(lp);
  lp.connect(amp).connect(out);
  osc.start(when); sub.start(when);
  const stopAt = when + (durSec != null ? durSec : 0.5);
  amp.gain.setValueAtTime(0.32 * g, stopAt);
  amp.gain.linearRampToValueAtTime(0, stopAt + 0.05);
  try { osc.stop(stopAt + 0.1); sub.stop(stopAt + 0.1); } catch (_) {}
  let stopped = false;
  return {
    stop: (t) => {
      if (stopped) return; stopped = true;
      try {
        amp.gain.cancelScheduledValues(t);
        amp.gain.setValueAtTime(amp.gain.value, t);
        amp.gain.linearRampToValueAtTime(0, t + 0.05);
        osc.stop(t + 0.1); sub.stop(t + 0.1);
      } catch (_) {}
    }
  };
}

// (v15m music upgrade) Fattened pad voice. Four oscillators (unison saw
// pair detuned ±~9 cents for chorus-like width + sub-octave sine for
// foundation + fifth-up sine for upper shimmer), slow LFO modulating the
// lowpass cutoff for evolving movement, filter envelope that "blooms in"
// over the attack. Way more bed-of-sound than the previous 2-oscillator
// thin pad.
function _musicSynthPad(freq, g, when, out, durSec) {
  const ctx = music.ctx;
  if (!ctx) return null;
  const padWave = music.padWave || 'sawtooth';
  // Main detuned unison pair (the body of the pad)
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.type = padWave; o2.type = padWave;
  o1.frequency.value = freq * 0.997;       // ~-5 cents
  o2.frequency.value = freq * 1.005;       // ~+9 cents
  // Sub-octave sine for low-end weight
  const oSub = ctx.createOscillator();
  oSub.type = 'sine';
  oSub.frequency.value = freq * 0.5;
  // Fifth-up sine for harmonic shimmer (very subtle)
  const oFifth = ctx.createOscillator();
  oFifth.type = 'sine';
  oFifth.frequency.value = freq * 1.5;
  // Filter — base 1200 Hz lowpass, modulated by LFO for breathing motion.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1200;
  lp.Q.value = 0.85;
  // Filter envelope : pad "blooms in" — cutoff opens from 700 → 1500
  // over the attack, giving the pad warmth-into-air motion.
  lp.frequency.setValueAtTime(700, when);
  lp.frequency.linearRampToValueAtTime(1500, when + 0.8);
  // Slow LFO modulating cutoff for evolving movement (0.3–0.7 Hz, ±300 Hz).
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.30 + Math.random() * 0.40;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 300;
  lfo.connect(lfoGain);
  lfoGain.connect(lp.frequency);
  // Per-voice gain stages so we can balance the layers
  const subGain = ctx.createGain();
  subGain.gain.value = 0.42;
  oSub.connect(subGain).connect(lp);
  const fifthGain = ctx.createGain();
  fifthGain.gain.value = 0.14;
  oFifth.connect(fifthGain).connect(lp);
  o1.connect(lp);
  o2.connect(lp);
  // Master amp envelope : slow attack, slow release (pad behavior).
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.15 * g, when + 0.5);
  lp.connect(amp).connect(out);
  o1.start(when); o2.start(when);
  oSub.start(when); oFifth.start(when);
  lfo.start(when);
  const stopAt = when + (durSec != null ? durSec : 2.0);
  amp.gain.setValueAtTime(0.15 * g, stopAt);
  amp.gain.linearRampToValueAtTime(0, stopAt + 0.5);
  try {
    o1.stop(stopAt + 0.55);
    o2.stop(stopAt + 0.55);
    oSub.stop(stopAt + 0.55);
    oFifth.stop(stopAt + 0.55);
    lfo.stop(stopAt + 0.55);
  } catch (_) {}
  let stopped = false;
  return {
    stop: (t) => {
      if (stopped) return; stopped = true;
      try {
        amp.gain.cancelScheduledValues(t);
        amp.gain.setValueAtTime(amp.gain.value, t);
        amp.gain.linearRampToValueAtTime(0, t + 0.5);
        o1.stop(t + 0.55); o2.stop(t + 0.55);
        oSub.stop(t + 0.55); oFifth.stop(t + 0.55);
        lfo.stop(t + 0.55);
      } catch (_) {}
    }
  };
}

// (v15m music upgrade) Lead voice now has a soft octave-up sine layer
// for shimmer + delayed vibrato (LFO ramps in after the attack so the
// note's onset is pure, then warms with vibrato as it sustains). The
// result is a more vocal / expressive lead instead of a sterile single
// oscillator.
function _musicSynthLead(freq, g, when, out, durSec) {
  const ctx = music.ctx;
  if (!ctx) return null;
  // Main oscillator
  const osc = ctx.createOscillator();
  osc.type = music.leadWave || 'triangle';
  osc.frequency.value = freq;
  // Octave-up sine (subtle harmonic shimmer)
  const oct = ctx.createOscillator();
  oct.type = 'sine';
  oct.frequency.value = freq * 2;
  // Vibrato LFO : 5.5 Hz, ±0.5% (~9 cents). Gain starts at 0 and ramps
  // up after the attack so the note's onset is clean.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 5.5;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0;
  lfoGain.gain.setValueAtTime(0, when);
  lfoGain.gain.linearRampToValueAtTime(freq * 0.005, when + 0.12);  // vibrato grows in
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  // Octave layer gain (subtle harmonic enrichment)
  const octGain = ctx.createGain();
  octGain.gain.value = 0.18;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.30 * g, when + 0.015);
  amp.gain.linearRampToValueAtTime(0.16 * g, when + 0.12);
  osc.connect(amp);
  oct.connect(octGain).connect(amp);
  amp.connect(out);
  // (v15m music upgrade) Reverb send : a tap off the amp goes to the lead
  // send (predelay → convolver → wet gain → out). Wet level is controlled
  // by the send chain's internal gain, so this just feeds it.
  if (music.leadSend) {
    try { amp.connect(music.leadSend); } catch (_) {}
  }
  osc.start(when); oct.start(when); lfo.start(when);
  const stopAt = when + (durSec != null ? durSec : 0.35);
  amp.gain.setValueAtTime(0.16 * g, stopAt);
  amp.gain.linearRampToValueAtTime(0, stopAt + 0.08);
  try { osc.stop(stopAt + 0.12); oct.stop(stopAt + 0.12); lfo.stop(stopAt + 0.12); } catch (_) {}
  let stopped = false;
  return {
    stop: (t) => {
      if (stopped) return; stopped = true;
      try {
        amp.gain.cancelScheduledValues(t);
        amp.gain.setValueAtTime(amp.gain.value, t);
        amp.gain.linearRampToValueAtTime(0, t + 0.08);
        osc.stop(t + 0.12);
        oct.stop(t + 0.12);
        lfo.stop(t + 0.12);
      } catch (_) {}
    }
  };
}

// === CHORD HELPERS ===

// Build a chord from scale degree (0..6) + quality.
// Returns array of MIDI offsets from keyMidi.
// (v15m music upgrade) Expanded chord qualities :
//   - min7, maj7 : sevenths add harmonic depth, modern jazzy color
//   - sus2, sus4 : suspended chords for tension/anticipation
//   - dim7 : darker than plain dim, used sparingly for unease
//   - add9 : minor with added 9th, dreamier than plain minor
//   - maj9 : full 9th chord, lush
function _musicChord(degree, quality) {
  const scale = music.scale;
  const root = scale[degree % 7];
  if (quality === 'maj')   return [root, root + 4, root + 7];
  if (quality === 'maj7')  return [root, root + 4, root + 7, root + 11];
  if (quality === 'maj9')  return [root, root + 4, root + 7, root + 11, root + 14];
  if (quality === 'min7')  return [root, root + 3, root + 7, root + 10];
  if (quality === 'dim')   return [root, root + 3, root + 6];
  if (quality === 'dim7')  return [root, root + 3, root + 6, root + 9];
  if (quality === 'sus2')  return [root, root + 2, root + 7];
  if (quality === 'sus4')  return [root, root + 5, root + 7];
  if (quality === 'add9')  return [root, root + 3, root + 7, root + 14];
  return [root, root + 3, root + 7]; // 'min' default
}

// Voice-leading: pick the closest octave for each pad note relative to the
// previous voicing. Pad sits ~24 semitones above keyMidi (mid-low pad register).
function _musicVoicePad(chord) {
  const baseMidi = music.keyMidi + 24;
  if (!music.lastPadVoicing) {
    return chord.map(n => baseMidi + n);
  }
  const prev = music.lastPadVoicing;
  return chord.map((n, i) => {
    let target = baseMidi + n;
    const reference = prev[i] != null ? prev[i] : baseMidi + n;
    // Move target by octaves to minimize distance from reference.
    while (target - reference > 6)  target -= 12;
    while (reference - target > 6)  target += 12;
    return target;
  });
}

// === RIFF BUILDER ===
// Picks scale-degree notes from music.scale and weaves them into rhythmic
// patterns on a 16th-note grid. Each bar combines one rhythm (when the
// notes hit) with one contour (which scale degrees they walk through).
// The riff config attaches to a pattern via PATTERN_RIFFS below.

// Scale-degree to semitone (auto-wraps octaves so contours can climb past 7).
function _musicScaleSemitone(degree) {
  const scale = music.scale; // length 7
  const oct = Math.floor(degree / 7);
  const d = ((degree % 7) + 7) % 7;
  return scale[d] + oct * 12;
}

// 16-step rhythm grids (one bar of 16th notes). 0 = rest, 1 = note, 2 = accent.
const RIFF_RHYTHMS = {
  hover_quarters: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],   // sparse, two notes per bar
  pulse_8ths:     [1,0,2,0, 1,0,2,0, 1,0,2,0, 1,0,2,0],   // steady 8th pulse, accents on the and
  driving:        [2,0,1,0, 1,0,2,0, 0,1,1,0, 2,0,1,1],   // syncopated combat riff
  galloping:      [2,0,1,1, 0,1,0,0, 2,0,1,1, 0,1,1,0],   // triplet-feel push
  call_response:  [2,0,1,0, 0,1,0,0, 2,0,1,0, 0,1,2,0],   // call on bar 1, answer on bar 2 of pair
  doomed_pulse:   [2,0,0,0, 1,0,0,1, 0,0,1,0, 0,1,0,0],   // unsteady, off-beat
};

// Scale-degree contours. 0 = root, 7 = next octave root, negative = below.
// The riff builder walks through these in order, wrapping when notes run out.
const RIFF_CONTOURS = {
  hover_root:     [0, 4, 0, 4],                    // tonic/fifth alternation
  rising:         [0, 2, 4, 5, 7, 9, 11, 12],      // diatonic ascent over 2 octaves
  falling:        [12, 11, 9, 7, 5, 4, 2, 0],      // diatonic descent
  zigzag:         [0, 4, 2, 5, 4, 7, 5, 9],        // up-down weave
  riff_minor:     [0, 0, 2, 4, 7, 4, 2, 0],        // tonic-anchored minor riff
  riff_blues:     [0, 2, 3, 4, 7, 4, 3, 2],        // blue-note flavor (uses scale degree 3 for b5-ish)
  pentatonic_a:   [0, 2, 4, 7, 9, 7, 4, 2],        // ascending then descending pentatonic
  doomed_creep:   [0, 1, 0, -2, 0, 1, 3, 1],       // crawls around the b2 (Phrygian sting)
};

// Pattern â†’ riff config. Octave is added on top of keyMidi+24 (lead register).
// barsPerCycle lets a riff span more than one bar before repeating (e.g. 2 bars
// of "call" then "response").
const PATTERN_RIFFS = {
  lobby:    { rhythm: 'hover_quarters', contour: 'hover_root',   barsPerCycle: 2, octaveAdd: 0 },
  warmup:   { rhythm: 'pulse_8ths',     contour: 'rising',       barsPerCycle: 1, octaveAdd: 0 },
  combat:   { rhythm: 'driving',        contour: 'riff_minor',   barsPerCycle: 2, octaveAdd: 0 },
  doomed:   { rhythm: 'doomed_pulse',   contour: 'doomed_creep', barsPerCycle: 2, octaveAdd: -12 },
  // Round-end and match-end patterns keep their scripted lead phrases ; no
  // overlay riff so the cadence reads cleanly.
};

// === STYLES ===
// A style is a complete musical aesthetic: it overrides the key, mode,
// tempo scaling, oscillator waveforms, and per-pattern riff combo. Default
// is 'cosmic' (the original LSS sound, C#2 Aeolian, triangle lead).
//
// Each style entry:
//   keyMidi     : root note as MIDI number (37 = C#2)
//   mode        : 'aeolian' | 'phrygian'
//   bpmScale    : multiplier on top of each pattern's bpmTarget
//   leadWave    : oscillator type for the lead synth ('sine'|'triangle'|'sawtooth'|'square')
//   bassWave    : oscillator type for the bass
//   padWave     : oscillator type for the pad
//   riff        : per-pattern { rhythm, contour, barsPerCycle, octaveAdd } overrides
const MUSIC_STYLES = {
  cosmic: {
    label: 'Cosmic',
    keyMidi: 37,                  // C#2 ; matches PHI_REST_BASE on the ambient bed
    mode: 'aeolian',
    bpmScale: 1.0,
    leadWave: 'triangle',
    bassWave: 'sawtooth',
    padWave: 'sawtooth',
    riff: {
      lobby:  { rhythm: 'hover_quarters', contour: 'hover_root',   barsPerCycle: 2, octaveAdd: 0 },
      warmup: { rhythm: 'pulse_8ths',     contour: 'rising',       barsPerCycle: 1, octaveAdd: 0 },
      combat: { rhythm: 'driving',        contour: 'riff_minor',   barsPerCycle: 2, octaveAdd: 0 },
      doomed: { rhythm: 'doomed_pulse',   contour: 'doomed_creep', barsPerCycle: 2, octaveAdd: -12 },
    },
  },
  cyber: {
    label: 'Cyber',                // 80s-synthwave vibe ; bright saw lead, fast 8ths
    keyMidi: 38,                  // D2
    mode: 'aeolian',
    bpmScale: 1.15,
    leadWave: 'sawtooth',
    bassWave: 'square',
    padWave: 'sawtooth',
    riff: {
      lobby:  { rhythm: 'pulse_8ths',     contour: 'pentatonic_a', barsPerCycle: 2, octaveAdd: 0 },
      warmup: { rhythm: 'pulse_8ths',     contour: 'rising',       barsPerCycle: 1, octaveAdd: 0 },
      combat: { rhythm: 'pulse_8ths',     contour: 'rising',       barsPerCycle: 2, octaveAdd: 12 },
      doomed: { rhythm: 'galloping',      contour: 'zigzag',       barsPerCycle: 2, octaveAdd: 0 },
    },
  },
  doom: {
    label: 'Doom',                 // metal-influenced ; lower key, darker contour, heavy
    keyMidi: 33,                  // A1
    mode: 'phrygian',
    bpmScale: 0.85,
    leadWave: 'sawtooth',
    bassWave: 'sawtooth',
    padWave: 'sawtooth',
    riff: {
      lobby:  { rhythm: 'doomed_pulse',   contour: 'doomed_creep', barsPerCycle: 2, octaveAdd: 0 },
      warmup: { rhythm: 'galloping',      contour: 'doomed_creep', barsPerCycle: 1, octaveAdd: 0 },
      combat: { rhythm: 'galloping',      contour: 'riff_blues',   barsPerCycle: 2, octaveAdd: -12 },
      doomed: { rhythm: 'doomed_pulse',   contour: 'doomed_creep', barsPerCycle: 2, octaveAdd: -12 },
    },
  },
  drift: {
    label: 'Drift',                // ambient ; sine lead, slow tempo, sparse
    keyMidi: 37,                  // C#2
    mode: 'aeolian',
    bpmScale: 0.7,
    leadWave: 'sine',
    bassWave: 'triangle',
    padWave: 'triangle',
    riff: {
      lobby:  { rhythm: 'hover_quarters', contour: 'hover_root',   barsPerCycle: 2, octaveAdd: 12 },
      warmup: { rhythm: 'hover_quarters', contour: 'rising',       barsPerCycle: 2, octaveAdd: 12 },
      combat: { rhythm: 'hover_quarters', contour: 'pentatonic_a', barsPerCycle: 2, octaveAdd: 12 },
      doomed: { rhythm: 'hover_quarters', contour: 'doomed_creep', barsPerCycle: 2, octaveAdd: 0 },
    },
  },
  battle: {
    label: 'Battle',               // cinematic / orchestral feel ; driving and grand
    keyMidi: 35,                  // B1
    mode: 'aeolian',
    bpmScale: 1.25,
    leadWave: 'sawtooth',
    bassWave: 'sawtooth',
    padWave: 'sawtooth',
    riff: {
      lobby:  { rhythm: 'driving',        contour: 'riff_minor',   barsPerCycle: 2, octaveAdd: 0 },
      warmup: { rhythm: 'galloping',      contour: 'rising',       barsPerCycle: 1, octaveAdd: 0 },
      combat: { rhythm: 'galloping',      contour: 'rising',       barsPerCycle: 2, octaveAdd: 0 },
      doomed: { rhythm: 'doomed_pulse',   contour: 'falling',      barsPerCycle: 2, octaveAdd: -12 },
    },
  },
  jazz: {
    label: 'Jazz',                 // laid-back lounge vibe ; triangle lead, swing-leaning
    keyMidi: 37,
    mode: 'aeolian',
    bpmScale: 0.95,
    leadWave: 'triangle',
    bassWave: 'sine',
    padWave: 'triangle',
    riff: {
      lobby:  { rhythm: 'call_response',  contour: 'zigzag',       barsPerCycle: 2, octaveAdd: 0 },
      warmup: { rhythm: 'call_response',  contour: 'pentatonic_a', barsPerCycle: 2, octaveAdd: 0 },
      combat: { rhythm: 'syncopated',     contour: 'pentatonic_a', barsPerCycle: 2, octaveAdd: 0 },
      doomed: { rhythm: 'syncopated',     contour: 'riff_blues',   barsPerCycle: 2, octaveAdd: -12 },
    },
  },

  // (v8_2a 2026-05-01) Hard / fast techno. 4-on-the-floor kick, off-beat
  // closed hats, claps on 2+4, square-wave acid bass, sawtooth lead.
  // A1 Phrygian gives the menacing flat-2 sting that carries the genre.
  // bpmScale 1.4 puts warmup at ~129 BPM and combat at ~140 BPM.
  // patternOverrides supply per-state drum + bass; chord progressions
  // come from the base MUSIC_PATTERNS entries unchanged.
  techno: {
    label: 'Techno',
    keyMidi: 33,                    // A1
    mode: 'phrygian',
    bpmScale: 1.4,
    leadWave: 'sawtooth',
    bassWave: 'square',
    padWave: 'sawtooth',
    riff: {
      lobby:  { rhythm: 'pulse_8ths', contour: 'hover_root',   barsPerCycle: 2, octaveAdd: 0 },
      warmup: { rhythm: 'pulse_8ths', contour: 'rising',       barsPerCycle: 1, octaveAdd: 0 },
      combat: { rhythm: 'driving',    contour: 'riff_minor',   barsPerCycle: 2, octaveAdd: 0 },
      doomed: { rhythm: 'galloping',  contour: 'doomed_creep', barsPerCycle: 2, octaveAdd: -12 },
    },
    patternOverrides: {
      lobby: {
        // Sparse 4-on-2/4 kick + off-beat hats + claps on 2+4. Lobby techno
        // is "yes we're here" without pushing.
        drum: (sub, beat) => {
          const beatInBar = beat % 4;
          const subInBeat = sub % 4;
          const out = [];
          if (subInBeat === 0 && (beatInBar === 0 || beatInBar === 2)) out.push({ note: 36, g: 0.85 });
          if (subInBeat === 2) out.push({ note: 42, g: 0.50 });
          if (subInBeat === 0 && (beatInBar === 1 || beatInBar === 3)) out.push({ note: 38, g: 0.55 });
          return out.length ? out : null;
        },
        bass: (beat) => {
          const beatInBar = beat % 4;
          if (beatInBar === 0 || beatInBar === 2) return 0;
          return null;
        },
        bassDurBeats: 2,
      },
      warmup: {
        // 4-on-the-floor warmup. Kick every beat, off-beat hats, claps on
        // 2+4 to lock the groove before combat. Hat ducked when kick fires.
        drum: (sub, beat) => {
          const beatInBar = beat % 4;
          const subInBeat = sub % 4;
          const out = [];
          if (subInBeat === 0) out.push({ note: 36, g: 1.0 });
          if (subInBeat === 0) out.push({ note: 42, g: 0.30 });
          if (subInBeat === 2) out.push({ note: 42, g: 0.65 });
          if (subInBeat === 0 && (beatInBar === 1 || beatInBar === 3)) out.push({ note: 38, g: 0.85 });
          return out.length ? out : null;
        },
        bass: (beat) => 0,
        bassDurBeats: 1,
      },
      combat: {
        // The main event. 4-on-the-floor with intensity-driven busyness:
        //   int 1: basic kick + off-beat hat + claps on 2+4
        //   int 2: add 16th hat ghosts + open-hat push every other bar
        //   int 3: add pushed kick on the "and" of 4 + snare ruff bar pickup
        drum: (sub, beat, intensity) => {
          const beatInBar = beat % 4;
          const subInBeat = sub % 4;
          const out = [];
          if (subInBeat === 0) out.push({ note: 36, g: 1.15 });
          if (subInBeat === 0) out.push({ note: 42, g: 0.30 });
          if (subInBeat === 2) out.push({ note: 42, g: 0.75 });
          if (intensity >= 2 && (subInBeat === 1 || subInBeat === 3)) out.push({ note: 42, g: 0.30 });
          if (subInBeat === 0 && (beatInBar === 1 || beatInBar === 3)) out.push({ note: 38, g: 0.95 });
          if (intensity >= 2 && beatInBar === 3 && subInBeat === 2 && (Math.floor(beat / 4) % 2 === 1)) {
            out.push({ note: 49, g: 0.45 });
          }
          if (intensity >= 3 && beatInBar === 3 && subInBeat === 2) out.push({ note: 36, g: 0.7 });
          if (intensity >= 3 && beat % 16 === 15 && subInBeat >= 2) out.push({ note: 38, g: 0.55 });
          return out.length ? out : null;
        },
        bass: (beat, intensity) => {
          const beatInBar = beat % 4;
          const barInLoop = Math.floor(beat / 4) % 4;
          // Bar 4 walks down for the descent; otherwise root pulse with a
          // 5th rotation at int 2+ to widen the harmonic motion.
          if (barInLoop === 3) {
            const seq = [0, -2, -3, -5];
            return seq[beatInBar];
          }
          if (intensity >= 2) {
            if (beatInBar === 0 || beatInBar === 2) return 0;
            if (beatInBar === 1) return 7;
            return 0;
          }
          return 0;
        },
        bassDurBeats: 1,
      },
      doomed: {
        // Hollow / industrial: kick only on 1, fast hats, no snare. Carries
        // the "tunnel" feel of the original doomed pattern with a techno
        // pulse underneath.
        drum: (sub, beat) => {
          const beatInBar = beat % 4;
          const subInBeat = sub % 4;
          const out = [];
          if (subInBeat === 0 && beatInBar === 0) out.push({ note: 36, g: 0.9 });
          if (subInBeat === 2) out.push({ note: 42, g: 0.40 });
          return out.length ? out : null;
        },
        bass: (beat) => 0,
        bassDurBeats: 1,
      },
    },
  },
};

// Read the riff config for the given pattern, honoring the active style's
// override if present. Falls back to PATTERN_RIFFS if the style doesn't
// override that pattern.
function _musicGetRiffCfg(patternId) {
  const styleId = music.styleId || 'cosmic';
  const style = MUSIC_STYLES[styleId];
  if (style && style.riff && style.riff[patternId]) return style.riff[patternId];
  return PATTERN_RIFFS[patternId];
}

// Apply a style: switches key, mode, waveforms, and BPM scaling. The current
// pattern keeps playing ; only its sonic palette changes. Idempotent.
function musicSetStyle(name) {
  const style = MUSIC_STYLES[name];
  if (!style) {
    console.warn('[music] unknown style', name, '; staying on', music.styleId);
    return;
  }
  music.styleId = name;
  music.keyMidi = style.keyMidi;
  music.leadWave = style.leadWave || 'triangle';
  music.bassWave = style.bassWave || 'sawtooth';
  music.padWave = style.padWave || 'sawtooth';
  music.bpmScale = style.bpmScale || 1.0;
  // Mode change updates the active scale (riffs + chords adapt automatically).
  if (style.mode === 'phrygian') music.scale = MUSIC_SCALE_PHRYGIAN;
  else                            music.scale = MUSIC_SCALE_AEOLIAN;
  music.mode = style.mode || 'aeolian';
  // Force pad voicing reset so the next chord change picks the right octave
  // around the new tonic instead of sliding far away.
  music.lastPadVoicing = null;
  // Bump bpmTarget by the new scale so the tempo follows the style.
  music.bpmTarget = music.bpmTarget * music.bpmScale / (music._lastBpmScale || 1.0);
  music._lastBpmScale = music.bpmScale;
}

// Generate a list of {sub16, semi, vel} notes for the given bar+pattern. The
// rhythm grid + contour combine to lay notes onto the 16th grid; cycling
// through the contour as we hit each note slot.
function _musicGenerateRiffBar(patternId, barInCycle) {
  const cfg = _musicGetRiffCfg(patternId);
  if (!cfg) return null;
  const rhythm = RIFF_RHYTHMS[cfg.rhythm];
  const contour = RIFF_CONTOURS[cfg.contour];
  if (!rhythm || !contour) return null;
  // Walk through every step in the bar, advancing contour index on each note.
  // For multi-bar cycles, the contour offset starts where the previous bar
  // left off so the line keeps developing (rather than restarting on every bar).
  const stepsPerBar = 16;
  const startContourIdx = (barInCycle % cfg.barsPerCycle) *
    rhythm.filter(x => x > 0).length;
  const notes = [];
  let cIdx = startContourIdx;
  for (let s = 0; s < stepsPerBar; s++) {
    const v = rhythm[s];
    if (v === 0) continue;
    const deg = contour[cIdx % contour.length];
    const semi = _musicScaleSemitone(deg) + (cfg.octaveAdd || 0);
    notes.push({
      sub16: s,
      semi,
      vel: v === 2 ? 0.85 : 0.55,
    });
    cIdx++;
  }
  return notes;
}

// === SCHEDULER ===

function musicEnsureCtx() {
  if (!audio || !audio.ctx) return false;
  if (!audio.musicGain) return false;
  music.ctx = audio.ctx;
  music.out = audio.musicGain;
  // (v15m music upgrade) Build a dedicated reverb send for the lead voice
  // so kill-triggered phrases and lead lines have spatial presence —
  // sustained tail + slight predelay, sits underneath the dry signal.
  // Built once and reused for every lead note via music.leadSend.
  if (!music.leadSend) {
    try {
      const ctx = music.ctx;
      const leadReverb = ctx.createConvolver();
      // Generate a small impulse response : 1.2s decay, soft attack.
      const irLen = Math.floor(ctx.sampleRate * 1.2);
      const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < irLen; i++) {
          // Exponential decay, randomized for stereo difference.
          const t = i / irLen;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.8) * 0.6;
        }
      }
      leadReverb.buffer = ir;
      // 35 ms predelay so the wet signal sits behind the dry, not on top.
      const predelay = ctx.createDelay(0.1);
      predelay.delayTime.value = 0.035;
      // Wet level — subtle, just enough to give the lead air.
      const wetGain = ctx.createGain();
      wetGain.gain.value = 0.42;
      predelay.connect(leadReverb).connect(wetGain).connect(music.out);
      // The send node : lead voices connect to this AND directly to music.out.
      music.leadSend = predelay;
    } catch (_) { music.leadSend = null; }
  }
  return true;
}

function _musicScheduleBeat(beatIdx, beatTime) {
  if (music.drumsSuspended && music.patternId !== 'lobby' && music.patternId !== 'silent') {
    // Drums only suspended; still let pad/bass play at strong beats below.
  }
  let ptn = MUSIC_PATTERNS[music.patternId];
  if (!ptn) return;
  // (v8_2a 2026-05-01) Style-level pattern override. A style can supply a
  // patternOverrides[patternId] containing { drum, bass, bassDurBeats } that
  // gets merged on top of the base pattern so chord progression and other
  // fields stay intact. Used by the 'techno' style for a hard 4-on-the-floor
  // kit + acid square bass per gameplay state.
  const _styleIdSch = (typeof audio !== 'undefined') ? audio.musicStyle : null;
  const _styleDefSch = (_styleIdSch && typeof MUSIC_STYLES !== 'undefined') ? MUSIC_STYLES[_styleIdSch] : null;
  const _styleOvrSch = (_styleDefSch && _styleDefSch.patternOverrides) ? _styleDefSch.patternOverrides[music.patternId] : null;
  if (_styleOvrSch) ptn = Object.assign({}, ptn, _styleOvrSch);
  const out = music.out;
  const secPerBeat = 60 / music.bpm;

  // Drums + riff: walk the 16th-note grid for this beat. Drums always fire
  // at bar-relative steps 0..15. Riff notes are pre-generated for the bar at
  // beat 0 and triggered as we walk the grid.
  const beatInBarLocal = beatIdx % 4;

  // Generate this bar's riff notes once (on the first beat of the bar). The
  // contour cycles via `_riffCycleBar` so multi-bar contours keep developing.
  if (beatInBarLocal === 0) {
    if (!music._riffCycleBar) music._riffCycleBar = 0;
    music._barRiffNotes = _musicGenerateRiffBar(music.patternId, music._riffCycleBar);
    const cfg = _musicGetRiffCfg(music.patternId);
    if (cfg) {
      music._riffCycleBar = (music._riffCycleBar + 1) % cfg.barsPerCycle;
    } else {
      music._riffCycleBar = 0;
      music._barRiffNotes = null;
    }
  }

  if (!music.drumsSuspended && ptn.drum) {
    for (let s = 0; s < 4; s++) {
      const sub = beatIdx * 4 + s;
      const subTime = beatTime + (s * secPerBeat / 4);
      const stepInBar = beatInBarLocal * 4 + s;
      // Drum hit for this 16th.
      const hit = ptn.drum(sub, beatIdx, music.intensity);
      if (hit) {
        for (const h of hit) {
          _musicSynthDrum(h.note, h.g != null ? h.g : 1.0, subTime, out);
        }
      }
      // Riff lead note for this 16th (if any).
      if (music._barRiffNotes) {
        for (const n of music._barRiffNotes) {
          if (n.sub16 === stepInBar) {
            const dur = secPerBeat * 0.45;  // tight 16th-ish lead, fades fast
            _musicSynthLead(_musicMidiHz(music.keyMidi + 24 + n.semi),
                            n.vel, subTime, out, dur);
          }
        }
      }
    }
  } else if (music._barRiffNotes) {
    // Drums suspended (e.g. inside stasis field) but riff still plays at half volume.
    for (let s = 0; s < 4; s++) {
      const subTime = beatTime + (s * secPerBeat / 4);
      const stepInBar = beatInBarLocal * 4 + s;
      for (const n of music._barRiffNotes) {
        if (n.sub16 === stepInBar) {
          const dur = secPerBeat * 0.45;
          _musicSynthLead(_musicMidiHz(music.keyMidi + 24 + n.semi),
                          n.vel * 0.5, subTime, out, dur);
        }
      }
    }
  }

  // Bass + pad + chord changes happen on beat boundaries.
  // (v8_1VR audio fix) Bass register changed from `keyMidi - 12` (one octave
  // BELOW the tonic, 27-37 Hz on most styles) to `keyMidi` (the tonic
  // itself, 55-73 Hz). The sub-octave bass was driving subwoofers into
  // crackling on desktops with real low-end response. The tonic-octave
  // bass still reads as bass against the pad (24 semitones above) and
  // sits cleanly above the 45 Hz output HPF below.
  if (ptn.bass) {
    const bassNote = ptn.bass(beatIdx, music.intensity);
    if (bassNote != null) {
      const freq = _musicMidiHz(music.keyMidi + bassNote);
      const dur = secPerBeat * (ptn.bassDurBeats || 1);
      _musicSynthBass(freq, 0.9, beatTime, out, dur);
    }
  }

  // Pad: chord progression. Stabs on each BAR boundary (beat 0) with a
  // short ~1.5-beat sustain so chords don't drone across the riff. The pad
  // becomes a rhythmic instrument that breathes with the beat instead of a
  // wash. Voice-leading still picks the closest voicing for smooth changes.
  if (ptn.chords && ptn.chordsBars) {
    const totalBars = ptn.chordsBars.reduce((a, b) => a + b, 0);
    const barInLoop = (Math.floor(beatIdx / 4)) % totalBars;
    const beatInBar = beatIdx % 4;
    if (beatInBar === 0) {
      // Find which chord index we're in for this bar.
      let acc = 0, chordIdx = 0;
      for (let i = 0; i < ptn.chordsBars.length; i++) {
        if (barInLoop < acc + ptn.chordsBars[i]) { chordIdx = i; break; }
        acc += ptn.chordsBars[i];
      }
      const [degree, quality] = ptn.chords[chordIdx];
      const chordOffsets = _musicChord(degree, quality);
      const voicing = _musicVoicePad(chordOffsets);
      // Short stab : 1.5 beats sustain, fades through beat 2 of the bar so the
      // riff has space. Each bar retriggers (rhythm), even on repeated chords.
      const dur = secPerBeat * 1.5;
      for (const m of voicing) {
        _musicSynthPad(_musicMidiHz(m), 0.7, beatTime, out, dur);
      }
      music.lastPadVoicing = voicing;
    }
  }

  // Lead: scheduled phrase notes from kill events.
  if (music.pendingLeadNotes.length) {
    const drained = [];
    const remaining = [];
    for (const n of music.pendingLeadNotes) {
      if (n.atBeat <= beatIdx + 0.001) drained.push(n);
      else remaining.push(n);
    }
    music.pendingLeadNotes = remaining;
    for (const n of drained) {
      const offset = (n.atBeat - beatIdx) * secPerBeat;
      const t = beatTime + Math.max(0, offset);
      _musicSynthLead(_musicMidiHz(music.keyMidi + 24 + n.note), n.vel || 0.9, t, out, n.dur || 0.25);
    }
  }
}

function _musicTick() {
  if (!music.enabled) return;
  if (!musicEnsureCtx()) return;
  const ctx = music.ctx;
  // BPM smoothing toward target (one-pole).
  music.bpm = music.bpm * 0.92 + music.bpmTarget * 0.08;
  // Schedule beats up to lookahead.
  const horizon = ctx.currentTime + music.lookaheadSec;
  // Boot: first beat lines up to "now".
  if (music.nextBeatAt < ctx.currentTime - 0.5) {
    music.nextBeatAt = ctx.currentTime + 0.05;
    music.beat = 0;
    music.bar = 0;
  }
  while (music.nextBeatAt <= horizon) {
    _musicScheduleBeat(music.beat, music.nextBeatAt);
    music.beat++;
    if (music.beat % 4 === 0) music.bar++;
    music.nextBeatAt += 60 / music.bpm;
  }
}

function musicStart() {
  if (music.schedTimer) return;
  if (!musicEnsureCtx()) return;
  music.schedTimer = setInterval(_musicTick, 50);
}

function musicStop() {
  if (music.schedTimer) clearInterval(music.schedTimer);
  music.schedTimer = null;
}

// === PUBLIC API ===

function musicSetEnabled(on) {
  music.enabled = !!on;
  if (!music.enabled) {
    musicStop();
    // Mute the bus immediately (avoid lingering pad tails).
    if (audio.musicGain && audio.ctx) {
      try {
        audio.musicGain.gain.cancelScheduledValues(audio.ctx.currentTime);
        audio.musicGain.gain.linearRampToValueAtTime(0, audio.ctx.currentTime + 0.1);
      } catch (_) {}
    }
  } else {
    if (audio.musicGain && audio.ctx) {
      try {
        const target = 0.30 * (audio.userVol.music != null ? audio.userVol.music : 0.45);
        audio.musicGain.gain.cancelScheduledValues(audio.ctx.currentTime);
        audio.musicGain.gain.linearRampToValueAtTime(target, audio.ctx.currentTime + 0.4);
      } catch (_) {}
    }
    musicStart();
  }
}

function musicSetVolume(v) {
  audio.userVol.music = Math.max(0, Math.min(1.5, v));
  if (audio.musicGain) {
    audio.musicGain.gain.value = 0.30 * audio.userVol.music;
  }
}

// (v15m music upgrade) Fire a short transition fill when the pattern
// changes, so the soundtrack doesn't snap to a new mood instantly. Fill
// shape varies with the destination :
//   combat       → snare roll + crash (escalating into action)
//   doomed       → low tom + reverse-swell (dread)
//   roundEndVictory / matchEndVictory → big crash (celebration)
//   roundEndDefeat / matchEndDefeat   → kick + tomb (collapse)
//   warmup / lobby → soft hat sweep (calm reset)
// Fills run at ~0.4 sec duration so they fit before the next bar starts.
function _musicFireTransitionFill(fromId, toId) {
  if (!music.ctx || !music.out) return;
  if (fromId === toId) return;
  if (fromId === 'silent' || toId === 'silent') return; // no fill on silence
  const ctx = music.ctx;
  const t = ctx.currentTime + 0.02;
  const secPerBeat = 60 / (music.bpm || 96);
  const out = music.out;
  try {
    if (toId === 'combat') {
      // Snare 16ths building intensity + crash on downbeat.
      for (let i = 0; i < 5; i++) {
        const dt = i * secPerBeat * 0.20;        // 20ths of a beat apart
        const vol = 0.45 + i * 0.12;             // crescendo
        _musicSynthDrum(38, vol, t + dt, out);
      }
      _musicSynthDrum(49, 0.95, t + secPerBeat * 1.0, out);
      _musicSynthDrum(36, 1.00, t + secPerBeat * 1.0, out);
    } else if (toId === 'doomed') {
      // Low ominous tom + delayed crash for dread.
      _musicSynthDrum(36, 1.10, t, out);                  // pitched kick = tom-ish
      _musicSynthDrum(36, 0.70, t + secPerBeat * 0.35, out);
      _musicSynthDrum(49, 0.40, t + secPerBeat * 0.5, out);
    } else if (toId === 'roundEndVictory' || toId === 'matchEndVictory') {
      // Big crash + open hat for triumph.
      _musicSynthDrum(49, 1.10, t, out);
      _musicSynthDrum(36, 1.00, t, out);
      _musicSynthDrum(38, 0.50, t + secPerBeat * 0.25, out);
      _musicSynthDrum(38, 0.50, t + secPerBeat * 0.5, out);
    } else if (toId === 'roundEndDefeat' || toId === 'matchEndDefeat') {
      // Hollow kick + tomb-fall snare for "we lost".
      _musicSynthDrum(36, 0.95, t, out);
      _musicSynthDrum(38, 0.45, t + secPerBeat * 0.5, out);
      _musicSynthDrum(36, 0.70, t + secPerBeat * 1.0, out);
    } else if (toId === 'warmup' || toId === 'lobby') {
      // Calm reset : soft hat triplet.
      _musicSynthDrum(42, 0.30, t, out);
      _musicSynthDrum(42, 0.30, t + secPerBeat * 0.33, out);
      _musicSynthDrum(42, 0.30, t + secPerBeat * 0.66, out);
    }
  } catch (_) {}
}

function musicSetPattern(id, opts) {
  if (!MUSIC_PATTERNS[id]) {
    console.warn('[music] unknown pattern', id);
    return;
  }
  const prevId = music.patternId;
  music.patternId = id;
  // (v15m music upgrade) Fire the transition fill on every pattern change.
  if (prevId !== id) _musicFireTransitionFill(prevId, id);
  music.lastChordKey = null;
  // Reset riff cycle bar so each pattern starts at its first phrase.
  music._riffCycleBar = 0;
  music._barRiffNotes = null;
  // Clear any pending lead notes from a prior pattern (kills don't echo across rounds).
  music.pendingLeadNotes = [];
  if (opts && typeof opts.intensity === 'number') {
    music.intensity = Math.max(0, Math.min(music.ceiling, opts.intensity));
  }
  // Style's bpmScale multiplies whatever the pattern asks for.
  const scale = music.bpmScale || 1.0;
  if (opts && typeof opts.bpm === 'number') {
    music.bpm = opts.bpm * scale;
    music.bpmTarget = opts.bpm * scale;
  }
  if (opts && typeof opts.bpmTarget === 'number') {
    music.bpmTarget = opts.bpmTarget * scale;
  }
  // Start the scheduler if not running.
  musicStart();
}

function musicSetBpmTarget(bpm) {
  // Honor the active style's bpmScale here too so the in-round ramp
  // (96â†’128 BPM in cosmic) lands at the style-appropriate range.
  const scale = music.bpmScale || 1.0;
  music.bpmTarget = Math.max(40, Math.min(220, bpm * scale));
}

function musicSetIntensity(level) {
  music.intensity = Math.max(0, Math.min(music.ceiling, level | 0));
}

function musicSetCeiling(label) {
  if (label === 'chill') music.ceiling = 1;
  else if (label === 'wild') music.ceiling = 3;
  else music.ceiling = 2;
  if (music.intensity > music.ceiling) music.intensity = music.ceiling;
}

function musicSetMode(mode) {
  music.mode = mode;
  music.scale = (mode === 'phrygian') ? MUSIC_SCALE_PHRYGIAN : MUSIC_SCALE_AEOLIAN;
}

function musicEnterMode(name) {
  if (name === 'doomed') {
    music.doomedMode = true;
    music._patternBeforeDoomed = music.patternId;
    musicSetMode('phrygian');
    // Switch to the doomed pattern (sparse drums, b2 chords, doomed_creep riff).
    musicSetPattern('doomed', { intensity: music.intensity });
  }
}

function musicExitMode(name) {
  if (name === 'doomed') {
    music.doomedMode = false;
    musicSetMode('aeolian');
    // Restore the previous pattern (combat in normal play). Falls back to combat
    // if we somehow lost the prior pattern reference.
    const restore = music._patternBeforeDoomed || 'combat';
    music._patternBeforeDoomed = null;
    musicSetPattern(restore, { intensity: music.intensity });
  }
}

function musicSuspendDrums(on) {
  music.drumsSuspended = !!on;
}

// onKill: queue a lead phrase quantized to the next 8th note. who = 'player' | 'bot'.
function musicOnKill(who, streakHint) {
  if (!musicEnsureCtx()) return;
  if (who === 'bot') {
    // Player just died from a bot's kill ; pad sour-stab + skip next snare.
    // (Quick way: schedule a quick lead bend down a semitone and back.)
    const t0 = music.ctx.currentTime;
    _musicSynthLead(_musicMidiHz(music.keyMidi + 12), 0.6, t0, music.out, 0.20);
    _musicSynthLead(_musicMidiHz(music.keyMidi + 11), 0.5, t0 + 0.18, music.out, 0.20);
    _musicSynthLead(_musicMidiHz(music.keyMidi + 12), 0.5, t0 + 0.36, music.out, 0.30);
    return;
  }
  // Player kill: quantize to next 8th note ; queue a phrase length based on streak.
  const beatNow = music.beat + Math.max(0, (music.nextBeatAt - music.ctx.currentTime) / (60 / music.bpm));
  const startBeat = Math.ceil(beatNow * 2) / 2;  // next 8th note boundary
  let phraseLen = 1;
  const inWindow = (music.beat - music.lastKillBeat) <= 8;  // 8 beats = ~5s @ 96 BPM
  if (inWindow) music.multikillCount++;
  else music.multikillCount = 1;
  music.lastKillBeat = music.beat;
  if (streakHint != null) music.multikillCount = Math.max(music.multikillCount, streakHint | 0);
  phraseLen = Math.min(5, music.multikillCount);
  // (v15m music upgrade) Phrase character escalates with multikill count :
  //   1 kill     : single root note (existing behavior)
  //   2 kills    : pentatonic ascending pair
  //   3 kills    : pentatonic ascending triple (existing extended)
  //   4+ kills   : CHROMATIC RISER — semitones climbing, the "you're on a tear" cue
  // Plus a crash on multikill ≥ 3 to punctuate.
  const useChromatic = music.multikillCount >= 4;
  if (useChromatic) {
    // 6-note chromatic riser from root up an octave.
    phraseLen = 6;
    for (let i = 0; i < phraseLen; i++) {
      music.pendingLeadNotes.push({
        atBeat: startBeat + i * 0.33,           // 8th-triplet feel for urgency
        note: i * 2,                            // whole-tone climb gives chromatic feel without dissonance
        dur: 0.18,
        vel: 0.9 + i * 0.02,
      });
    }
    // Crash on the final note for punctuation.
    try {
      const crashT = music.ctx.currentTime + (startBeat - music.beat) * (60 / music.bpm);
      _musicSynthDrum(49, 0.95, crashT, music.out);
    } catch (_) {}
  } else if (music.multikillCount >= 3) {
    // Pentatonic phrase + small crash hit.
    for (let i = 0; i < phraseLen; i++) {
      const scaleIdx = i % MUSIC_PENTATONIC_MIN.length;
      const oct = Math.floor(i / MUSIC_PENTATONIC_MIN.length) * 12;
      music.pendingLeadNotes.push({
        atBeat: startBeat + i * 0.5,
        note: MUSIC_PENTATONIC_MIN[scaleIdx] + oct,
        dur: 0.30,
        vel: 0.90,
      });
    }
    try {
      const crashT = music.ctx.currentTime + (startBeat - music.beat) * (60 / music.bpm);
      _musicSynthDrum(49, 0.55, crashT, music.out);
    } catch (_) {}
  } else {
    // Standard pentatonic phrase, eighth notes.
    for (let i = 0; i < phraseLen; i++) {
      const scaleIdx = i % MUSIC_PENTATONIC_MIN.length;
      const oct = Math.floor(i / MUSIC_PENTATONIC_MIN.length) * 12;
      music.pendingLeadNotes.push({
        atBeat: startBeat + i * 0.5,
        note: MUSIC_PENTATONIC_MIN[scaleIdx] + oct,
        dur: 0.30,
        vel: 0.85,
      });
    }
  }
}

// (v15m music upgrade) Champion-field cue : low rumble + crash + ascending
// pad-like swell. Fires when the champion field spawns (last 10 seconds of
// round). Tells the player "endgame is here" without a HUD prompt.
function musicPlayChampionCue() {
  if (!musicEnsureCtx()) return;
  const ctx = music.ctx;
  const t = ctx.currentTime + 0.02;
  const out = music.out;
  // Big low rumble : pitched-down kick + sustained sub sine.
  try {
    _musicSynthDrum(36, 1.20, t, out);
    // Sustained low rumble : 50 Hz sine for ~1.2s.
    const rumble = ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.setValueAtTime(60, t);
    rumble.frequency.exponentialRampToValueAtTime(40, t + 1.2);
    const rumAmp = ctx.createGain();
    rumAmp.gain.setValueAtTime(0, t);
    rumAmp.gain.linearRampToValueAtTime(0.45, t + 0.4);
    rumAmp.gain.linearRampToValueAtTime(0, t + 1.4);
    rumble.connect(rumAmp).connect(out);
    rumble.start(t); rumble.stop(t + 1.5);
    // Cymbal swell : two delayed crashes for big sustained shimmer.
    _musicSynthDrum(49, 0.40, t + 0.10, out);
    _musicSynthDrum(49, 0.30, t + 0.65, out);
    // Ascending lead phrase : root, fifth, octave — "the field calls".
    const startBeat = Math.ceil(music.beat + 0.5);
    music.pendingLeadNotes.push({ atBeat: startBeat,       note: 0,  dur: 0.45, vel: 0.95 });
    music.pendingLeadNotes.push({ atBeat: startBeat + 1,   note: 7,  dur: 0.45, vel: 0.95 });
    music.pendingLeadNotes.push({ atBeat: startBeat + 2,   note: 12, dur: 0.65, vel: 1.00 });
  } catch (_) {}
}

// Round-end victory/defeat phrase (longer scripted lead figure).
function musicPlayRoundEndPhrase(victory) {
  if (!musicEnsureCtx()) return;
  // 4-note phrase quantized to the next beat.
  const startBeat = Math.ceil(music.beat + 0.5);
  const seq = victory
    ? [0, 4, 7, 12]   // ascending major triad
    : [12, 8, 5, 3];  // descending minor figure (lands on b3)
  for (let i = 0; i < seq.length; i++) {
    music.pendingLeadNotes.push({
      atBeat: startBeat + i * 0.5,
      note: seq[i],
      dur: 0.40,
      vel: 0.95,
    });
  }
}

// === PATTERNS ===
// Each pattern: { id, drum(sub16, beat, intensity)->[hits]|null, bass(beat, intensity)->offset|null,
//                 chords:[[degree,quality],...], chordsBars:[bars,...], bassDurBeats }

const MUSIC_PATTERNS = {
  silent: {
    id: 'silent',
    drum: () => null,
    bass: () => null,
    chords: null, chordsBars: null,
  },

  lobby: {
    id: 'lobby',
    drum: (sub, beat, intensity) => {
      const beatInBar = beat % 4;
      const subInBeat = sub % 4;
      const out = [];
      // Hat on every other 16th (8th notes).
      if (subInBeat % 2 === 0) out.push({ note: 42, g: 0.5 });
      // Kick on 1.
      if (subInBeat === 0 && beatInBar === 0) out.push({ note: 36, g: 0.9 });
      // Soft snare on 3.
      if (subInBeat === 0 && beatInBar === 2) out.push({ note: 38, g: 0.5 });
      return out.length ? out : null;
    },
    bass: (beat) => {
      const beatInBar = beat % 4;
      if (beatInBar === 0) return 0;       // root
      if (beatInBar === 2) return 0;       // root again (calm)
      return null;
    },
    bassDurBeats: 2,
    // (v15m music upgrade) Calmer, dreamier lobby with min7 + maj7 colors.
    // i7 - VImaj7 - i(add9) - i7
    chords: [[0, 'min7'], [5, 'maj7'], [0, 'add9'], [0, 'min7']],
    chordsBars: [2, 2, 2, 2],
  },

  warmup: {
    id: 'warmup',
    drum: (sub, beat) => {
      const beatInBar = beat % 4;
      const subInBeat = sub % 4;
      const out = [];
      if (subInBeat % 2 === 0) out.push({ note: 42, g: 0.6 });        // 8th hats
      if (subInBeat === 0 && beatInBar % 2 === 0) out.push({ note: 36, g: 0.95 }); // kick on 1+3
      if (subInBeat === 0 && beatInBar % 2 === 1) out.push({ note: 38, g: 0.7 });  // snare on 2+4
      return out.length ? out : null;
    },
    bass: (beat) => beat % 1 === 0 ? 0 : null, // root pulse every beat
    bassDurBeats: 1,
    chords: [[0, 'min']],
    chordsBars: [4],
  },

  combat: {
    id: 'combat',
    drum: (sub, beat, intensity) => {
      const beatInBar = beat % 4;
      const subInBeat = sub % 4;
      const out = [];
      // Hats: 8ths at int 1, 16ths at int 2+, ghost-16ths at int 3.
      if (intensity >= 2) out.push({ note: 42, g: subInBeat % 2 === 0 ? 0.6 : 0.35 });
      else if (subInBeat % 2 === 0) out.push({ note: 42, g: 0.55 });
      // Kick on 1+3 always; +"and of 4" at int 3.
      if (subInBeat === 0 && (beatInBar === 0 || beatInBar === 2)) out.push({ note: 36, g: 1.0 });
      if (intensity >= 3 && subInBeat === 2 && beatInBar === 3) out.push({ note: 36, g: 0.7 });
      // Snare on 2+4.
      if (subInBeat === 0 && (beatInBar === 1 || beatInBar === 3)) out.push({ note: 38, g: 0.85 });
      // Snare ruff on bar pickup at int 2+.
      if (intensity >= 2 && beat % 16 === 15 && subInBeat >= 1) out.push({ note: 38, g: 0.5 });
      return out.length ? out : null;
    },
    bass: (beat, intensity) => {
      const beatInBar = beat % 4;
      const barInLoop = Math.floor(beat / 4) % 4;
      // 8th-pulse on root + fifth alternation. Bar 4 walks down.
      if (barInLoop === 3) {
        const seq = [0, -2, -3, -5];
        return seq[beatInBar];
      }
      if (beatInBar === 0 || beatInBar === 2) return 0;     // root
      if (beatInBar === 1 || beatInBar === 3) return 7;     // fifth above
      return null;
    },
    bassDurBeats: 1,
    // (v15m music upgrade) Combat now mixes a sus4 build-up before the
    // i7 resolution — adds anticipation. i - VI - sus4_i - i7.
    chords: [[0, 'min'], [5, 'maj'], [0, 'sus4'], [0, 'min7']],
    chordsBars: [2, 1, 1, 2],
  },

  doomed: {
    id: 'doomed',
    drum: (sub, beat) => {
      const beatInBar = beat % 4;
      const subInBeat = sub % 4;
      const out = [];
      // Just kick + hat. No snare. The "tunnel".
      if (subInBeat % 2 === 0) out.push({ note: 42, g: 0.45 });
      if (subInBeat === 0 && (beatInBar === 0 || beatInBar === 2)) out.push({ note: 36, g: 0.9 });
      return out.length ? out : null;
    },
    bass: (beat) => 0, // pedal on root, every beat
    bassDurBeats: 1,
    // (v15m music upgrade) Doomed pattern : dim7 root + b2 min7 = darker, more
    // unstable. The dim7 is famously "I'm in trouble" jazz/horror chord.
    chords: [[0, 'dim7'], [1, 'min7']],
    chordsBars: [2, 2],
  },

  roundEndVictory: {
    id: 'roundEndVictory',
    drum: (sub, beat) => {
      const subInBeat = sub % 4;
      if (beat === 0 && subInBeat === 0) return [{ note: 49, g: 1.0 }, { note: 36, g: 1.0 }];
      if (beat === 1 && subInBeat === 0) return [{ note: 38, g: 0.7 }];
      if (beat === 1 && subInBeat === 2) return [{ note: 38, g: 0.5 }];
      if (beat === 2 && subInBeat === 0) return [{ note: 38, g: 0.4 }];
      return null;
    },
    bass: (beat) => beat === 0 ? 0 : null,
    bassDurBeats: 4,
    chords: [[0, 'maj9']],  // (v15m) Picardy lift → maj9 for lush victory
    chordsBars: [2],
  },

  roundEndDefeat: {
    id: 'roundEndDefeat',
    drum: (sub, beat) => {
      const subInBeat = sub % 4;
      if (beat === 0 && subInBeat === 0) return [{ note: 36, g: 0.7 }];
      return null;
    },
    bass: (beat) => beat === 0 ? 0 : null,
    bassDurBeats: 4,
    chords: [[0, 'min'], [3, 'min'], [0, 'min']],
    chordsBars: [1, 1, 2],
  },

  matchEndVictory: {
    id: 'matchEndVictory',
    drum: () => null,
    bass: (beat) => (beat % 8 === 0) ? 0 : null,
    bassDurBeats: 8,
    // (v15m) Cinematic resolution : Imaj7 - Vsus4 - Imaj9.
    chords: [[0, 'maj7'], [4, 'sus4'], [0, 'maj9']],
    chordsBars: [2, 2, 4],
  },

  matchEndDefeat: {
    id: 'matchEndDefeat',
    drum: () => null,
    bass: (beat) => (beat % 4 === 0) ? 0 : null,
    bassDurBeats: 4,
    // (v15m) Match-end defeat : all-min7 progression for melancholic
    // mood — "Round Midnight"-style harmonic color.
    chords: [[0, 'min7'], [6, 'min7'], [5, 'min7'], [4, 'min7']],
    chordsBars: [2, 2, 2, 2],
  },
};

// === RUNTIME HOOKS (called from existing game functions) ===

// Pattern dispatcher driven by game.state. Called from updateAmbientBed-adjacent
// tick or directly from state-change sites. We expose it so the round system
// can flip patterns on transition.
function musicSyncToGameState() {
  if (!music.enabled) return;
  if (typeof game === 'undefined') return;
  const s = game.state;
  // 'select' is the ship-select / lobby screen ; treat as lobby music.
  if (s === 'select' || s === 'lobby' || s === 'menu' || s === 'connecting') {
    if (music.musicMuteLobby) { musicSetPattern('silent'); return; }
    musicSetPattern('lobby', { bpmTarget: 78, intensity: 1 });
    return;
  }
  if (s === 'warmup') { musicSetPattern('warmup', { bpmTarget: 92, intensity: 1 }); return; }
  if (s === 'playing') {
    musicSetPattern('combat', { bpmTarget: 100, intensity: 1 });
    return;
  }
  // roundEnd / matchEnd handled by direct calls from the round system since
  // they need victor info.
}

// Per-frame updater called from updateAmbientBed (already runs every frame).
// Handles BPM ramp during 'playing' and end-of-round timer-tied phrases.
function musicTickFromMain(dt) {
  if (!music.enabled) return;
  if (typeof game === 'undefined') return;
  if (game.state === 'playing' && typeof game.roundTimer === 'number') {
    const total = (typeof LSS !== 'undefined' && LSS.ROUND_TIME) ? LSS.ROUND_TIME : 180;
    const elapsed = Math.max(0, total - game.roundTimer);
    const f = Math.max(0, Math.min(1, elapsed / total));
    const bpm = 96 + f * 32; // 96 -> 128 across the round
    musicSetBpmTarget(bpm);
    // Intensity ramp.
    if (game.roundTimer < 10) musicSetIntensity(3);
    else if (game.roundTimer < 30) musicSetIntensity(2);
    else musicSetIntensity(1);
  }
  // Doomed mode tracking off the local player's flag (so the music engine
  // doesn't need its own listener for state changes).
  if (typeof player !== 'undefined' && player) {
    const isDoomed = !!player.doomed && player.shipState !== 'dead';
    if (isDoomed && !music.doomedMode) musicEnterMode('doomed');
    else if (!isDoomed && music.doomedMode) musicExitMode('doomed');
    // Stasis suspend.
    const inStasis = !!(typeof game !== 'undefined' && game.playerInStasis);
    if (inStasis !== music.drumsSuspended) musicSuspendDrums(inStasis);
  }
}

// Expose to console + window for diagnostics.
try {
  window.music = music;
  window.musicSetEnabled = musicSetEnabled;
  window.musicSetVolume = musicSetVolume;
  window.musicSetPattern = musicSetPattern;
  window.musicSetBpmTarget = musicSetBpmTarget;
  window.musicSetIntensity = musicSetIntensity;
  window.musicSetCeiling = musicSetCeiling;
  window.musicSetMode = musicSetMode;
  window.musicEnterMode = musicEnterMode;
  window.musicExitMode = musicExitMode;
  window.musicSuspendDrums = musicSuspendDrums;
  window.musicOnKill = musicOnKill;
  window.musicPlayRoundEndPhrase = musicPlayRoundEndPhrase;
  window.musicSyncToGameState = musicSyncToGameState;
  window.musicStart = musicStart;
  window.musicStop = musicStop;
  window.musicSetStyle = musicSetStyle;
  // Riff + style diagnostics: peek/poke from console.
  window.RIFF_RHYTHMS = RIFF_RHYTHMS;
  window.RIFF_CONTOURS = RIFF_CONTOURS;
  window.PATTERN_RIFFS = PATTERN_RIFFS;
  window.MUSIC_STYLES = MUSIC_STYLES;
} catch (_) {}

// ---- HOOK AUDIO INTO EXISTING FUNCTIONS ----
// Override key functions to add sound triggers

const _origFireWeapon = fireWeapon;
fireWeapon = function() {
  _origFireWeapon();
  const w = player.weapon;
  if (!w) return;
  // (bugfix 2026-05-18 #102) Restored sound-dispatch + closing brace
  // from v17o:53245. Extraction dropped both, leaving the entire rest
  // of this file buried inside fireWeapon's body. The broken wrap
  // meant per-weapon fire sounds never played AND announcer / ANN /
  // music functions only became globally available after first fire.
  const isRailgun = w.mode === 'hitscan' && w.fireRate >= 0.8;
  const isMinigun = w.mode === 'hitscan' && w.fireRate < 0.08;
  const isMissile = w.mode === 'projectile' && (w.homing || w.salvo);
  if (isMinigun) playSound('fire_minigun');
  else if (isRailgun) playSound('fire_railgun');
  else if (isMissile) playSound('fire_salvo');
  else if (w.mode === 'hitscan') playSound('fire_hitscan');
  else if (w.mode === 'projectile') playSound('fire_projectile');
  else if (w.mode === 'spread') playSound('fire_spread');
};

// ============================================================================
// SECTION 6 : Announcer (Web Speech API, ship-AI lines)
// ============================================================================
// =====================================================================
// v8VR: Ship AI announcer (Web Speech API)
// =====================================================================
// Procedural in-game voice line system. Uses the browser's built-in
// SpeechSynthesis, no audio assets shipped. Tuned to sound like a ship's
// onboard AI: low pitch + slightly fast rate + male/robotic voice
// preference. Lines route through a queue + per-key cooldown + global
// anti-chain gap so the AI never overlaps itself or spams the player.
//
// Fits the v7.1VR procedural-audio philosophy; speech is generated locally
// by the user's OS each play, no downloads, no recording session.
// =====================================================================
const announcer = {
  enabled: true,
  voice: null,             // resolved SpeechSynthesisVoice object
  voiceName: null,         // persisted voice name (resolves to .voice on init)
  rate: 1.5,               // base / fallback rate; dynamic rates below override
  pitch: 1.0,              // natural pitch; lower the slider for more robotic feel
  volume: 0.9,
  globalGap: 600,          // ms between any two lines (anti-chain)
  cooldowns: {},
  _lastSpokenAt: 0,
  // (v8VR 2026-05-01) Dynamic rate by game state. Slower in menu / lobby
  // / ship-select for clarity, faster in combat for urgency. Toggle the
  // dynamic flag off to use the static `rate` field instead. Per-line
  // opts.rate still overrides everything (priority lines that want their
  // own pace).
  dynamicRate: true,
  rateMenu:     1.05,      // lobby + ship select: deliberate ship-AI welcome
  rateWarmup:   1.30,      // round about to start: alert + composed
  rateCombat:   1.55,      // mid-fight: rushed, urgent
  rateRoundEnd: 1.15,      // round just ended: measured callout
  rateMatchEnd: 1.0,       // victory/defeat banner: slow finality
  // Voice preferences in priority order. We bias toward modern *neural* /
  // *natural* voices that ship with current OSes (Edge's "Online (Natural)"
  // family on Windows, Apple's "Premium" / "Enhanced" on macOS, Google's
  // server-side voices in Chrome). The old "Microsoft David" / robotic
  // Speech API defaults are deliberately near the bottom; they only get
  // picked when nothing better is available.
  voicePrefs: [
    // Default pick: Microsoft Imani Online (Natural). Warm, composed, reads
    // as a calm ship AI rather than a generic news anchor.
    'Microsoft Imani Online (Natural)',
    // Other Microsoft Edge / Windows 11 neural voices (newest, most natural):
    'Microsoft Andrew Online (Natural)',
    'Microsoft Brandon Online (Natural)',
    'Microsoft Brian Online (Natural)',
    'Microsoft Christopher Online (Natural)',
    'Microsoft Eric Online (Natural)',
    'Microsoft Guy Online (Natural)',
    'Microsoft Roger Online (Natural)',
    'Microsoft Steffan Online (Natural)',
    'Microsoft Aria Online (Natural)',
    'Microsoft Jenny Online (Natural)',
    'Online (Natural)',                            // generic catch-all
    // Apple premium / enhanced:
    'Tom (Premium)', 'Tom (Enhanced)',
    'Alex (Enhanced)', 'Daniel (Enhanced)',
    'Premium', 'Enhanced',                          // generic catch-all
    // Google (Chrome built-in):
    'Google UK English Male', 'Google US English',
    // Fallback: legacy SAPI voices (more robotic).
    'Microsoft David', 'Microsoft Mark',
    'Daniel', 'Alex', 'Fred',
    'en-GB', 'en-US',
  ],
};

function announcerInit() {
  if (typeof speechSynthesis === 'undefined') {
    announcer.enabled = false;
    console.log('[v8VR Announcer] SpeechSynthesis API not available; disabled.');
    return;
  }
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return false;

    // 1) Honor a previously-saved exact voice name first.
    if (announcer.voiceName) {
      const exact = voices.find(v => v.name === announcer.voiceName);
      if (exact) { announcer.voice = exact; return true; }
    }
    // 2) Walk our preference list looking for substring match in name OR
    // lang prefix match. First win sticks.
    let chosen = null;
    for (const pref of announcer.voicePrefs) {
      chosen = voices.find(v =>
        v.name.toLowerCase().includes(pref.toLowerCase()) ||
        v.lang.toLowerCase().startsWith(pref.toLowerCase())
      );
      if (chosen) break;
    }
    // 3) Fallback heuristics: any English neural-flavored voice.
    if (!chosen) chosen = voices.find(v => /^en[-_]/i.test(v.lang) && /natural|neural|premium|enhanced|online/i.test(v.name));
    if (!chosen) chosen = voices.find(v => /^en[-_]/i.test(v.lang));
    if (!chosen) chosen = voices[0];
    announcer.voice = chosen;
    if (chosen) console.log('[v8VR Announcer] Voice:', chosen.name, '(' + chosen.lang + ')');
    return !!chosen;
  }
  if (!pickVoice()) {
    speechSynthesis.addEventListener('voiceschanged', pickVoice, { once: true });
  }
}

// Settings-UI helpers.
// Filters and groups available voices into a tidy list of Englishy options.
function announcerListVoices() {
  if (typeof speechSynthesis === 'undefined') return [];
  const voices = speechSynthesis.getVoices() || [];
  const eng = voices.filter(v => /^en[-_]/i.test(v.lang));
  // Sort: natural / premium / enhanced first, then alphabetical.
  return eng.sort((a, b) => {
    const score = (v) => /natural|neural|premium|enhanced|online/i.test(v.name) ? 0 : 1;
    const sd = score(a) - score(b);
    if (sd !== 0) return sd;
    return a.name.localeCompare(b.name);
  });
}

function announcerSetVoiceByName(name) {
  if (typeof speechSynthesis === 'undefined') return false;
  const voices = speechSynthesis.getVoices() || [];
  const v = voices.find(x => x.name === name);
  if (!v) return false;
  announcer.voice     = v;
  announcer.voiceName = name;
  if (typeof saveSettings === 'function') saveSettings();
  return true;
}

function announcerAudition() {
  // Cancel any in-flight speech and play a short representative line so
  // the user can A/B voices without waiting for a real game event.
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  // Bypass the per-key cooldown by speaking directly with priority.
  announcerSay('Systems online. Targeting array calibrated. Engage hostiles.', { priority: true });
}

// Speak a line. opts: { key, cooldown, priority, rate, pitch, volume }
// - key: groups identical lines for cooldown bookkeeping
// - cooldown: seconds before this key can speak again
// - priority: cancels any current speech to play this immediately
function announcerSay(text, opts) {
  opts = opts || {};
  if (!announcer.enabled || !text) return false;
  if (typeof speechSynthesis === 'undefined') return false;
  // Skip in VR (the headset audio path differs and TTS is awkward there);
  // can be revisited if Quest-side TTS becomes desirable.
  if (typeof renderer !== 'undefined' && renderer.xr && renderer.xr.isPresenting) return false;

  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Per-key cooldown gate.
  if (opts.key) {
    const readyAt = announcer.cooldowns[opts.key] || 0;
    if (now < readyAt) return false;
    if (opts.cooldown > 0) announcer.cooldowns[opts.key] = now + opts.cooldown * 1000;
  }
  // Anti-chain global gap (priority lines bypass it).
  if (!opts.priority && (now - announcer._lastSpokenAt) < announcer.globalGap) return false;
  announcer._lastSpokenAt = now;

  if (opts.priority) speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  if (announcer.voice) u.voice = announcer.voice;
  // (v8VR 2026-05-01) Per-call rate beats dynamic rate beats static rate.
  // Lets a priority line specify its own pace (opts.rate) while normal
  // lines respect the game-state cadence.
  u.rate   = opts.rate   != null ? opts.rate   : _announcerCurrentRate();
  u.pitch  = opts.pitch  != null ? opts.pitch  : announcer.pitch;
  u.volume = opts.volume != null ? opts.volume : announcer.volume;
  speechSynthesis.speak(u);
  return true;
}

// Map current game state to an announcer rate. Falls back to announcer.rate
// when dynamicRate is off or game state is unknown. Lobby + ship-select
// + boot read as "menu" pace; warmup + playing + roundEnd + matchEnd
// each get their own tier.
function _announcerCurrentRate() {
  if (!announcer.dynamicRate) return announcer.rate;
  const s = (typeof game !== 'undefined' && game && game.state) ? game.state : '';
  switch (s) {
    // (bugfix 2026-05-19 #182) Port uses 'menu' for the main lobby +
    // boot screen ; map it to the menu rate (1.05) so the intro
    // announcement and any boot callouts speak at a calm deliberate
    // pace instead of falling through to default rate (1.5 = combat).
    case 'menu':
    case 'select':
    case 'lobby':
    case '':
    case undefined:
    case null:
      return announcer.rateMenu;
    case 'warmup':
      return announcer.rateWarmup;
    case 'playing':
      return announcer.rateCombat;
    case 'roundEnd':
      return announcer.rateRoundEnd;
    case 'matchEnd':
      return announcer.rateMatchEnd;
    default:
      return announcer.rate;
  }
}

function announce(key, text, opts) {
  return announcerSay(text, Object.assign({ key: key }, opts || {}));
}

function announcerCancelAll() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

// =====================================================================
// v8VR: Line library â€” keys mapped to ship-AI flavored text
// =====================================================================
// Cooldowns intentionally generous; an AI that yells every 2 seconds is
// noise. Priority flags reserved for genuinely important moments (death,
// round transitions, victory) so they don't get held back by the gap.
// =====================================================================
const ANN = {
  // ---- Match flow ----
  systemsOnline:    () => announce('systemsOnline',    'All systems online. Combat ready.',           { cooldown: 60 }),
  warmupOver:       () => announce('warmupOver',       'Warmup complete. Engage.',                    { cooldown: 5,  priority: true }),
  roundStart:       () => announce('roundStart',       'Round commencing. Engage hostiles.',          { cooldown: 0,  priority: true }),
  victory:          () => announce('victory',          'Victory. All hostiles eliminated.',            { cooldown: 0,  priority: true }),
  defeat:           () => announce('defeat',           'Mission failed.',                              { cooldown: 0,  priority: true }),
  championDeclared: () => announce('championDeclared', 'Champion field active. Hold to capture.',     { cooldown: 0 }),

  // ---- Damage tiers (called from playerTakeDamage health checks) ----
  shieldDown:       () => announce('shieldDown',       'Shields offline.',                             { cooldown: 12 }),
  hullDamage:       () => announce('hullDamage',       'Hull integrity compromised.',                  { cooldown: 18 }),
  criticalDamage:   () => announce('criticalDamage',   'Warning. Critical damage.',                    { cooldown: 8,  priority: true }),
  doomed:           () => announce('doomed',           'Warning. Hull compromised. Find shields immediately.', { cooldown: 30, priority: true }),
  // (v8_2a) Reserved for the moment the player is the last alive ship on
  // their team (all teammates dead). Long cooldown so it doesn't repeat
  // if the team disposition flickers via stasis / respawn.
  lastShipSailing:  () => announce('lastShipSailing',  'You are the last ship sailing. The fleet is yours.', { cooldown: 60, priority: true }),

  // ---- Combat awareness ----
  multipleHostiles: () => announce('multipleHostiles', 'Warning. Multiple ships engaging.',           { cooldown: 15 }),
  enemyLock:        () => announce('enemyLock',        'Lock detected. Evasive maneuvers.',           { cooldown: 8 }),
  ramming:          () => announce('ramming',          'Brace for impact.',                            { cooldown: 6 }),
  stasisActive:     () => announce('stasisActive',     'Stasis field engaged.',                        { cooldown: 10 }),

  // ---- Kill confirmations + multikill ramp ----
  enemyDown:        () => announce('enemyDown',        'Target eliminated.',                           { cooldown: 4 }),
  doubleKill:       () => announce('doubleKill',       'Double kill.',                                 { cooldown: 3, priority: true }),
  tripleKill:       () => announce('tripleKill',       'Triple kill.',                                 { cooldown: 3, priority: true }),
  rampage:          () => announce('rampage',          'Rampage.',                                     { cooldown: 3, priority: true }),
  unstoppable:      () => announce('unstoppable',      'Unstoppable.',                                 { cooldown: 3, priority: true }),
  godlike:          () => announce('godlike',          'Godlike.',                                     { cooldown: 3, priority: true }),

  // ---- Abilities + core ----
  abilityReady:     () => announce('abilityReady',     'Ability online.',                              { cooldown: 6 }),
  coreReady:        () => announce('coreReady',        'Core charged and ready.',                      { cooldown: 12, priority: true }),
  dashReady:        () => announce('dashReady',        'Dash drive ready.',                            { cooldown: 10 }),

  // ---- Map / arena ----
  enteringArena:    () => announce('enteringArena',    'Entering combat zone.',                        { cooldown: 60, priority: true }),
  lowAmmo:          () => announce('lowAmmo',          'Ammunition low.',                              { cooldown: 15 }),

  // ---- Ship select (parameterized by chosen chassis) ----
  welcomeAboard: (shipName) => announce('welcomeAboard',
    'Welcome aboard, ' + (shipName || 'pilot') + '. All systems online.',
    { cooldown: 8, priority: true }),

  // ---- Boot / lobby intro (one-shot per session) ----
  introBoot: () => announce('introBoot',
    'Welcome to Last Ship Sailing, pilot! Choose your adventure, climb in a ship, and come join the battle.',
    { cooldown: 600, priority: true }),

  // ---- Round-end personal callouts (vs. match-end victory/defeat above) ----
  roundWon:  () => announce('roundWon',  'Round won. Great job.',     { cooldown: 0, priority: true }),
  roundLost: () => announce('roundLost', 'Round lost. Try again.',    { cooldown: 0, priority: true }),
};

// Try to init now. If voices are not yet enumerated the voiceschanged
// event handler inside announcerInit will pick the voice when ready.
try { announcerInit(); } catch (e) { console.warn('[v8VR Announcer] init failed:', e); }

// Helper: pick the right multikill line from streak count.
function announceMultikill(streak) {
  if (streak === 2) return ANN.doubleKill();
  if (streak === 3) return ANN.tripleKill();
  if (streak === 4) return ANN.rampage();
  if (streak === 5) return ANN.unstoppable();
  if (streak >= 6)  return ANN.godlike();
  return false;
}

window.announcer             = announcer;
window.announcerSay          = announcerSay;
window.announce              = announce;
window.announcerCancelAll    = announcerCancelAll;
window.announcerListVoices   = announcerListVoices;
window.announcerSetVoiceByName = announcerSetVoiceByName;
window.announcerAudition     = announcerAudition;
window.ANN                   = ANN;
window.announceMultikill     = announceMultikill;
