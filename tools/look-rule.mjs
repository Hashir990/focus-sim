/**
 * The rule editor, in a real browser, on a desktop.
 *
 *     node tools/look-rule.mjs        # serves it on 4455
 *
 * The blocking page is gated behind the Android plugin and draws one line
 * saying so on anything else, which is why its layout has only ever been
 * looked at on a phone -- a deploy and a hand each time, for a CSS change.
 * The smoke test already gets past the gate with a stand-in plugin and a
 * door into the IIFE; this serves that same page to a browser instead of
 * to jsdom, so the sticky save row can be measured where layout exists.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const html = readFileSync('dist/index.html', 'utf8');
const termsV = (html.match(/const TERMS_VERSION = '([^']+)'/) || [])[1] || '';

const shim = `<script>
  (function(){
    var mem = {focus_terms: JSON.stringify({v:${JSON.stringify(termsV)}, at:1}), focus_setup:'1',
      focus_guard: JSON.stringify({on:true, rules:[{id:'r1', name:'Social', apps:['x.insta','x.tok'],
        sites:['reddit.com'], when:'always', pause:12, open:[5], opens:3, odds:1, hard:false,
        prompt:'Take a breath.', after:'block', days:'0123456'}]})};
    try { Object.defineProperty(window, 'localStorage', {configurable:true, value:{
      getItem:function(k){ return mem[k] === undefined ? null : mem[k]; },
      setItem:function(k,v){ mem[k] = String(v); }, removeItem:function(k){ delete mem[k]; },
      clear:function(){ mem = {}; }, key:function(i){ return Object.keys(mem)[i] || null; },
      get length(){ return Object.keys(mem).length; }}}); } catch(e){}
  })();
  window.__gcalls = [];
  window.Capacitor = {Plugins: {FocusGuard: (function(){
    var stored = null;
    var copy = function(o){ return JSON.parse(JSON.stringify(o)); };
    return {
      status: function(){ return Promise.resolve({notifications:true, overlay:true, accessibility:true, admin:false, gray:false}); },
      listApps: function(){ return Promise.resolve({apps:[{id:'x.insta', name:'Instagram', icon:''},
        {id:'x.tok', name:'TikTok', icon:''}]}); },
      setConfig: function(c){ stored = copy(c); window.__gcalls.push(['setConfig', copy(c)]); return Promise.resolve(copy(stored)); },
      getStats: function(){ return Promise.resolve({usage:{}, day:''}); },
      setTimer: function(){ return Promise.resolve(); }, showNotice: function(){ return Promise.resolve(); },
      hideNotice: function(){ return Promise.resolve(); },
      takeCommand: function(){ return Promise.resolve({cmd:''}); },
      requestNotifications: function(){ return Promise.resolve({granted:true}); },
      openSettings: function(){ return Promise.resolve(); }, requestAdmin: function(){ return Promise.resolve(); },
      releaseAdmin: function(){ return Promise.resolve(); }, setTasks: function(){ return Promise.resolve(); },
      addListener: function(){ return {remove:function(){}}; },
    };
  })()}};
</script>`;

const at = html.lastIndexOf('})();');
const door = '\nwindow.__g = {Guard, guardOpen, guardOpenRule, guardPaintRule};\n';
const page = (html.slice(0, at) + door + html.slice(at)).replace('<script>', shim + '\n<script>');

createServer((q, r) => {
  r.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
  r.end(page);
}).listen(4455, '127.0.0.1', () => console.log('http://127.0.0.1:4455'));
