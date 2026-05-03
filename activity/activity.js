// LSS Discord Activity stub.
//
// This file runs inside Discord's iframe at:
//   https://1500305353210855615.discordsays.com/
// which proxies to lss.fractalreality.ca/activity/index.html.
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
//   1. Loads the Discord Embedded App SDK (locally hosted in this
//      folder so it satisfies the script-src 'self' CSP rule).
//   2. Initializes the SDK with our Application ID, awaits ready().
//   3. Wires the ENGAGE button to open the full game in a new browser
//      window via discordSdk.commands.openExternalLink(). Forwards the
//      Discord iframe context (instance_id, channel_id, etc.) as
//      ?discord_* URL params so the game can use them later.
//   4. Falls back to plain window.open() if loaded outside Discord
//      (so direct-browser testing of /activity/ still works).

import { DiscordSDK } from './discord-sdk.js';

const APPLICATION_ID = '1500305353210855615';
const GAME_URL       = 'https://lss.fractalreality.ca/';

// Discord forwards context as URL params on the iframe URL. We pass
// these through to the popup so the game can act on them later
// (e.g. pre-populate the lobby with voice-channel members).
const FORWARD_PARAMS = [
  'instance_id', 'channel_id', 'location_id', 'launch_id',
  'guild_id', 'frame_id', 'platform', 'referrer_id',
];

// Built once on boot; null while pending, the SDK once ready, or false
// if init failed (we fall back to window.open in that case).
let _sdk = null;
let _sdkPromise = null; // resolves once init has settled (success or fail)

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
  console.log('[lss-activity] Initializing Discord SDK with appId', APPLICATION_ID);
  try {
    const sdk = new DiscordSDK(APPLICATION_ID);
    await sdk.ready();
    _sdk = sdk;
    console.log('[lss-activity] Discord SDK ready.');
  } catch (err) {
    console.error('[lss-activity] Discord SDK init failed:', err);
    _sdk = false;
    setStatus('Discord SDK unavailable ; will try direct popup.', 'warn');
  }
}

async function onEngage() {
  const url = buildGameUrl();
  console.log('[lss-activity] ENGAGE clicked ; target url:', url);

  // Wait for SDK init to settle before deciding which path to take.
  // Without this, an early click would fall through to window.open
  // even though the SDK was about to be ready.
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
  // outside Discord (regular browser tab); blocked inside Discord's
  // sandboxed iframe but worth trying as a last resort.
  const win = window.open(url, 'lss_game');
  if (!win) {
    setStatus(
      'Pop-up blocked. Allow pop-ups for this site, then click ENGAGE again.',
      'error'
    );
    return;
  }
  setStatus('Game opened in a new window. You can close this Activity panel.', 'ok');
  try { win.focus(); } catch (_) {}
}

function init() {
  const btn = document.getElementById('engage-btn');
  if (btn) btn.addEventListener('click', onEngage);
  // Kick off SDK init in parallel ; onEngage will await this promise
  // so an early click doesn't fall through to the fallback before the
  // SDK has had a chance to load.
  _sdkPromise = initSdk();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
