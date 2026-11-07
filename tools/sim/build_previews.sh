#!/usr/bin/env bash
# Renders GIF/PNG previews of every sign screen and animation using the real
# firmware drawing code (firmware/mta_sign/display.cpp).
#
#   tools/sim/build_previews.sh [output-dir]      (needs g++, git, python3 + Pillow)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mkdir -p "${1:-previews}" && cd "${1:-previews}" && pwd)"
WORK="${SIM_WORK:-$HERE/.build}"
GFX_REV=4e23182c134091e664a80892096271d23e1954a6   # Adafruit-GFX-Library, pinned

mkdir -p "$WORK"
if [ ! -d "$WORK/gfx" ]; then
  git clone -q https://github.com/adafruit/Adafruit-GFX-Library.git "$WORK/gfx"
  git -C "$WORK/gfx" checkout -q "$GFX_REV"
fi

g++ -std=c++17 -O1 -Wall -DARDUINO=100 -I"$HERE/shim" -I"$WORK/gfx/src" \
  "$HERE/sim.cpp" "$HERE/../../firmware/mta_sign/display.cpp" "$WORK/gfx/src/Adafruit_GFX.cpp" \
  -o "$WORK/sim"

for scene in weekday weekend weekend-ar connecting walk chase peek message; do
  "$WORK/sim" "$scene" "$WORK/$scene.rgb" >/dev/null
  case "$scene" in weekday|weekend|weekend-ar) ext=png ;; *) ext=gif ;; esac
  python3 "$HERE/render_gif.py" "$WORK/$scene.rgb" "$OUT/$scene.$ext"
done
BASE=weekend "$WORK/sim" walk "$WORK/walk-weekend.rgb" >/dev/null
python3 "$HERE/render_gif.py" "$WORK/walk-weekend.rgb" "$OUT/walk-weekend.gif"
