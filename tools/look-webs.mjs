/**
 * The spiders light, with its corner webs, on a desktop.
 *
 *     node tools/look-webs.mjs      # serves it on 4456
 *
 * The webs are fixed to the window's corners and only drawn under one
 * light, so looking at them means owning that light and turning it on.
 * This serves the build with a door into the closure, so a browser can
 * set the light directly and the drawing can be measured against the
 * window edges rather than described.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';

const html = readFileSync('dist/index.html', 'utf8');
const termsV = (html.match(/const TERMS_VERSION = '([^']+)'/) || [])[1] || '';

const shim = `<script>
  (function(){
    var mem = {focus_terms: JSON.stringify({v:${JSON.stringify(termsV)}, at:1}), focus_setup:'1'};
    try { Object.defineProperty(window, 'localStorage', {configurable:true, value:{
      getItem:function(k){ return mem[k] === undefined ? null : mem[k]; },
      setItem:function(k,v){ mem[k] = String(v); }, removeItem:function(k){ delete mem[k]; },
      clear:function(){ mem = {}; }, key:function(i){ return Object.keys(mem)[i] || null; },
      get length(){ return Object.keys(mem).length; }}}); } catch(e){}
  })();
</script>`;

const at = html.lastIndexOf('})();');
const door = '\nwindow.__look = {Embers, vfxSet, vfxApply};\n';
const page = (html.slice(0, at) + door + html.slice(at)).replace('<script>', shim + '\n<script>');

const TYPES = { '.ogg':'audio/ogg', '.opus':'audio/ogg', '.mp3':'audio/mpeg',
  '.webm':'audio/webm', '.woff2':'font/woff2', '.png':'image/png', '.svg':'image/svg+xml' };

createServer((q, r) => {
  /* Anything but the page itself comes off disk, so the audio the app asks
     for is the audio that would ship. */
  const path = (q.url || '/').split('?')[0];
  if (path !== '/') {
    const file = join('dist', path.replace(/^\/+/, ''));
    if (existsSync(file) && statSync(file).isFile()) {
      const ext = file.slice(file.lastIndexOf('.'));
      r.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      r.end(readFileSync(file));
      return;
    }
    r.writeHead(404); r.end('no ' + path); return;
  }
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(page);
}).listen(4456, '127.0.0.1', () => console.log('http://127.0.0.1:4456'));
