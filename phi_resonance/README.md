# Phi Resonance: the φ sound lab as an Android and iPhone app

Created: 2026-09-29
Last updated: 2026-10-18
Version: 2.0

The φ-Entrainment Composer from fractalreality.ca, packaged as a paid app for Google Play and the Apple App Store with [Capacitor 8](https://capacitorjs.com/). It has the full sound lab (eight engines, layers, texture, tuning, presets, saved settings, breath guide, visual beat) plus the Composer, which grows music from the field: Fibonacci form, tempo locked to the beat, a golden-section peak. The whole app runs on the device: it makes no network requests, collects nothing, and works offline.

## Where it comes from

- `www/index.html` is **built** from the web Composer edition, `Fractal_Reality/docs/phi_resonance_composer.html`, by `scripts/build_page.py`. The current build is from Fractal_Reality commit `b35b2598` (2026-10-18). The web page itself is not changed.
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
| Android only: the page's screen-off loop is turned off and its lock button hidden | See "Screen-off sound" below. |
| Saving settings to a file and the Composer's audio download call `PhiApp.saveFile()` first | `a.download` does nothing inside an app, so the file is written to the app cache and opened in the share sheet (Save to Files, Drive, AirDrop). |
| A "not a medical device" paragraph in the About tab | Wording required by Google Play's Health Content and Services policy. |
| The site's links point to `https://fractalreality.ca/...` (they open in the phone's browser), plus a Privacy link in the About tab and the footer | The app bundles only this page. `privacy.html` is bundled because Apple 5.1.1(i) wants the policy reachable in the app. |

## Screen-off sound

The web page has its own way to keep playing with a phone locked: on request (the lock button) it renders the session into a seamless loop and plays it from an `<audio>` element, because mobile browsers suspend Web Audio when the screen locks. The app has a native way: on Android, `PlaybackService` keeps the app allowed to play with the screen off, so the live engine, the composer included, just keeps going.

- **Android:** the native service carries it, and the page's loop is off (`loopState.disabled`), with its lock button and status line hidden. Just start a session and lock the phone. If device testing shows the sound stopping with the screen off, delete the four `[PHI-APP]` lines at the end of the script in `scripts/build_page.py` that set `loopState.disabled`, rebuild, and the lock button comes back as a fallback.
- **iOS:** the loop stays available, because whether WKWebView keeps live Web Audio running in the background is still open (device checklist), and an `<audio>` element is what iOS reliably keeps playing. The bridge does not resume the live engine while the loop plays.
- **Timer:** the web page's timer now counts clock time and starts its closing fade early enough to reach silence at the chosen minute, which covers what September's audio-clock gate did, so the gate was not carried over. Device check 7 confirms it with the screen locked.

## Fonts

The page uses Orbitron and Rajdhani (both under the SIL Open Font License 1.1). `www/fonts/fonts.css` points at five files that still have to be added: `orbitron-latin.woff2` (a variable font, weights 400 to 900) and `rajdhani-400-latin.woff2`, `-500-`, `-600-`, `-700-`, from Google Fonts, with the license texts as `OFL-Orbitron.txt` and `OFL-Rajdhani.txt`. Until they are there the page falls back to the system's sans-serif, which works, only plainer.

## Native pieces

- **Android (`android/`)**
  - `PlaybackService.java` is a foreground service of type `mediaPlayback`. It makes no sound. It exists because Android 17 silences screen-off audio from apps without one, and it shows the playback notification with a **Stop** button. Starting it again while it runs updates the notification's line.
  - `PlaybackServicePlugin.java` exposes the service to the page as `start`, `stop` and a `stopRequested` event. On Android 13+ it asks for notification permission on the first session; the app plays either way.
  - `MainActivity.java` registers the plugin.
  - The manifest declares the service and the `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `POST_NOTIFICATIONS` permissions. `res/drawable/ic_stat_phi.xml` is the notification icon.
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

## Testing without a phone

`tests/android-harness.html` runs `www/index.html` in a frame with a pretend Capacitor on Android. Serve the folder over http (a `file://` page cannot fetch the app's page), open the harness, and drive it from the browser's console: every plugin call lands in `frame.contentWindow.__calls` as `[plugin, method, args]`, and `frame.contentWindow.__fire('PlaybackService', 'stopRequested')` presses the notification's Stop.

## Verified here, and what needs a real phone

**Verified on 2026-10-18 (Chromium, through the harness):**

- The page builds from the Composer edition with 23 `[PHI-APP]` marks; its script and the bridge pass `node --check`, and every element id the script uses exists (the form's playhead is made at run time).
- It loads as Phi Resonance with the Composer tab first; on Android the lock button is hidden.
- BEGIN SESSION starts the playback service with the line "Ambient Field · 97.1 BPM". Turning the composer off changes it to "Drone · 256 Hz", on again to the composer's style and tempo. While the page is hidden it sends no update (Android may refuse one from the background).
- The notification's Stop ends the session, and the service stops 0.6 s later.
- Saving settings to a file writes the JSON to the app cache and opens the share sheet; the Composer's audio download rendered a 1:16 piece (12.7 MB WAV) and did the same.
- Every request the page made stayed inside the app's own files: no Google Fonts or anything else from the internet.

**Not verified here:** no APK or iOS build has been made yet; the Java checks from 2026-09-29 (the three Android classes compile against the API 36 framework with zero warnings) still apply, since that code did not change.

**Device checklist (please run these before submitting):**

1. **Android:** start a session (composer on) and lock the phone for 30+ minutes. Sound and music continue without gaps, the notification shows on the lock screen, and **Stop** ends it.
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

- 2026-10-18 v2.0: the app is now built from the Composer edition by `scripts/build_page.py` (was a hand-edited copy of the plain lab page); bundled fonts; the Android notification follows the sound; the page's screen-off loop is off on Android; September's timer changes replaced by the web page's own; the Android harness; README rewritten for all of it
- 2026-09-29 v1.2: privacy page merged into Fractal_Reality `main` (PR #773)
- 2026-09-29 v1.1: privacy policy published on fractalreality.ca (phi_resonance_privacy.html); bundled copy links to it
- 2026-09-29 v1.0: initial app: verbatim copy of the web page, Capacitor 8 scaffold, app changes (screen-off audio, timer on the audio clock, share-sheet export, disclaimer), Android media foreground service and iOS background audio, icons, tests, listing drafts
