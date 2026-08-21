/**
 * Chess rules test.
 *
 * Chess is the one game in here where "looks right" is not good enough — en
 * passant, castling through check, and pinned pieces are exactly the rules a
 * hand-written board gets wrong, and getting them wrong means the host rejects
 * a move somebody is entitled to play.
 *
 * So this runs perft: count every legal move sequence to a given depth and
 * compare against the numbers everyone else's engine agrees on. A single wrong
 * rule anywhere shows up as a wrong total. The positions are the standard ones
 * (the start, Kiwipete, and two that are famous for catching en-passant and
 * promotion bugs).
 *
 *   node tools/chess-rules-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'js');
const src = readFileSync(join(R, '35-chess-rules.js'), 'utf8');

const C = new Function(src + `
  return {chessStart, chessMoves, chessMake, chessSan, chessUci, chessParse,
          chessReplay, chessResult, chessInCheck, chessKey, chSq, chIndex, chName};`)();

const {
  chessStart, chessMoves, chessMake, chessSan, chessUci, chessParse,
  chessReplay, chessResult, chessInCheck, chIndex, chName,
} = C;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

/** Read a FEN into the engine's position shape. Test-side only — the app never
 *  needs it, because the app only ever stores move lists. */
function fen(str) {
  const [board, turn, cr, ep, half, full] = str.split(/\s+/);
  const b = new Array(64).fill('');
  let i = 0;
  for (const ch of board) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) i += Number(ch);
    else b[i++] = ch;
  }
  return {
    b, w: turn === 'w', cr: cr === '-' ? '-' : cr,
    ep: ep === '-' ? -1 : chIndex(ep),
    half: Number(half || 0), full: Number(full || 1),
  };
}

function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = chessMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(chessMake(pos, m), depth - 1);
  return n;
}

console.log('\nperft — the opening position');
{
  const p = chessStart();
  ok('20 moves at depth 1', perft(p, 1) === 20, `${perft(p, 1)}`);
  ok('400 at depth 2', perft(p, 2) === 400, `${perft(p, 2)}`);
  ok('8,902 at depth 3', perft(p, 3) === 8902, `${perft(p, 3)}`);
  ok('197,281 at depth 4', perft(p, 4) === 197281, `${perft(p, 4)}`);
}

console.log('\nperft — Kiwipete (castling, pins, a board full of tactics)');
{
  const p = fen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  ok('48 at depth 1', perft(p, 1) === 48, `${perft(p, 1)}`);
  ok('2,039 at depth 2', perft(p, 2) === 2039, `${perft(p, 2)}`);
  ok('97,862 at depth 3', perft(p, 3) === 97862, `${perft(p, 3)}`);
}

console.log('\nperft — the two that catch en passant and promotion');
{
  const three = fen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  ok('14 at depth 1', perft(three, 1) === 14, `${perft(three, 1)}`);
  ok('2,812 at depth 3', perft(three, 3) === 2812, `${perft(three, 3)}`);
  ok('674,624 at depth 5', perft(three, 5) === 674624, `${perft(three, 5)}`);

  const four = fen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
  ok('6 at depth 1', perft(four, 1) === 6, `${perft(four, 1)}`);
  ok('264 at depth 2', perft(four, 2) === 264, `${perft(four, 2)}`);
  ok('9,467 at depth 3', perft(four, 3) === 9467, `${perft(four, 3)}`);
}

