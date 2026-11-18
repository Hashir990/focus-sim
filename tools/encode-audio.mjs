/**
 * The ambience tracks: a short, high-quality loop cut out of each recording.
 *
 *     node tools/encode-audio.mjs            # all of them
 *     node tools/encode-audio.mjs cafe sea   # just these
 *     node tools/encode-audio.mjs --dry      # choose the windows, encode nothing
 *
 * **Why this replaced a 45-minute file at 32 kbps.**
 *
 * The old pipeline stretched half an hour of recording out to forty-five
 * minutes and encoded it at 32 kbps so that eight of them would fit in an
 * app. Night city, the cafe and the sea were reported as scratchy, and they
 * were: at that bitrate the top two octaves are gone, which is where
 * birdsong, traffic detail and crockery live. Moving to Opus bought the
 * spectrum back and they still sounded wrong, because by then the bitrate
 * was no longer the worst thing happening to them.
 *
 * A loop costs what it is long. Two minutes instead of forty-five is
 * twenty-two times less audio, so the bitrate can go up by more than that
 * and the app still gets smaller: ~1.9 MB a track at 128 kbps stereo
 * against ~9.8 MB at 32 kbps mono. Stereo, because these are recordings of
 * places and the width is most of what makes them feel like one.
 *
 * **The stretch is gone, and that is a change of feel.** The recordings used
 * to be slowed to 0.75x for two reasons: to make them calmer, and because
 * 33 minutes of source had to become 45. The second reason died with the
 * long file. The first cost real fidelity -- a phase vocoder on cafe chatter
 * smears every voice in it, which is exactly the track that keeps being
 * called horrible. Put `STRETCH` back to 0.75 below if the calmer pacing is
 * worth more than the detail.
 *
 * **Where the loop is cut from is measured, not guessed.** The old script
 * took whatever was 60 seconds in. A loop two minutes long repeats thirty
 * times an hour, so anything distinctive in it -- a shout, a horn, a dog --
 * becomes a metronome. This scans the whole recording for the stretch whose
 * short-term loudness varies least and sits closest to the recording's own
 * median, which is the nearest thing to "nothing happens here" that can be
 * measured.
 *
 * **Nothing is baked in to hide the join.** The app plays two elements and
 * crossfades `AMB_FADE` seconds across the seam, so the end of one pass is
 * already mixed into the start of the next. A fade in the file as well would
 * dip twice and be audible as a dip.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist/audio';
const SRC = 'audio-src';

/** 0.75 to bring the old slowed-down feel back; 1 leaves the recording alone. */
const STRETCH = 1;
/** Seconds of finished loop. Everything scales off this. */
const LOOP = 120;
/**
 * Tracks that need longer, and why.
 *
 * Two minutes is plenty for anything that is really one steady sound. It is
 * not enough for a recording of events: the forest is birdsong, and the
 * calmest two minutes in three hours of it still swings 3 LU where every
 * other track manages under one. A short loop of that does not sound like a
 * forest, it sounds like the same four birds on a timer.
 */
const LOOP_LONGER = { forest: 240 };
/** How much of each end the crossfade actually touches; see the scoring. */
const EDGE_SECS = 4;
/** Everything lands here, so no track is louder than another. */
const TARGET_LUFS = -26;
/** Headroom against inter-sample peaks, which is what the old limiter missed. */
const TRUE_PEAK = -2;

/* name: the filters that are its own. Everything shared is added below. */
const TRACKS = {
  rain: '', forest: '', office: '', campfire: '', city: '', sea: '',
  /* A deeper cut under the room tone, which on this recording is mostly
     air conditioning. The 8.2 kHz roll-off that used to be here is gone:
     it was put in to take the edge off the crockery, and most of that edge
     turned out to be the 32 kbps encoder rather than the crockery. */
  cafe: 'bass=g=-9:f=220:w=0.6',
  /* A composed piece, not a recording of a place: taken whole, at its own
     tempo, and its bottom end left alone because the bass is part of it. */
  adrift: null,
};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const want = args.filter((a) => !a.startsWith('--'));

