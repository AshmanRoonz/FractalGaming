// LSS Discord Activity stub.
//
// This file runs inside Discord's iframe at:
//   https://1500305353210855615.discordsays.com/activity/
// (the game's head shim redirect.js bounces the root mapping here when the
// page is served through the Activity proxy).
//
// Discord's iframe enforces a strict CSP that blocks inline scripts,
// inline event handlers (onclick=), external CDN fonts/scripts, and
// several browser APIs (WebXR, Wake Lock, full-screen). It also strips
// the iframe sandbox's allow-popups permission, so plain window.open()
// is hard-blocked. The official escape hatch is the Discord Embedded
// App SDK's commands.openExternalLink() method, which routes the
// navigation through Discord's parent window instead.
//
// What this file does:
//   1. Loads the Discord Embedded App SDK (vendored locally as
//      discord-sdk.js — @discord/embedded-app-sdk@2.5.0, esm.sh bundle —
//      so it satisfies the script-src 'self' CSP rule).
//   2. Initializes the SDK with our Application ID and awaits ready()
//      WITH A TIMEOUT. A 2026-07 field test showed ready() can hang
//      forever (no error, no resolve) — the old code awaited it
//      unconditionally, so ENGAGE clicks died silently. Now init
//      settles within SDK_READY_TIMEOUT_MS no matter what, and if
//      ready() straggles in late we adopt the SDK for the next click.
//   3. Logs a capped handshake trace of window "message" events so a
//      hang shows WHAT the client actually sent (or that it sent
//      nothing) — paste the console when reporting issues.
//   4. Wires ENGAGE to a fallback chain that always ends with something
//      clickable: SDK openExternalLink → window.open → a plain visible
//      <a target="_blank"> link under the button.
//
// Outside Discord (no frame_id/instance_id in the URL) the SDK is
// skipped entirely and window.open handles it, so direct-browser
// testing of /activity/ still works.

import { DiscordSDK } from './discord-sdk.js';

const APPLICATION_ID = '1500305353210855615';
const GAME_URL       = 'https://lss.fractalreality.ca/';
const SDK_READY_TIMEOUT_MS = 5000;

// Discord forwards context as URL params on the iframe URL. We pass
// these through to the popup so the game can act on them later
// (e.g. pre-populate the lobby with voice-channel members).
const FORWARD_PARAMS = [
  'instance_id', 'channel_id', 'location_id', 'launch_id',
  'guild_id', 'frame_id', 'platform', 'referrer_id',
];

// Built once on boot; null while pending, the SDK once ready, or false
// if init failed/timed out (fallback chain handles it from there).
let _sdk = null;
let _sdkPromise = null; // resolves once init has settled (success or fail)

// ---- handshake trace ------------------------------------------------
// The Embedded App SDK talks to the client via postMessage frames of the
// shape [opcode, payload]. Logging the first dozen incoming messages
// tells us whether the client ever answered our HELLO — the difference
// between "SDK too old / protocol mismatch" (frames arrive, ready()
// still hangs) and "no RPC bridge in this context" (silence).
let _msgSeen = 0;
window.addEventListener('message', (ev) => {
  if (_msgSeen >= 12) return;
  _msgSeen++;
  let tag;
  try {
    const d = ev.data;
    if (Array.isArray(d)) {
      const p = d[1] || {};
      tag = 'op=' + d[0] + (p.evt ? ' evt=' + p.evt : '') + (p.cmd ? ' cmd=' + p.cmd : '');
    } else if (d && typeof d === 'object') {
      tag = 'keys=' + Object.keys(d).slice(0, 5).join(',');
    } else {
      tag = String(d).slice(0, 60);
    }
  } catch (_) { tag = '(unreadable)'; }
  console.log('[lss-activity][trace] message #' + _msgSeen + ' from', ev.origin, '->', tag);
});

function buildGameUrl() {
  const src = new URLSearchParams(window.location.search);
  const url = new URL(GAME_URL);
  url.searchParams.set('source', 'discord_activity');
  for (const k of FORWARD_PARAMS) {
    const v = src.get(k);
    if (v && v !== 'undefined') url.searchParams.set('discord_' + k, v);
  }
  return url.toString();
}

function setStatus(text, kind) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

