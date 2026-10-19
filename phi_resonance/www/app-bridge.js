// Phi Resonance: app bridge.
// Created: 2026-09-29. Last updated: 2026-10-18. Version: 1.1.
// Loaded by index.html before its main script. Outside the app (no Capacitor, e.g. index.html
// opened in a browser) every function here is a harmless no-op, so the page still runs as it does
// on fractalreality.ca.
//
// What it gives the app:
//   1. iOS: asks WebKit for a 'playback' audio session (Safari/WKWebView 16.4+), so sound plays with
//      the silent switch on and keeps playing with the screen locked (Info.plist has
//      UIBackgroundModes audio; AppDelegate sets AVAudioSession to .playback as well).
//   2. Android: runs the PlaybackService plugin (android/.../PlaybackService.java) while a session
//      plays. Android 17 silences screen-off audio from an app with no visible activity and no
//      mediaPlayback foreground service; its notification also carries a Stop button, and its line
//      follows the sound (the page's mode and base, or the composer's style and tempo).
//   3. Resumes the AudioContext when the app returns to the foreground (WKWebView can leave it
//      'interrupted' or 'suspended' after a trip to the background). The page says when there is
//      nothing to resume: while its screen-off loop plays, the live engine is paused on purpose.
//   4. Export: a.download does nothing inside an app WebView, so files are written to the app cache
//      and handed to the share sheet (Save to Files, Drive, AirDrop, email...).
// The lock screen's Media Session (title, artwork, play and pause) is the page's own.
//
// index.html calls, each marked [PHI-APP] there:
//   PhiApp.attach({ start, stop, isPlaying, getContext, describe })   once, at the end of its script
//   PhiApp.sessionStarted() / PhiApp.sessionStopped()                  from startSession / stopSession
//   PhiApp.sessionChanged()                                            whenever the page updates its
//                                                                      Media Session
//   PhiApp.saveFile(blob, filename) -> true if handled natively        from both export paths
//
// Revision history:
// - 2026-10-18 v1.1: the page is now the Composer edition: the Media Session is left to the page,
//   the notification's line follows sound changes (sessionChanged), no resume while the page's
//   screen-off loop plays
// - 2026-09-29 v1.0: initial
(function () {
  'use strict';

  var Cap = window.Capacitor;
  var native = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  var platform = native && typeof Cap.getPlatform === 'function' ? Cap.getPlatform() : 'web';

  function plugin(name) {
    try { return native && typeof Cap.registerPlugin === 'function' ? Cap.registerPlugin(name) : null; }
    catch (_) { return null; }
  }
  var Playback = platform === 'android' ? plugin('PlaybackService') : null;
  var Filesystem = plugin('Filesystem');
  var Share = plugin('Share');

  // (1) Must be set before the AudioContext exists; index.html creates it on the first touch or on
  // BEGIN SESSION, both after this file has run.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}

  var hooks = null;
  var stopDelay = null;
  var serviceOn = false;
  var lastLine = '';

  function describe() {
    try { return (hooks && hooks.describe && hooks.describe()) || ''; } catch (_) { return ''; }
  }

  function quiet(p) { if (p && typeof p.catch === 'function') p.catch(function () {}); }

  function startService() {
    lastLine = describe() || 'Session playing';
    quiet(Playback.start({ title: 'Phi Resonance', text: lastLine }));
    serviceOn = true;
  }

  // (3)
  function resumeIfNeeded() {
    if (!hooks || !hooks.isPlaying()) return;
    var ctx = hooks.getContext();
    if (ctx && ctx.state !== 'running' && typeof ctx.resume === 'function') quiet(ctx.resume());
  }

  window.PhiApp = {
    native: native,
    platform: platform,

    attach: function (h) { hooks = h; },

    sessionStarted: function () {
      clearTimeout(stopDelay);
      stopDelay = null;
      // (2) Started from the BEGIN SESSION tap, i.e. while the app is visible: Android only lets
      // an app start a foreground service from the foreground.
      if (Playback) startService();
    },

    sessionStopped: function () {
      // A short wait, so a stop and an immediate new start (the notification's Stop, then
      // BEGIN SESSION) do not take the notification down and put it straight back.
      clearTimeout(stopDelay);
      stopDelay = setTimeout(function () {
        stopDelay = null;
        if (Playback && serviceOn && !(hooks && hooks.isPlaying())) {
          quiet(Playback.stop());
          serviceOn = false;
        }
      }, 600);
    },

    // (2) The sound changed (a preset, the mode, the composer): refresh the notification's line.
    // Only while the app is visible: Android may refuse a foreground-service call from the
    // background, and nothing changes the sound there anyway.
    sessionChanged: function () {
      if (!Playback || !serviceOn || document.hidden) return;
      if (!(hooks && hooks.isPlaying())) return;
      if (describe() === lastLine) return;
      startService();
    },

    // (4) Returns true when the app handled the file; the page then skips its a.download path.
    saveFile: function (blob, filename) {
      if (!native || !Filesystem || !Share) return false;
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result || '');
        var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        Filesystem.writeFile({ path: filename, data: base64, directory: 'CACHE' })
          .then(function (res) { return Share.share({ title: filename, files: [res.uri] }); })
          .catch(function (e) {
            var msg = String((e && e.message) || e || '');
            if (!/cancel/i.test(msg)) window.alert('Could not share ' + filename + (msg ? ': ' + msg : ''));
          });
      };
      reader.onerror = function () { window.alert('Could not read ' + filename + ' for sharing.'); };
      reader.readAsDataURL(blob);
      return true;
    }
  };

  document.addEventListener('visibilitychange', function () { if (!document.hidden) resumeIfNeeded(); });
  window.addEventListener('focus', resumeIfNeeded);
  window.addEventListener('pageshow', resumeIfNeeded);

  // (2) The notification's Stop button.
  if (Playback && typeof Playback.addListener === 'function') {
    quiet(Playback.addListener('stopRequested', function () {
      if (hooks && hooks.isPlaying()) hooks.stop();
    }));
  }
})();
