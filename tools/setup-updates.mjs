/**
 * Point this project at a GitHub repository, so copies of the app can update.
 *
 *   node tools/setup-updates.mjs your-github-name focus-simulator
 *
 * There are three places the repository has to be named and it is easy to get
 * one of them wrong, so they are all written from one command:
 *
 *   package.json → build.publish   where electron-builder uploads installers,
 *                                  and where the installed app looks for them
 *   .env.release                   FOCUS_UPDATE_URL for the plain HTML build,
 *                                  read by tools/build.mjs
 *   git remote origin              added if the project has none yet
 *
 * Run it once. Everything after that is `npm run release` and a push.
 *
 * Nothing here contacts GitHub or needs a token — it only writes local files.
 * Creating the repository itself is a thing you do on the website; publishing
 * needs a token in `GH_TOKEN`, which electron-builder reads when it uploads.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [owner, repo] = process.argv.slice(2);

if (!owner || !repo) {
  console.error('Usage: node tools/setup-updates.mjs <github-user> <repo-name>');
  console.error('   eg: node tools/setup-updates.mjs hashir focus-simulator');
  process.exit(1);
}
if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
  console.error('That does not look like a GitHub user and repository name.');
  process.exit(1);
}
/* Placeholders taken literally. This is not a hypothetical: the first person to
   run this pasted the line out of the instructions unchanged, and ended up with
   a project configured to a repository that does not exist and cannot exist.
   Better to refuse than to write it. */
const PLACEHOLDER = /^(your|the|owner|repo|username|user|name|my)[-_]?/i;
if (PLACEHOLDER.test(owner) || /^(the|repo|your)/i.test(repo)
    || owner === 'OWNER' || repo === 'REPO') {
  console.error(`
Those look like the placeholders rather than your details.

  owner = ${owner}
  repo  = ${repo}

Use your actual GitHub username and the actual name of the repository, eg:

  npm run setup:updates hashir focus-simulator

Your username is what appears in github.com/<this bit>. If you have not made
the repository yet, do that first at https://github.com/new — any name will do,
and it should be public.
`);
  process.exit(1);
}

// 1. the installer's publish target
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.build = pkg.build || {};
pkg.build.publish = [{ provider: 'github', owner, repo }];
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json  → publish to github.com/${owner}/${repo}`);

/* 2. where the browser/phone copies look.
   A release asset rather than a file in the repository: `releases/latest/
   download/...` always serves the newest release's copy, so publishing is one
   command and git never enters into it. See tools/publish-extra.mjs. */
const raw = `https://github.com/${owner}/${repo}/releases/latest/download/latest.json`;
writeFileSync(join(root, '.env.release'),
  `# Read by tools/build.mjs. Baked into every build made from here on, so the\n`
  + `# copies you hand out know where to check. See INSTALL.md.\n`
  + `FOCUS_UPDATE_URL=${raw}\n`
  + `FOCUS_RELEASE_URL=https://github.com/${owner}/${repo}/releases/latest\n`);
console.log(`.env.release  → ${raw}`);

/* 3. the git remote — a convenience for anyone who does use git, and entirely
   optional. Nothing in the release flow shells out to git any more. */
let remote = '';
try {
  remote = execSync('git remote get-url origin', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
} catch (e) { /* no git, or no remote — neither matters here */ }
if (!remote) {
  try {
    execSync(`git remote add origin https://github.com/${owner}/${repo}.git`,
      { cwd: root, stdio: 'ignore' });
    console.log(`git remote    → https://github.com/${owner}/${repo}.git`);
  } catch (e) {
    console.log('git remote    · skipped (git is not installed, which is fine)');
  }
} else {
  console.log(`git remote    · already ${remote} (left alone)`);
}

console.log(`
Two things left, once:

  1. Make the repository at https://github.com/new
       name it "${repo}", leave it PUBLIC, add no files.
     Public matters: the copies you hand out fetch from it without a login.

  2. Make a token at https://github.com/settings/tokens
       "Generate new token (classic)", tick "repo", copy it, then:

       setx GH_TOKEN "paste_it_here"

     and open a new terminal so it takes.

Then, whenever you have something worth handing over — one command each:

  npm run release patch "what changed"
  npm run publish:win

No git needed for either. The first stamps the version; the second builds the
installer, uploads it, and attaches the file that plain HTML copies read.
`);
