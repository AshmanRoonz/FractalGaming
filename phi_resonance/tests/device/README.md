# Measuring the app on a phone

Created: 2026-10-19
Last updated: 2026-10-19
Version: 1.0

Tools for counting audio dropouts in the debug app on a real phone over USB, instead of guessing at them. They were written while finding why the app's sound broke up on the owner's Pixel 9 (see "Dropouts and screen-off sound" in `../../README.md`).

## Setup

1. Turn on USB debugging on the phone (Settings, About phone, tap Build number 7 times; then Developer options, USB debugging), plug it in, and allow this computer.
2. Open the debug app, then forward its WebView's DevTools to port 9333:

   ```bash
   adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof ca.fractalreality.phiresonance)
   ```

   `ADB` may point at adb when it is not on the path (on the owner's PC: `C:/Program Files (x86)/Android/android-sdk/platform-tools/adb.exe`).

## The tools

- **`verify.sh`** runs the whole check: 60 s of plain playback, 60 s of the flashes, 60 s of setting changes. Each phase is counted at two levels, with a CPU sample per thread, and the phone's big-core frequency cap, battery temperature and thermal status at the end. Sound plays from the phone.
- **`xruns.sh`** prints the app's Android-level underrun counters:
  - AAudio XRuns on the low-latency (MMAP) path, which Chromium uses for a short or numeric latency hint;
  - AudioFlinger track underruns on the buffered path.
- **`cdp.mjs`** is a tiny DevTools client (Node 22 or newer, no packages). It runs JavaScript in the app's page: `node cdp.mjs 9333 eval localhost -e "expression"`, or `list`.
- **`probe_inject.js`** goes into the page before a session starts. It keeps the page's AudioContext and counts frames and long tasks. Its `measure(seconds)` reads `AudioContext.playbackStats`: WebView 155 has it as `playbackStats` with `underrunEvents` and `underrunDuration`, the spec as `playoutStats`.
  - For experiments, set `window.__phiForce = { latency, fps, noCssAnim }` first. It can force a latency hint, cap every animation loop, or stop the page's never-ending CSS animations.

## Reading the numbers

- **Page underruns:** the WebView's audio thread had nothing ready to play.
- **Android underruns:** the hand-off from the app to Android's audio system came late. These can happen with no page underruns at all. On the low-latency path the app hands over 2 ms bursts with about 6 ms of margin, so any stall in the app's process shows up here.
- **Heat:** a phone that has been working hard throttles its CPU (the big core's cap falls), and dropouts grow over time. Compare runs taken back to back, and repeat the first run at the end to see the drift.

## What was found (2026-10-19, Pixel 9, Android 17, WebView 155)

| Case, 60 s each | Android underruns | Page underruns |
|---|---|---|
| App v1.5: 120 fps drawing, 0.15 s hint | 1,129, and 8,258 on a hotter phone | up to 86 |
| 120 fps, `'playback'` hint | 28,701 | 1,430 (half the audio lost) |
| 30 fps, `'playback'` hint | 7,739 | 391 |
| 30 fps, 0.15 s hint | 0 to 139 | 0 |
| 30 fps, 0.15 s hint, CSS animations stopped | 0 | 0 |

At the screen's 120 Hz the page's drawing used about three CPU cores. That throttled the phone to 700 MHz on its big core, and both audio levels fell behind. The page now draws at most 30 frames a second on phones (Composer page v1.7), and the title tag's glitch fires as a one-off rather than a never-ending animation. The app also skips the WebView's full-screen mode for the flashes: the overlay already covers the page, and that mode doubled the app's own drawing work.

## Revision history

- 2026-10-19 v1.0: initial
