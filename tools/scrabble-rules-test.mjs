/**
 * Scrabble rules test.
 *
 * The smoke test drives Scrabble through the real UI, which is the right way to
 * test it — but the bag is shuffled, so the smoke test can only play whatever
 * word happens to be in the rack. That leaves the interesting rules unproven:
 * crossing words, blanks, bingos, the endgame arithmetic.
 *
 * So this one lifts the rules engine straight out of `src/js/` with the DOM and
 * the network stubbed out, builds boards by hand, and asks it to judge them.
 * No jsdom, so it runs in well under a second.
 *
 *   node tools/scrabble-rules-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'js');
const src = ['31-scrabble-data.js', '31a-scrabble-rules.js', '32-scrabble.js']
  .map((f) => readFileSync(join(R, f), 'utf8')).join('\n');

const noop = () => {};
const stub = {
  $: () => null, Arcade: { open: false, active: null, _refresh: noop, close: noop },
  esc: (s) => String(s), chime: noop, showBanner: noop, toast: noop,
  syncActive: () => true, syncIsHost: () => true, syncSeats: () => [],
  syncGameSend: noop, syncGamePush: noop, syncGamePushAll: noop,
  syncGameRegister: noop, registerGame: noop, syncOpen: noop,
  holdMenu: noop, askConfirm: noop, window: { addEventListener: noop },
};
const names = Object.keys(stub);
const S = new Function(...names,
  src + '\nreturn {Scrabble, scrIsWord, scrJudge, scrUnfinished, SCR_VALUES, scrPrem};')
  (...names.map((n) => stub[n]));

const { Scrabble, scrIsWord, scrJudge, scrUnfinished } = S;
let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

const SIZE = 15;
const fresh = () => {
  Scrabble.state = {
    board: new Array(SIZE * SIZE).fill(null),
    bag: [], seats: [], turn: 0, moves: 0, last: null, quiet: 0,
    over: false, winner: '', endedBy: '',
  };
  return Scrabble.state;
};
const put = (st, r, c, ch, blank) => { st.board[r * SIZE + c] = { ch, blank: !!blank }; };
const seat = (rack) => ({ id: 'x', name: 'X', rack: rack.split(''), score: 0 });
const T = (r, c, ch, blank) => ({ r, c, ch, blank: !!blank });

console.log('\ndictionary');
ok('common words are in', ['cat', 'cats', 'walking', 'quiz', 'jo', 'qi', 'za'].every(scrIsWord));
ok('nonsense is out', !['zzq', 'abcd', 'qqqq'].some(scrIsWord));

console.log('\nfirst move');
{
  const st = fresh();
  ok('must cross the star', !Scrabble._judge(seat('catxxxx'), [T(0,0,'c'), T(0,1,'a'), T(0,2,'t')]).ok);
  ok('two letters minimum', !Scrabble._judge(seat('axxxxxx'), [T(7,7,'a')]).ok);
  const r = Scrabble._judge(seat('catxxxx'), [T(7,7,'c'), T(7,8,'a'), T(7,9,'t')]);
  ok('CAT on the star scores 10', r.ok && r.pts === 10, JSON.stringify(r));
}

console.log('\nlines and gaps');
{
  const st = fresh();
  put(st, 7, 7, 'c'); put(st, 7, 8, 'a'); put(st, 7, 9, 't');
  ok('no diagonals', !Scrabble._judge(seat('sexxxxx'), [T(6,10,'s'), T(8,11,'e')]).ok);
  ok('no gaps in the line', !Scrabble._judge(seat('sexxxxx'), [T(7,11,'s'), T(7,13,'e')]).ok);
  ok('must touch what is there', !Scrabble._judge(seat('atxxxxx'), [T(0,0,'a'), T(0,1,'t')]).ok);
}

console.log('\ncross words');
{
  const st = fresh();
  // CAT across the middle; hang a word off the T
  put(st, 7, 7, 'c'); put(st, 7, 8, 'a'); put(st, 7, 9, 't');
  const good = Scrabble._judge(seat('enxxxxx'), [T(8,9,'e'), T(9,9,'n')]);
  ok('TEN down off the T is allowed', good.ok, JSON.stringify(good));
  // a play whose main word is fine but whose crossing word is not
  const bad = Scrabble._judge(seat('zqxxxxx'), [T(6,7,'z'), T(6,8,'q')]);
  ok('a bad crossing word rejects the whole play', !bad.ok, JSON.stringify(bad));
  // parallel play: every new tile makes a two-letter crossing word
  const st2 = fresh();
  put(st2, 7, 7, 'a'); put(st2, 7, 8, 't');
  // HI under AT: the crossings AH and TI are both words, so it stands
  const par = Scrabble._judge(seat('hixxxxx'), [T(8,7,'h'), T(8,8,'i')]);
  ok('a parallel play scores its crossings too', par.ok && par.pts > 5, JSON.stringify(par));
  // ...and IT under AT does not, because TT is nothing
  const parBad = Scrabble._judge(seat('itxxxxx'), [T(8,7,'i'), T(8,8,'t')]);
  ok('a parallel play is judged on every crossing', !parBad.ok, JSON.stringify(parBad));
}

console.log('\nscoring');
{
  const st = fresh();
  // (7,7) is the star (double word). CAT = 3+1+1 = 5, doubled = 10.
  ok('the star doubles', Scrabble._judge(seat('catxxxx'), [T(7,7,'c'), T(7,8,'a'), T(7,9,'t')]).pts === 10);
  const st2 = fresh();
  // a blank scores nothing but still spells
  const b = Scrabble._judge(seat('ca?xxxx'), [T(7,7,'c'), T(7,8,'a'), T(7,9,'t', true)]);
  ok('a blank spells but does not score', b.ok && b.pts === 8, JSON.stringify(b));
  const st3 = fresh();
  const bingo = Scrabble._judge(seat('rateing'), [T(7,4,'t'), T(7,5,'a'), T(7,6,'n'), T(7,7,'g'), T(7,8,'i'), T(7,9,'e'), T(7,10,'r')]);
  ok('seven tiles is a bingo', bingo.ok && bingo.pts > 50, JSON.stringify(bingo));
}

console.log('\nrack honesty');
{
  fresh();
  ok('you cannot play tiles you do not hold', !Scrabble._judge(seat('zzzzzzz'), [T(7,7,'c'), T(7,8,'a'), T(7,9,'t')]).ok);
  ok('you cannot use one tile twice', !Scrabble._judge(seat('atxxxxx'), [T(7,7,'a'), T(7,8,'t'), T(7,9,'t')]).ok);
  const st = fresh();
  put(st, 7, 7, 'c');
  ok('you cannot cover an existing tile', !Scrabble._judge(seat('atxxxxx'), [T(7,7,'a'), T(7,8,'t')]).ok);
  ok('you cannot play off the board', !Scrabble._judge(seat('atxxxxx'), [T(7,14,'a'), T(7,15,'t')]).ok);
}

console.log('\nlive preview');
{
  // The preview shows a verdict only once there is something to have a verdict
  // about. "Still being laid out" and "actually wrong" have to be tellable apart
  // or it nags at you between tiles.
  const st = fresh();
  ok('one tile down is not yet an opinion', scrUnfinished(scrJudge(st.board, [T(7,7,'a')]).why));
  ok('a gap is not yet an opinion', scrUnfinished(scrJudge(st.board, [T(7,7,'c'), T(7,9,'t')]).why));
  ok('scattered tiles are not yet an opinion', scrUnfinished(scrJudge(st.board, [T(7,7,'c'), T(9,9,'t')]).why));
  ok('a real non-word is an opinion', !scrUnfinished(scrJudge(st.board, [T(7,7,'z'), T(7,8,'q')]).why));
  ok('missing the star is an opinion', !scrUnfinished(scrJudge(st.board, [T(0,0,'c'), T(0,1,'a'), T(0,2,'t')]).why));

  // and the preview scores the same as the host will
  const live = scrJudge(st.board, [T(7,7,'c'), T(7,8,'a'), T(7,9,'t')]);
  const real = Scrabble._judge(seat('catxxxx'), [T(7,7,'c'), T(7,8,'a'), T(7,9,'t')]);
  ok('preview and host agree on the score', live.ok && real.ok && live.pts === real.pts,
     `${live.pts} vs ${real.pts}`);
}

console.log('\nendgame');
{
  const st = fresh();
  st.seats = [seat(''), seat('qz')];
  st.seats[0].name = 'Out'; st.seats[1].name = 'Stuck';
  st.seats[0].score = 30; st.seats[1].score = 40;
  st.bag = [];
  Scrabble._finish('out');
  ok('going out collects what is left', st.seats[0].score === 30 + 20, `${st.seats[0].score}`);
  ok('leftovers are paid for', st.seats[1].score === 40 - 20, `${st.seats[1].score}`);
  ok('the winner is named', st.winner === 'Out', st.winner);
}

console.log(`\n${pass}/${pass + fail} rules checks passed`);
process.exit(fail ? 1 : 0);
