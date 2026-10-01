/**
 * Check everything a publish needs, before spending ten minutes on a build.
 *
 *     npm run publish:check
 *
 * `electron-builder --publish always` fails at the *end* of the build if the
 * token is missing or the repository is not there, which means you find out
 * about a one-line problem after the longest part of the job. Everything it is
 * going to need can be known in two seconds, so this knows it in two seconds.
 *
 * Nothing here writes anything or needs a token to answer most of it — the
 * repository check is an unauthenticated GET, the same request the copies you
 * hand out will make.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

let bad = 0;
/** One setting out of .env.release, read the same way tools/build.mjs reads it
    so the two cannot disagree about whether something is set. */
function envRelease(name) {
  try {
    const text = readFileSync(join(root, '.env.release'), 'utf8');
    const line = text.split('\n').find((l) => l.trim().startsWith(name + '='));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch (e) {
    return '';
  }
}

const ok = (m) => console.log('  ok    ' + m);
const no = (m, fix) => { bad++; console.log('  ✗     ' + m); if (fix) console.log('        → ' + fix); };
const note = (m) => console.log('  ·     ' + m);

console.log(`\nFocus Simulator ${pkg.version} — publish check\n`);

// 1. where is it going
const p = pkg.build && pkg.build.publish;
const target = Array.isArray(p) ? p[0] : p;
if (!target || !target.owner || target.owner === 'OWNER') {
  no('no repository configured', 'npm run setup:updates <your-github-name> <repo-name>');
} else {
  ok(`publishing to github.com/${target.owner}/${target.repo}`);
}

/* 1b. who to write to
   The privacy policy and the credits name whoever runs the app and an address
   to reach them. Unfilled, they render as red underlined "the developer" and
   "the contact address for this build" — deliberately loud, in seven languages.
   Loud is not the same as caught, though: it shipped that way in 1.4.0, because
   the only thing that would have noticed was somebody opening the privacy page
   in a release build and reading it. A policy with no one to write to is the
   one part of this the law actually cares about, which is also why the terms
   were allowed to drop their copy of it and this was not. */
/* `FOCUS_PRIVACY_EMAIL` used to be here too and is not any more: neither the
   privacy policy nor the terms prints an address, so demanding one would be
   demanding a value nothing reads. Questions go through Report a problem, whose
   address is REPORT_TO in 50-about.js. */
for (const [name, what] of [['FOCUS_PRIVACY_OWNER', 'who runs the app']]) {
  const v = (process.env[name] || envRelease(name) || '').trim();
  if (!v) {
    no(`${name} is not set — ${what} is blank in the privacy policy`,
       `add ${name}=... to .env.release`);
  } else {
    ok(`${name} is set (${v})`);
  }
}

// 2. the token
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  no('GH_TOKEN is not set in this terminal',
     'setx GH_TOKEN "ghp_..."  — then CLOSE this window and open a new one');
} else if (!/^(gh[pousr]_|github_pat_)/.test(token)) {
  note('GH_TOKEN is set but does not look like a GitHub token — carrying on anyway');
} else {
  ok(`GH_TOKEN is set (${token.slice(0, 7)}…, ${token.length} characters)`);
  /* **Being set is not the same as working.**

     This used to stop here, and "ok" meant only that the variable existed. The
     first thing that actually tried the token was electron-builder, at the
     *end* of a three-minute build — so a bad paste cost a full rebuild and
     arrived as a wall of `HttpError: 401` with a stack trace through
     `builder-util-runtime`, which reads like a broken toolchain rather than a
     mistyped secret.

     One authenticated request answers it in a second, and can tell the three
     failures apart: a token GitHub does not recognise at all (401), a token it
     recognises but which may not carry `repo` scope, and a token that is fine.
     Whitespace is checked separately because a trailing space survives `setx`
     silently and produces exactly the same 401 as a wrong token. */
  if (token !== token.trim()) {
    no('GH_TOKEN has a space or newline in it — that alone causes "Bad credentials"',
       'setx GH_TOKEN "ghp_..."  — retype the quotes, paste nothing after the token');
  }
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { 'User-Agent': 'focus-publish-check', Authorization: `Bearer ${token.trim()}` },
    });
    if (res.status === 401) {
      no('GitHub rejected this token — "Bad credentials"',
         'it is expired, revoked, or was pasted wrong. Make a new one: '
         + 'github.com/settings/tokens → Tokens (classic) → Generate new token (classic), tick repo');
    } else if (res.ok) {
      const me = await res.json();
      const scopes = res.headers.get('x-oauth-scopes');
      ok(`token works, signed in as ${me.login}`);
      /* Fine-grained tokens send no scope header at all, so a missing one is
         not evidence of anything — only a classic token that is definitely
         missing `repo` can be called out. */
      if (scopes !== null && scopes !== '' && !/\brepo\b/.test(scopes)) {
        no(`this token has no "repo" scope (it has: ${scopes || 'none'})`,
           'uploading a release needs it — make a new token and tick the top repo box');
      }
    } else {
      note(`could not check the token (GitHub said ${res.status}) — carrying on`);
    }
  } catch (e) {
    note('no network, so the token could not be checked');
  }
}

