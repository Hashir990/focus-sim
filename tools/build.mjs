/**
 * Stitches src/ back into a single self-contained dist/index.html.
 *
 * Order is filename order, which is why every file has a numeric prefix.
 * To add a new arcade game: drop src/js/22-chess.js, src/css/14-chess.css and
 * src/body/12-chess.html in place and rebuild. No config to edit.
 *
 *   node tools/build.mjs           build once
 *   node tools/build.mjs --watch   rebuild on save
 *   node tools/build.mjs --serve   rebuild on save + http://localhost:4321
 *   node tools/build.mjs --verify  build, then diff against the original
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, watch, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');
const DIST = join(root, 'dist');

const args = new Set(process.argv.slice(2));
const WATCH = args.has('--watch') || args.has('--serve');
const SERVE = args.has('--serve');
const VERIFY = args.has('--verify');

function readDirJoined(sub, ext) {
  const dir = join(SRC, sub);
  if (!existsSync(dir)) return '';
  const files = readdirSync(dir)
    .filter((f) => extname(f) === ext)
    .sort();
  if (!files.length) return '';
  return files.map((f) => readFileSync(join(dir, f), 'utf8')).join('');
}

export function build() {
  const head = readFileSync(join(SRC, 'head.html'), 'utf8');
  const css = readDirJoined('css', '.css');
  const body = readDirJoined('body', '.html');
  const js = readDirJoined('js', '.js');

  const html =
    head +
    '<style>\n' +
    css +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    body +
    '\n<script>\n' +
    js +
    '</script>\n' +
    '</body>\n' +
    '</html>\n';

  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, 'index.html'), html, 'utf8');
  return html;
}

function verify() {
  const ref = join(root, 'tools', 'original.reference.html');
  if (!existsSync(ref)) {
    console.log('! no reference file — skipping byte comparison');
    return true;
  }
  const built = readFileSync(join(DIST, 'index.html'), 'utf8');
  const original = readFileSync(ref, 'utf8');
  if (built === original) {
    console.log('✓ dist/index.html is byte-identical to the original');
    return true;
  }
  const a = original.split('\n');
  const b = built.split('\n');
  console.log(`✗ differs — original ${a.length} lines / built ${b.length} lines`);
  let shown = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 10; i++) {
    if (a[i] !== b[i]) {
      console.log(`  line ${i + 1}:\n    original: ${JSON.stringify((a[i] ?? '').slice(0, 90))}\n    built:    ${JSON.stringify((b[i] ?? '').slice(0, 90))}`);
      shown++;
    }
  }
  return false;
}

const run = () => {
  const t = Date.now();
  const html = build();
  console.log(`built dist/index.html — ${(html.length / 1024).toFixed(1)} KB in ${Date.now() - t}ms`);
};

run();

if (VERIFY) process.exit(verify() ? 0 : 1);

if (WATCH) {
  let timer = null;
  watch(SRC, { recursive: true }, (_e, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        run();
        console.log(`  (${file} changed)`);
      } catch (err) {
        console.error('build failed:', err.message);
      }
    }, 60);
  });
  console.log('watching src/ …');
}

if (SERVE) {
  const PORT = 4321;
  createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/index.html') {
      res.writeHead(404).end('not found');
      return;
    }
    const body = readFileSync(join(DIST, 'index.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(body);
  }).listen(PORT, () => console.log(`serving http://localhost:${PORT}`));
}
