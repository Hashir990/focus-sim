/**
 * Push the signed bundle to Google Play.
 *
 *   node tools/play-upload.mjs                 → the internal track
 *   node tools/play-upload.mjs --track alpha   → somewhere else
 *   node tools/play-upload.mjs --dry           → say what it would do
 *
 * **This cannot make the app, only update it.** The Play Developer API has no
 * call that creates a listing: the app entry, the store listing, the content
 * rating, the data safety form and the very first release all have to be done
 * by a signed-in person in the Play Console. Everything after that is this
 * file. See PLAY.md.
 *
 * **What it needs.** A service account key, as JSON, from
 * Play Console → Setup → API access → create a service account (it sends you
 * to Google Cloud to make it), then grant that account **Release manager** on
 * the app and download its key. Put the file somewhere outside this repository
 * and point `FOCUS_PLAY_KEY` at it, or drop it at `android/play-key.json`,
 * which .gitignore already covers along with every other key here.
 *
 * It is deliberately small: one upload, one track, one commit. Anything
 * cleverer belongs in the Console where somebody can see it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at >= 0 ? (args[at + 1] || true) : fallback;
};

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appId = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8')).appId;
const track = String(flag('track', 'internal'));
const dry = args.includes('--dry');
const aab = join(root, 'android', 'app', 'build', 'outputs', 'bundle', 'release',
  'app-release.aab');

const keyPath = process.env.FOCUS_PLAY_KEY || join(root, 'android', 'play-key.json');

function die(what, how) {
  console.error('\n  ' + what);
  if (how) console.error('  ' + how);
  console.error('');
  process.exit(1);
}

if (!existsSync(aab)) {
  die('no bundle at android/app/build/outputs/bundle/release/app-release.aab',
      'cd android && ./gradlew :app:bundleRelease   (JAVA_HOME on a JDK 21)');
}
if (!existsSync(keyPath)) {
  die('no service account key at ' + keyPath,
      'Play Console → Setup → API access. See the note at the top of this file.');
}

console.log(`${appId} ${pkg.version} → ${track}${dry ? '  (dry run)' : ''}`);
if (dry) {
  console.log('bundle: ' + aab);
  console.log('key:    ' + keyPath);
  process.exit(0);
}

/** A signed assertion, swapped for an access token. The only auth Google
    offers a machine, and the only reason this file needs `crypto`. */
async function token() {
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  });
  const sign = createSign('RSA-SHA256');
  sign.update(body);
  const jwt = body + '.' + sign.sign(key.private_key, 'base64url');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const out = await r.json();
  if (!out.access_token) die('Google refused the key: ' + JSON.stringify(out));
  return out.access_token;
}

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

async function call(tok, path, opt = {}) {
  const r = await fetch(API + '/' + appId + path, {
    ...opt, headers: { Authorization: 'Bearer ' + tok, ...(opt.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) die(`${r.status} on ${path}`, text.slice(0, 400));
  return text ? JSON.parse(text) : {};
}

const tok = await token();

/* An edit is a transaction: nothing is live until it is committed, and an
   abandoned one changes nothing, which is what makes a failed run safe. */
const edit = await call(tok, '/edits', { method: 'POST' });
console.log('edit ' + edit.id);

const bytes = readFileSync(aab);
const up = await fetch(
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/`
  + `${appId}/edits/${edit.id}/bundles?uploadType=media`,
  { method: 'POST', body: bytes,
    headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/octet-stream' } });
const bundle = await up.json();
if (!up.ok) die('upload refused', JSON.stringify(bundle).slice(0, 400));
console.log('uploaded versionCode ' + bundle.versionCode);

await call(tok, `/edits/${edit.id}/tracks/${track}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ track, releases: [{
    name: pkg.version,
    versionCodes: [String(bundle.versionCode)],
    status: 'completed',
  }] }),
});
await call(tok, `/edits/${edit.id}:commit`, { method: 'POST' });
console.log(`committed. ${pkg.version} (${bundle.versionCode}) is on ${track}.`);
