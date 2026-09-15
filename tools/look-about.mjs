/** The Privacy and Credits screens.  node tools/look-about.mjs [out.png] */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const P='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const opts=()=>(existsSync(P)?{executablePath:P,args:['--no-sandbox']}:{args:['--no-sandbox']});
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const out=process.argv[2]?join(root,process.argv[2]):join(root,'look','about.png');
mkdirSync(dirname(out),{recursive:true});
const src=readFileSync(join(root,'dist','index.html'),'utf8').replace(/const ACC_URL = '[^']*'/,"const ACC_URL = ''");
const at=src.lastIndexOf('})();');
const tmp=join(root,'look','_about.html');
writeFileSync(tmp, src.slice(0,at)+`
  window.__about = (w) => aboutOpen(w);
`+src.slice(at));
const b=await chromium.launch(opts());
const pg=await b.newPage({viewport:{width:420,height:1500},deviceScaleFactor:2});
await pg.goto('file://'+tmp); await pg.waitForTimeout(800);
const shots=[];
for(const [w,label] of [['privacy','Privacy'],['credits','Credits'],['report','Report a problem']]){
  await pg.evaluate((x)=>window.__about(x), w);
  await pg.waitForTimeout(250);
  if(w === 'report'){ await pg.evaluate(()=>{ const b=document.querySelector('.rep-kind[data-kind="game"]'); if(b) b.click(); const t=document.getElementById('rep-text'); if(t) t.value='The 5x5 crossword stopped taking letters after I typed one.'; }); await pg.waitForTimeout(150); }
  const el = await pg.$('#about-overlay');
  shots.push({label, png:(await el.screenshot()).toString('base64')});
}
const sheet=`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px;align-items:flex-start">
  ${shots.map(s=>`<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:420px;border-radius:10px">
    <figcaption style="margin-top:6px;opacity:.85">${s.label}</figcaption></figure>`).join('')}</body>`;
const sf=join(root,'look','_about-sheet.html');
writeFileSync(sf,sheet);
await pg.setViewportSize({width:1360,height:1700});
await pg.goto('file://'+sf); await pg.waitForTimeout(250);
await pg.screenshot({path:out,fullPage:true});
await b.close(); console.log('wrote '+out);
