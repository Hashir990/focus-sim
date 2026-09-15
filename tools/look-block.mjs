/**
 * The app blocking page and its picker, with a stand-in for the plugin.
 *
 * Neither screen can be seen on a machine that is not an Android phone — the
 * menu row hides itself, the page says so, and the app list comes from
 * PackageManager. So this installs a believable fake and photographs the four
 * states worth checking: switched off, switched on with permissions missing,
 * fully working with a day behind it, and the picker.
 *
 * **The picker over the page is the shot that matters.** Two of the app's
 * overlays stacked is two 96% washes, and the settings underneath came through
 * the app list plainly enough to read (HANDOFF §6). It is fixed; this is how
 * you would see it come back.
 *
 *   node tools/look-block.mjs [out.png]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SANDBOX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const opts = () => {
  const p = process.env.CHROME_PATH || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : '');
  return p ? { executablePath: p, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'block.png');
mkdirSync(dirname(out), { recursive: true });

/* Splice at the LAST close — see HANDOFF §6. */
const src = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");
const at = src.lastIndexOf('})();');
const html = src.slice(0, at) + `
  window.__fake = (o) => {
    o = o || {};
    const ico = (bg, ch) => 'data:image/svg+xml;base64,' + btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">'
      + '<rect width="96" height="96" rx="22" fill="' + bg + '"/>'
      + '<text x="48" y="66" font-size="52" font-family="sans-serif" font-weight="700"'
      + ' text-anchor="middle" fill="#fff">' + ch + '</text></svg>');
    const names = [
      ['com.instagram.android', 'Instagram', '#c13584'],
      ['com.zhiliaoapp.musically', 'TikTok', '#111111'],
      ['com.google.android.youtube', 'YouTube', '#ff0033'],
      ['com.whatsapp', 'WhatsApp', '#25d366'],
      ['com.reddit.frontpage', 'Reddit', '#ff4500'],
      ['com.twitter.android', 'X', '#222222'],
      ['com.spotify.music', 'Spotify', '#1db954'],
      ['com.android.chrome', 'Chrome', '#4285f4'],
      ['com.google.android.gm', 'Gmail', '#ea4335'],
      ['com.netflix.mediaclient', 'Netflix', '#e50914'],
    ];
    window.Capacitor = { Plugins: { FocusGuard: {
      setTimer: () => Promise.resolve(), setConfig: () => Promise.resolve(),
      showNotice: () => Promise.resolve(), hideNotice: () => Promise.resolve(),
      takeCommand: () => Promise.resolve({ cmd: '', at: 0 }), addListener: () => {},
      requestNotifications: () => Promise.resolve({ granted: true }),
      openSettings: () => Promise.resolve(),
      status: () => Promise.resolve(o.status
        || { notifications: false, overlay: false, accessibility: false }),
      getStats: () => Promise.resolve(o.stats || {}),
      listApps: () => Promise.resolve({ apps: names.map(
        (n) => ({ id: n[0], name: n[1], system: false, icon: ico(n[2], n[1][0]) })) }),
    } } };
    Guard.on = true;
    Guard.status = o.status || { notifications: false, overlay: false, accessibility: false };
    Guard.stats = o.stats || {};
    Guard.cfg = Object.assign({}, GUARD_DEFAULTS, o.cfg || {});
    guardMenuRow();
    guardOpen();
    return 'ok';
  };
  window.__pick = () => { guardOpenPicker(); return 'ok'; };
` + src.slice(at);
const tmp = join(root, 'look', '_block.html');
writeFileSync(tmp, html);

const ALL = { notifications: true, overlay: true, accessibility: true };
const SOME = { notifications: true, overlay: false, accessibility: false };
const shots = [];
const browser = await chromium.launch(opts());
const page = await browser.newPage({ viewport: { width: 400, height: 1180 }, deviceScaleFactor: 2 });

const shoot = async (label, arg, pick) => {
  await page.goto('file://' + tmp);
  await page.waitForTimeout(600);
  await page.evaluate((a) => window.__fake(a), arg);
  await page.waitForTimeout(350);
  if (pick) { await page.evaluate(() => window.__pick()); await page.waitForTimeout(350); }
  const el = await page.$(pick ? '#block-apps-overlay' : '#block-overlay');
  shots.push({ label, png: (await el.screenshot()).toString('base64') });
};

await shoot('off, and honest about it', { cfg: { on: false }, status: SOME });
await shoot('on, and not blocking anything yet', {
  cfg: { on: true, apps: ['com.instagram.android', 'com.zhiliaoapp.musically'] }, status: SOME,
});
await shoot('working, with a day behind it', {
  cfg: { on: true, apps: ['com.instagram.android', 'com.reddit.frontpage'], pause: 12 },
  status: ALL,
  stats: {
    'com.instagram.android': { shown: 7, closed: 5, through: 2 },
    'com.reddit.frontpage': { shown: 3, closed: 3 },
  },
});
await shoot('the picker, over the page', {
  cfg: { on: true, apps: ['com.instagram.android', 'com.zhiliaoapp.musically'] }, status: ALL,
}, true);

const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px;align-items:flex-start">
  ${shots.map((s) => `<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:380px;border-radius:12px">
    <figcaption style="margin-top:6px;opacity:.8">${s.label}</figcaption></figure>`).join('')}
</body>`;
const sf = join(root, 'look', '_block-sheet.html');
writeFileSync(sf, sheet);
await page.setViewportSize({ width: 1640, height: 1300 });
await page.goto('file://' + sf);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