const run = (...a) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...a],
  { encoding: 'utf8', maxBuffer: 1 << 28 });

/** Where a recording actually is, allowing for the ones that are only linked. */
function sourceOf(name) {
  for (const ext of ['wav', 'flac', 'm4a', 'opus', 'mp3']) {
    const p = join(SRC, `${name}.${ext}`);
    if (existsSync(p) && statSync(p).size > 4096) return p;
  }
  /* audio-src/sources.txt: `name<TAB>path`, for recordings that arrived with
     the uploader's title on them and were never copied in. */
  const idx = join(SRC, 'sources.txt');
  if (existsSync(idx)) {
    for (const line of readFileSync(idx, 'utf8').split(/\r?\n/)) {
      const [n, ...rest] = line.split('\t');
      const p = rest.join('\t');
      if (n === name && p && existsSync(p)) return p;
    }
  }
  return null;
}

function duration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  return Number((r.stdout || '').trim()) || 0;
}

/** Short-term loudness over time, as [seconds, LUFS]. */
function levelTrace(file) {
  const r = run('-i', file, '-filter_complex', 'ebur128', '-f', 'null', '-');
  const pts = [];
  for (const m of (r.stderr || '').matchAll(/t:\s*([\d.]+).*?\sS:\s*(-?[\d.]+|-inf)/g)) {
    pts.push([Number(m[1]), m[2] === '-inf' ? -70 : Number(m[2])]);
  }
  return pts;
}

/**
 * The calmest `width` seconds in the recording.
 *
 * ebur128 reports a short-term loudness every 100 ms. A window where that
 * number barely moves is a window where nothing happens, which is what a
 * loop needs; a window far from the recording's own median is one that is
 * unusually loud or unusually dead, which is what it does not.
 */
function calmestWindow(file, width, total) {
  const pts = levelTrace(file);
  if (pts.length < 40) return { at: Math.min(60, Math.max(0, total - width)), why: 'no loudness data; fell back to 60s in' };

  const sorted = pts.map((p) => p[1]).slice().sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const step = 5;
  let best = null;
  /* Skip the first and last half-minute: recordings tend to start with a
     fade, a slate, or somebody putting the recorder down. */
  for (let start = 30; start + width <= total - 30; start += step) {
    const inWin = pts.filter((p) => p[0] >= start && p[0] < start + width).map((p) => p[1]);
    if (inWin.length < width * 5) continue;
    const mean = inWin.reduce((a, b) => a + b, 0) / inWin.length;
    const sd = Math.sqrt(inWin.reduce((a, b) => a + (b - mean) ** 2, 0) / inWin.length);
    /* **The edges matter more than the middle.** The app crossfades the last
       few seconds of a pass into the first few of the next, so those are the
       only two moments that ever meet. Choosing purely for steadiness picked
       windows that began or ended in a lull, and the join then dipped about a
       loudness unit every time it came round -- not a fault in the fade,
       which is equal-power, but the content under it being quiet at both
       ends at once. Both edges are scored against the window's own level. */
    const edge = Math.round(EDGE_SECS * 10);
    const head = inWin.slice(0, edge);
    const tail = inWin.slice(-edge);
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const edgeMiss = Math.abs(avg(head) - mean) + Math.abs(avg(tail) - mean);
    /* Steadiness first, then edges that match, then being typical. */
    const score = sd + edgeMiss * 1.5 + Math.abs(mean - median) * 0.5;
    if (!best || score < best.score) best = { at: start, sd, mean, edgeMiss, score };
  }
  if (!best) return { at: Math.min(60, Math.max(0, total - width)), why: 'no window fitted; fell back to 60s in' };
  return { at: best.at, why: `sd ${best.sd.toFixed(2)} LU, edges ${best.edgeMiss.toFixed(2)} LU apart,`
    + ` mean ${best.mean.toFixed(1)} against median ${median.toFixed(1)}` };
}