// 3. the updater, which is what makes an installed copy update itself
if (existsSync(join(root, 'node_modules', 'electron-updater'))) {
  ok('electron-updater is installed');
} else {
  no('electron-updater is missing', 'npm install');
}

// 4. is there anything to say about this release
if (existsSync(join(root, 'latest.json'))) {
  const l = JSON.parse(readFileSync(join(root, 'latest.json'), 'utf8'));
  if (l.version !== pkg.version) {
    no(`latest.json says ${l.version}, package.json says ${pkg.version}`,
       'npm run release patch "what changed"');
  } else if (!l.notes) {
    note('latest.json has no note on it — copies will see the version and nothing else');
  } else {
    ok(`release note: "${l.notes}"`);
  }
} else {
  no('no latest.json', 'npm run release patch "what changed"');
}

/* 4b. do the files on disk agree with the manifest that describes them?

   **A GitHub asset name is not the name you gave it.** Spaces become dots on
   upload, so `Focus Simulator Setup 1.0.8.exe` arrives as
   `Focus.Simulator.Setup.1.0.8.exe` — while `latest.yml` still asks for the
   name electron-builder wrote. Installed copies then fetch a URL that 404s and
   report nothing at all, because a missing update file and no update look
   identical from the outside.

   `build.artifactName` now forces a hyphenated name so this cannot arise from a
   normal build. This exists for the other route: the hand upload, done at the
   end of a long evening because a token expired. It compares what is on disk
   with what the manifest claims — name, size and hash — and says exactly which
   files to attach. */
if (existsSync(join(root, 'release', 'latest.yml'))) {
  const yml = readFileSync(join(root, 'release', 'latest.yml'), 'utf8');
  const want = (yml.match(/^path:\s*(.+)$/m) || [])[1]?.trim();
  const size = Number((yml.match(/size:\s*(\d+)/) || [])[1]);
  const ver = (yml.match(/^version:\s*(.+)$/m) || [])[1]?.trim();
  /* **A note, not a failure.** `publish:win` runs this check *first* and builds
     second, so a stale `latest.yml` from the previous version is the normal
     state here — blocking on it made the check refuse to let the build that
     would fix it run at all. It only matters for the hand-upload path, where
     the file on disk is the one being attached. */
  if (ver && ver !== pkg.version) {
    note(`release/latest.yml still describes ${ver} — the build regenerates it`);
  } else if (want) {
    if (/\s/.test(want)) {
      no(`latest.yml names "${want}", which has a space in it`,
         'GitHub turns spaces into dots on upload and the updater then 404s — '
         + 'check build.artifactName in package.json');
    }
    const onDisk = join(root, 'release', want);
    if (!existsSync(onDisk)) {
      no(`release/${want} is missing, but latest.yml points at it`,
         'npm run publish:win  — or rename the built installer to exactly that');
    } else if (size && statSync(onDisk).size !== size) {
      no(`release/${want} is ${statSync(onDisk).size} bytes, latest.yml says ${size}`,
         'the two are from different builds — rebuild so they match');
    } else {
      ok(`release/${want} matches latest.yml`);
      note('to attach by hand: that file, its .blockmap, latest.yml, and latest.json');
    }
  }
}

/* 4c. will the packaged app actually contain its updater?

   **The dependency has to be inside the app, not just in the repo.** Whether
   electron-builder copies it is decided by `build.files`: the default includes
   node_modules, but naming `files` explicitly replaces that default, and a list
   of three entries that does not mention node_modules leaves `electron-updater`
   out of the build entirely.

   The failure is completely silent from the outside. `require('electron-updater')`
   throws inside the packaged app, the updater switches itself off, and the page
   — hearing nothing — falls back to the GitHub link. The app looks like it has
   no auto-updater, and the reason is on a stdout nobody reads. That is exactly
   what 1.0.7 shipped with, and it took a console session on the user's own
   laptop to see it.

   Also check the two guards run in the right order, because the same silence
   comes back if `setup()` can ever return before it registers the reply. */
if (existsSync(join(root, 'electron', 'updater.cjs'))) {
  const files = (pkg.build && pkg.build.files) || [];
  const packsModules = !files.length
    || files.some((f) => typeof f === 'string' && /^node_modules/.test(f));
  if (!packsModules) {
    no('build.files does not include node_modules — electron-updater will not be in the app',
       'add "node_modules/**/*" to build.files in package.json');
  } else {
    ok('electron-updater will be packaged with the app');
  }
  const up = readFileSync(join(root, 'electron', 'updater.cjs'), 'utf8');
  const reply = up.indexOf("ipcMain.on('focus-update-ready'");
  const firstReturn = up.indexOf('return;', up.indexOf('function setup('));
  if (reply < 0) {
    no('electron/updater.cjs never answers focus-update-ready',
       'the page waits for a reply that never comes and shows the manual link');
  } else if (firstReturn >= 0 && firstReturn < reply) {
    no('updater.cjs can return before it answers the page',
       'a failure there makes the shell mute, which reads as having no updater at all');
  } else {
    ok('the shell answers the page even when updates are off');
  }
}

