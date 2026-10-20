# Phi Resonance: the φ sound lab as an Android and iPhone app

Created: 2026-09-29
Last updated: 2026-10-19
Version: 2.9

The φ-Entrainment Composer from fractalreality.ca, packaged as a paid app for Google Play and the Apple App Store with [Capacitor 8](https://capacitorjs.com/). It has the full sound lab (eight engines, layers, texture, tuning, presets, saved settings, breath guide, visual beat) plus the Composer, which grows music from the field: Fibonacci form, tempo locked to the beat, a golden-section peak. The whole app runs on the device: it makes no network requests, collects nothing, and works offline.

## Where it comes from

- `www/index.html` is **built** from the web Composer edition, `Fractal_Reality/docs/phi_resonance_composer.html`, by `scripts/build_page.py`. The current build is from Fractal_Reality commit `631902cd` (2026-10-19, the Composer page v1.7: lighter setting changes, cheap flashes, and the frame cap for phones). The web page itself is not changed.
- The script applies a short list of app edits, each marked `[PHI-APP]` in the output, so `grep -n "PHI-APP" www/index.html` shows exactly what the app changed. Each edit must find its anchor exactly once or the build stops, so a web change that moves an anchor is caught instead of shipped half-edited.
- To bring a later web change into the app, run the script again (the path is wherever the Fractal_Reality repo sits; beside FractalGaming it is `../../Fractal_Reality`):

  ```bash
  cd phi_resonance
  python scripts/build_page.py ../../Fractal_Reality/docs/phi_resonance_composer.html
  ```

  If it stops, fix the anchor in the script, never the output. Do not edit `www/index.html` by hand.
- Until 2026-10-18 the app was a hand-edited copy of the plain lab page (`docs/phi_resonance.html` at commit `874ff34`); the owner chose the Composer edition for the store ("it's the same but more features").

## What the app changes in the web page

| Change | Why |
|---|---|
| Title "Phi Resonance", top-bar tag "φ RESONANCE" (the web says φ-Entrainment / φ-COMPOSER), "Phi Resonance" in the Media Session and in the AI music prompts | "Entrainment" reads as a claim to change the body, which store health rules treat as medical ("Positioning" below). |
| Orbitron and Rajdhani from `www/fonts/` instead of Google Fonts | The app makes no network requests, and the privacy policy says so. See "Fonts" below. |
| `app-bridge.js` loaded before the main script | The Android playback service and its notification, resuming after the screen wakes, native export. In a browser it does nothing. |
| `PhiApp.sessionStarted()` / `sessionStopped()` in `startSession` / `stopSession`, `PhiApp.sessionChanged()` in `updateMediaSession` | Start and stop the Android foreground service, and keep its notification's line in step with the sound (mode and base, or the composer's style and tempo). A composer style change also refreshes the Media Session. |
| The AudioContext asks for `latencyHint: 0.15` on Android (150 ms rendered ahead) and `'playback'` on iOS | Inside the Android WebView the sound cut in and out with the default (a few ms rendered ahead) and with `'playback'` (about 21 ms). See "Dropouts and screen-off sound" below. |
| The silent clip that keeps the lock loop's `<audio>` element ready is ten seconds long (the web's is half a second) | It plays for the whole session, so it now restarts every ten seconds instead of twice a second. |
| Saving settings to a file and the Composer's audio download call `PhiApp.saveFile()` first | `a.download` does nothing inside an app, so the file is written to the app cache and opened in the share sheet (Save to Files, Drive, AirDrop). |
| A "not a medical device" paragraph in the About tab | Wording required by Google Play's Health Content and Services policy. |
| The footer is one link, to `https://fractalreality.ca/` (the web page's footer links four of the site's pages) | The owner wanted one link home at the bottom of the app (2026-10-19). |
| The About tab's links to the site point to `https://fractalreality.ca/...`, and it links the bundled Privacy policy | Links to the site open in the phone's browser; the app bundles only this page. `privacy.html` is bundled because Apple 5.1.1(i) and Google Play's User Data policy want the policy reachable in the app. |
| The flashes never ask for the WebView's full-screen mode (their overlay still fills the app's window) | Full-screen mode doubled the app's UI and render threads, and Android counted 666 underruns in a minute of full-screen flashes (APK v1.6). See "Dropouts and screen-off sound" below. |

