/**
 * Attach `latest.json` to the GitHub release electron-builder just made.
 *
 * Why this exists: to take git out of the loop.
 *
 * There are two audiences for an update and they were being served two
 * different ways. The installed desktop app reads `latest.yml`, which
 * electron-builder uploads to the release on its own. A copy of the plain
 * `dist/index.html` reads `latest.json` — and the only way that file reached the
 * internet was by committing and pushing it, which meant installing git, making
 * a repository locally, and remembering three commands after every release.
 *
 * A release asset solves it. `https://github.com/OWNER/REPO/releases/latest/
 * download/latest.json` always serves the newest release's copy of that file, so
 * both audiences read from the same release, uploaded by the same command, with
 * nothing else to remember and no git anywhere.
 *
 * Run by `npm run publish:win` (and the mac/linux ones) straight after
 * electron-builder. Standalone if you need it:
 *
 *     node tools/publish-extra.mjs
 *
 * Needs `GH_TOKEN` — the same token electron-builder uses — and the `publish`
 * block in package.json, which `npm run setup:updates` writes.
 *
 * **The repository should be public.** Both this file and the installer are
 * fetched without credentials by the copies out there; a private repo would need
 * a token embedded in every build, which is not a thing to do.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const target = (() => {
  const p = pkg.build && pkg.build.publish;
  const first = Array.isArray(p) ? p[0] : p;
  if (!first || !first.owner || first.owner === 'OWNER') return null;
  return { owner: first.owner, repo: first.repo };
})();

if (!target) {
  console.log('publish-extra: no repository configured — run  npm run setup:updates');
  process.exit(0);
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.log('publish-extra: no GH_TOKEN in the environment — skipping latest.json');
  console.log('  (the installer was still published; only the notice for plain');
  console.log('   HTML copies needs this)');
  process.exit(0);
}

const file = join(root, 'latest.json');
if (!existsSync(file)) {
  console.log('publish-extra: no latest.json — run  npm run release  first');
  process.exit(0);
}

const api = 'https://api.github.com';
const head = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'focus-simulator-release',
};
const tag = 'v' + pkg.version;

async function json(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch (e) { /* empty or not json */ }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${body.message || text.slice(0, 120)}`);
  return body;
}

try {
  /* electron-builder makes the release as a draft and publishes it at the end,
     so it is normally there by now. If it isn't — because this was run on its
     own, or the build was skipped — make it. */
  let release;
  try {
    release = await json(`${api}/repos/${target.owner}/${target.repo}/releases/tags/${tag}`, { headers: head });
  } catch (e) {
    console.log(`publish-extra: no release ${tag} yet, creating it`);
    release = await json(`${api}/repos/${target.owner}/${target.repo}/releases`, {
      method: 'POST',
      headers: { ...head, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, name: tag, draft: false, prerelease: false }),
    });
  }

  // An asset of the same name from a previous attempt has to go first.
  const old = (release.assets || []).find((a) => a.name === 'latest.json');
  if (old) {
    await fetch(`${api}/repos/${target.owner}/${target.repo}/releases/assets/${old.id}`,
      { method: 'DELETE', headers: head });
  }

  const body = readFileSync(file);
  const up = release.upload_url.replace(/\{.*\}$/, '') + '?name=latest.json';
  await json(up, {
    method: 'POST',
    headers: { ...head, 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
    body,
  });

  console.log(`publish-extra: latest.json attached to ${tag}`);
  console.log(`  copies check https://github.com/${target.owner}/${target.repo}/releases/latest/download/latest.json`);
} catch (e) {
  /* Never fail the build over this. The installer is already published and
     updating; the notice for plain HTML copies is the part that missed. */
  console.log('publish-extra: could not attach latest.json — ' + e.message);
}
