#!/bin/bash
# Cuts the full-length source recordings down to the tracks the app ships.
#
#   audio-src/<name>.mp3   full recording (1-4 hours, 55-235 MB) — not in git
#   dist/audio/<name>.mp3  45 min, mono, 32 kbps, ~10.3 MB
#
# The recordings are slowed to 75% speed to make them calmer to work to. atempo
# does this by time-stretching, so pitch is unchanged — rain doesn't drop into a
# growl and birdsong stays birdsong. 33 min 45 s of source therefore yields the
# 45 minutes we want.
#
# bass= takes 7 dB off the low shelf and highpass= clears the sub-bass rumble
# underneath it, which is what made them feel heavy through speakers.
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

# **Music is not ambience, and is not treated like it.** Five of these are
# recordings of a place: hours long, steady, and better slowed down. Adrift is
# a composed piece two and a half minutes long, so there is nothing to cut it
# down to and stretching it to three quarters speed would not make it calmer,
# it would make it wrong. It is levelled and re-encoded at its own length and
# its own tempo, and the app loops it — which it already does seamlessly, so
# repeating it into a longer file would buy nothing but megabytes.
#
# Gains measured the ebur128 way described above, each bringing the track to
# about -26 LUFS: city -24.2, sea -25.9, adrift -15.3.
#
# name:gain-in-dB
TRACKS="rain:4.5 forest:4.7 cafe:10.4 office:7.5 campfire:6.7 city:-1.8 sea:-0.1 adrift:-10.7"
WANT="${*:-rain forest cafe office campfire city sea adrift}"

for pair in $TRACKS; do
  n="${pair%%:*}"; g="${pair##*:}"
  case " $WANT " in *" $n "*) ;; *) continue ;; esac
  # The sources are whatever the recording came as. Only the name is a
  # convention; the container is not.
  src=""
  for ext in mp3 m4a opus wav flac; do
    [ -f "audio-src/$n.$ext" ] && { src="audio-src/$n.$ext"; break; }
  done
  [ -n "$src" ] || { echo "skip $n (nothing at audio-src/$n.*)"; continue; }

  # campfire's source is only 60 min, so it starts at 0; the others skip a
  # minute of intro. Adrift is 144 seconds end to end and every one of them is
  # the piece, so it skips nothing and is not cut.
  start=60
  [ "$n" = campfire ] && start=0
  [ "$n" = adrift ] && start=0

  echo "encoding $n ..."
  # 2025 s of source -> 2700 s (45 min) out at 0.75x.
  #
  # cafe uses librubberband instead of atempo. atempo is a simple overlap-add and
  # it mangles voices at this much stretch — the chatter came out warbling. A
  # phase vocoder holds speech together, at roughly 5x the encoding cost. The
  # other four are steady noise, where atempo is fine and much faster.
  # cafe also gets a deeper bass cut and an 8.2 kHz roll-off, to take the edge off
  # the crockery.
  #
  # adrift keeps its tempo and most of its bottom end: it is a composed piece
  # and the bass is part of it, where in a recording of a room the low end is
  # just the room. Levelled, lightly cleared of sub-bass, and left alone.
  if [ "$n" = cafe ]; then
    FILT="volume=${g}dB,highpass=f=65,bass=g=-9:f=220:w=0.6,rubberband=tempo=0.75:transients=smooth:detector=soft:window=long:smoothing=on,lowpass=f=8200,alimiter=limit=0.95"
  elif [ "$n" = adrift ]; then
    FILT="volume=${g}dB,highpass=f=35,alimiter=limit=0.95"
  else
    FILT="volume=${g}dB,bass=g=-7:f=180:w=0.6,highpass=f=55,atempo=0.75,alimiter=limit=0.95"
  fi

  # 2025 s of source -> 2700 s out at 0.75x; adrift is taken whole.
  LEN="-t 2025"
  [ "$n" = adrift ] && LEN=""

  ffmpeg -v error -y -ss "$start" $LEN -i "$src" \
    -af "$FILT" \
    -ac 1 -ar 32000 -c:a libmp3lame -b:a 32k -write_xing 1 \
    "dist/audio/$n.mp3"
done

echo
ls -la dist/audio/