## Dropouts and screen-off sound

The web page has its own way to keep playing with a phone locked: on request (the lock button, "Prepare for screen lock") it renders the session into a seamless loop and plays it from an `<audio>` element, because mobile browsers suspend Web Audio when the screen locks. The app keeps that, and adds native help: on Android, `PlaybackService` keeps the app allowed to play with the screen off.

- **Android:** the lock button and its loop work as on the web (since build script v1.1). The owner's tests, all on one phone whose browser plays the same page cleanly:
  - **v1.0** turned the loop off and hid the button, trusting the native service to carry the live engine. It hitched every few seconds and went silent when the screen locked.
  - **v1.1** brought the button back and asked for `latencyHint: 'playback'`. The sound still cut in and out, most when moving around the app.
  - **v1.2** renders 150 ms ahead on Android (`latencyHint: 0.15`). The page's audio stopped starving, but setting changes and then the visuals still stuttered. v1.3 to v1.5 lightened changes and the flashes, which helped on a desktop and less on the phone.
  - **v1.6 and v1.7** came from measuring the phone over USB (`tests/device/`, results there). The page's drawing at the screen's 120 Hz took about three CPU cores. The phone throttled its big core to 700 MHz, and Android counted over 1,000 audio underruns a minute, 8,000 once it was hotter. Now the page draws at most 30 frames a second on phones (Composer page v1.7), the title tag's glitch fires as a one-off, and the app skips the WebView's full-screen mode for the flashes. The latency hint stays 0.15: `'playback'` (21 ms ahead) starved the page's audio even at 30 frames.

  What the source shows (Chromium, `media/base/audio_latency.cc` and `media/audio/android/`):
  - **The default hint** renders one hardware buffer ahead (a few ms), on a low-latency AAudio stream.
  - **`'playback'`** renders 1024 frames (about 21 ms), on a power-saving stream.
  - **A hint in seconds** renders that much (capped near 170 ms), on a low-latency stream.

  On the Pixel the low-latency stream is Android's MMAP path. The app hands it 2 ms bursts with about 6 ms of margin, so any stall in the app's process is an audible gap. Lighter drawing is what keeps that hand-off on time. Capacitor does not pause the WebView in the background (its `KeepRunning` setting defaults to true).

  Whether the live engine keeps going with the screen locked without the lock button is a device check (item 1 below). The lock button is the path the browser already proves.
- **iOS:** the loop stays available, because whether WKWebView keeps live Web Audio running in the background is still open (device checklist), and an `<audio>` element is what iOS reliably keeps playing. The bridge does not resume the live engine while the loop plays.
- **Timer:** the web page's timer now counts clock time and starts its closing fade early enough to reach silence at the chosen minute, which covers what September's audio-clock gate did, so the gate was not carried over. Device check 7 confirms it with the screen locked.

## Fonts

The page uses Orbitron and Rajdhani, both under the SIL Open Font License 1.1, bundled in `www/fonts/`: `orbitron-latin.woff2` (a variable font, weights 400 to 900) and `rajdhani-400-latin.woff2`, `-500-`, `-600-` and `-700-`, the latin subsets as Google Fonts served them on 2026-10-18 (about 73 KB together), with the license texts `OFL-Orbitron.txt` and `OFL-Rajdhani.txt`. `fonts.css` declares them. Greek letters such as φ are in neither font and come from the system's, as they do on the web.

## Native pieces

