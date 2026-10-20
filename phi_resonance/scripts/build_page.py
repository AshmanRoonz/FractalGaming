"""Build www/index.html, the Phi Resonance app's page, from the web Composer edition.

Created: 2026-10-18
Last updated: 2026-10-19
Version: 1.4

Usage, from phi_resonance/ (the path is wherever the Fractal_Reality repo sits; beside FractalGaming
it is ../../Fractal_Reality):

    python scripts/build_page.py ../../Fractal_Reality/docs/phi_resonance_composer.html

The app's page is the φ-Entrainment Composer page from fractalreality.ca with a short list of app
edits, each marked [PHI-APP] in the output. Every edit has to find its anchor exactly once or the
build stops, so a change on the web side that moves an anchor is caught here instead of shipping a
half-edited page. To bring a later web change into the app, run this again; when it stops, fix the
anchor below, not the output.

Revision history:
- 2026-10-19 v1.4: the footer is one link to fractalreality.ca (the owner's wish); the privacy policy
  stays linked from the About tab, as Apple and Google Play want
- 2026-10-19 v1.3: measured on the owner's phone over USB: the full-screen flashes skip the WebView's
  full-screen mode (the overlay covers the page already); the latency notes now carry the numbers
- 2026-10-19 v1.2: the owner still heard the sound cut in and out, most when moving around the
  app: on Android the latency hint is now 0.15 s (Chromium renders up to about 170 ms ahead, where
  'playback' gave about 21 ms); iOS keeps 'playback'
- 2026-10-19 v1.1: after the owner's first Android test (hitching every few seconds, sound stopped
  on lock, no lock button): the 'playback' latency hint (Android's power-saving audio path), a
  ten-second silent clip, and the page's screen-off loop and lock button kept on Android too
- 2026-10-18 v1.0: initial; replaces September's hand-edited copy of the plain lab page
"""
import io
import os
import re
import subprocess
import sys

if len(sys.argv) != 2:
    sys.exit(__doc__)
src = os.path.abspath(sys.argv[1])
here = os.path.dirname(os.path.abspath(__file__))
dst = os.path.join(here, '..', 'www', 'index.html')

s = io.open(src, encoding='utf-8', newline='').read().replace('\r\n', '\n')


