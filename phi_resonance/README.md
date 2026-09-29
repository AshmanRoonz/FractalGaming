# Phi Resonance: the φ sound lab as an Android and iPhone app

Created: 2026-09-29
Last updated: 2026-09-29
Version: 1.1

The φ-Entrainment sound lab from fractalreality.ca, packaged as a paid app for Google Play and the Apple App Store with [Capacitor 8](https://capacitorjs.com/). The whole app runs on the device: it makes no network requests, collects nothing, and works offline.

## Where it came from

- `www/index.html` is a **copy** of `Fractal_Reality/docs/phi_resonance.html`, taken at Fractal_Reality commit `874ff34`. The web page itself is not changed.
- The copy was committed verbatim first. Every app change is marked `[PHI-APP]` in the file, so `git diff` against that first commit, or `grep -n "PHI-APP" www/index.html`, shows exactly what the app changed.
- To bring in a later change to the web page, diff `docs/phi_resonance.html` against commit `874ff34` in Fractal_Reality and apply that diff here, keeping the `[PHI-APP]` edits.

## What the app changes in the copy

| Change | Why |
|---|---|
| Title "Phi Resonance" / header "φ RESONANCE" (was "φ-Entrainment") | "Entrainment" reads as a claim to change the body, which store health rules treat as medical ("Positioning" below). |
| `app-bridge.js` loaded before the main script | Handles screen-off audio, lock-screen controls and native export. In a browser it does nothing. |
| Output gate after the dry and wet mix, plus `scheduleTimerFade()` | The session timer now fades the sound out on the **audio clock**, so it ends on time even while a locked phone slows the page's timers. |
| Timer counts clock time (was: one `+1` per tick) | Ticks are skipped when the phone sleeps. Tested: after a 6-minute gap in ticks, the original page kept playing a 5-minute session (timer showed `00:03`); the copy ended it. |
| `sessionStarted()` / `sessionStopped()` hooks | Start and stop the Android foreground service; update the Media Session. |
| Both export paths call `PhiApp.saveFile()` first | `a.download` does nothing inside an app, so the file is written to the app cache and opened in the share sheet (Save to Files, Drive, AirDrop). |
| Disclaimer under the headphones note | Wording required by Google Play's Health Content and Services policy. |
| Footer links point to `https://fractalreality.ca/...`, plus a Privacy link | The app bundles only this page; the links open the phone's browser. `privacy.html` is bundled because Apple 5.1.1(i) wants the policy reachable in the app. |

## Native pieces

- **Android (`android/`)**
  - `PlaybackService.java` is a foreground service of type `mediaPlayback`. It makes no sound. It exists because Android 17 silences screen-off audio from apps without one, and it shows the playback notification with a **Stop** button.
  - `PlaybackServicePlugin.java` exposes the service to the page as `start`, `stop` and a `stopRequested` event. On Android 13+ it asks for notification permission on the first session; the app plays either way.
  - `MainActivity.java` registers the plugin.
  - The manifest declares the service and the `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `POST_NOTIFICATIONS` permissions. `res/drawable/ic_stat_phi.xml` is the notification icon.
- **iOS (`ios/`)**
  - `Info.plist` has `UIBackgroundModes` set to `audio`.
  - `AppDelegate.swift` sets the audio session to `.playback`, so sound keeps going with the silent switch on and the screen locked.
  - The page also sets `navigator.audioSession.type = 'playback'`, because the audio runs inside WKWebView.
- **Icons and splash:** generated from `assets/` (a gold φ with resonance rings on the page's indigo) with `npm run assets`. Replace the files in `assets/` and run it again to change them.

## Build and run

Requirements:

- Node 20+.
- **Android:** Android Studio with SDK 36 and JDK 21.
- **iOS:** Xcode 26 on a Mac, or a cloud Mac (Xcode Cloud, GitHub Actions `macos-26`, Codemagic).

```bash
cd phi_resonance
npm install
npx cap sync          # copies www/ into both native projects (the copies are gitignored)
npx cap open android  # Android Studio: Run on a device; Build > Generate Signed App Bundle for Play
npx cap open ios      # Xcode: set your Team under Signing; Run; Product > Archive for App Store Connect
```

Edit files in `www/`, then run `npx cap sync` again. iOS uses Swift Package Manager, so there is no `pod install`.

## Verified here, and what needs a real phone

**Verified in this environment (2026-09-29):**

- **Web checks in headless Chromium, 16 passing:**
  - The page runs as a normal web page.
  - The timer schedules its fade near +300 s for 5 minutes, and the ∞ button cancels it.
  - Web export still downloads.
  - With a simulated Android bridge: BEGIN SESSION starts the service with a description; a preset change restarts the sound without stopping the service and updates the notification text; the notification's Stop ends the session and the service; export writes base64 JSON to the cache and opens the share sheet.
  - The timer survives skipped ticks.
  - No page errors.
- **Android Java:** `PlaybackService`, `PlaybackServicePlugin` and `MainActivity` compile with `-Xlint:all` and zero warnings against the real Android 16 (API 36) framework classes. The Capacitor stand-ins used for the check copy the exact signatures from Capacitor 8.5.2's source. Every androidx call was also matched against androidx's published API (`core/api/current.txt`).
- **Config files:** the Android XML is well-formed, and `Info.plist` parses.

**Not verified here:** no APK or iOS build was produced, because the Android SDK and Xcode are not available in this environment. The first build happens on your machine.

**Device checklist (please run these before submitting):**

1. **Android:** start a session and lock the phone for 30+ minutes. Sound continues, the notification shows on the lock screen, and **Stop** ends it.
2. **Android 13+:** the notification permission is asked once. Deny it: sound still plays.
3. **Android:** swipe the app away from Recents. The notification disappears.
4. **iPhone:** with the silent switch on, sound plays.
5. **iPhone:** lock the phone for 30+ minutes. Sound continues.
6. **iPhone:** lock-screen controls. If they don't appear, the next step is a small native Now Playing plugin (`MPNowPlayingInfoCenter`); WebKit's support for lock-screen controls on Web Audio-only pages is uncertain.
7. **Both:** a **5-minute timer ends on time with the screen locked** (it fades over the last 8 seconds).
8. **Both:** a phone call mid-session. After the call, returning to the app resumes the sound.
9. **Both:** export presets, a Serum wavetable and the preset card: the share sheet opens, and Save to Files works. Import presets back.
10. **Both:** binaural modes on headphones (left and right channels correct), the visual beat in full screen with its warning, and battery use over an hour.

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
- **Description:** eight sound engines (binaural, isochronic, monaural, drone, harmonic, φ-cascade, noise, chord), golden-ratio layering, presets and saved states, session timer up to 2 hours with a gentle fade, a breathing pacer, a visual beat mode with a photosensitivity warning, and Serum 2 wavetable export for producers. Plays with the screen locked. No account, no ads, no data collected. End with the required sentence: *Phi Resonance is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. For any health concern, talk to a healthcare professional.*
- **Category:** Health & Fitness on both stores (Music would also fit). On Play, complete the **Health apps declaration** (Stress Management & Mental Wellness, or Sleep Management).
- **Privacy:**
  - Apple's privacy label: *Data Not Collected*.
  - Play's Data safety: no data collected, none shared.
  - Privacy policy URL for both listings: `https://fractalreality.ca/phi_resonance_privacy.html` (Fractal_Reality `docs/phi_resonance_privacy.html`). It goes live when that repo's branch is merged into `main`. The app bundles the same text as `www/privacy.html`; keep the two in step.
- **Play foreground-service declaration:** Play Console > App content > Foreground service permissions: media playback, "user-started sound sessions that keep playing with the screen off". Play may ask for a short video.
- **Price:** paid upfront; the store handles payment, so there is no billing code. Enroll in Apple's Small Business Program and Google's 15% tier. See `../store/PLAN.md` for the tax and address requirements, including that Google shows a selling developer's address publicly.

## Revision history

- 2026-09-29 v1.1: privacy policy published on fractalreality.ca (phi_resonance_privacy.html); bundled copy links to it
- 2026-09-29 v1.0: initial app: verbatim copy of the web page, Capacitor 8 scaffold, app changes (screen-off audio, timer on the audio clock, share-sheet export, disclaimer), Android media foreground service and iOS background audio, icons, tests, listing drafts
