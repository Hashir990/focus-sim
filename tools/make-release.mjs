/**
 * Cut a release: bump the version, build, and write the file that other copies
 * of the app check.
 *
 *   node tools/make-release.mjs "Calendar can plan ahead now"   <- minor, the default
 *   node tools/make-release.mjs patch "Fixed the crossword clues"
 *   node tools/make-release.mjs minor "Calendar can plan ahead now"
 *   node tools/make-release.mjs 2.0.0 "Rewritten"
 *
 * It writes three things:
 *
 *   package.json      the new version number
 *   dist/index.html   rebuilt, with that version stamped inside it
 *   latest.json       what an installed copy reads to learn a newer one exists
 *
 * `latest.json` is the whole update mechanism on the server side. It is a static
 * file — no server code, no API, nothing to keep running. Put it anywhere that
 * serves text over https and point FOCUS_UPDATE_URL at it:
 *
 *   FOCUS_UPDATE_URL=https://raw.githubusercontent.com/you/focus/main/latest.json \
 *     node tools/make-release.mjs patch "..."
 *
 * The URL is baked into the build that reads it, so it has to be set for the
 * build people are given, not for this one. Set it once in your shell profile
 * and forget about it.
 *
 * What this deliberately does *not* do is install anything. Silently replacing a
 * file on somebody else's disk needs code signing, an updater service and a
 * trust relationship this app does not have and should not pretend to. The
 * person is told there is a new version and given the link; they choose.
 *
 * For the Windows installer there *is* a proper automatic path — electron-builder
 * writes the metadata electron-updater needs, and if you publish the installer
 * to GitHub Releases the desktop app can update itself. See INSTALL.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');

function bump(version, how) {
  if (/^\d+\.\d+\.\d+/.test(how)) return how;          // an explicit version
  const [a, b, c] = version.split('.').map((n) => parseInt(n, 10) || 0);
  if (how === 'major') return `${a + 1}.0.0`;
  if (how === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

/* **`minor` is the default from 1.0.10 onwards.**
 *
 * Hashir's call, and a sound one: patch numbers had run to double figures,
 * which is where a dotted version stops being readable at a glance and starts
 * being something you have to parse. `1.1.0`, `1.2.0` reads as a sequence of
 * releases; `1.0.9`, `1.0.10`, `1.0.11` reads as a build counter.
 *
 * `patch` is still there for a genuine one-line fix on top of a release. It is
 * the default that changed, not the options. */
/* The first argument is the bump only if it names one. Otherwise the whole
   command line is the note and the bump is the default — so
   `make-release "what changed"` works, which is the point of having one. */
const KINDS = ['major', 'minor', 'patch'];
const named = KINDS.includes(process.argv[2]) || /^\d+\.\d+\.\d+$/.test(process.argv[2] || '');
const how = named ? process.argv[2] : 'minor';
const notes = process.argv.slice(named ? 3 : 2).join(' ').trim();
if (!notes) {
  console.error('Say what changed:  node tools/make-release.mjs "…"');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const from = pkg.version || '0.0.0';
const to = bump(from, how);
pkg.version = to;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`version ${from} → ${to}`);

/* Built after the bump, so the number inside the file is the number being
   released. This is the one ordering mistake that produces an app which thinks
   it is out of date the moment it is installed. */
const { build } = await import('./build.mjs');
build();

function envFile(name) {
  try {
    const text = readFileSync(join(root, '.env.release'), 'utf8');
    const line = text.split('\n').find((l) => l.trim().startsWith(name + '='));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch (e) {
    return '';
  }
}

/* Where the notice's "Get it" button points. Taken from `.env.release` — which
   `npm run setup:updates` writes — or from the publish target in package.json.
   Git is never consulted: it is not installed on every machine this is built
   on, and asking it would make the release depend on something that has nothing
   to do with releasing. */
const url = process.env.FOCUS_RELEASE_URL
  || envFile('FOCUS_RELEASE_URL')
  || (() => {
    const p = pkg.build && pkg.build.publish;
    const first = Array.isArray(p) ? p[0] : p;
    return first && first.owner && first.owner !== 'OWNER'
      ? `https://github.com/${first.owner}/${first.repo}/releases/latest`
      : '';
  })();

writeFileSync(join(root, 'latest.json'),
  JSON.stringify({ version: to, notes, url, at: new Date().toISOString() }, null, 2) + '\n');
console.log('wrote latest.json' + (url ? ` → ${url}` : ' (no download url; set FOCUS_RELEASE_URL)'));
console.log('\nNext:  npm run publish:win');
console.log('       — builds the installer, uploads it, and attaches latest.json');
console.log('         so both kinds of copy see this release.');
