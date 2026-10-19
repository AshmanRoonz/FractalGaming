"""Build www/index.html, the Phi Resonance app's page, from the web Composer edition.

Created: 2026-10-18
Last updated: 2026-10-18
Version: 1.0

Usage, from phi_resonance/ (the path is wherever the Fractal_Reality repo sits; beside FractalGaming
it is ../../Fractal_Reality):

    python scripts/build_page.py ../../Fractal_Reality/docs/phi_resonance_composer.html

The app's page is the φ-Entrainment Composer page from fractalreality.ca with a short list of app
edits, each marked [PHI-APP] in the output. Every edit has to find its anchor exactly once or the
build stops, so a change on the web side that moves an anchor is caught here instead of shipping a
half-edited page. To bring a later web change into the app, run this again; when it stops, fix the
anchor below, not the output.

Revision history:
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
rep('</style>',
    '  /* [PHI-APP] On Android the native playback service keeps the live sound going with the screen\n'
    '     off, so the page\'s own screen-off loop and its lock button stay hidden (end of the script). */\n'
    '  .phi-app-android #lockBtn, .phi-app-android #bgStatus { display: none !important; }\n'
    '</style>')

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
# policy is bundled (Apple 5.1.1(i) wants it reachable inside the app)
rep('How Reality Is Built</a><br>',
    'How Reality Is Built</a> ·\n'
    '        <a href="privacy.html" style="color:var(--chip);">Privacy</a><br><!-- [PHI-APP] bundled -->')
rep('<a href="how_reality_is_built.html">How Reality Is Built</a>\n  </footer>',
    '<a href="how_reality_is_built.html">How Reality Is Built</a> ·\n'
    '    <a href="privacy.html">Privacy</a><!-- [PHI-APP] bundled -->\n  </footer>')
for page in ('circumpunct_consciousness_theory', 'attune', 'hemispheric_resonance', 'how_reality_is_built'):
    rep('<a href="%s.html"' % page,
        '<a href="https://fractalreality.ca/%s.html" target="_blank" rel="noopener"' % page, count=2)
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

  // [PHI-APP] Android: the native playback service (PlaybackService.java) keeps the live sound going
  // with the screen off, so the page's own screen-off loop, and the lock button that prepares it,
  // stay out of the way. iOS keeps them: whether WKWebView keeps live Web Audio running in the
  // background is an open item on the README's device checklist, and the loop plays through an
  // <audio> element, which iOS does keep playing.
  if (window.PhiApp && window.PhiApp.platform === 'android') {
    loopState.disabled = true;
    document.body.classList.add('phi-app-android');
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
