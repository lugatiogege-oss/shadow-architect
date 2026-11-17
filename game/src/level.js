/* Shadow Architect — level resolution, validation, star rating.
 *
 * Resolving a level into a playable layout for an orientation,
 * checking level data, and the star rule from spec sections 3, 5
 * and 6. No screen, no storage, no network.
 */
(function (root) {
  'use strict';

  var SA = root.SA || (root.SA = {});

  var SHAPES = ['triangle', 'ring', 'hexagon'];
  var ORIENTATIONS = ['landscape', 'portrait'];

  /* Star thresholds by difficulty (spec section 3). Only normal
   * is defined for this game. */
  var STAR_THRESHOLDS = {
    normal: {
      three: { moves: 25, seconds: 120, match: 0.95, hints: 1 },
      two: { moves: 40, seconds: 240, match: 0.90, hints: 3 }
    }
  };

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalOrientation(orientation) {
    return orientation === 'portrait' ? 'portrait' : 'landscape';
  }

  function shapeKind(object) {
    if (!object) return '';
    return String(object.shape || object.type || object.kind || '').toLowerCase();
  }

  /* Return the star thresholds for a difficulty, as a fresh copy,
   * or null when the difficulty is not defined. Each tier carries
   * the four limits under both short and long names. */
  function starThresholds(difficulty) {
    var name = difficulty || 'normal';
    var found = STAR_THRESHOLDS[name];
    var copy;
    if (!found) return null;
    copy = deepCopy(found);
    copy.three.maxMoves = copy.three.moves;
    copy.three.maxSeconds = copy.three.seconds;
    copy.three.minMatch = copy.three.match;
    copy.three.maxHints = copy.three.hints;
    copy.two.maxMoves = copy.two.moves;
    copy.two.maxSeconds = copy.two.seconds;
    copy.two.minMatch = copy.two.match;
    copy.two.maxHints = copy.two.hints;
    return copy;
  }

  /* Star rating (spec section 3). Three stars need all four
   * three-star limits at once; two stars need all four two-star
   * limits at once; anything else is one star. The first argument
   * is a thresholds object as returned by starThresholds. An
   * object-form call is also accepted. */
  function starRating(thresholds, moves, seconds, match, hints) {
    var t = thresholds;
    var three;
    var two;
    if (t && typeof t === 'object' && !t.three && typeof moves === 'object' && moves !== null) {
      /* Object form: starRating({ thresholds, moves, seconds, match, hints }) */
      var opts = moves;
      t = opts.thresholds || opts.starThresholds || null;
      moves = opts.moves;
      seconds = opts.seconds;
      match = opts.match;
      hints = opts.hints;
    }
    if (!t || !t.three || !t.two) return 1;
    three = t.three;
    two = t.two;
    if (moves <= three.moves && seconds <= three.seconds &&
        match >= three.match && hints <= three.hints) {
      return 3;
    }
    if (moves <= two.moves && seconds <= two.seconds &&
        match >= two.match && hints <= two.hints) {
      return 2;
    }
    return 1;
  }

  /* Convenience: rate with the thresholds of a named difficulty. */
  function starsForDifficulty(difficulty, moves, seconds, match, hints) {
    var thresholds = starThresholds(difficulty);
    if (!thresholds) return 1;
    return starRating(thresholds, moves, seconds, match, hints);
  }

  /* Resolve a level identifier (or a level object) into level data
   * for an orientation. The returned data is a fresh copy: object
   * positions are landscape in the tables and are scaled to
   * portrait by the section 2 rule when the orientation is
   * portrait; the light home and target bands are the per-
   * orientation values from the tables. Returns null for an
   * unknown identifier. */
  function resolveLevel(levelOrId, orientation) {
    var o = normalOrientation(orientation);
    var source = null;
    var resolved;
    var math;
    var i;
    if (typeof levelOrId === 'string') {
      if (SA.Levels && SA.Levels.getLevel) source = SA.Levels.getLevel(levelOrId);
      if (!source) return null;
    } else if (levelOrId && typeof levelOrId === 'object') {
      source = deepCopy(levelOrId);
    } else {
      return null;
    }
    resolved = source;
    resolved.orientation = o;
    math = SA.Math;
    if (o === 'portrait' && math && math.toPortraitPosition) {
      for (i = 0; i < (resolved.objects || []).length; i++) {
        var scaled = math.toPortraitPosition(resolved.objects[i]);
        resolved.objects[i].x = scaled.x;
        resolved.objects[i].y = scaled.y;
      }
    }
    if (resolved.lightHome) {
      resolved.light = deepCopy(resolved.lightHome[o] || resolved.lightHome.landscape);
      resolved.lightHomePosition = resolved.light;
    }
    if (resolved.targets) {
      resolved.targetBands = deepCopy(resolved.targets[o] || resolved.targets.landscape);
      resolved.targetsForOrientation = resolved.targetBands;
    }
    return resolved;
  }

  /* Build the playable layout for a resolved level and an
   * orientation. Holds the world size, the wall position and
   * thickness, the objects with their start positions, the light
   * home, and the target bands for that orientation. */
  function buildLayout(resolvedLevel, orientation) {
    var o = normalOrientation(orientation);
    var level = resolvedLevel;
    var board;
    var wall;
    var objects;
    var i;
    if (!level) return null;
    /* Accept a level identifier as well as a resolved level. */
    if (typeof level === 'string') level = resolveLevel(level, o);
    if (!level) return null;
    /* If the level has not been resolved for this orientation yet,
     * resolve its positions now, without mutating the input. */
    if (level.orientation !== o) level = resolveLevel(level, o);
    if (!level) return null;
    board = (SA.Math && SA.Math.boardSize) ? SA.Math.boardSize(o)
      : (o === 'portrait' ? { width: 720, height: 1280 } : { width: 1280, height: 720 });
    wall = (SA.Math && SA.Math.wall) ? SA.Math.wall(o)
      : (o === 'portrait' ? { position: 1010, thickness: 64, axis: 'y' }
                          : { position: 1080, thickness: 64, axis: 'x' });
    objects = (level.objects || []).map(function (object) {
      return deepCopy(object);
    });
    /* Start positions are the object positions in the resolved
     * level; keep them under both names for callers. */
    for (i = 0; i < objects.length; i++) {
      objects[i].startX = objects[i].x;
      objects[i].startY = objects[i].y;
    }
    var light = level.light || level.lightHomePosition ||
      (level.lightHome && (level.lightHome[o] || level.lightHome.landscape)) || { x: 0, y: 0 };
    var bands = level.targetBands || level.targetsForOrientation ||
      (level.targets && (level.targets[o] || level.targets.landscape)) || [];
    return {
      id: level.id,
      levelId: level.id,
      name: level.name,
      chapter: level.chapter,
      difficulty: level.difficulty || 'normal',
      orientation: o,
      world: { width: board.width, height: board.height },
      worldWidth: board.width,
      worldHeight: board.height,
      width: board.width,
      height: board.height,
      wall: { position: wall.position, thickness: wall.thickness, axis: wall.axis },
      wallPosition: wall.position,
      wallThickness: wall.thickness,
      wallAxis: wall.axis,
      wallX: o === 'landscape' ? wall.position : null,
      wallY: o === 'portrait' ? wall.position : null,
      objects: objects,
      light: deepCopy(light),
      lightHome: deepCopy(light),
      targetBands: deepCopy(bands),
      targets: deepCopy(bands),
      winType: level.winType || 'match',
      winThreshold: isFiniteNumber(level.winThreshold) ? level.winThreshold : 0.9,
      hints: level.hints ? deepCopy(level.hints) : []
    };
  }

  /* Validate level data and report every problem found.
   * Returns { valid, errors, problems } where errors is the list
   * of problem strings (problems is the same list). A level with
   * no problems is valid. */
  function validateLevel(levelOrId) {
    var errors = [];
    var level = levelOrId;
    var i;
    var object;
    var ids;
    var bands;
    var seen;
    if (typeof level === 'string') {
      if (SA.Levels && SA.Levels.getLevel) level = SA.Levels.getLevel(level);
      if (!level) {
        errors.push('unknown level id: ' + levelOrId);
        return { valid: false, errors: errors, problems: errors };
      }
    }
    if (!level || typeof level !== 'object') {
      errors.push('level data is missing or not an object');
      return { valid: false, errors: errors, problems: errors };
    }
    if (!level.id || typeof level.id !== 'string') errors.push('missing level id');
    if (!level.name || typeof level.name !== 'string') errors.push('missing level name');
    if (!isFiniteNumber(level.winThreshold) || level.winThreshold <= 0 || level.winThreshold > 1) {
      errors.push('winThreshold must be a number between 0 and 1');
    }
    if (!Array.isArray(level.objects) || level.objects.length === 0) {
      errors.push('missing objects: level must have at least one object');
    } else {
      ids = {};
      for (i = 0; i < level.objects.length; i++) {
        object = level.objects[i];
        if (!object || typeof object !== 'object') {
          errors.push('object ' + i + ' is missing or not an object');
          continue;
        }
        if (!object.id || typeof object.id !== 'string') {
          errors.push('object ' + i + ' is missing an id');
        } else if (ids[object.id]) {
          errors.push('duplicate object id: ' + object.id);
        } else {
          ids[object.id] = true;
        }
        if (SHAPES.indexOf(shapeKind(object)) === -1) {
          errors.push('object ' + (object.id || i) + ' has unknown shape: ' + (object.shape || object.type));
        }
        if (!isFiniteNumber(object.x)) errors.push('object ' + (object.id || i) + ' is missing a finite x');
        if (!isFiniteNumber(object.y)) errors.push('object ' + (object.id || i) + ' is missing a finite y');
        if (!isFiniteNumber(object.radius)) {
          errors.push('object ' + (object.id || i) + ' is missing a finite radius');
        } else if (object.radius <= 0) {
          errors.push('object ' + (object.id || i) + ' has a non-positive radius: ' + object.radius);
        }
        if (object.rotation !== undefined && !isFiniteNumber(object.rotation)) {
          errors.push('object ' + (object.id || i) + ' has a non-finite rotation');
        }
      }
    }
    if (!level.lightHome || typeof level.lightHome !== 'object') {
      errors.push('missing lightHome');
    } else {
      for (i = 0; i < ORIENTATIONS.length; i++) {
        var home = level.lightHome[ORIENTATIONS[i]];
        if (!home || !isFiniteNumber(home.x) || !isFiniteNumber(home.y)) {
          errors.push('missing light home for orientation: ' + ORIENTATIONS[i]);
        }
      }
    }
    if (!level.targets || typeof level.targets !== 'object') {
      errors.push('missing targets');
    } else {
      for (i = 0; i < ORIENTATIONS.length; i++) {
        bands = level.targets[ORIENTATIONS[i]];
        if (!Array.isArray(bands) || bands.length === 0) {
          errors.push('missing target bands for orientation: ' + ORIENTATIONS[i]);
          continue;
        }
        bands.forEach(function (band, index) {
          if (!band || !isFiniteNumber(band.low) || !isFiniteNumber(band.high)) {
            errors.push('target band ' + index + ' (' + ORIENTATIONS[i] + ') is missing finite low/high');
          } else if (band.low >= band.high) {
            errors.push('target band ' + index + ' (' + ORIENTATIONS[i] + ') has low >= high');
          }
          if (!isFiniteNumber(band.depth) || band.depth <= 0) {
            errors.push('target band ' + index + ' (' + ORIENTATIONS[i] + ') has a non-positive depth');
          }
        });
      }
    }
    if (level.hints !== undefined && !Array.isArray(level.hints)) {
      errors.push('hints must be an array');
    }
    seen = errors.length === 0;
    return { valid: seen, errors: errors, problems: errors };
  }

  SA.Level = {
    STAR_THRESHOLDS: STAR_THRESHOLDS,
    resolveLevel: resolveLevel,
    resolve: resolveLevel,
    buildLayout: buildLayout,
    layout: buildLayout,
    getLayout: buildLayout,
    validateLevel: validateLevel,
    validate: validateLevel,
    starRating: starRating,
    stars: starRating,
    rateStars: starRating,
    starThresholds: starThresholds,
    thresholds: starThresholds,
    getStarThresholds: starThresholds,
    thresholdsFor: starThresholds,
    starsForDifficulty: starsForDifficulty
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