// 5. does the repository actually exist yet
if (target && target.owner && target.owner !== 'OWNER') {
  const url = `https://api.github.com/repos/${target.owner}/${target.repo}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'focus-publish-check' } });
    if (res.status === 404) {
      no(`github.com/${target.owner}/${target.repo} does not exist (or is private)`,
         'make it at https://github.com/new — same name, PUBLIC, add no files');
    } else if (res.ok) {
      const repo = await res.json();
      ok(`repository found, ${repo.private ? 'PRIVATE' : 'public'}`);
      if (repo.private) {
        no('a private repository cannot be read by the copies you hand out',
           'Settings → General → Danger Zone → Change visibility → Public');
      }
    } else {
      note(`GitHub answered ${res.status} — could not confirm the repository`);
    }
  } catch (e) {
    note('no network, so the repository could not be checked');
  }

  /* 6. is the *last* release actually complete?

     **A release can exist and still update nobody.** There are two update paths
     and they read different files: the page reads `latest.json`, and
     electron-updater reads `latest.yml` plus the installer beside it. A publish
     that gets far enough to create the release and then fails on the upload
     leaves exactly one of those in place — and the result is an app that
     correctly announces a new version and then can only offer you a link,
     because the link is the only route with a file behind it.

     That is not hypothetical: 1.0.8 sat like that, with `latest.json` alone on
     the release, while the installer sat unpublished on disk. It looked from
     the outside like the auto-updater was broken. It was not; it was reading a
     file that was never uploaded. */
  try {
    const rel = await fetch(
      `https://api.github.com/repos/${target.owner}/${target.repo}/releases/latest`,
      { headers: { 'User-Agent': 'focus-publish-check' } });
    if (rel.ok) {
      const r = await rel.json();
      const names = (r.assets || []).map((a) => a.name);
      const has = (re) => names.some((n) => re.test(n));
      const yml = has(/^latest\.yml$/i);
      const exe = has(/\.exe$/i);
      if (!names.length) {
        note(`the ${r.tag_name} release has no files on it at all`);
      } else if (!yml || !exe) {
        no(`the ${r.tag_name} release is incomplete — `
           + `${exe ? '' : 'no installer'}${!exe && !yml ? ' and ' : ''}${yml ? '' : 'no latest.yml'}`,
           'installed copies read latest.yml to update themselves. Attach it and the '
           + '.exe to that release, or re-run the publish');
      } else {
        ok(`the ${r.tag_name} release is complete (${names.length} files)`);
      }
    }
  } catch (e) { /* the note above already covered a dead network */ }

  /* 7. is the release GitHub calls "Latest" actually the newest one?

     **GitHub decides "Latest" by publish date, not by version number.** Editing
     or re-publishing an old release moves the label onto it, and both update
     paths read `releases/latest` — so everyone would be pointed at a version
     older than the one they already have. `allowDowngrade` and `updNewer()`
     stop anybody actually going backwards, but the visible result is an app
     that has stopped offering updates at all, for a reason nothing on screen
     explains.

     This is also what makes "always the newest" true rather than merely usual:
     there is no version ladder, every installer is complete, and a copy on
     1.0.5 jumps straight to the top — provided the top is what is labelled. */
  try {
    const all = await fetch(
      `https://api.github.com/repos/${target.owner}/${target.repo}/releases?per_page=100`,
      { headers: { 'User-Agent': 'focus-publish-check' } });
    if (all.ok) {
      const list = (await all.json()).filter((r) => !r.draft && !r.prerelease);
      const num = (v) => String(v || '').replace(/^v/, '').split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);
      const newer = (a, b) => {
        const x = num(a), y = num(b);
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
          if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
        }
        return false;
      };
      const top = list.reduce((best, r) => (!best || newer(r.tag_name, best.tag_name) ? r : best), null);
      const marked = list[0];   // the API returns them newest-published first
      if (top && marked && top.tag_name !== marked.tag_name) {
        no(`${marked.tag_name} is marked Latest, but ${top.tag_name} is the newer version`,
           `both update paths read releases/latest, so everyone is being pointed at `
           + `${marked.tag_name}. Edit ${top.tag_name} on GitHub and tick "Set as the latest release"`);
      } else if (top) {
        ok(`${top.tag_name} is both the newest version and the one marked Latest`);
      }
    }
  } catch (e) { /* covered above */ }
}

console.log(bad
  ? `\n${bad} thing(s) to fix first.\n`
  : '\nAll set:  npm run publish:win\n');

/* Set the code and let node leave when it is ready, rather than calling
   process.exit() here. The repository check above uses fetch(), whose keep-alive
   socket is still closing as this line runs, and exiting on top of it aborts
   libuv on Windows — "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
   file src\\win\\async.c". That took down the whole publish chain *after* every
   check had printed ok, which reads like the check failed when it had already
   passed. The socket closes itself in a few seconds; the unref'd timer is only
   a backstop for a connection that never does, and it cannot hold the process
   open on its own. */
process.exitCode = bad ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 10000).unref();
