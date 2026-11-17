// Shadow Architect — entry hand-in program (Node 22, standard library only).
//
// This file is the program that hands the game in. The playable game lives
// in game/ beside this file (plain static files: game/index.html plus its
// scripts and style, nothing fetched from the network), and the screenshots
// live in screenshots/ beside it. Running this file copies both folders into
// the output directory and writes output/dossier.json, the summary the
// make.fun judge reads, using the vendored make.fun library.
//
// Run it locally like this (the output directory defaults to /output, which
// only exists inside the grader's container):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Serve the game locally for a quick play test with:
//   node serve.ts
// then open http://localhost:8080 in a desktop browser.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps: the text budget shapes how much source the dossier
// carries, and the other caps refuse an entry the scorer would refuse — more
// than four screenshots or one over 256 KiB, more than 993 files in game/ or
// 48 MiB of game files in all, or a path under game/ over 1000 bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
