/* SHADOW ARCHITECT — level loader + room layout.
   Levels are DATA (src/levels.js registry, or any plain object with
   the same shape — e.g. a test JSON file). This module only:
     - resolves a level by id (SA.Levels registry) or validates a
       raw definition,
     - builds the orientation-aware room layout from a level def,
     - scores stars from a level's par table,
     - scores per-band shadow fit for the HUD indicators.
   The engine loads a level by id and needs NO code changes for a
   new level. Works in the browser as SA.Level and under Node as
   module.exports (the registry is pulled in below for Node).
*/
var SA = (typeof SA !== 'undefined') ? SA : {};
SA.Level = (function () {
  'use strict';

  // Band lights up when its per-band score reaches this value.
  var BAND_THRESHOLD = 0.85;

  // Required shape of a level definition (see src/levels.js header).
  function validateLevelData(def) {
    if (!def || typeof def !== 'object') return 'level def must be an object';
    if (typeof def.id !== 'string' || !def.id) return 'level def needs a string id';
    if (!Array.isArray(def.objects) || !def.objects.length) return 'level def needs a non-empty objects array';
    for (var i = 0; i < def.objects.length; i++) {
      var o = def.objects[i];
      if (!o.id || !o.shape || typeof o.cx !== 'number' || typeof o.cy !== 'number' ||
          typeof o.r !== 'number' || typeof o.rotDeg !== 'number') {
        return 'object #' + i + ' needs id/shape/cx/cy/r/rotDeg';
      }
    }
    if (!def.light || def.light.type !== 'point' || !def.light.home ||
        !def.light.home.landscape || !def.light.home.portrait) {
      return 'level def needs light { type: "point", home: { landscape, portrait } }';
    }
    if (!def.target || !def.target.landscape || !def.target.portrait ||
        !Array.isArray(def.target.landscape.bands) || !Array.isArray(def.target.portrait.bands) ||
        !Array.isArray(def.target.landscape.widths) || !Array.isArray(def.target.portrait.widths) ||
        def.target.landscape.bands.length !== def.target.landscape.widths.length ||
        def.target.portrait.bands.length !== def.target.portrait.widths.length) {
      return 'level def needs target { landscape/portrait: { bands[], widths[] } } with matching lengths';
    }
    if (!def.win || def.win.type !== 'match' || typeof def.win.threshold !== 'number' ||
        def.win.threshold <= 0 || def.win.threshold > 1) {
      return 'level def needs win { type: "match", threshold: 0..1 }';
    }
    // Stars accepts BOTH forms. Legacy array form is read as the
    // 'normal' table with minMatch 0.90 / maxHints Infinity (see
    // parFor below). Object form is per-difficulty:
    // { normal: [...], hard: [...], hell: [...] }, each table two
    // rows {moves, seconds} with optional minMatch / maxHints.
    // 'normal' must be present in object form.
    var starsErr = validateStars(def.stars);
    if (starsErr) return starsErr;
    if (def.difficulty !== undefined &&
        (def.difficulty !== 'normal' && def.difficulty !== 'hard' && def.difficulty !== 'hell')) {
      return 'level def difficulty must be "normal", "hard" or "hell"';
    }
    if (!Array.isArray(def.hints) || !def.hints.length) return 'level def needs a non-empty hints array';
    if (!('moveLimit' in def)) return 'level def needs moveLimit (null = unlimited)';
    return null; // valid
  }

  // One par row: { moves, seconds } plus optional minMatch / maxHints.
  function validateParRow(row) {
    if (!row || typeof row !== 'object' ||
        typeof row.moves !== 'number' || typeof row.seconds !== 'number') return false;
    if (row.minMatch !== undefined &&
        (typeof row.minMatch !== 'number' || row.minMatch <= 0 || row.minMatch > 1)) return false;
    if (row.maxHints !== undefined &&
        (typeof row.maxHints !== 'number' || row.maxHints < 0)) return false;
    return true;
  }
  function validateStars(stars) {
    if (Array.isArray(stars)) {
      if (stars.length !== 2 || !validateParRow(stars[0]) || !validateParRow(stars[1])) {
        return 'level def needs stars: [{moves, seconds}, {moves, seconds}]';
      }
      return null;
    }
    if (stars && typeof stars === 'object') {
      var keys = Object.keys(stars);
      if (!keys.length) return 'level def needs stars with at least a normal table';
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k !== 'normal' && k !== 'hard' && k !== 'hell') {
          return 'level def stars keys must be "normal", "hard" or "hell"';
        }
        var rows = stars[k];
        if (!Array.isArray(rows) || rows.length !== 2 ||
            !validateParRow(rows[0]) || !validateParRow(rows[1])) {
          return 'level def stars.' + k + ' needs [{moves, seconds}, {moves, seconds}]';
        }
      }
      if (!stars.normal) return 'level def stars object needs a "normal" table';
      return null;
    }
    return 'level def needs stars: [{moves, seconds}, {moves, seconds}] or { normal: [...], hard: [...], hell: [...] }';
  }

  // Resolve a level by id from the registry (deep copy). Returns null
  // for an unknown id. Raw defs (e.g. a test JSON file) go through
  // validateLevelData + SA.Levels.clone instead.
  function resolveLevel(id) {
    if (typeof SA.Levels === 'undefined' || !SA.Levels.get) return null;
    return SA.Levels.get(id);
  }

  // Orientation-aware ROOM layout. Room geometry (canvas size, wall,
  // stage, light zone) is shared by every level; the level def
  // supplies only its own light home + target silhouette per
  // orientation.
  function makeLayout(orientation, levelDef) {
    var level = levelDef || resolveLevel('level-01');
    var t = level.target[orientation] || level.target.landscape;
    var home = level.light.home[orientation] || level.light.home.landscape;
    if (orientation === 'portrait') {
      return {
        orientation: 'portrait',
        W: 720, H: 1280,
        axis: 'y', wall: 1010, wallSpan: [80, 640],
        wallThick: 64,
        // Wall moved up from 1090 so its bottom (1074 virtual =
        // 537px on a 360x640 screen) clears the touch bar (top edge
        // 584px) with 47px to spare; the wall panel bottom (1114
        // virtual = 557px) clears it by 27px. Stage bottom (980)
        // keeps a 30-virtual gap to the wall top.
        lightHome: { x: home.x, y: home.y },
        lightZone: { x: [120, 600], y: [90, 300] },
        stage: { x: [90, 630], y: [360, 980] },
        target: t.bands,
        targetWidths: t.widths
      };
    }
    return {
      orientation: 'landscape',
      W: 1280, H: 720,
      axis: 'x', wall: 1080, wallSpan: [90, 630],
      wallThick: 64,
      lightHome: { x: home.x, y: home.y },
      lightZone: { x: [90, 300], y: [120, 600] },
      stage: { x: [360, 980], y: [90, 630] },
      target: t.bands,
      targetWidths: t.widths
    };
  }

  // Normalized par table for a level's difficulty — two rows
  // { moves, seconds, minMatch, maxHints }. Legacy array-form stars
  // are read as 'normal' with minMatch 0.90 / maxHints Infinity.
  // Object-form stars pick level.difficulty (default 'normal'),
  // falling back to the 'normal' table when that difficulty has no
  // table yet. A level with no stars at all falls back to the
  // v0.7.1 default pars.
  function parFor(level) {
    var stars = level && level.stars;
    var rows = null;
    if (stars && !Array.isArray(stars) && typeof stars === 'object') {
      var diff = (level && level.difficulty) || 'normal';
      rows = stars[diff] || stars.normal;
    } else if (Array.isArray(stars)) {
      rows = stars;
    }
    if (!rows) rows = [{ moves: 40, seconds: 180 }, { moves: 80, seconds: 600 }];
    function norm(row) {
      return {
        moves: row.moves, seconds: row.seconds,
        minMatch: (typeof row.minMatch === 'number') ? row.minMatch : 0.90,
        maxHints: (typeof row.maxHints === 'number') ? row.maxHints : Infinity
      };
    }
    return [norm(rows[0]), norm(rows[1])];
  }

  // Star rating — AND model over 4 factors (moves, seconds,
  // accuracy, hints). New call: starsFor(moves, seconds, match,
  // hintsUsed, level), where match is the CONFIRMATION match (never
  // the drag peak) and hintsUsed counts deliberate Hint-button
  // presses only. 3 stars iff every par-0 bound holds, 2 stars iff
  // every par-1 bound holds, else 1 (only meaningful on completion).
  // Old 3-arg call starsFor(moves, seconds, level) still works:
  // match / hints default to "unknown, do not penalize" (match 1,
  // hints 0), so legacy callers and legacy array-form levels rate
  // exactly as before.
  function starsFor(moves, seconds, match, hintsUsed, level) {
    if (match && typeof match === 'object' && level === undefined) {
      level = match; match = undefined; hintsUsed = undefined;
    }
    var par = parFor(level);
    var m = (typeof match === 'number') ? match : 1;
    var h = (typeof hintsUsed === 'number') ? hintsUsed : 0;
    if (moves <= par[0].moves && seconds <= par[0].seconds &&
        m >= par[0].minMatch && h <= par[0].maxHints) return 3;
    if (moves <= par[1].moves && seconds <= par[1].seconds &&
        m >= par[1].minMatch && h <= par[1].maxHints) return 2;
    return 1;
  }

  // Per-band shadow fit for the HUD indicators. Accepts a live
  // engine state object — { shadowIntervals, target } (or the
  // aliases { shadows, bands }) — or the two raw interval arrays
  // directly: bandScores(shadowIntervals, targetIntervals).
  // Returns one score 0..1 per band; a band lights when its score
  // reaches BAND_THRESHOLD (0.85). Scoring is the SA.Math per-band
  // rule: the best single object's interval IoU against the band,
  // NOT union coverage (see src/math.js bandScores — union coverage
  // would light band 3 at the level start, before the player acts).
  // When SA.Math is unavailable, falls back to computing the same
  // single-object IoU inline from a state carrying objects + light
  // + layout.
  function bandScores(state, targetIntervals) {
    var shadows = null, target = null;
    if (Array.isArray(state)) {
      shadows = state;
      target = targetIntervals;
    } else if (state && typeof state === 'object') {
      shadows = state.shadowIntervals || state.shadows || state.intervals || null;
      target = state.target || state.bands || targetIntervals || null;
      if (!shadows && state.objects && state.light && state.layout && typeof SA.Math !== 'undefined') {
        shadows = [];
        for (var i = 0; i < state.objects.length; i++) {
          shadows.push(SA.Math.shadowInterval(state.objects[i], state.light, state.layout));
        }
        if (!target) target = state.layout.target;
      }
    }
    if (!shadows || !target) return [];
    if (typeof SA.Math !== 'undefined' && SA.Math.bandScores) {
      return SA.Math.bandScores(shadows, target);
    }
    var out = [];
    for (var b = 0; b < target.length; b++) {
      var band = target[b], best = 0;
      for (var j = 0; j < shadows.length; j++) {
        var iv = shadows[j];
        if (!iv) continue;
        var inter = Math.max(0, Math.min(iv[1], band[1]) - Math.max(iv[0], band[0]));
        var uni = Math.max(iv[1], band[1]) - Math.min(iv[0], band[0]);
        var score = uni <= 0 ? 0 : inter / uni;
        if (score > best) best = score;
      }
      out.push(best);
    }
    return out;
  }

  var api = {
    BAND_THRESHOLD: BAND_THRESHOLD,
    makeLayout: makeLayout,
    resolveLevel: resolveLevel,
    validateLevelData: validateLevelData,
    starsFor: starsFor,
    parFor: parFor,
    bandScores: bandScores
  };
  return api;
})();
// Node: each file is its own module scope, so pull the registry in here
// (in the browser the classic scripts already share one global SA).
if (typeof module !== 'undefined' && module.exports) {
  try { SA.Levels = require('./levels.js'); } catch (e) { /* registry unavailable */ }
  module.exports = SA.Level;
}
