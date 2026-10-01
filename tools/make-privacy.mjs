/**
 * The public privacy policy page, built from the one in the app.
 *
 *   node tools/make-privacy.mjs          (build.mjs runs it for you)
 *
 * **Why this is generated and not written.**
 *
 * Google Play and the App Store both want the policy at a public URL, and the
 * obvious thing to do is paste the text into a web page once. That page is
 * wrong within a month: the app changes, the in-app policy changes with it
 * because it sits next to the code, and the copy on the web does not — so the
 * document a reviewer reads and the document the app shows stop agreeing. A
 * policy that contradicts itself is worse than either half alone.
 *
 * So there is one source: `aboutPrivacy()` in src/js/50-about.js. This lifts
 * that function out of the built bundle, runs it, and wraps what it returns in
 * a standalone page. Nothing is retyped, and the two cannot drift, because the
 * web page does not exist until the app has been built.
 *
 * It takes the *English* text deliberately. The app carries translations (see
 * 61-docs-*.js) and a store listing needs one canonical document; the in-app
 * copy still appears in the reader's language.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The body of a top-level `function name(){ … }`, by walking its braces.
    A regex cannot do this: the policy has braces inside strings. */
function bodyOf(src, name) {
  const at = src.indexOf('function ' + name + '(){');
  if (at < 0) throw new Error('no ' + name + '() in the bundle');
  const open = src.indexOf('{', at + ('function ' + name).length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (!depth) return src.slice(open + 1, i);
    }
    /* Skip over strings, so a brace inside one cannot close the function.
       Every string in this file is single-quoted; the escape check is there
       because an apostrophe in the prose is written \'. */
    else if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
    }
  }
  throw new Error(name + '() never closes');
}

function constOf(src, name, fallback) {
  const m = src.match(new RegExp('const ' + name + " = '([^']*)'"));
  return m ? m[1] : fallback;
}

export function makePrivacy() {
  const dist = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  const updated = constOf(dist, 'ABOUT_UPDATED', '');
  const owner = constOf(dist, 'ABOUT_OWNER', '');
  const email = constOf(dist, 'ABOUT_EMAIL', '');

  /* The function is pure — it reads those three names and returns a string —
     so it runs here with them passed in, and `esc`/`aboutWho` stubbed to what
     they do in the app. If it ever stops being pure this throws, loudly, at
     build time, which is the right place to find out. */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const aboutWho = (v, f) => (v && v.indexOf('__') !== 0)
    ? esc(v) : '<u class="about-todo">' + f + '</u>';

  const run = new Function('ABOUT_UPDATED', 'ABOUT_OWNER', 'ABOUT_EMAIL',
    'esc', 'aboutWho', bodyOf(dist, 'aboutPrivacy'));
  const policy = run(updated, owner, email, esc, aboutWho);

  const who = (owner && owner.indexOf('__') !== 0) ? owner : 'the developer';
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy &middot; Focus Simulator</title>
<meta name="description" content="What Focus Simulator stores, what leaves your device, and what is never collected.">
<meta name="robots" content="index,follow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0b1220; --bg2:#101a2e; --card:#16203a;
    --text:#e8eefc; --muted:#8fa0c0; --line:#243356; --accent:#4fe0c8;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    background:radial-gradient(120% 80% at 50% -10%, var(--bg2) 0%, var(--bg) 62%) fixed;
    color:var(--text);
    font:16px/1.65 'Space Grotesk',system-ui,-apple-system,sans-serif;
    padding:0 20px 72px;
  }
  .wrap{max-width:660px;margin:0 auto}
  header{padding:48px 0 8px;border-bottom:1px solid var(--line);margin-bottom:28px}
  .mark{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .mark i{width:11px;height:11px;border-radius:3px;background:var(--accent);
    box-shadow:0 0 10px rgba(79,224,200,.5);transform:rotate(45deg);flex:0 0 auto}
  .mark b{font-size:13px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;color:var(--muted)}
  h1{font-size:30px;line-height:1.2;margin:0 0 10px;font-weight:700}
  header p{margin:0;color:var(--muted);font-size:14px}
  h4{margin:30px 0 8px;font-size:13px;letter-spacing:.09em;text-transform:uppercase;
    color:var(--accent);font-weight:600}
  p{margin:0 0 12px;font-size:15px;line-height:1.7}
  b{font-weight:600}
  a{color:var(--accent)}
  .about-lede{font-size:17px;line-height:1.6;margin-bottom:6px}
  .about-date{margin-top:22px;font-size:13px;color:var(--muted)}
  .about-todo{text-decoration:none;padding:1px 6px;border-radius:5px;
    background:rgba(240,90,90,.16);color:#ff9d9d;font-style:normal}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:13.5px}
  @media (prefers-color-scheme: light){
    :root{--bg:#f6f8fc;--bg2:#fff;--text:#16203a;--muted:#5a6a88;--line:#dde3ef;--accent:#0d9488}
    .mark i{box-shadow:0 0 10px rgba(13,148,136,.35)}
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="mark"><i></i><b>Focus Simulator</b></div>
    <h1>Privacy</h1>
    <p>What the app keeps, what leaves your device, and what is never collected.</p>
  </header>
  <main>
${policy.split('</p>').join('</p>\n')}
  </main>
  <footer>
    <p>Focus Simulator is made and run by ${esc(who)} &mdash;
    questions, corrections, or a request to delete an account:
    <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>
    <p>This page is generated from the policy inside the app, so the two always
    say the same thing. ${updated ? 'Last updated ' + esc(updated) + '.' : ''}</p>
  </footer>
</div>
</body>
</html>
`;

  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'privacy.html'), page, 'utf8');
  return page.length;
}

/* Run directly, as well as from build.mjs. */
if (process.argv[1] && process.argv[1].endsWith('make-privacy.mjs')) {
  const n = makePrivacy();
  console.log(`wrote docs/privacy.html — ${(n / 1024).toFixed(1)} KB`);
}
