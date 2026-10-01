/**
 * Every packed file has to survive being moved out of the way.
 *
 * An update does not overwrite the old copy, it uninstalls it first. The way
 * electron-builder's uninstaller does that is to rename each installed file
 * into `%TEMP%\ns_____.tmp\old-install\<the same relative path>` and only then
 * delete the lot -- an atomic-ish removal, so a half-finished uninstall can be
 * put back. NSIS `Rename` is `MoveFileW` with no `\\?\` long-path prefix, so
 * a target over 260 characters simply fails, and the uninstaller reports the
 * one cause
 * it cannot tell that apart from:
 *
 *     File is busy, aborting: <path>
 *
 * The installer then stops with "Failed to uninstall old application files.
 * Please try running the installer again.: 2" -- and trying again does exactly
 * the same thing, because nothing was ever busy. The person is stuck on the
 * version they have, on this and every future release, and the only way out is
 * deleting the offending files by hand.
 *
 * That is what shipping `node_modules/@capacitor/android` did: its Gradle
 * output reaches 258 characters inside the install folder, which is 262 in the
 * temp folder the uninstaller moves it to. Nothing in the build said a word
 * about it. The installer built, installed and ran perfectly -- the failure
 * arrived one release later, on somebody else's machine, as a dialog with no
 * true information in it. So the packed tree is measured here, before upload.
 *
 * The budget, worked out rather than guessed:
 *
 *   260   MAX_PATH
 *   -41   "C:\Users\" + "\AppData\Local\Temp\" + "ns____.tmp"
 *   -24   room for a long Windows user name
 *   -13   "\old-install\"
 *   ----
 *   182   for the path relative to the install folder -- call it 180.
 *
 * A normal build's longest path is about a third of that, so this only ever
 * fires on something that has no business being in the package at all.
 *
 * Run by ship-release.ps1 between building the installer and uploading it.
 * By hand, on a build or on an installed copy:
 *
 *     node tools/path-check.mjs [folder]
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 180;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2] || join(root, 'release', 'win-unpacked');

if (!existsSync(dir)) {
  console.error('nothing to check: ' + dir + ' does not exist (build it first)');
  process.exit(1);
}

const found = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const full = join(d, name);
    let st;
    try { st = statSync(full); } catch (e) { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    const rel = relative(dir, full);
    if (rel.length > LIMIT) found.push(rel);
  }
};
walk(dir);

const worst = found.sort((a, b) => b.length - a.length);
if (worst.length) {
  console.error(worst.length + ' packed path(s) too long for the uninstaller to move (limit ' + LIMIT + '):');
  for (const rel of worst.slice(0, 5)) console.error('  ' + String(rel.length).padStart(3) + '  ' + rel);
  if (worst.length > 5) console.error('  ... and ' + (worst.length - 5) + ' more');
  console.error('An update over this build would fail with "Failed to uninstall old application files".');
  console.error('Keep it out of the package: "files" in package.json.');
  process.exit(1);
}

let longest = 0;
const measure = (d) => {
  for (const name of readdirSync(d)) {
    const full = join(d, name);
    let st;
    try { st = statSync(full); } catch (e) { continue; }
    if (st.isDirectory()) { measure(full); continue; }
    longest = Math.max(longest, relative(dir, full).length);
  }
};
measure(dir);
console.log('packed paths fit: longest is ' + longest + ' of ' + LIMIT);
