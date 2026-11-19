// token-radar-01 entry (Node 22, standard library only).
//
// main.ts reads the sealed snapshot, scores every pre-token protocol with the
// radar-2.2 model in lib/model.ts, writes the ranked board to /output/board.json,
// writes the dashboard's data to /output/data.js, copies dashboard/ and
// screenshots/ to /output, and writes /output/dossier.json with the vendored
// make.fun library.
//
// The dashboard carries seven page features — sortable headers, pins, a compare
// dialog, a command palette, a live what-if model sandbox, CSV export and a
// tabbed detail drawer — plus log-scale bars, all client-side from the same
// window.RADAR. The model ranks 225 rows: the floor no longer caps discovery,
// liquid-staking/restaking protocols are ranked, every live comparable is shown,
// and each farm plan has seven steps. Four screenshots are handed in: the board,
// a detail view, a filtered view and one feature view.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p /tmp/tr-out && MAKEFUN_OUTPUT_DIR=/tmp/tr-out node main.ts --input input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** A dollar amount with thousands separators, written by hand: no locale dependence, so two runs print alike. */
function fmtUsd(n: number): string {
  const digits = String(Math.trunc(n));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return `$${out}`;
}

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length !== 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 4, the board, a detail view, a filtered view and one feature view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierPath = join(out, 'dossier.json');
writeFileSync(dossierPath, buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
const dossierBytes = statSync(dossierPath).size;
const boardBytes = statSync(join(out, 'board.json')).size;
const dataBytes = statSync(join(out, 'data.js')).size;

// Self-check before reporting success: the dossier must parse, and the board
// written to disk must hold exactly the rows the model scored.
const dossierParsed = JSON.parse(readFileSync(dossierPath, 'utf8'));
if (typeof dossierParsed !== 'object' || dossierParsed === null) {
  process.stderr.write('token radar: the dossier did not parse back as JSON\n');
  process.exit(1);
}
const boardOnDisk = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
if (!Array.isArray(boardOnDisk.rows) || boardOnDisk.rows.length !== board.length) {
  process.stderr.write(`token radar: board.json on disk holds ${Array.isArray(boardOnDisk.rows) ? boardOnDisk.rows.length : 'no'} rows, expected ${board.length}\n`);
  process.exit(1);
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: rank 1 ${board[0]!.name} at ${fmtUsd(board[0]!.implied_value_usd)}, rank ${board.length} at ${fmtUsd(board[board.length - 1]!.implied_value_usd)}\n` +
    `token radar: wrote ${join(out, 'board.json')} (${boardBytes} bytes), ${join(out, 'data.js')} (${dataBytes} bytes), ${join(out, 'dashboard')} (${dash.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${dossierPath} (${dossierBytes} bytes)\n`,
);
