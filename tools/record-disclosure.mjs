/**
 * The declaration video, recorded off the phone.
 *
 *     node tools/record-disclosure.mjs            # record until you press Enter
 *     node tools/record-disclosure.mjs --secs 90  # or for a fixed length
 *
 * Google Play's accessibility policy asks for a video showing the prominent
 * disclosure and the feature it is for. What a reviewer is looking for is a
 * specific order of events, and the order is the whole point:
 *
 *   1. the app's own screen explaining why the service is needed, what it
 *      reads, and what it does with it -- BEFORE anything is asked for;
 *   2. the person choosing to go on;
 *   3. Android's own accessibility dialog, carrying `guard_service_desc`;
 *   4. the blocker actually standing in front of a blocked app.
 *
 * **It has to be the phone.** Rendering the desktop build was tried and
 * does not work at all: the blocking page is gated, and on anything that
 * is not Android it draws one line saying so -- "App blocking needs the
 * Android app. A browser and the desktop app have no way to see which app
 * is in front of you, or to stand in front of it." So the disclosure
 * cannot be photographed off the desktop even incompletely, never mind
 * beats three and four, which are Android's own dialog and the blocker
 * standing in front of something.
 *
 * **It does not drive the phone.** Tapping by coordinate is a guess at one
 * screen size and silently taps the wrong thing on every other, and a video
 * of the wrong thing being tapped is worse than no video. This starts the
 * recording, gets out of the way while you walk through it, and then pulls
 * the file and remuxes it so the result plays in a browser and in the
 * Console's uploader.
 */
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const ADB = [
  process.env.ADB,
  join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  'adb',
].filter(Boolean).find((p) => p === 'adb' || existsSync(p));

const PKG = 'com.uswork.focussimulator';
const ON_PHONE = '/sdcard/focus-disclosure.mp4';
const OUT_DIR = 'look/video';

const adb = (...args) => spawnSync(ADB, args, { encoding: 'utf8' });

const devices = () => {
  const r = adb('devices');
  if (r.error) return [];
  return (r.stdout || '').split('\n').slice(1)
    .map((l) => l.trim()).filter((l) => l.endsWith('\tdevice'))
    .map((l) => l.split('\t')[0]);
};

const secsArg = process.argv.indexOf('--secs');
const secs = secsArg > 0 ? Number(process.argv[secsArg + 1]) || 0 : 0;

const found = devices();
if (!found.length) {
  console.log('No phone. Plug it in, unlock it, and allow USB debugging when');
  console.log('it asks -- `adb devices` should list it as `device` rather than');
  console.log('`unauthorized`. ANDROID.md section 2 has the rest.');
  process.exit(1);
}
console.log('phone: ' + found[0]);

/* The app has to be the one on the phone, not an older build: the video is
   evidence about the version being reviewed. */
const ver = adb('shell', 'dumpsys', 'package', PKG);
const m = /versionName=([^\s]+)/.exec(ver.stdout || '');
console.log('installed: ' + (m ? m[1] : 'not installed -- run npm run phone first'));
if (!m) process.exit(1);

/* **One at a time.** Two screenrecords write the same file on the phone:
   the second deletes it and starts again, and the first then pulls a
   fragment of the second's take and remuxes it into nothing. That is a
   confusing way to lose a recording somebody has just performed, and it
   is entirely avoidable by asking. */
const busy = (adb('shell', 'pidof', 'screenrecord').stdout || '').trim();
if (busy) {
  console.log('A recording is already running on the phone (pid ' + busy + ').');
  console.log('Let it finish, or stop it, before starting another -- they');
  console.log('share one file and the first one out ruins both.');
  process.exit(1);
}

/* **Awake, or there is nothing to record.** screenrecord reads the
   display; with the screen off it fails with UNASSIGNED_LAYER_STACK and
   writes a nought-byte file, which is only discovered after the whole
   take. A phone left alone during a deploy is asleep by the end of it. */
adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
const awake = () => /mScreenState=ON/.test(
  (adb('shell', 'dumpsys', 'display').stdout || ''));
for (let i = 0; i < 10 && !awake(); i++) {
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},400)']);
}
if (!awake()) {
  console.log('The screen will not come on. Unlock the phone and try again --');
  console.log('screenrecord reads the display, and a dark one records as nothing.');
  process.exit(1);
}
/* And it must not go dark partway through. Put the timeout back after. */
const wasTimeout = (adb('shell', 'settings', 'get', 'system', 'screen_off_timeout')
  .stdout || '').trim();
if (/^\d+$/.test(wasTimeout)) {
  adb('shell', 'settings', 'put', 'system', 'screen_off_timeout', '600000');
}

mkdirSync(OUT_DIR, { recursive: true });
adb('shell', 'rm', '-f', ON_PHONE);

/* Bitrate up, because the disclosure is text and the default smears it. */
const rec = spawn(ADB, ['shell', 'screenrecord', '--bit-rate', '8000000',
  ...(secs ? ['--time-limit', String(secs)] : []), ON_PHONE],
  { stdio: 'inherit' });

console.log('');
console.log('Recording. Walk through it in this order, unhurried:');
console.log('  1. open the menu, then App blocking');
console.log('  2. let the page explaining the service sit on screen for a few');
console.log('     seconds -- this is the prominent disclosure, and it is the');
console.log('     part a reviewer is looking for');
console.log('  3. tap the App blocking service row');
console.log('  4. let Android\'s own dialog show, with its description, then allow');
console.log('  5. open an app you have blocked, and let the block screen appear');
console.log('');
console.log(secs ? `Stops by itself after ${secs}s.` : 'Press Enter when you are done.');

const finish = () => {
  try { rec.kill('SIGINT'); } catch (e) {}
  setTimeout(() => {
    if (/^\d+$/.test(wasTimeout)) {
      adb('shell', 'settings', 'put', 'system', 'screen_off_timeout', wasTimeout);
    }
    adb('pull', ON_PHONE, join(OUT_DIR, 'disclosure-raw.mp4'));
    const raw = join(OUT_DIR, 'disclosure-raw.mp4');
    const out = join(OUT_DIR, 'accessibility-disclosure.mp4');
    /* screenrecord writes a stream some players will not seek in; a remux
       costs nothing and makes it behave in a browser and in the uploader. */
    const ff = spawnSync('ffmpeg', ['-y', '-i', raw, '-c', 'copy',
      '-movflags', '+faststart', out], { encoding: 'utf8' });
    /* **Nought bytes is not a video.** Saying "wrote" over an empty file
       is how the first take got as far as being handed over. */
    let size = 0;
    try { size = statSync(raw).size; } catch (e) {}
    if (!size) {
      console.log('\nthe recording came back empty. The screen was probably off,');
      console.log('or the phone refused to record. Nothing was written.');
      process.exit(1);
    }
    if (ff.status === 0) console.log('\nwrote ' + out + ' (' + (size / 1e6).toFixed(1) + ' MB raw)');
    else console.log('\nwrote ' + raw + ' (' + (size / 1e6).toFixed(1) + ' MB; remux failed, the raw file plays)');
    process.exit(0);
  }, 1200);
};

if (secs) rec.on('exit', finish);
else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('', () => { rl.close(); finish(); });
}
