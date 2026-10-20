#!/usr/bin/env bash
# Measure the installed debug app on a phone over USB, nothing forced: 60 s of plain playback,
# 60 s of the flashes, 60 s of setting changes (one every 1.4 s), each counted at the page (Web Audio
# underruns, AudioContext.playbackStats) and at Android (xruns.sh), with a CPU sample per thread.
# Needs: USB debugging on, the debug app open, and its WebView's DevTools forwarded first:
#   adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof ca.fractalreality.phiresonance)
# Then: tests/device/verify.sh   (ADB may point at adb; sound plays from the phone)
HERE="$(cd "$(dirname "$0")" && pwd)"
ADB="${ADB:-adb}"; export ADB
cdp() { node "$HERE/cdp.mjs" 9333 eval localhost -e "$1"; }
xr() { bash "$HERE/xruns.sh" | awk '/^aaudio/ { sub("xruns=", "", $NF); s += $NF } /^mixer/ { sub("underruns=", "", $NF); m += $NF } END { print s + m }'; }
cpu() {
  local APP; APP=$("$ADB" shell pidof ca.fractalreality.phiresonance | tr -d '\r')
  "$ADB" shell 'top -H -b -n 2 -d 3 -s 3 -m 14 -o PID,TID,%CPU,CMD 2>/dev/null' | tr -d '\r' | awk -v app="$APP" '/^Threads:/ { blk++ } blk == 2 && $2 ~ /^[0-9]+$/ && ($1 == app || $4 ~ /AudioOutput|CrRenderer|Compositor/) { printf "%s=%s ", $4, $3 }'
}
phase() {  # label, js run alongside the 60 s measurement
  local X0 X1 M
  X0=$(xr)
  M=$(cdp "(async () => { const m = window.__phi.measure(60); $2; return JSON.stringify(await m); })()")
  X1=$(xr)
  echo "[$1] android_underruns=$((X1 - X0)) page=$M"
  echo "    cpu: $(cpu)"
}
cdp "$(cat "$HERE/probe_inject.js"); 'probe in'" > /dev/null
cdp "(async () => { document.getElementById('playBtn').click(); await new Promise(r => setTimeout(r, 5000)); return 'playing'; })()" > /dev/null
phase plain ""
phase flashes "document.querySelector('[data-flash-where=\"full\"]').click(); await new Promise(r => setTimeout(r, 200)); document.getElementById('vbeatLaunch').click()"
cdp "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'closed'" > /dev/null
phase setting_changes "const fire = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }; const seq = [['base',150],['beat',2.3],['base',156],['lfoDepth',40],['beat',2.1],['base',144],['lfoDepth',30],['base',150],['beat',2.4],['base',144],['beat',2.1],['lfoDepth',35],['base',152],['base',144]]; for (let k = 0; k < 3; k++) for (const [id, v] of seq) { fire(id, v); await new Promise(r => setTimeout(r, 1400)); }"
cdp "document.getElementById('playBtn').textContent.includes('STOP') && document.getElementById('playBtn').click(); 'stopped'" > /dev/null
echo "    phone: big-core cap $("$ADB" shell cat /sys/devices/system/cpu/cpufreq/policy7/scaling_max_freq | tr -d '\r') kHz, $("$ADB" shell dumpsys battery | tr -d '\r' | grep temperature | tr -s ' ') (tenths of a degree), $("$ADB" shell dumpsys thermalservice | tr -d '\r' | grep 'Thermal Status')"
