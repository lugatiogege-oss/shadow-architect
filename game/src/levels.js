/* Shadow Architect — level data tables.
 *
 * The tables in spec section 3, nothing else. No screen, no storage,
 * no network. Callers must copy a level before changing it; the
 * tables here are never mutated by the game.
 */
(function (root) {
  'use strict';

  var SA = root.SA || (root.SA = {});

  /* Deep copy through plain JSON values: the tables hold only
   * numbers, strings, and plain objects, so this is exact. */
  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* First Light, Chapter One, difficulty normal (spec section 3).
   * Object positions are landscape coordinates. Portrait positions
   * are derived from these by the scaling rule in section 2, except
   * the light home and the target bands, which are given per
   * orientation below. */
  var LEVEL_01 = {
    id: 'level-01',
    name: 'First Light',
    chapter: 1,
    difficulty: 'normal',
    winType: 'match',
    winThreshold: 0.9,
    moveLimit: null,
    objects: [
      { id: 'tri', shape: 'triangle', x: 960, y: 450, radius: 40, rotation: 25, color: '#f2ead8' },
      { id: 'ring', shape: 'ring', x: 560, y: 470, radius: 34, rotation: 0, color: '#9d8df1' },
      { id: 'hex', shape: 'hexagon', x: 580, y: 430, radius: 38, rotation: 12, color: '#6fd3e7' }
    ],
    lightHome: {
      landscape: { x: 185, y: 360 },
      portrait: { x: 360, y: 175 }
    },
    targets: {
      landscape: [
        { low: 160, high: 270, depth: 92 },
        { low: 305, high: 415, depth: 66 },
        { low: 450, high: 560, depth: 92 }
      ],
      portrait: [
        { low: 110, high: 220, depth: 92 },
        { low: 290, high: 400, depth: 66 },
        { low: 470, high: 580, depth: 92 }
      ]
    },
    hints: [
      'Drag an object to move it. The light magnifies what is near it.',
      'Use the left and right arrows (or scroll) to rotate the selected object.',
      'Drag the light: near the wall shadows shrink, near objects they grow.',
      'Match the shadow to the ivory silhouette. Reach 90% to win.'
    ],
    starThresholds: {
      normal: {
        three: { moves: 25, seconds: 120, match: 0.95, hints: 1 },
        two: { moves: 40, seconds: 240, match: 0.90, hints: 3 }
      }
    }
  };

  var LEVELS = [LEVEL_01];

  function findLevel(id) {
    var i;
    for (i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].id === id) return LEVELS[i];
    }
    return null;
  }

  /* Fetch a level by identifier. Returns a fresh copy, or null
   * when no level has that identifier. */
  function getLevel(id) {
    var found = findLevel(id);
    return found ? deepCopy(found) : null;
  }

  /* List the levels: fresh copies of the identifier and name of
   * each level, in table order. */
  function listLevels() {
    return LEVELS.map(function (level) {
      return { id: level.id, name: level.name, chapter: level.chapter };
    });
  }

  /* Copy a level: a deep copy of the stored table for the given
   * identifier (or of a level object passed in), so the caller can
   * change positions freely without touching the originals. */
  function copyLevel(levelOrId) {
    var source;
    if (typeof levelOrId === 'string') {
      source = findLevel(levelOrId);
      return source ? deepCopy(source) : null;
    }
    if (levelOrId && typeof levelOrId === 'object') {
      return deepCopy(levelOrId);
    }
    return null;
  }

  SA.Levels = {
    LEVELS: LEVELS,
    LEVEL_01: LEVEL_01,
    getLevel: getLevel,
    fetchLevel: getLevel,
    get: getLevel,
    find: getLevel,
    listLevels: listLevels,
    list: listLevels,
    copyLevel: copyLevel,
    cloneLevel: copyLevel,
    copy: copyLevel,
    clone: copyLevel,
    deepCopy: deepCopy
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
