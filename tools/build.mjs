/**
 * Stitches src/ back into a single self-contained dist/index.html.
 *
 * Order is filename order, which is why every file has a numeric prefix.
 * To add a new arcade game: drop src/js/22-chess.js, src/css/14-chess.css and
 * src/body/12-chess.html in place and rebuild. No config to edit.
 *
 *   node tools/build.mjs           build once
 *   node tools/build.mjs --watch   rebuild on save
 *   node tools/build.mjs --serve   rebuild on save + http://localhost:4321
 *   node tools/build.mjs --verify  build, then diff against the original
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, watch, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { buildDev } from './dev-build.mjs';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');
const DIST = join(root, 'dist');

const args = new Set(process.argv.slice(2));
const WATCH = args.has('--watch') || args.has('--serve');
const SERVE = args.has('--serve');
const VERIFY = args.has('--verify');

function readDirJoined(sub, ext) {
  const dir = join(SRC, sub);
  if (!existsSync(dir)) return '';
  const files = readdirSync(dir)
    .filter((f) => extname(f) === ext)
    .sort();
  if (!files.length) return '';
  return files.map((f) => readFileSync(join(dir, f), 'utf8')).join('');
}

/** The version in package.json, stamped in so the app knows what it is. */
function appVersion() {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
}

/* Where a copy of the app looks to find out whether a newer one exists.
   A plain static file, so it can live anywhere that serves text — a GitHub raw
   URL, a Pages site, a Dropbox link. Empty by default and empty in every build
   that is handed out until somebody decides where to host it, and an empty URL
   means the check never runs and never mentions itself.

   Overridable from the environment so a fork does not have to edit source:
       FOCUS_UPDATE_URL=https://... npm run build
   See tools/make-release.mjs for what the file on the other end looks like. */
function envFile(name) {
  /* `.env.release` is written by tools/setup-updates.mjs and holds the one
     setting that has to be the same in every build you hand out. Kept in a file
     rather than in the shell because a build made from a different terminal — or
     by a script, or six months later — has to come out the same. */
  try {
    const text = readFileSync(join(root, '.env.release'), 'utf8');
    const line = text.split('\n').find((l) => l.trim().startsWith(name + '='));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch (e) {
    return '';
  }
}

/* Where the accounts Worker lives. Blank in this repo on purpose, and blank is
   a working state: with no URL stamped in there is no sign-in anywhere in the
   app, no request, and no mention of one — the same opt-in-by-hosting rule the
   update check follows. See ACCOUNTS.md and 48-account.js. */
const ACCOUNT_URL = process.env.FOCUS_ACCOUNT_URL
  || envFile('FOCUS_ACCOUNT_URL')
  || '';

/* Whose app this is, and where to write about it. Stamped rather than typed
   into the source so one `.env` line covers the policy, the credits and any
   store listing that has to agree with them. Left as the placeholder, the
   Privacy screen shows a red gap where the name should be — a policy that ships
   saying "the developer" is worse than one that is missing, and this makes that
   impossible to not notice. See §"Your part" in HANDOFF.md. */
const PRIVACY_OWNER = process.env.FOCUS_PRIVACY_OWNER
  || envFile('FOCUS_PRIVACY_OWNER')
  || '__PRIVACY_OWNER__';

const PRIVACY_EMAIL = process.env.FOCUS_PRIVACY_EMAIL
  || envFile('FOCUS_PRIVACY_EMAIL')
  || '__PRIVACY_EMAIL__';

const UPDATE_URL = process.env.FOCUS_UPDATE_URL
  || envFile('FOCUS_UPDATE_URL')
  || 'https://raw.githubusercontent.com/OWNER/REPO/main/latest.json';

/** Stamped into the drawer footer so you can always see which build you're looking at. */
function buildStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  let hash = '';
  try {
    hash = ' · ' + execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) { /* not a git repo — fine */ }
  return when + hash;
}

export function build() {
  const head = readFileSync(join(SRC, 'head.html'), 'utf8');
  const css = readDirJoined('css', '.css');
  const body = readDirJoined('body', '.html');
  const js = readDirJoined('js', '.js');

  const html = (
    head +
    '<style>\n' +
    css +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    body +
    '\n<script>\n' +
    js +
    '</script>\n' +
    '</body>\n' +
    '</html>\n'
  ).replace(/__BUILD__/g, buildStamp())
   .replace(/__VERSION__/g, appVersion())
   .replace(/__UPDATE_URL__/g, UPDATE_URL)
   .replace(/__ACCOUNT_URL__/g, ACCOUNT_URL)
   .replace(/__PRIVACY_OWNER__/g, PRIVACY_OWNER)
   .replace(/__PRIVACY_EMAIL__/g, PRIVACY_EMAIL);

  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, 'index.html'), html, 'utf8');
  // ...and the developer's copy, with everything already bought. See tools/dev-build.mjs.
  try { buildDev(); } catch (e) { console.log('! dev-unlocked.html: ' + e.message); }
  return html;
}

function verify() {
  const ref = join(root, 'tools', 'original.reference.html');
  if (!existsSync(ref)) {
    console.log('! no reference file — skipping byte comparison');
    return true;
  }
  const built = readFileSync(join(DIST, 'index.html'), 'utf8');
  const original = readFileSync(ref, 'utf8');
  if (built === original) {
    console.log('✓ dist/index.html is byte-identical to the original');
    return true;
  }
  const a = original.split('\n');
  const b = built.split('\n');
  console.log(`✗ differs — original ${a.length} lines / built ${b.length} lines`);
  let shown = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 10; i++) {
    if (a[i] !== b[i]) {
      console.log(`  line ${i + 1}:\n    original: ${JSON.stringify((a[i] ?? '').slice(0, 90))}\n    built:    ${JSON.stringify((b[i] ?? '').slice(0, 90))}`);
      shown++;
    }
  }
  return false;
}

/** The one thing that isn't inside index.html — warn loudly if it's missing. */
function checkAudio() {
  const dir = join(DIST, 'audio');
  const want = ['rain', 'forest', 'cafe', 'office', 'campfire'];
  const missing = want.filter((n) => !existsSync(join(dir, n + '.mp3')));
  if (missing.length) {
    console.log(`! dist/audio is missing: ${missing.join(', ')} — run  bash tools/encode-audio.sh`);
  }
}

const run = () => {
  const t = Date.now();
  const html = build();
  console.log(`built dist/index.html — ${(html.length / 1024).toFixed(1)} KB in ${Date.now() - t}ms`);
  checkAudio();
};

run();

if (VERIFY) process.exit(verify() ? 0 : 1);

if (WATCH) {
  let timer = null;
  watch(SRC, { recursive: true }, (_e, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        run();
        console.log(`  (${file} changed)`);
      } catch (err) {
        console.error('build failed:', err.message);
      }
    }, 60);
  });
  console.log('watching src/ …');
}

if (SERVE) {
  const PORT = 4321;
  createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/index.html') {
      res.writeHead(404).end('not found');
      return;
    }
    const body = readFileSync(join(DIST, 'index.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(body);
  }).listen(PORT, () => console.log(`serving http://localhost:${PORT}`));
}
