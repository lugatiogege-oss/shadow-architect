// Shadow Architect — submission entry point (Node 22, standard library only).
//
// This file hands the game in to make.fun. The game itself lives in game/
// next to this file: plain static files a desktop browser loads offline
// (game/index.html plus its ES modules, no library, no network request).
// Running this script copies game/ and screenshots/ into the output
// directory and writes dossier.json there, the summary the judge reads,
// using the vendored make.fun library in vendor/.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Inside the grader's container the output directory is /output; outside
// it, MAKEFUN_OUTPUT_DIR stands in for /output.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The folder this file sits in is the repository root.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });

// The game is required: copy the whole folder, preserving its structure.
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });

// Screenshots are optional at build time; copy them when they exist.
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes
// the bytes; the rest refuse an entry the scorer would refuse — more than
// 4 screenshots or one over 256 KiB; more than 993 files in game/ or
// 48 MiB of game files in all, or a path under game/ over 1000 bytes
// (game/ counts beside /output's own 1000-entry cap, its screenshots/
// and dossier.json).
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`dossier written to ${join(outDir, 'dossier.json')}`);
