/**
 * The desktop caption strip, with and without it.
 *
 *   node tools/look-winbar.mjs [out.png]
 *
 * Electron sets `titlebar-area-*`; nothing else does. A browser cannot fake an
 * environment variable, so the "with" side overrides `--winbar` directly — which
 * is the same value every layer reads, and therefore the same test.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const P='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const opts=()=>(existsSync(P)?{executablePath:P,args:['--no-sandbox']}:{args:['--no-sandbox']});
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const out=process.argv[2]?join(root,process.argv[2]):join(root,'look','winbar.png');
mkdirSync(dirname(out),{recursive:true});
const src=readFileSync(join(root,'dist','index.html'),'utf8').replace(/const ACC_URL = '[^']*'/,"const ACC_URL = ''");
const at=src.lastIndexOf('})();');
const tmp=join(root,'look','_winbar.html');
writeFileSync(tmp, src.slice(0,at)+`
  window.__bar = (px) => document.documentElement.style.setProperty('--winbar', px + 'px');
  window.__ov = () => { Arcade.show(); };
`+src.slice(at));
const b=await chromium.launch(opts());
const pg=await b.newPage({viewport:{width:420,height:820},deviceScaleFactor:2});
await pg.goto('file://'+tmp); await pg.waitForTimeout(900);
const shots=[];
const shoot=async(label)=>shots.push({label,png:(await pg.screenshot()).toString('base64')});
await shoot('phone / browser — no strip');
await pg.evaluate(()=>window.__bar(32)); await pg.waitForTimeout(250);
await shoot('desktop — 32px strip');
await pg.evaluate(()=>window.__ov()); await pg.waitForTimeout(350);
await shoot('and an overlay over it');
const sheet=`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px">
  ${shots.map(s=>`<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:400px;border:1px solid #333">
    <figcaption style="margin-top:6px;opacity:.85">${s.label}</figcaption></figure>`).join('')}</body>`;
const sf=join(root,'look','_winbar-sheet.html');
writeFileSync(sf,sheet);
await pg.setViewportSize({width:1320,height:900});
await pg.goto('file://'+sf); await pg.waitForTimeout(300);
await pg.screenshot({path:out,fullPage:true});
await b.close();
console.log('wrote '+out);
