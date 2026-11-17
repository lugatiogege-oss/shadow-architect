/* SHADOW ARCHITECT — level DATA.
   Levels are pure config: no code, no logic. The engine loads a
   level by id and must NOT need code changes for a new level.
   A level definition carries:
     - objects: start positions (+ shape, radius, rotation, colour)
     - light: type + home position per orientation
     - target: silhouette bands (+ drawn widths) per orientation
     - win: win condition (type + threshold)
     - stars: par table per difficulty — { normal: [...], hard: [...],
       hell: [...] }, each table two rows {moves, seconds, minMatch,
       maxHints} for 3 and 2 stars (AND model: all four must hold).
       Legacy array form is still accepted and read as 'normal'.
     - difficulty: 'normal' | 'hard' | 'hell' (default 'normal')
     - moveLimit: null = unlimited moves (by design — no softlock)
     - hints: level hints shown in order
   Object start positions are authored in LANDSCAPE space; in
   portrait they are proportionally remapped into the portrait
   stage, exactly as an orientation change remaps them.
   Only level-01 is playable (Chapter I). Chapters II–V below are
   locked stubs — data only, no playable content, no levels.
   Works in the browser as SA.Levels and under Node as module.exports.
*/
var SA = (typeof SA !== 'undefined') ? SA : {};
SA.Levels = (function () {
  'use strict';

  var LEVELS = {
    'level-01': {
      id: 'level-01',
      chapter: 'Chapter I',
      name: 'First Light',
      // The triangle starts INSIDE the light cone, so it casts a
      // shadow from the first moment and dragging it gives immediate
      // feedback. Initial match is ~25.6% landscape / ~25.8%
      // portrait (still unsolved), and the start sits 242 px from
      // the triangle's solution position, so the level is not given
      // away. The player stays free to move it anywhere afterwards
      // (no rails, no forced path).
      objects: [
        { id: 'tri', shape: 'triangle', cx: 960, cy: 450, r: 40, rotDeg: 25, color: '#f2ead8' },
        { id: 'ring', shape: 'ring', cx: 560, cy: 470, r: 34, rotDeg: 0, color: '#9d8df1' },
        { id: 'hex', shape: 'hexagon', cx: 580, cy: 430, r: 38, rotDeg: 12, color: '#6fd3e7' }
      ],
      light: {
        type: 'point',
        home: {
          landscape: { x: 185, y: 360 },
          portrait: { x: 360, y: 175 }
        }
      },
      // Target silhouette bands along the wall (lantern shape: wide
      // top, narrow middle, wide bottom) + the drawn width of each.
      target: {
        landscape: { bands: [[160, 270], [305, 415], [450, 560]], widths: [92, 66, 92] },
        portrait: { bands: [[110, 220], [290, 400], [470, 580]], widths: [92, 66, 92] }
      },
      win: { type: 'match', threshold: 0.90 },
      // Chapter I stays Normal. 3 stars = at most 25 moves AND at
      // most 120 s AND at least 95% confirmation match AND at most
      // 1 deliberate hint; 2 stars = at most 40 moves AND at most
      // 240 s AND at least 90% AND at most 3 hints; else 1 star.
      // Hard/Hell tables are intentionally absent — parFor() falls
      // back to 'normal' until a future level/difficulty defines
      // them. Do NOT add Hard/Hell levels or Chapter II content
      // without an owner order.
      difficulty: 'normal',
      stars: {
        normal: [
          { moves: 25, seconds: 120, minMatch: 0.95, maxHints: 1 },  // 3 stars
          { moves: 40, seconds: 240, minMatch: 0.90, maxHints: 3 }   // 2 stars (else 1)
        ]
      },
      moveLimit: null,
      // Hints trimmed to fit the 148px mobile pill in at most 4 lines.
      hints: [
        'Drag an object to move it. The light magnifies what is near it.',
        'Use ◀ ▶ (or scroll) to rotate the selected object.',
        'Drag the light: near the wall shadows shrink, near objects they grow.',
        'Match the shadow to the ivory silhouette. Reach 90% to win.'
      ]
    }
  };

  // Locked chapter stubs — DATA ONLY. No level ids, no objects, no
  // target bands, nothing playable. The menu shows these as locked;
  // the engine never resolves them as levels.
  var CHAPTERS = [
    { chapter: 'Chapter I', name: 'First Light', locked: false, levelId: 'level-01' },
    { chapter: 'Chapter II', name: 'Twin Suns', locked: true, levelId: null },
    { chapter: 'Chapter III', name: 'The Prism Hall', locked: true, levelId: null },
    { chapter: 'Chapter IV', name: 'Mirror Deep', locked: true, levelId: null },
    { chapter: 'Chapter V', name: 'The Final Silhouette', locked: true, levelId: null }
  ];

  // Deep copy so callers can mutate a loaded level without touching
  // the registry (the engine clones again per fresh state anyway).
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function get(id) {
    if (!LEVELS[id]) return null;
    return clone(LEVELS[id]);
  }
  function list() { return Object.keys(LEVELS); }
  function listChapters() { return clone(CHAPTERS); }

  return { LEVELS: LEVELS, CHAPTERS: CHAPTERS, get: get, list: list, listChapters: listChapters, clone: clone };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SA.Levels;
