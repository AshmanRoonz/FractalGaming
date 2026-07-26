#!/bin/bash
# High-quality GIF: makegif.sh <framedir> <out.gif> [width] [outfps] [infps]
set -e
cd "$(dirname "$0")"
DIR="$1"; OUT="$2"; W="${3:-480}"; OFPS="${4:-20}"; IFPS="${5:-30}"
PAL=$(mktemp --suffix=.png)
./ffmpeg -y -loglevel error -framerate $IFPS -pattern_type glob -i "$DIR/f*.jpg" \
  -vf "fps=$OFPS,scale=$W:-1:flags=lanczos,palettegen=max_colors=224:stats_mode=diff" "$PAL"
./ffmpeg -y -loglevel error -framerate $IFPS -pattern_type glob -i "$DIR/f*.jpg" -i "$PAL" \
  -lavfi "fps=$OFPS,scale=$W:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  "$OUT"
rm -f "$PAL"
du -h "$OUT" | cut -f1
