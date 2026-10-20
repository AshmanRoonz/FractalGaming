#!/usr/bin/env bash
# Print the app's Android-level audio underrun counters, one line per stream:
#   aaudio ... xruns=N      the AAudio stream (the low-latency MMAP path Chromium uses for a short
#                           or numeric latency hint), from `dumpsys media.aaudio`
#   mixer  ... underruns=N  AudioFlinger tracks (the buffered path, and the lock loop's <audio>)
# Usage: tests/device/xruns.sh [app-uid]   (ADB may point at adb; the uid is in `dumpsys package`)
ADB="${ADB:-adb}"
UID_APP="${1:-$("$ADB" shell dumpsys package ca.fractalreality.phiresonance | tr -d '\r' | sed -n 's/.*userId=\([0-9]*\).*/\1/p' | head -1)}"
"$ADB" shell dumpsys media.aaudio 2>/dev/null | tr -d '\r' | awk -v u="$UID_APP" '$1 ~ /^0x/ && $2 == u { print "aaudio " $1 " burst=" $7 " capacity=" $10 " xruns=" $NF }'
"$ADB" shell dumpsys media.audio_flinger 2>/dev/null | tr -d '\r' | awk -v u="$UID_APP" '
  /^Output thread/ { thr = $5 }
  $0 ~ ("/ +" u " ") && $0 !~ /AT::|removeTrack|threadLoop/ {
    for (i = 1; i <= NF; i++) if ($i ~ /^[A-Za-z]$/ && $(i+1) ~ /^[0-9]+$/ && $(i-1) ~ /^[0-9]+$/ && $(i-2) ~ /^[0-9A-F]+$/) { print "mixer " thr " track=" $1 " underruns=" $(i+1); break }
  }'
