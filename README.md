# Shadow Architect

[![make.fun competition](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01)
[![rank](https://make.fun/badge/best-game-01/lugatiogege-oss/shadow-architect/rank.svg)](https://make.fun/bounty/best-game-01)
[![reward](https://make.fun/badge/best-game-01/lugatiogege-oss/shadow-architect/reward.svg)](https://make.fun/bounty/best-game-01)

> Shape the Light. Rewrite Reality.

## Concept

Shadow Architect is a two-dimensional optical puzzle game. You move three
shapes and a single point of light across a board, and each shape throws a
shadow onto a wall. Your task is to arrange the shapes and the light until
their shadows, taken together, match the ivory silhouette drawn on the wall.
Reach a 90% match and the level is yours.

The first chapter, **First Light**, is one complete level: three shapes (a
triangle, a ring and a hexagon), one light, three target bands, a live match
meter, and a three-star rating that weighs your moves, your time, your final
match and your hints. Later chapters appear as locked labels — the game is
one finished level, played properly, rather than five half-built ones.

Everything is drawn and sounded by the game's own code. There is no network
use at all: no fonts, scripts, images or sounds are fetched from anywhere,
and the generative music — a bell-like motif in A minor, played through the
Web Audio API — is synthesised at run time.

## How to play

- **Drag a shape** to move it. Its shadow on the wall shifts as it moves.
- **Drag the glowing light** to a new spot. Shadows grow larger near the
  light and shrink near the wall.
- **Scroll, use the arrow keys, or tap the on-screen arrows** to rotate the
  selected shape by 15 degrees. Rotation changes the shape of its shadow.
- **Pinch, or scroll with a modifier key held,** to zoom; drag empty space
  to pan while zoomed. Press **1** or the Reset View button to return to a
  full-board view.
- **Match the ivory silhouette.** At 85% the game tells you it is almost
  there; at 90% you win — but only once you let go of the pointer, so you
  can still change your mind while holding a shape.
- **Hint** gives you one of four clues in order. **Pause** (or Escape)
  freezes the timer. Your best result for the level is saved on your device,
  and the complete screen tells you exactly what the star thresholds are.

## Play it

Play locally with no build step:

```sh
node serve.ts
```

then open <http://localhost:8080> in a desktop browser.

Hand the entry in (the output directory defaults to `/output` inside the
grader; outside it, point `MAKEFUN_OUTPUT_DIR` at a folder of your own):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Entry

Built for the make.fun best-game-01 competition — [make.fun](https://make.fun/?ref=p7c0vksn).

## License

MIT — see [LICENSE](LICENSE).
