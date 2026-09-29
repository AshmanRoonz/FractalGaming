// Phi Resonance: app bridge.
// Created 2026-09-29. Loaded by index.html before its main script. Outside the app (no Capacitor,
// e.g. index.html opened in a browser) every function here is a harmless no-op, so the page still
// runs as it does on fractalreality.ca.
//
// What it gives the app:
//   1. iOS: asks WebKit for a 'playback' audio session (Safari/WKWebView 16.4+), so sound plays with
//      the silent switch on and keeps playing with the screen locked (Info.plist has
//      UIBackgroundModes audio; AppDelegate sets AVAudioSession to .playback as well).
//   2. Android: runs the PlaybackService plugin (android/.../PlaybackService.java) while a session
//      plays. Android 17 silences screen-off audio from an app with no visible activity and no
//      mediaPlayback foreground service; its notification also carries a Stop button.
//   3. Media Session: lock-screen and headset controls where the platform offers them for web audio.
//   4. Resumes the AudioContext when the app returns to the foreground (WKWebView can leave it
//      'interrupted' or 'suspended' after a trip to the background).
//   5. Export: a.download does nothing inside an app WebView, so files are written to the app cache
//      and handed to the share sheet (Save to Files, Drive, AirDrop, email...).
//
// index.html calls, each marked [PHI-APP] there:
//   PhiApp.attach({ start, stop, isPlaying, getContext, describe })   once, at the end of its script
//   PhiApp.sessionStarted() / PhiApp.sessionStopped()                  from startSession / stopSession
//   PhiApp.saveFile(blob, filename) -> true if handled natively        from both export paths
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

  function describe() {
    try { return (hooks && hooks.describe && hooks.describe()) || ''; } catch (_) { return ''; }
  }

  function quiet(p) { if (p && typeof p.catch === 'function') p.catch(function () {}); }

  // (3)
  function setMediaSession(playing) {
    var ms = navigator.mediaSession;
    if (!ms) return;
    try {
      if (playing && typeof window.MediaMetadata === 'function') {
        ms.metadata = new window.MediaMetadata({
          title: 'Phi Resonance',
          artist: describe(),
          album: 'Sound lab',
          artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
        });
      }
      ms.playbackState = playing ? 'playing' : 'paused';
    } catch (_) {}
  }

  // (4)
  function resumeIfNeeded() {
    if (!hooks || !hooks.isPlaying()) return;
    var ctx = hooks.getContext();
    if (ctx && ctx.state !== 'running' && typeof ctx.resume === 'function') quiet(ctx.resume());
  }

  window.PhiApp = {
    native: native,
    platform: platform,

    attach: function (h) {
      hooks = h;
      var ms = navigator.mediaSession;
      if (ms && typeof ms.setActionHandler === 'function') {
        var set = function (action, fn) { try { ms.setActionHandler(action, fn); } catch (_) {} };
        set('play', function () { if (!hooks.isPlaying()) hooks.start(); });
        set('pause', function () { if (hooks.isPlaying()) hooks.stop(); });
        set('stop', function () { if (hooks.isPlaying()) hooks.stop(); });
      }
    },

    sessionStarted: function () {
      clearTimeout(stopDelay);
      stopDelay = null;
      setMediaSession(true);
      // (2) Started from the BEGIN SESSION tap, i.e. while the app is visible: Android only lets
      // an app start a foreground service from the foreground.
      if (Playback) {
        quiet(Playback.start({ title: 'Phi Resonance', text: describe() || 'Session playing' }));
        serviceOn = true;
      }
    },

    sessionStopped: function () {
      setMediaSession(false);
      // startSession() calls stopSession() first to rebuild the sound graph (every preset change
      // does this), so wait a moment: a restart must not take the notification down and put it
      // straight back.
      clearTimeout(stopDelay);
      stopDelay = setTimeout(function () {
        stopDelay = null;
        if (Playback && serviceOn && !(hooks && hooks.isPlaying())) {
          quiet(Playback.stop());
          serviceOn = false;
        }
      }, 600);
    },

    // (5) Returns true when the app handled the file; the page then skips its a.download path.
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