// Last-resort escape hatch: a real anchor the user can click/tap. Some
// embed contexts (e.g. the desktop popout) allow user-gesture anchor
// navigation where scripted window.open is blocked. Element-level
// styles are fine under the iframe CSP (style-src has unsafe-inline).
function showManualLink(url) {
  let a = document.getElementById('manual-link');
  if (!a) {
    a = document.createElement('a');
    a.id = 'manual-link';
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.cssText = 'display:inline-block;margin-top:14px;color:#ffaa00;' +
      'font-size:13px;letter-spacing:2px;text-decoration:underline;cursor:pointer;';
    const btn = document.getElementById('engage-btn');
    if (btn && btn.parentNode) btn.parentNode.insertBefore(a, btn.nextSibling);
    else document.body.appendChild(a);
  }
  a.href = url;
  a.textContent = 'TAP HERE TO OPEN THE GAME IN YOUR BROWSER';
}

function inDiscordIframe() {
  // Heuristic: we're inside Discord's iframe if the URL has frame_id
  // or instance_id (Discord injects these on launch). Outside Discord
  // (e.g. testing /activity/ directly in a browser tab), neither is
  // present and we use window.open instead of the SDK.
  const p = new URLSearchParams(window.location.search);
  return !!(p.get('frame_id') || p.get('instance_id'));
}

async function initSdk() {
  if (!inDiscordIframe()) {
    console.log('[lss-activity] Not in Discord iframe; skipping SDK init.');
    _sdk = false;
    return;
  }
  console.log('[lss-activity] Initializing Discord SDK (bundle 2.5.0) with appId', APPLICATION_ID);
  try {
    const sdk = new DiscordSDK(APPLICATION_ID);
    const ready = sdk.ready();
    // Adopt a straggler: if ready() resolves after our timeout already
    // marked the SDK unavailable, upgrade in place so the NEXT click
    // takes the SDK path.
    ready.then(() => {
      if (_sdk === false) {
        _sdk = sdk;
        console.log('[lss-activity] ready() resolved AFTER timeout; SDK adopted for next click.');
      }
    }).catch(() => {});
    await Promise.race([
      ready,
      new Promise((_, rej) => setTimeout(
        () => rej(new Error('ready() did not resolve within ' + SDK_READY_TIMEOUT_MS + 'ms')),
        SDK_READY_TIMEOUT_MS)),
    ]);
    _sdk = sdk;
    console.log('[lss-activity] Discord SDK ready.');
  } catch (err) {
    console.error('[lss-activity] Discord SDK init failed:', err);
    if (_sdk === null) _sdk = false;
    setStatus('Discord link is slow or blocked ; using fallback.', 'warn');
  }
}

async function onEngage() {
  const url = buildGameUrl();
  console.log('[lss-activity] ENGAGE clicked ; target url:', url);

  // Wait for SDK init to settle before deciding which path to take.
  // initSdk() is timeout-bounded, so this can no longer hang the click.
  if (_sdkPromise) {
    setStatus('Connecting to Discord...', 'warn');
    try { await _sdkPromise; } catch (_) {}
  }

  // Prefer the SDK route when available ; it bypasses the iframe
  // popup-block by handing the URL to Discord's parent window.
  if (_sdk) {
    try {
      console.log('[lss-activity] calling openExternalLink via SDK...');
      await _sdk.commands.openExternalLink({ url });
      setStatus('Game opened in your default browser.', 'ok');
      return;
    } catch (err) {
      console.error('[lss-activity] openExternalLink failed:', err);
      setStatus('Discord blocked the open. Trying direct popup...', 'warn');
    }
  } else {
    console.warn('[lss-activity] SDK not available ; using window.open fallback.');
  }

  // Fallback: plain window.open. Works when /activity/ is loaded
  // outside Discord (regular browser tab) and in some embed contexts.
  let win = null;
  try { win = window.open(url, '_blank', 'noopener'); } catch (_) {}
  if (win) {
    setStatus('Game opened in a new window. You can close this Activity panel.', 'ok');
    try { win.focus(); } catch (_) {}
    return;
  }

  // Final fallback: give the user a real link to click. A direct
  // user-gesture anchor navigation survives contexts that block
  // scripted popups.
  console.warn('[lss-activity] window.open blocked ; showing manual link.');
  showManualLink(url);
  setStatus('Pop-up blocked here. Use the link below instead:', 'warn');
}

function init() {
  const btn = document.getElementById('engage-btn');
  if (btn) btn.addEventListener('click', onEngage);
  // Kick off SDK init in parallel ; onEngage awaits this promise, and
  // initSdk is timeout-bounded so the button always settles.
  _sdkPromise = initSdk();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
