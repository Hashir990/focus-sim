/* One page per language, with the real markup under the real CSS.
 *
 * jsdom has no layout, so the only way to see whether Arabic reads right to
 * left, whether a Russian button overflows or whether Devanagari needs more
 * line height is to render the actual screens and look at them.
 *
 *   node tools/look-lang.mjs            → look/lang-<code>.html for each
 *   node tools/look-lang.mjs ar         → just that one
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = 'D:/Focus';
const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
const css = readdirSync(join(root, 'src/css')).sort()
  .map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n');
const LANGS = process.argv[2] ? [process.argv[2]] : ['en', 'ja', 'zh', 'ru', 'hi', 'ur', 'ar'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const lang of LANGS) {
  const seed = `localStorage.setItem('focus_lang','${lang}');`
    + `localStorage.setItem('focus_terms','${JSON.stringify({ v: 'seen', at: 1 }).replace(/"/g, '\\"')}');`;
  const door = 'window.__look = {Arcade, Picross};';
  const at = html.lastIndexOf('})();');
  const page = (html.slice(0, at) + door + html.slice(at))
    .replace('<script>', `<script>${seed}</script>\n<script>`);
  const dom = new JSDOM(page, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://localhost/', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  await wait(900);
  const $ = (id) => w.document.getElementById(id);

  const shots = [];
  const grab = (el, title) => { if (el) shots.push('<h2>' + title + '</h2><div class="shot">' + el.outerHTML + '</div>'); };

  grab($('setup'), lang + ' · setup');
  $('menu-btn').click(); await wait(60);
  grab($('drawer'), lang + ' · menu');
  $('drawer-close').click(); await wait(40);
  $('arcade-open').click(); await wait(120);
  grab($('picker'), lang + ' · the shelf');
  try { await w.__look.Arcade.pick('picross'); } catch (e) {}
  await wait(200);
  grab($('game-picross'), lang + ' · picross');
  try { w.__look.Arcade._picker(); } catch (e) {}
  $('ov-back') && $('ov-back').click(); await wait(60);
  $('menu-btn').click(); await wait(40);
  $('d-stats') && $('d-stats').click(); await wait(140);
  grab($('stats-overlay'), lang + ' · your focus');

  const dir = /^(ur|ar)$/.test(lang) ? 'rtl' : 'ltr';
  const out = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
    + '<html lang="' + lang + '" dir="' + dir + '"><style>' + css
    + '\nbody{background:var(--bg);color:var(--text);margin:0;padding:12px;font-family:"Space Grotesk",sans-serif}'
    + 'h2{font-size:12px;color:var(--muted);margin:18px 0 6px;font-weight:500}'
    + '.shot{width:390px;max-width:100%;border:1px solid var(--line);border-radius:14px;overflow:hidden;'
    + 'background:var(--bg2);position:relative}'
    + '.shot .view,.shot .drawer,.shot .overlay{position:static!important;display:block!important;'
    + 'inset:auto!important;height:auto!important;transform:none!important;animation:none!important}'
    + '.shot .hide{display:none!important}.wrap{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}'
    + '</style><body data-phase="rest"><div id="app" data-phase="rest"><div class="wrap">'
    + shots.join('') + '</div></div></body>';
  writeFileSync(join(root, 'look', 'lang-' + lang + '.html'), out);
  console.log('look/lang-' + lang + '.html', Math.round(out.length / 1024) + 'KB');
  w.close();
}
process.exit(0);
