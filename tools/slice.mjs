/* Run the first N lines of the smoke test, then report and leave.

   The whole file takes longer than one shell call is allowed, so it has to be
   run in pieces. Rather than keep stale hand-cut copies around — the ones in
   ~/run/tools are from the 8th and do not have any of this week's checks — this
   truncates the *current* file at a line number and staples the verdict on.

     node tools/slice.mjs 700 [outDir]

   `outDir` matters in the sandbox. Running the slice from inside the repo makes
   `import jsdom` alone take ~40s, because resolving it reads hundreds of files
   back across the Windows mount — the slice then dies having printed nothing,
   which looks exactly like a hang. Write it somewhere with a local
   `node_modules` and run it from there:

     node tools/slice.mjs 900 ~/run
     cd ~/run && node slice-run.mjs /path/to/dist/index.html

   Only the front half is usable this way: the later sections build on windows
   opened earlier. For a middle slice, run to its end and read the tail. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const upto = Number(process.argv[2] || 700);
const outDir = process.argv[3] || join(root, 'tools');
const src = readFileSync(root + '/tools/smoke-test.mjs', 'utf8').split('\n');

/* **Cut where a top-level block just closed, not merely on a blank line.**

   The test is written as a series of `{ ... }` scopes, and a blank line inside
   one is still inside it — truncating there gives `Unexpected end of input`.
   The sections all close with a `}` hard against the left margin, so that is
   the seam: walk back to the nearest one at or before the mark. */
let cut = Math.min(upto, src.length);
while (cut > 1 && src[cut - 1] !== '}') cut--;

const verdict = `
const failed = checks.filter((c) => !c.ok);
log('');
failed.forEach((c) => log('  FAIL: ' + c.label + (c.detail ? '  [' + c.detail + ']' : '')));
log(\`\\n\${checks.length - failed.length}/\${checks.length} checks passed (lines 1-${cut})\`);
const allErrors = errors.concat(typeof errors2 === 'undefined' ? [] : errors2);
if (allErrors.length) { log('runtime errors:'); allErrors.slice(0, 6).forEach((e) => log('  ' + e.split('\\n')[0])); }
for (const w of BOOTED) { try { w.close(); } catch (e) { /* gone */ } }
setImmediate(() => process.exit(failed.length || allErrors.length ? 1 : 0));
`;

writeFileSync(join(outDir, 'slice-run.mjs'),
  src.slice(0, cut).join('\n') + verdict);
console.log('cut at line', cut, '→', join(outDir, 'slice-run.mjs'));