def source_commit(path):
    """The web repo's last commit of the page, plus a note when the file has local changes."""
    folder, name = os.path.split(path)
    try:
        commit = subprocess.run(['git', '-C', folder, 'log', '-1', '--format=%h', '--', name],
                                capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(['git', '-C', folder, 'status', '--porcelain', '--', name],
                               capture_output=True, text=True).stdout.strip()
    except OSError:
        return 'unknown'
    return (commit or 'unknown') + (' plus uncommitted changes' if dirty else '')


def rep(a, b, count=1):
    global s
    n = s.count(a)
    assert n == count, 'anchor found %d times (wanted %d): %r' % (n, count, a[:90])
    s = s.replace(a, b)


commit = source_commit(src)

# ---- head: the name, where this file comes from, fonts that are bundled ----
rep('<title>φ-Entrainment Composer | Sound Laboratory</title>',
    '<!-- [PHI-APP] This file is built by ../scripts/build_page.py from Fractal_Reality/docs/phi_resonance_composer.html\n'
    '     (Fractal_Reality commit ' + commit + '). Do not edit it by hand: change the web page, or the\n'
    '     edits in the script, and build again. Every app change is marked [PHI-APP]; see ../README.md. -->\n'
    '<!-- [PHI-APP] The app\'s name. "Entrainment" reads as a claim to change the body, which store\n'
    '     health rules treat as a medical claim (see ../README.md, "Positioning"). -->\n'
    '<title>Phi Resonance</title>')
rep('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;600;700;900&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet">',
    '<!-- [PHI-APP] Orbitron and Rajdhani are bundled in fonts/ (SIL Open Font License) instead of\n'
    '     coming from Google Fonts: the app makes no network requests. -->\n'
    '<link rel="stylesheet" href="fonts/fonts.css">')
# The page's own screen-off loop and its lock button stay on every platform: the owner tried the
# first Android build (2026-10-19), missed the button, and the loop is what plays well on the same
# phone in the browser. The native playback service still keeps the app allowed to play with the
# screen off.

# ---- sound that holds up inside an app's WebView ----
# On the owner's phone the app's sound cut in and out, most when moving around the app, while the
# browser on the same phone played cleanly: inside a WebView the page's audio thread misses its
# deadlines while the screen is busy. The fix is a deeper buffer, rendered further ahead.
# - Android: a latency hint in seconds. Chromium renders that much ahead (up to 8192 frames, about
#   170 ms), where the default renders one hardware buffer (a few ms) and 'playback' about 21 ms
#   (media/base/audio_latency.cc; media/audio/android/audio_manager_android.cc). Build script v1.1
#   used 'playback'; the owner still heard dropouts.
# - iOS: 'playback', WebKit's own choice for long listening.
# A sound lab needs no low latency; the screen-off path is the lock button's loop either way.
# Measured on the owner's Pixel 9 over USB (2026-10-19): with the page's drawing capped at 30 frames a
# second (Composer page v1.7), 0.15 played with no underruns at either level, while 'playback' (21 ms
# ahead) starved the page's audio, 391 underruns a minute. The dropouts came from the drawing: at the
# screen's 120 Hz it took about three cores, the phone throttled to 700 MHz, and Android's low-latency
# path (2 ms bursts, about 6 ms of margin) missed over 1,000 deadlines a minute.
rep('state.ctx = new (window.AudioContext || window.webkitAudioContext)();',
    "state.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: APP_LATENCY_HINT });"
    '   // [PHI-APP]')
rep('  function ensureAudio() {',
    '  // [PHI-APP] how far ahead the sound is rendered (see ../scripts/build_page.py): deep on Android,\n'
    '  // where the WebView\'s audio thread misses short deadlines while the screen is busy\n'
    "  const APP_LATENCY_HINT = (window.PhiApp && window.PhiApp.platform === 'android') ? 0.15 : 'playback';\n\n"
    '  function ensureAudio() {')
# The full-screen flashes: the overlay already covers the app's whole page, and asking the WebView
# for full screen as well doubled the app's own drawing work on the owner's Pixel 9 (measured over USB,
# 2026-10-19: the app's UI and render threads went from about 11% and 16% of a core to 24% and 28%,
# and a run on a warm phone counted 666 Android audio underruns a minute). In the app, the overlay alone.
rep("""      // Request fullscreen (best effort; silently falls back to fixed overlay)
      if (overlay.requestFullscreen) {""",
    """      // Request fullscreen (best effort; silently falls back to fixed overlay)
      if (window.PhiApp && window.PhiApp.native) {
        // [PHI-APP] not in the app: the overlay already covers the whole page (see ../scripts/build_page.py)
      } else if (overlay.requestFullscreen) {""")
# The silent clip that keeps the screen-off loop's <audio> element ready plays all session; the web's
# is half a second, so it restarts twice a second. Ten seconds at 8 kHz (320 KB) restarts rarely.
rep('      const z = new Float32Array(22050);\n'
    '      loopState.silentUrl = URL.createObjectURL(encodeWav([z, z], 44100));',
    '      // [PHI-APP] ten seconds (the web\'s is half a second), so the element restarts rarely\n'
    '      const z = new Float32Array(80000);\n'
    '      loopState.silentUrl = URL.createObjectURL(encodeWav([z, z], 8000));')

# ---- the page ----
rep('<div class="brand"><span class="lss-tag"><span class="lt-text">φ-COMPOSER</span></span></div>',
    '<div class="brand"><span class="lss-tag"><span class="lt-text">φ RESONANCE</span></span></div>'
    '<!-- [PHI-APP] was φ-COMPOSER -->')
rep('This is a sound tool for relaxation and exploration, not a medical treatment.</div>\n',
    'This is a sound tool for relaxation and exploration, not a medical treatment.</div>\n'
    '      <!-- [PHI-APP] Google Play\'s Health Content and Services policy asks health-adjacent apps that\n'
    '           are not medical devices to say so; the same words go in both store descriptions. -->\n'
    '      <div class="row-note">Phi Resonance is a sound tool for relaxation, focus and exploration. It is not'
    ' a medical device and does not diagnose, treat, cure, or prevent any medical condition. For any health'
    ' concern, talk to a healthcare professional.</div>\n')
# the app bundles only this page: the site's pages open in the phone's browser, and the privacy
# policy is bundled (Apple 5.1.1(i) and Google Play's User Data policy want it reachable inside the
# app; the About tab's link does that)
rep('How Reality Is Built</a><br>',
    'How Reality Is Built</a> ·\n'
    '        <a href="privacy.html" style="color:var(--chip);">Privacy</a><br><!-- [PHI-APP] bundled -->')
# the footer is one link home (the owner, 2026-10-19: "just one to fractalreality.ca")
rep('  <footer class="app-foot">\n'
    '    <a href="circumpunct_consciousness_theory.html">Consciousness Theory</a> ·\n'
    '    <a href="attune.html">Attune</a> ·\n'
    '    <a href="hemispheric_resonance.html">Hemispheric Resonance</a> ·\n'
    '    <a href="how_reality_is_built.html">How Reality Is Built</a>\n'
    '  </footer>',
    '  <footer class="app-foot">\n'
    '    <!-- [PHI-APP] one link home; the privacy policy is linked from the About tab -->\n'
    '    <a href="https://fractalreality.ca/" target="_blank" rel="noopener">fractalreality.ca</a>\n'
    '  </footer>')
for page in ('circumpunct_consciousness_theory', 'attune', 'hemispheric_resonance', 'how_reality_is_built'):
    rep('<a href="%s.html"' % page,
        '<a href="https://fractalreality.ca/%s.html" target="_blank" rel="noopener"' % page)   # the About tab's
leftover = sorted(set(re.findall(r'href="(?!https?:|#|privacy\.html|fonts/)([^"]+)"', s)))
assert not leftover, 'relative links the app cannot follow: %r' % leftover

# ---- the script ----
rep('\n<script>\n(() => {\n  \'use strict\';',
    '\n<!-- [PHI-APP] The playback service, its notification, resuming after the screen wakes, and\n'
    '     native export (see app-bridge.js). -->\n'
    '<script src="app-bridge.js"></script>\n<script>\n(() => {\n  \'use strict\';')
rep("          artist: state.music.on ? 'φ-Entrainment Composer' : 'φ-Entrainment',\n"
    "          album: 'Fractal Reality'\n",
    "          artist: 'Phi Resonance',   // [PHI-APP] the app's name\n"
    "          album: 'Fractal Reality',\n"
    "          artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }]   // [PHI-APP]\n")
rep("  function updateMediaSession() {\n    if (!('mediaSession' in navigator)) return;",
    "  function updateMediaSession() {\n"
    "    if (window.PhiApp) window.PhiApp.sessionChanged();   // [PHI-APP] the notification's line follows\n"
    "    if (!('mediaSession' in navigator)) return;")
rep('    startTimer();\n    acquireWakeLock();\n    updateMediaSession();\n',
    '    startTimer();\n    acquireWakeLock();\n    updateMediaSession();\n'
    '    if (window.PhiApp) window.PhiApp.sessionStarted();   // [PHI-APP] playback service, notification\n')
rep('    updateMediaSession();\n    updateBgStatus();\n  }\n\n  // Parameter change while playing',
    '    updateMediaSession();\n    updateBgStatus();\n'
    '    if (window.PhiApp) window.PhiApp.sessionStopped();   // [PHI-APP]\n'
    '  }\n\n  // Parameter change while playing')
rep("""    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = 'phi-resonance-states-' + stamp + '.json';
""", """    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // [PHI-APP] inside the app, a.download does nothing: hand the file to the share sheet instead
    if (window.PhiApp && window.PhiApp.saveFile(blob, 'phi-resonance-states-' + stamp + '.json')) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'phi-resonance-states-' + stamp + '.json';
""")
rep('  function downloadWav(blob, name) {\n',
    '  function downloadWav(blob, name) {\n'
    '    if (window.PhiApp && window.PhiApp.saveFile(blob, name)) return;   // [PHI-APP] share sheet\n')
rep('  function onMusicSettingChanged() {\n    composerRecompose();\n    renderComposerForm();\n    renderPieceInfo();\n',
    '  function onMusicSettingChanged() {\n    composerRecompose();\n    renderComposerForm();\n    renderPieceInfo();\n'
    '    if (state.playing) updateMediaSession();   // [PHI-APP] the lock screen and notification name the new style\n')
rep("built the way the φ-Entrainment app builds sound. ' +",
    "built the way the Phi Resonance app builds sound. ' +   // [PHI-APP] the app's name")
rep("track built the way the φ-Entrainment Composer builds music. ' +",
    "track built the way the Phi Resonance app builds music. ' +   // [PHI-APP] the app's name")
rep('\n})();\n</script>\n',
    """
  // [PHI-APP] One line for the Android notification: the same words as the lock screen's title.
  function describeSession() {
    if (state.music.on) {
      return (STYLES[state.music.style] || STYLES.ambient).label + ' · ' + composerTempo().bpm.toFixed(1) + ' BPM';
    }
    return state.mode.charAt(0).toUpperCase() + state.mode.slice(1) + ' · ' + Math.round(state.params.base) + ' Hz';
  }

  // [PHI-APP] Hand the session to the app bridge (app-bridge.js): the playback service and its
  // notification's Stop button, and resuming the sound after the screen wakes. A no-op in a browser.
  if (window.PhiApp) {
    window.PhiApp.attach({
      start: startSession,
      stop: () => stopSession(),
      isPlaying: () => state.playing,
      // while the screen-off loop plays, the live engine is paused on purpose: nothing to resume
      getContext: () => (loopState.active ? null : state.ctx),
      describe: describeSession
    });
  }

})();
</script>
""")

assert 'φ-Entrainment' not in s.split('<script src="app-bridge.js">')[1], 'the web name is left in the script'
assert 'fonts.googleapis' not in s and 'fonts.gstatic' not in s, 'a Google Fonts link is left'
io.open(dst, 'w', encoding='utf-8', newline='\n').write(s)
print('built', os.path.normpath(dst), '(%d chars) from Fractal_Reality commit %s' % (len(s), commit))
print('[PHI-APP] marks:', s.count('[PHI-APP]'))