/**
 * A gain ramp that makes the loop's last seconds as loud as its first.
 *
 * Choosing a window whose edges already match gets most of the way, but on
 * the flattest tracks it is not enough. Rain is the case that showed it:
 * its loudness barely moves anywhere, so the half-unit its head and tail
 * happened to differ by was the only variation in the file, and the
 * crossfade put it in the one place that repeats. Measured against the
 * track's own distribution, the quietest moment in two passes of rain was
 * the join itself.
 *
 * So the difference is taken out with a straight line: half of it added at
 * the start, half taken off at the end. Across two minutes that is a slope
 * of well under a decibel, which no one can hear as a change; at the seam
 * it is the difference between the quietest point in the track and an
 * unremarkable one. Clamped, because anything bigger than a decibel is not
 * an edge mismatch to be corrected, it is a window that should not have
 * been chosen.
 */
function edgeTilt(file, start, take, pre) {
  /* `-filter_complex`, not `-af`: under `-af` this filter prints nothing at
     all, so the first version of this measured an empty trace and quietly
     decided every track was already matched. */
  const r = run('-ss', String(start), '-t', String(take), '-i', file,
    '-filter_complex', pre + 'ebur128', '-f', 'null', '-');
  const pts = [];
  for (const m of (r.stderr || '').matchAll(/t:\s*([\d.]+).*?\sS:\s*(-?[\d.]+|-inf)/g)) {
    if (m[2] !== '-inf') pts.push([Number(m[1]), Number(m[2])]);
  }
  /* The short-term window needs EDGE_SECS to fill before it means anything,
     so the head is read just after it has. */
  const head = pts.filter((x) => x[0] >= EDGE_SECS && x[0] < EDGE_SECS * 2).map((x) => x[1]);
  const tail = pts.filter((x) => x[0] >= take - EDGE_SECS).map((x) => x[1]);
  if (head.length < 5 || tail.length < 5) return { d: 0, filter: '' };
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  let d = avg(tail) - avg(head);
  if (Math.abs(d) < 0.05) return { d: 0, filter: '' };
  /* Three, not one and a half. The first limit was hit by rain with more
     left to correct, and the seam stayed the quietest point in the file.
     Spread over two minutes even this is a slope of a fortieth of a decibel
     a second, which is nothing; what it is guarding against is a window so
     lopsided it should have been rejected, and that is far beyond three. */
  d = Math.max(-3, Math.min(3, d));
  const half = (d / 2).toFixed(4);
  const slope = (d / take).toFixed(6);
  return {
    d,
    filter: `volume=eval=frame:volume='pow(10\\,((${half})-(${slope})*t)/20)',`,
  };
}

/** loudnorm, measured first and applied second, which is the accurate way. */
function loudnormFilter(file, start, take, pre) {
  const probe = run('-ss', String(start), '-t', String(take), '-i', file,
    '-af', `${pre}loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=11:print_format=json`,
    '-f', 'null', '-');
  /* Taken as a brace-to-brace block. Slicing from the last `{` to the end of
     the buffer swept up the lines ffmpeg prints after it, and every parse
     failed. */
  const json = ((probe.stderr || '').match(/\{[^{}]*"input_i"[\s\S]*?\}/) || [])[0];
  let m;
  try { m = JSON.parse(json); } catch (e) { return null; }
  return `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=11`
    + `:measured_I=${m.input_i}:measured_TP=${m.input_tp}`
    + `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}`
    + `:offset=${m.target_offset}:linear=true`;
}

mkdirSync(OUT, { recursive: true });
const names = Object.keys(TRACKS).filter((n) => !want.length || want.includes(n));
const report = [];