- **Android (`android/`)**
  - `PlaybackService.java` is a foreground service of type `mediaPlayback`. It makes no sound. It exists because Android 17 silences screen-off audio from apps without one, and it shows the playback notification with a **Stop** button. Starting it again while it runs updates the notification's line.
  - `PlaybackServicePlugin.java` exposes the service to the page as `start`, `stop` and a `stopRequested` event. On Android 13+ it asks for notification permission on the first session; the app plays either way.
  - `MainActivity.java` registers the plugin.
  - The manifest declares the service and the `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `POST_NOTIFICATIONS` permissions. `res/drawable/ic_stat_phi.xml` is the notification icon.
  - `android/build.gradle` takes an optional `-PandroidBuildTools=<version>` for an SDK that lacks the build-tools the Android Gradle plugin asks for (see "Build and run").
- **iOS (`ios/`)**
  - `Info.plist` has `UIBackgroundModes` set to `audio`.
  - `AppDelegate.swift` sets the audio session to `.playback`, so sound keeps going with the silent switch on and the screen locked.
  - The page and the bridge also set `navigator.audioSession.type = 'playback'`, because the audio runs inside WKWebView.
- **The bridge (`www/app-bridge.js`)** starts and stops the playback service, refreshes its line, forwards the notification's Stop, resumes the audio after the app returns to the foreground, and saves files through the share sheet. The lock screen's Media Session (title, artwork, play and pause) is the page's own.
- **Icons and splash:** generated from `assets/` (a gold φ with resonance rings on the page's indigo) with `npm run assets`. Replace the files in `assets/` and run it again to change them.

## Build and run

Requirements:

- Node 20+.
- **Android:** JDK 21 and the Android SDK with platform 36 and build-tools 36. Android Studio is the easy way to run and sign. This PC already has both, installed by Visual Studio: the JDK at `C:\Program Files\Android\openjdk\jdk-21.0.8` and the SDK at `C:\Program Files (x86)\Android\android-sdk` (platforms 35 and 36, build-tools 36.0.0). Point `JAVA_HOME` and `ANDROID_HOME` at them for a command-line build.
- **iOS:** Xcode 26 on a Mac, or a cloud Mac (Xcode Cloud, GitHub Actions `macos-26`, Codemagic).

```bash
cd phi_resonance
npm install
npx cap sync          # copies www/ into both native projects (the copies are gitignored)
npx cap open android  # Android Studio: Run on a device; Build > Generate Signed App Bundle for Play
npx cap open ios      # Xcode: set your Team under Signing; Run; Product > Archive for App Store Connect
```

After rebuilding `www/index.html`, run `npx cap sync` again. iOS uses Swift Package Manager, so there is no `pod install`.

**On the owner's PC**, from the command line, with Visual Studio's JDK and SDK. That SDK is read-only and has build-tools 36.0.0 but not the 35.0.0 the Android Gradle plugin asks for, so the build names the ones it has (`android/build.gradle` applies the flag to every module; without it nothing changes):

```bash
export JAVA_HOME="/c/Program Files/Android/openjdk/jdk-21.0.8"
export ANDROID_HOME="C:/Program Files (x86)/Android/android-sdk"
cd phi_resonance && npx cap sync android && cd android
./gradlew assembleDebug -PandroidBuildTools=36.0.0
```

The debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`. For Google Play, build a signed App Bundle with your upload key (Android Studio's Build > Generate Signed App Bundle walks through making and using one; keep the key and its password safe, outside the repo).

## Testing without a phone

`tests/android-harness.html` runs `www/index.html` in a frame with a pretend Capacitor on Android. Serve the folder over http (a `file://` page cannot fetch the app's page), open the harness, and drive it from the browser's console: every plugin call lands in `frame.contentWindow.__calls` as `[plugin, method, args]`, and `frame.contentWindow.__fire('PlaybackService', 'stopRequested')` presses the notification's Stop. Two 404s in the console (`tests/fonts/fonts.css` and `tests/app-bridge.js`) are the harness, not the app: the frame's first fetch runs before the injected `<base>` applies, and both files then load from `www/`.

## Verified here, and what needs a real phone

**Verified on 2026-10-19 (build script v1.2, Chromium, through the harness):**

- The page builds with 24 `[PHI-APP]` marks and passes `node --check`.
- On Android the AudioContext is created with `latencyHint: 0.15` and reports `baseLatency` 0.15 s.
- The breath guide's lane shows on the main screen by default (from the web pages, 2026-10-19).
- Start, Prepare for screen lock, Ready (loop playing, live engine suspended) and Stop work as before. The service gets one start and one stop.

**Verified on 2026-10-19 (build script v1.1, Chromium, through the harness):**

- The page builds with 23 `[PHI-APP]` marks and passes `node --check`.
- On Android the lock button shows ("Play with screen off", then "Prepare for screen lock" once a session plays).
- BEGIN SESSION creates the AudioContext with `latencyHint: 'playback'` and starts the playback service ("Ambient Field · 126.0 BPM" for Ashman1).
- The lock button renders the loop (Ashman1 with the Composer, about 3 s on this PC) and reaches "Ready: lock your screen". The loop takes over, and the live engine is suspended.
- Stop ends the session and stops the service once.
- The ten-second silent clip plays without an error.

**Verified on 2026-10-18 (Chromium, through the harness):**

- The page builds from the Composer edition with 23 `[PHI-APP]` marks; its script and the bridge pass `node --check`, and every element id the script uses exists (the form's playhead is made at run time).
- It loads as Phi Resonance with the Composer tab first; on Android the lock button was hidden (build script v1.0).
- BEGIN SESSION starts the playback service with the line "Ambient Field · 97.1 BPM". Turning the composer off changes it to "Drone · 256 Hz", on again to the composer's style and tempo. While the page is hidden it sends no update (Android may refuse one from the background).
- The notification's Stop ends the session, and the service stops 0.6 s later.
- Saving settings to a file writes the JSON to the app cache and opens the share sheet; the Composer's audio download rendered a 1:16 piece (12.7 MB WAV) and did the same.
- Every request the page made stayed inside the app's own files: no Google Fonts or anything else from the internet. Orbitron and Rajdhani load from `www/fonts/`.

**Android build v1.8 (2026-10-19, on the owner's PC, installed on the owner's Pixel 9 over USB):** build script v1.4 on the same page as v1.7. The page builds with 25 `[PHI-APP]` marks and passes `node --check`. On the phone the footer shows only fractalreality.ca, and tapping it opened the site in Chrome while the app stayed on its own page. The About tab still lists the site's pages and Privacy. The sound path is unchanged from v1.7, so it was not measured again. The Presets store screenshot was retaken from this build.

**Android build v1.7 (2026-10-19, on the owner's PC, installed on the owner's Pixel 9 over USB):** build script v1.3 on the Composer page v1.7. Measured on the phone with `tests/device/verify.sh`, nothing forced, zero underruns at both levels in each phase:
- 60 s of plain playback
- 60 s of the flashes, with the breath guide over them
- 60 s of setting changes, 42 in all

The phone's big core ended capped at 1,396 MHz (it had been held at 700 under the old drawing load). The owner listened and confirmed it sounds good. The committed page differs from the installed one only in its source-commit comment, which now names `631902cd`. APK v1.6 (the same page, with the WebView's full-screen mode still used for the flashes) counted 666 Android underruns in a minute of full-screen flashes on a warm phone.

**Android build v1.5 (2026-10-19, on the owner's PC):** the Composer page v1.6, with cheap flashes. The owner found v1.4 "good until I started the visuals". Measured in Chromium with the full-screen flashes on (the old engine first):
- The whole hidden page kept drawing underneath, about 119,000 canvas calls a second. Now nothing under the flashes is drawn.
- The panel was repainted in a new colour 60 times a second, each change restarting a 40 ms colour transition. Now one opacity per frame moves a layer of the colour; the compositor does that without repainting.
- The HUD text was rewritten 120 times a second. Now it changes only when its text does.

The colour itself is unchanged: below 50% lightness HSL is a straight blend toward black, above it toward white, so a black panel with a 50% hue layer and a white layer shows exactly the old colour. Flashes in the main window, the canvas shapes and stopping were checked too. The page in the 6.4 MB APK is byte-identical to `www/index.html`.

**Android build v1.4 (2026-10-19, on the owner's PC):** build script v1.2 on the Composer page v1.5, with lighter setting changes. The owner found v1.3 got "really hitchy" after a while of changing settings. Desktop checks found no build-up after about 70 changes of every kind: audio sources, output connections, timers, memory, page elements and animation loops all held steady. So the remaining load is each change's moment of doubled sound. v1.5 shrinks it in three ways:
- The old sound's sources now stop on the audio clock the moment its fade ends. Before, a timer stopped them 80 ms or more later, depending on how busy the page was.
- The crossfade is 0.25 s (it was 0.35).
- Noise is made once per audio context and reused. Before, every change made megabytes of it again.

Checked in Chromium:
- Right after a change's fade, the source count was back to steady.
- Eleven changes with a noise bed made no new buffers.
- Noise mode made its three colours once.
- The lock loop, a change while it plays, and Stop all work.

The page in the 6.4 MB APK is byte-identical to `www/index.html`.

**Android build v1.3 (2026-10-19, on the owner's PC):** build script v1.2 on the Composer page v1.4, where one reverb runs across setting changes. The owner heard v1.2 play cleanly when left alone but stutter while changing settings; on most changes the engine rebuilt the whole sound and ran a second reverb, made from fresh noise, beside the first. Checked in Chromium with the output redirected into an analyser:
- Three Base changes made no new reverb (the old engine made three).
- The level stayed flat across five rebuilds.
- A Reverb size change made exactly one new reverb.
- Prepare for screen lock, a change while the loop plays, and Stop all work.

The page in the 6.4 MB APK is byte-identical to `www/index.html`.

**Android build v1.2 (2026-10-19, on the owner's PC):** `assembleDebug` succeeded (6.4 MB). It was built just before the web change was committed, so its page differs from today's `www/index.html` only in the source-commit comment ("c8843f5d plus uncommitted changes", now `66afa2ed`).

**Android build v1.1 (2026-10-19, on the owner's PC):** `assembleDebug` succeeded in 46 s with build script v1.1. The page in the 6.3 MB APK's `assets/public` is byte-identical to `www/index.html` (the `'playback'` latency hint, the lock button kept on Android, 23 `[PHI-APP]` marks).

**Android build (2026-10-18, on the owner's PC):** `assembleDebug` succeeded with AGP 8.13 and Gradle 8.14.3, compileSdk and targetSdk 36. The 6.3 MB debug APK's `assets/public` holds the new page (23 `[PHI-APP]` marks, no Google Fonts), the bridge, the fonts and the privacy policy. The only build warnings come from Capacitor's own template and plugins.

**Not verified yet:** the app on a phone (the checklist below), a signed release bundle, and anything on iOS.

**Device checklist (please run these before submitting):**

1. **Android:** start a session (composer on) and listen for a few minutes with the screen on, moving between the tabs: the sound never cuts out. Then change Base, Beat and Mode while it plays: each change crossfades without stuttering. Then lock the phone, first without the lock button (does the live sound keep going?), then after "Prepare for screen lock" reaches Ready, for 30+ minutes. Sound and music continue without gaps, the notification shows on the lock screen, and **Stop** ends it.
2. **Android:** change the preset, then the composer's style, while playing: the notification's line follows.
3. **Android 13+:** the notification permission is asked once. Deny it: sound still plays.
4. **Android:** swipe the app away from Recents. The notification disappears.
5. **iPhone:** with the silent switch on, sound plays.
6. **iPhone:** lock the phone for 30+ minutes, without and then with the lock button's loop. Note which keeps playing; if live sound does, the loop can be turned off on iOS too.
7. **Both:** a **5-minute timer ends on time with the screen locked** (it fades over its last seconds).
8. **Both:** a phone call mid-session. After the call, returning to the app resumes the sound.
9. **Both:** File tab: save settings to a file, then load them back; Composer tab: download a full piece (about 13 MB): the share sheet opens, and Save to Files works.
10. **Both:** binaural modes on headphones (left and right channels correct), the visual beat in full screen and in the main window with its warning, the breath guide over the flashes, and battery use over an hour.

## Positioning (read before writing the store listing)

Market Phi Resonance as a **sound tool for relaxation, focus, meditation, sleep wind-down and sound exploration**. Do not describe it as therapy or as treating any condition.

- Apple:
  - 1.4.1 reviews apps that could be used for "treating patients" more strictly and may ask for regulatory clearance.
  - 2.3.1 makes misleading marketing grounds for removal.
  - 5.1.1(ix) says healthcare services should come from a company, not an individual.
- Google Play requires the "not a medical device" disclaimer (below) for health-adjacent apps.
- The FDA's General Wellness guidance (revised 2026-01-06) treats relaxation, stress management and sleep as wellness claims, and treating anxiety or insomnia as a medical-device claim. Health Canada decides by what the app claims.
- The evidence on binaural beats is mixed, so health claims could not be substantiated.

Full notes and sources: `../store/PLAN.md`, section "φ Resonance".

## Draft store listing

The finished Google Play kit is in `store-listing/`: the listing text, framed screenshots from the owner's phone, the feature graphic, the App content answers and the release steps (`store-listing/README.md`). The signed bundle comes from `scripts/build_release.ps1`, which the owner runs: it makes the upload key on its first run and never writes the password to disk. The draft below is where the kit started.

- **Name:** Phi Resonance (13/30).
- **Apple subtitle:** Sound lab for calm and focus (28/30).
- **Play short description:** Golden-ratio sound lab: binaural, isochronic and drone tones for calm and focus. (80/80)
- **Apple keywords:** binaural,isochronic,drone,meditation,relaxation,focus,sleep,breathing,tones,golden ratio,sound lab (98/100). Never use "therapy", "heal" or condition names.
- **Description:** eight sound engines (binaural, isochronic, monaural, drone, harmonic, φ-cascade, noise, chord), golden-ratio layering, presets and saved settings, a session timer up to 2 hours with a gentle fade, a breath guide that can sit on the main screen or over the flashes, a visual beat mode with a photosensitivity warning, and the Composer: music grown from the sound itself, in five styles, with its tempo locked to the beat and every piece peaking at the golden section, downloadable as audio. Plays with the screen locked. No account, no ads, no data collected. End with the required sentence: *Phi Resonance is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. For any health concern, talk to a healthcare professional.*
- **Category:** Health & Fitness on both stores (Music would also fit). On Play, complete the **Health apps declaration** (Stress Management & Mental Wellness, or Sleep Management).
- **Privacy:**
  - Apple's privacy label: *Data Not Collected*.
  - Play's Data safety: no data collected, none shared.
  - Privacy policy URL for both listings: `https://fractalreality.ca/phi_resonance_privacy.html` (Fractal_Reality `docs/phi_resonance_privacy.html`). The app bundles the same text as `www/privacy.html`; keep the two in step.
- **Play foreground-service declaration:** Play Console > App content > Foreground service permissions: media playback, "user-started sound sessions that keep playing with the screen off". Play may ask for a short video.
- **Price:** paid upfront (the owner confirmed on 2026-10-18); the store handles payment, so there is no billing code. Enroll in Apple's Small Business Program and Google's 15% tier. See `../store/PLAN.md` for the tax and address requirements, including that Google shows a selling developer's address publicly.
- **Closed test:** a new personal Play account must run a closed test with at least 12 testers opted in for 14 days before production, and testers on a closed track must buy a paid app (internal testing is free). Recruiting page: `https://fractalreality.ca/phi_resonance_testers.html`.

## Revision history

- 2026-10-19 v2.9: build script v1.4, at the owner's wish: the footer is one link to fractalreality.ca, and the About tab keeps the site's links and Privacy; APK v1.8 checked on the owner's phone; the Presets store screenshot retaken; the change table gains the row for the flashes' full-screen mode (build script v1.3)
- 2026-10-19 v2.8: release signing from the environment in `android/app/build.gradle` (unsigned without a key; checked with a throwaway key, since deleted), `scripts/build_release.ps1` for the owner, key files ignored by git, and the Google Play kit in `store-listing/`
- 2026-10-19 v2.7: measured on the owner's Pixel 9 over USB (`tests/device/`): the drawing at 120 Hz was the cause; APK v1.6 and v1.7 from the Composer page v1.7 (a 30 fps cap on phones, the title tag's glitch as a one-off) and build script v1.3 (no WebView full screen for the flashes)
- 2026-10-19 v2.6: APK v1.5 from the Composer page v1.6 (cheap flashes: the colour moves by opacity, the HUD is written only when it changes, nothing is drawn under the full-screen flashes), after the owner found v1.4 good until the visuals started
- 2026-10-19 v2.5: APK v1.4 from the Composer page v1.5 (the old sound stops on the audio clock when its fade ends, a 0.25 s crossfade, noise made once), after the owner found v1.3 got hitchy after a while of changing settings; the source is now the owner's commit `4d15418d`
- 2026-10-19 v2.4: APK v1.3 from the Composer page v1.4 (one reverb across setting changes), after the owner heard v1.2 stutter while changing settings; device check 1 now covers changes while playing
- 2026-10-19 v2.3: build script v1.2, after the owner heard the v1.1 sound cut in and out, most when moving around the app: a 150 ms latency hint on Android (`'playback'` stays on iOS); "Screen-off sound" is now "Dropouts and screen-off sound" with the three test builds and the next steps; the page now starts with the breath lane on the main screen (from the web pages)
- 2026-10-19 v2.2: build script v1.1, after the owner's first Android test (hitching every few seconds, silent on lock, no lock button): the `'playback'` latency hint (Android's power-saving audio path), a ten-second silent clip, and the page's lock button and loop kept on Android; "Screen-off sound", the change table, the harness results and device check 1 updated
- 2026-10-19 v2.1: rebuilt from the Composer page at `c8843f5d`: the app now starts on Ashman1, the owner's setting (binaural, 144 Hz base, 2.1 Hz beat, octave-spaced triangle layers, the Composer on piece 75C2C6), which also leads the preset list
- 2026-10-18 v2.0: the app is now built from the Composer edition by `scripts/build_page.py` (was a hand-edited copy of the plain lab page); bundled fonts (Orbitron, Rajdhani, OFL); the Android notification follows the sound; the page's screen-off loop is off on Android; September's timer changes replaced by the web page's own; the Android harness; the build-tools flag and a first debug APK built on the owner's PC; README rewritten for all of it
- 2026-09-29 v1.2: privacy page merged into Fractal_Reality `main` (PR #773)
- 2026-09-29 v1.1: privacy policy published on fractalreality.ca (phi_resonance_privacy.html); bundled copy links to it
- 2026-09-29 v1.0: initial app: verbatim copy of the web page, Capacitor 8 scaffold, app changes (screen-off audio, timer on the audio clock, share-sheet export, disclaimer), Android media foreground service and iOS background audio, icons, tests, listing drafts
