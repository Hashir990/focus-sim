#!/bin/bash
# Cuts the full-length source recordings down to the one-hour tracks the app ships.
#
#   audio-src/<name>.mp3   full recording (1-4 hours, 55-235 MB) — not in git
#   dist/audio/<name>.mp3  one hour, mono, 32 kbps, ~13.7 MB
#
# The gain per track was measured with ebur128 on a 90-second sample and brings
# each one to about -26 LUFS, so no ambience is louder or harsher than another:
#
#   ffmpeg -i audio-src/rain.mp3 -ss 300 -t 90 -filter_complex ebur128 -f null -
#
# alimiter catches the peaks the gain would otherwise push over. No fades are
# baked in — the app fades on loop, and doing both would double up.
#
# Usage:  bash tools/encode-audio.sh [name ...]
set -e
cd "$(dirname "$0")/.."
mkdir -p dist/audio

# name:gain-in-dB
TRACKS="rain:4.5 forest:4.7 cafe:10.4 office:7.5 campfire:6.7"
WANT="${*:-rain forest cafe office campfire}"

for pair in $TRACKS; do
  n="${pair%%:*}"; g="${pair##*:}"
  case " $WANT " in *" $n "*) ;; *) continue ;; esac
  [ -f "audio-src/$n.mp3" ] || { echo "skip $n (no audio-src/$n.mp3)"; continue; }

  # campfire's source is only 60 min, so it starts at 0; the others skip a
  # minute of intro
  start=60
  [ "$n" = campfire ] && start=0

  echo "encoding $n ..."
  ffmpeg -v error -y -ss "$start" -t 3600 -i "audio-src/$n.mp3" \
    -af "volume=${g}dB,alimiter=limit=0.95" \
    -ac 1 -ar 32000 -c:a libmp3lame -b:a 32k -write_xing 1 \
    "dist/audio/$n.mp3"
done

echo
ls -la dist/audio/