for (const name of names) {
  const src = sourceOf(name);
  if (!src) { console.log(`skip ${name} — nothing at ${SRC}/${name}.* and no sources.txt entry`); continue; }
  const whole = TRACKS[name] === null;
  const total = duration(src);
  /* **A piece that ends cannot be looped over its ending.** Adrift fades up
     at the front and away at the back, the way a composed piece does, and
     the app crossfades the back into the front -- so the one moment it
     repeats forever was two fades on top of each other. Measured, that join
     was 41 LU below the rest of the track: not a dip, a hole. Trimming to
     the part that plays at full level costs the intro and the outro, which
     are the two seconds of it nobody in a loop was ever going to hear in
     one piece anyway. */
  let headTrim = 0, tailTrim = 0;
  if (whole) {
    const lvl = levelTrace(src);
    if (lvl.length > 20) {
      const sorted = lvl.map((x) => x[1]).slice().sort((a, b) => a - b);
      const mid = sorted[sorted.length >> 1];
      const up = lvl.filter((x) => x[1] > mid - 6).map((x) => x[0]);
      if (up.length) {
        headTrim = Math.max(0, up[0]);
        tailTrim = Math.max(0, total - up[up.length - 1]);
      }
    }
  }

  /* A stretched loop needs less source than it produces. */
  const loop = LOOP_LONGER[name] || LOOP;
  const take = whole ? total - headTrim - tailTrim : loop * STRETCH;
  let at = whole ? headTrim : 0;
  let why = whole
    ? `the piece, less ${headTrim.toFixed(1)}s of intro and ${tailTrim.toFixed(1)}s of outro`
    : '';
  if (!whole) {
    process.stdout.write(`${name}: scanning ${(total / 60).toFixed(0)} min for the calmest ${take.toFixed(0)}s ... `);
    const pick = calmestWindow(src, take, total);
    at = pick.at; why = pick.why;
    console.log(`${(at / 60).toFixed(1)} min in (${why})`);
  }
  if (dry) { report.push([name, at, why, 0]); continue; }

  const own = TRACKS[name] || '';
  const shared = whole ? 'highpass=f=35' : 'highpass=f=55,bass=g=-7:f=180:w=0.6';
  const tempo = (!whole && STRETCH !== 1) ? `,atempo=${STRETCH}` : '';
  const pre = [shared, own].filter(Boolean).join(',') + tempo + ',';

  /* Before loudnorm, so what loudnorm measures is the finished shape. A
     composed piece is left alone: its ends were trimmed to full level
     already, and tilting a piece of music is not the same as tilting a
     recording of a room. */
  const tilt = whole ? { d: 0, filter: '' } : edgeTilt(src, at, take, pre);
  const pre2 = pre + tilt.filter;
  if (tilt.d) console.log(`  ${name}: edges ${tilt.d.toFixed(2)} dB apart, tilted level`);

  const ln = loudnormFilter(src, at, take, pre2);
  if (!ln) { console.log(`  ${name}: loudnorm would not measure; skipped`); continue; }

  const out = join(OUT, `${name}.ogg`);
  const enc = run('-v', 'error', '-y', '-ss', String(at), '-t', String(take), '-i', src,
    '-af', pre2 + ln,
    '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on',
    '-compression_level', '10', '-application', 'audio', '-frame_duration', '60',
    out);
  if (enc.status !== 0) { console.log(`  ${name}: ffmpeg failed\n${enc.stderr}`); continue; }

  /* The MP3 this replaces, if it is still there: build.files ships
     dist/audio/**, so one left behind is megabytes of app nobody plays. */
  const stale = join(OUT, `${name}.mp3`);
  if (existsSync(stale)) { rmSync(stale); console.log(`  removed the old ${stale}`); }

  report.push([name, at, why, statSync(out).size]);
}

console.log('');
let bytes = 0;
for (const [name, at, why, size] of report) {
  bytes += size;
  console.log(`${name.padEnd(10)} ${(at / 60).toFixed(1).padStart(5)} min in  ${(size / 1e6).toFixed(2).padStart(6)} MB   ${why}`);
}
console.log(`${''.padEnd(10)} ${''.padStart(5)}          ${(bytes / 1e6).toFixed(2).padStart(6)} MB total`);