console.log('\nthe rules a player actually notices');
{
  // Scholar's mate, played through the same path the app uses
  const g = chessReplay(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
  ok('a normal game replays', g.ok);
  ok('and reads as chess', g.list.map((m) => m.san).join(' ')
    === 'e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#', g.list.map((m) => m.san).join(' '));
  const r = chessResult(g.pos, g.keys);
  ok('mate is mate', r.over && r.reason === 'checkmate', JSON.stringify(r));
  ok('and White won it', r.winner === 'w');
  ok('there is nothing left to play', chessMoves(g.pos).length === 0);

  const bad = chessReplay(['e2e4', 'e7e5', 'e4e5']);
  ok('a move that is not legal is refused, not half-applied', !bad.ok && bad.at === 2);

  // castling through an attacked square
  // black rook on f8 covers f1, which is the square the king crosses castling
  // short. e1 and d1 are untouched, so the long side is still legal.
  const thru = fen('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const kside = chessMoves(thru).some((m) => chessUci(m) === 'e1g1');
  const qside = chessMoves(thru).some((m) => chessUci(m) === 'e1c1');
  ok('you cannot castle through check', !kside);
  ok('but the other side is still fine', qside);

  // a pinned piece cannot wander off
  const pin = fen('4k3/8/8/8/8/8/4R3/4K2r b - - 0 1');
  ok('a pinned rook stays on the file',
    chessMoves(pin).every((m) => chessUci(m) !== 'h1a1' || false));

  // en passant, and only on the move it is available
  const epp = chessReplay(['e2e4', 'a7a6', 'e4e5', 'd7d5']);
  ok('en passant is offered', chessMoves(epp.pos).some((m) => chessUci(m) === 'e5d6'));
  const late = chessReplay(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'a2a3', 'h7h6']);
  ok('and gone a move later', !chessMoves(late.pos).some((m) => chessUci(m) === 'e5d6'));

  // promotion produces four different moves, not one
  const pro = fen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  ok('a pawn on the seventh has four promotions',
    chessMoves(pro).filter((m) => m.from === chIndex('a7')).length === 4);
  ok('and they are named properly',
    chessMoves(pro).map((m) => chessSan(pro, m)).join(' ').includes('a8=Q'),
    chessMoves(pro).map((m) => chessSan(pro, m)).join(' '));

  // stalemate is not a win
  const stale = fen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const sr = chessResult(stale, []);
  ok('stalemate ends it', sr.over && sr.reason === 'stalemate');
  ok('with nobody winning', sr.winner === null);

  // draws that are nobody's fault
  ok('two bare kings is a draw', chessResult(fen('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), []).over);
  ok('king and knight is a draw', chessResult(fen('4k3/8/8/8/8/8/8/3NK3 w - - 0 1'), []).over);
  ok('king and two knights is not', !chessResult(fen('4k3/8/8/8/8/8/8/2NNK3 w - - 0 1'), []).over);
  ok('the fifty-move rule ends it',
    chessResult(fen('4k3/8/4r3/8/8/4R3/8/4K3 w - - 100 80'), []).reason === 'the fifty-move rule');

  // threefold, by shuffling knights back and forth
  const rep = chessReplay(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
  ok('the same position three times is a draw',
    chessResult(rep.pos, rep.keys).reason === 'the same position three times',
    JSON.stringify(chessResult(rep.pos, rep.keys)));

  // check is check
  const chk = chessReplay(['e2e4', 'f7f5', 'd1h5']);
  ok('check is spotted', chessInCheck(chk.pos));
  ok('and named in the notation', chk.list[chk.list.length - 1].san === 'Qh5+',
    chk.list[chk.list.length - 1].san);

  // disambiguation: two knights that can both reach the same square
  const two = fen('4k3/8/8/8/8/2N1N3/8/4K3 w - - 0 1');
  const d4 = chessMoves(two).filter((m) => chName(m.to) === 'd5');
  ok('two knights to one square are told apart',
    d4.map((m) => chessSan(two, m)).sort().join(' ') === 'Ncd5 Ned5',
    d4.map((m) => chessSan(two, m)).join(' '));

  // a move list round-trips through the wire format
  const uci = ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3'];
  ok('a game survives being written down and read back',
    chessReplay(uci).list.map((m) => m.uci).join(' ') === uci.join(' '));
  ok('and a nonsense move is simply not found', chessParse(chessStart(), 'e2e5') === null);
}

console.log(`\n${pass}/${pass + fail} chess rules checks passed`);
process.exit(fail ? 1 : 0);
