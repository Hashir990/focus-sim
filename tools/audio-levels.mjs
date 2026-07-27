/* Renders each ambience offline with a real Web Audio implementation and reports
   peak / RMS, so we can see whether anything clips. */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { OfflineAudioContext } from 'node-web-audio-api';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
const SR = 44100, SECS = 6;

for (const id of ['rain','forest','cafe','office','campfire']) {
  const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost/', virtualConsole:new VirtualConsole() });
  const w = dom.window;
  const off = new OfflineAudioContext(1, SR*SECS, SR);
  w.AudioContext = function(){ return off; };
  await new Promise(r=>setTimeout(r,350));
  const btn = [...w.document.getElementById('amb-grid').children].find(b=>b.dataset.a===id);
  btn.click();
  await new Promise(r=>setTimeout(r,60));
  const buf = await off.startRendering();
  const d = buf.getChannelData(0);
  let peak=0, sum=0, clipped=0;
  for(let i=0;i<d.length;i++){ const a=Math.abs(d[i]); if(a>peak)peak=a; if(a>=0.999)clipped++; sum+=d[i]*d[i]; }
  const rms = Math.sqrt(sum/d.length);
  const db = v => (20*Math.log10(v||1e-9)).toFixed(1);
  console.log(`${id.padEnd(9)} peak ${peak.toFixed(3)} (${db(peak)} dB)  rms ${rms.toFixed(4)} (${db(rms)} dB)  clipped ${clipped}`);
  dom.window.close();
}
process.exit(0);
