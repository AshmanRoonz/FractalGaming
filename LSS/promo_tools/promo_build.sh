#!/bin/bash
# Assemble the LSS promo video. Segments: title cards + overworld scenic + 7 ship clips + combat highlights.
set -e
cd "$(dirname "$0")"
FF=./ffmpeg
FPS=30
OUT=promo_out
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
MUSIC=/home/user/FractalGaming/LSS/music/battle_in_LSS.mp3
mkdir -p "$OUT"
rm -f "$OUT"/s*.mp4 "$OUT"/concat.txt

i=0
add() { echo "file 's$i.mp4'" >> "$OUT/concat.txt"; i=$((i+1)); }

card() { # card <png> <seconds>
  local png=$1 secs=$2
  local fo=$(python3 -c "print(max(0,$secs-0.45))")
  $FF -y -loglevel error -loop 1 -i "$png" -t "$secs" -r $FPS \
    -vf "scale=1280:720,fade=t=in:st=0:d=0.4,fade=t=out:st=$fo:d=0.45" \
    -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p "$OUT/s$i.mp4"
  add
}

clip() { # clip <dir> <startframe> <nframes> [label]
  local dir=$1 start=$2 n=$3 label=$4
  local secs=$(python3 -c "print($n/$FPS)")
  local fo=$(python3 -c "print(max(0,$n/$FPS-0.35))")
  local vf="scale=1280:720:flags=lanczos,fade=t=in:st=0:d=0.3,fade=t=out:st=$fo:d=0.35"
  if [ -n "$label" ]; then
    vf="$vf,drawtext=fontfile=$FONT:text='$label':fontcolor=0xFFAA00:fontsize=44:x=60:y=h-110:shadowcolor=black@0.7:shadowx=3:shadowy=3"
  fi
  $FF -y -loglevel error -framerate $FPS -start_number "$start" -i "$dir/f%04d.jpg" -frames:v "$n" \
    -vf "$vf" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p "$OUT/s$i.mp4"
  add
}

echo "== building segments =="
card cards/c1.png 3.2
clip promo_segments/overworld 30 200
card cards/c2.png 2.4
clip ship_frames/VORTEX   15 75 "VORTEX"
clip ship_frames/PYRO     60 75 "PYRO"
clip ship_frames/PUNCTURE 20 75 "PUNCTURE"
clip ship_frames/SLAYER   80 75 "SLAYER"
clip ship_frames/TRACKER  30 75 "TRACKER"
clip ship_frames/BLASTER  80 75 "BLASTER"
clip ship_frames/SYPHON   40 75 "SYPHON"
card cards/c3.png 2.4
clip ship_frames/SLAYER  140 70
clip ship_frames/PYRO    140 70
card cards/c4.png 2.4
card cards/c5.png 2.4
clip ship_frames/VORTEX  140 70
card cards/c6.png 4.0

echo "== concat =="
$FF -y -loglevel error -f concat -safe 0 -i "$OUT/concat.txt" -c copy "$OUT/video_noaudio.mp4"
DUR=$(python3 -c "
import subprocess,re
p=subprocess.run(['./ffmpeg','-i','$OUT/video_noaudio.mp4'],capture_output=True,text=True)
m=re.search(r'Duration: (\d+):(\d+):([\d.]+)',p.stderr)
print(int(m.group(1))*3600+int(m.group(2))*60+float(m.group(3)))")
FADE=$(python3 -c "print($DUR-3.0)")
echo "duration ${DUR}s"

echo "== music =="
$FF -y -loglevel error -i "$OUT/video_noaudio.mp4" -i "$MUSIC" \
  -filter_complex "[1:a]afade=t=in:st=0:d=1.2,afade=t=out:st=$FADE:d=3.0,volume=0.95[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT/LSS_promo.mp4"
ls -la "$OUT/LSS_promo.mp4"
echo PROMO-DONE
