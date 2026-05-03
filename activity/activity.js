// LSS Discord Activity stub.
//
// This file runs inside Discord's iframe at:
//   https://1500305353210855615.discordsays.com/
// which proxies to lss.fractalreality.ca/activity/index.html.
//
// Discord's iframe enforces a strict CSP that blocks inline scripts,
// inline event handlers (onclick=), external CDN fonts/scripts, and
// several browser APIs (WebXR, Wake Lock, full-screen). Rather than
// fight all of that to host the full game inside the iframe, this
// stub exists only to hand off into a regular browser window where
// LSS can run with all features intact (VR support, full screen, the
// actual lobby).
//
// What this file does:
//   1. Wires up the ENGAGE button to open lss.fractalreality.ca in a
//      new browser window when clicked.
//   2. Forwards the Discord iframe's URL parameters (instance_id,
//      channel_id, etc.) to the new window as ?discord_* params, so
//      the game can later use them to coordinate with this Activity.
//   3. Reports popup-blocked / popup-success state to the user.

(function () {
  'use strict';

  // The full-game URL we open. Always lss.fractalreality.ca ; the
  // browser window is a regular tab, not the Discord iframe, so it
  // gets the unmodified game with no CSP / permission constraints.
  var GAME_URL = 'https://lss.fractalreality.ca/';

  // Discord injects context as URL params on the iframe's URL. We
  // forward whatever we received so the game window can act on it
  // later (e.g. pre-fill the lobby with voice-channel members).
  var FORWARD_PARAMS = [
    'instance_id', 'channel_id', 'location_id', 'launch_id',
    'guild_id', 'frame_id', 'platform', 'referrer_id',
  ];

  function buildGameUrl() {
    var src = new URLSearchParams(window.location.search);
    var url = new URL(GAME_URL);
    url.searchParams.set('source', 'discord_activity');
    for (var i = 0; i < FORWARD_PARAMS.length; i++) {
      var k = FORWARD_PARAMS[i];
      var v = src.get(k);
      if (v) url.searchParams.set('discord_' + k, v);
    }
    return url.toString();
  }

  function setStatus(text, kind) {
    var el = document.getElementById('status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function onEngage() {
    var url = buildGameUrl();
    // Use a named target so a second click reuses the same tab.
    // No 'noopener' here ; we may want postMessage between windows
    // in a later iteration. Discord's iframe does not block window.open
    // when triggered by a real user gesture (button click).
    var win = window.open(url, 'lss_game');
    if (!win) {
      setStatus(
        'Pop-up blocked. Allow pop-ups for Discord, then click ENGAGE again.',
        'error'
      );
      return;
    }
    setStatus(
      'Game opened in a new window. You can close this Activity panel.',
      'ok'
    );
    // Best-effort: focus the new window if the browser allows.
    try { win.focus(); } catch (_) {}
  }

  function init() {
    var btn = document.getElementById('engage-btn');
    if (!btn) return;
    btn.addEventListener('click', onEngage);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
