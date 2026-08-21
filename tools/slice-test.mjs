/**
 * Sandbox helper. The full smoke test no longer finishes inside the agent
 * sandbox's 45-second cap on a shell call, and a killed call takes the process
 * with it — so it has to be run in pieces there.
 *
 * This writes each independent block of tools/smoke-test.mjs out as a runnable
 * file: the shared prelude (through `boot()`), one block, and the verdict.
 *
 *   node tools/slice-test.mjs <outdir>
 *
 * Not part of `npm test`. On a real machine just run the whole thing.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, '.slices');
mkdirSync(out, { recursive: true });

const L = readFileSync(join(root, 'tools', 'smoke-test.mjs'), 'utf8').split('\n');
const at = (pred) => L.findIndex(pred);

const pass1 = at((l) => l.startsWith('// ==='));                       // end of the prelude
const sync = at((l) => l.startsWith('const { window: host, errors: hostErr }'));
const games = at((l) => l.startsWith('// --- shared games'));
const hangman = at((l) => l.startsWith('// hangman ---'));
const chess = at((l) => l.startsWith('// chess ---'));
const hand = at((l) => l.startsWith('// --- handing the timer over'));
const verdict = at((l) => l.startsWith('// --- verdict'));

const head = L.slice(0, pass1).join('\n');
const tail = (errs) => L.slice(verdict).join('\n')
  .replace('errors.concat(errors2, hostErr, guestErr, thirdErr)', errs);
const write = (name, body, errs) => {
  writeFileSync(join(out, name), head + '\n' + body + '\n' + tail(errs));
};

// the two-window setup, needed by every block that talks to a second device
const setupEnd = at((l) => l.startsWith('const syncOnG =')) + 1;
const setup = L.slice(sync, setupEnd).join('\n');

/* The solo pass outgrew the 45-second call on its own, so it is cut in two at
   the ambience block. `solo.mjs` is still written whole for a machine with no
   time limit; in the sandbox run the halves.

   The cut is where it is because everything after it works off seeded storage
   and the log the first half wrote to it, rather than off the screen the first
   half left behind — so the second half can boot cold and still find the world
   it expects. Move this line and check that is still true. */
const solo2 = at((l) => l.startsWith('// --- ambience'));
write('solo.mjs', L.slice(pass1, sync).join('\n'), 'errors.concat(errors2)');
// the second window (`errors2`) is booted in the overlays block, which is in
// the second half — so the first half has only its own errors to report
write('solo1.mjs', L.slice(pass1, solo2).join('\n'), 'errors');
/* The second half needs a *history*, not the first half's screen: stats, the
   calendar and the lights all read finished blocks out of storage. Replaying the
   first half to produce one worked and then stopped fitting in the call, so the
   preamble is now the real boot call with `seedLog` handed to it — the same
   eight sessions the stats block seeds its own window with. One boot, no waits,
   and it cannot drift from the real one because it is sliced from it. */
const bootAt = at((l) => l.startsWith('const { window, errors } = boot(html'));
const bootEnd = L.findIndex((l, i) => i > bootAt && l.startsWith('await wait(400);')) + 1;
const soloBoot = L.slice(bootAt, bootEnd).join('\n')
  .replace('  focus_embers:', '  focus_log: JSON.stringify(seedLog),\n  focus_embers:');
write('solo2.mjs', soloBoot + '\n' + L.slice(solo2, sync).join('\n'),
  'errors.concat(errors2)');
write('sync.mjs', L.slice(sync, games).join('\n'), 'hostErr.concat(guestErr)');
// the room, the two names and the tap/open helpers, which both game slices need
const room = L.slice(games, hangman).join('\n');
write('games.mjs', setup + '\n' + L.slice(games, chess).join('\n'), 'hostErr.concat(guestErr)');
write('chess.mjs', setup + '\n' + room + '\n' + L.slice(chess, hand).join('\n'),
  'hostErr.concat(guestErr)');
/* The handover block needs two windows already in a room, not the whole sync
   pass — and carrying all of it made this slice long enough that the sandbox
   killed it half the time. Everything it was re-running is covered by sync.mjs. */
const msgs = at((l) => l.startsWith('// --- messages ---'));
write('handover.mjs', L.slice(sync, msgs).join('\n') + '\n' + L.slice(hand, verdict).join('\n'),
  'hostErr.concat(guestErr, thirdErr)');

console.log('wrote solo / sync / games / chess / handover to ' + out);
