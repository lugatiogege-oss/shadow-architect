/* Shadow Architect — geometry.
 *
 * Pure board mathematics only: no screen, no storage, no network.
 * All angles are in degrees, all lengths in world units.
 * A point is { x, y }. An interval is [low, high] with low <= high.
 * An orientation is the string 'landscape' or 'portrait'.
 */
(function (root) {
  'use strict';

  var SA = root.SA || (root.SA = {});

  /* Board size by orientation (spec section 2). */
  var BOARD = {
    landscape: { width: 1280, height: 720 },
    portrait: { width: 720, height: 1280 }
  };

  /* Wall plane by orientation: the coordinate of the wall face the
   * play area looks at, and the wall thickness. */
  var WALL = {
    landscape: { position: 1080, thickness: 64, axis: 'x' },
    portrait: { position: 1010, thickness: 64, axis: 'y' }
  };

  var WIN_THRESHOLD = 0.9;
  var BAND_MATCH_THRESHOLD = 0.85;
  var RING_INNER_RATIO = 0.53;

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function normalOrientation(orientation) {
    return orientation === 'portrait' ? 'portrait' : 'landscape';
  }

  function pointOf(value) {
    if (Array.isArray(value)) {
      return { x: value[0], y: value[1] };
    }
    return { x: value.x, y: value.y };
  }

  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  /* Corner angles (degrees) for each shape kind, relative to rotation.
   * Triangle: rotation - 90, + 30, + 150.
   * Hexagon: rotation + 0, 60, 120, 180, 240, 300.
   * Ring: twelve corners, rotation + 0, 30, ... 330. */
  function cornerAngles(kind, rotation) {
    var angles = [];
    var i;
    if (kind === 'triangle') {
      angles = [rotation - 90, rotation + 30, rotation + 150];
    } else if (kind === 'hexagon') {
      for (i = 0; i < 6; i++) {
        angles.push(rotation + i * 60);
      }
    } else if (kind === 'ring') {
      for (i = 0; i < 12; i++) {
        angles.push(rotation + i * 30);
      }
    } else {
      return null;
    }
    return angles;
  }

  function shapeKind(shape) {
    if (!shape) return '';
    var kind = shape.shape || shape.type || shape.kind || '';
    return String(kind).toLowerCase();
  }

  /* Corners of a shape: points at distance radius from the centre,
   * at the corner angles for the shape kind. */
  function shapeCorners(shape) {
    var kind = shapeKind(shape);
    var rotation = isFiniteNumber(shape.rotation) ? shape.rotation : 0;
    var radius = shape.radius;
    var angles = cornerAngles(kind, rotation);
    var corners = [];
    var i;
    var a;
    if (!angles) return corners;
    for (i = 0; i < angles.length; i++) {
      a = toRadians(angles[i]);
      corners.push({
        x: shape.x + radius * Math.cos(a),
        y: shape.y + radius * Math.sin(a)
      });
    }
    return corners;
  }

  /* Project one point onto the wall along the ray from the light
   * through the point. Returns the wall coordinate (a number), or
   * null when the ray is parallel to the wall or runs away from it.
   * Landscape: the wall is vertical, the result is a wall y.
   * Portrait: the wall is horizontal, the result is a wall x. */
  function projectPoint(light, point, orientation) {
    var o = normalOrientation(orientation);
    var wallAt = WALL[o].position;
    var from = pointOf(light);
    var through = pointOf(point);
    var t;
    if (o === 'landscape') {
      if (through.x === from.x) return null;
      t = (wallAt - from.x) / (through.x - from.x);
      if (!(t > 0)) return null;
      return from.y + t * (through.y - from.y);
    }
    if (through.y === from.y) return null;
    t = (wallAt - from.y) / (through.y - from.y);
    if (!(t > 0)) return null;
    return from.x + t * (through.x - from.x);
  }

  /* Shadow interval of one shape: the smallest and largest wall
   * coordinate among the projections of its corners. Returns
   * [low, high], or null when no corner projects onto the wall. */
  function shadowInterval(shape, light, orientation) {
    var corners = shapeCorners(shape);
    var low = Infinity;
    var high = -Infinity;
    var i;
    var projected;
    for (i = 0; i < corners.length; i++) {
      projected = projectPoint(light, corners[i], orientation);
      if (projected === null || !isFiniteNumber(projected)) continue;
      if (projected < low) low = projected;
      if (projected > high) high = projected;
    }
    if (low === Infinity || high === -Infinity) return null;
    return [low, high];
  }

  /* Shadow intervals for a list of shapes, skipping shapes with
   * no projection. */
  function shadowIntervals(shapes, light, orientation) {
    var out = [];
    var i;
    var interval;
    for (i = 0; i < shapes.length; i++) {
      interval = shadowInterval(shapes[i], light, orientation);
      if (interval) out.push(interval);
    }
    return out;
  }

  function intervalOf(value) {
    if (Array.isArray(value)) return [value[0], value[1]];
    return [value.low, value.high];
  }

  /* Merge a list of intervals into their union: sort by low end,
   * then fold together any intervals that overlap or touch.
   * Null entries are ignored; the result is sorted and disjoint. */
  function mergeIntervals(intervals) {
    var cleaned = [];
    var i;
    var pair;
    var merged;
    var last;
    if (!intervals) return [];
    for (i = 0; i < intervals.length; i++) {
      if (!intervals[i]) continue;
      pair = intervalOf(intervals[i]);
      if (!isFiniteNumber(pair[0]) || !isFiniteNumber(pair[1])) continue;
      cleaned.push([Math.min(pair[0], pair[1]), Math.max(pair[0], pair[1])]);
    }
    cleaned.sort(function (a, b) {
      if (a[0] !== b[0]) return a[0] - b[0];
      return a[1] - b[1];
    });
    merged = [];
    for (i = 0; i < cleaned.length; i++) {
      last = merged[merged.length - 1];
      if (last && cleaned[i][0] <= last[1]) {
        if (cleaned[i][1] > last[1]) last[1] = cleaned[i][1];
      } else {
        merged.push([cleaned[i][0], cleaned[i][1]]);
      }
    }
    return merged;
  }

  function totalLength(union) {
    var total = 0;
    var i;
    for (i = 0; i < union.length; i++) {
      total += Math.max(0, union[i][1] - union[i][0]);
    }
    return total;
  }

  /* Length covered by both unions. */
  function overlapLength(first, second) {
    var i = 0;
    var j = 0;
    var total = 0;
    var low;
    var high;
    while (i < first.length && j < second.length) {
      low = Math.max(first[i][0], second[j][0]);
      high = Math.min(first[i][1], second[j][1]);
      if (high > low) total += high - low;
      if (first[i][1] < second[j][1]) i++;
      else j++;
    }
    return total;
  }

  /* Intersection-over-union of two single intervals. */
  function intervalIoU(first, second) {
    var a = intervalOf(first);
    var b = intervalOf(second);
    var interLow = Math.max(a[0], b[0]);
    var interHigh = Math.min(a[1], b[1]);
    var inter = Math.max(0, interHigh - interLow);
    var union = Math.max(0, a[1] - a[0]) + Math.max(0, b[1] - b[0]) - inter;
    if (union <= 0) return 0;
    return inter / union;
  }

  /* Match of a shadow union against a target: the overlap length
   * divided by the length covered by either union. The inputs may
   * be raw interval lists; each side is merged first. */
  function matchScore(shadow, target) {
    var shadowUnion = mergeIntervals(shadow);
    var targetUnion = mergeIntervals(target);
    var inter = overlapLength(shadowUnion, targetUnion);
    var union = totalLength(shadowUnion) + totalLength(targetUnion) - inter;
    if (union <= 0) return 0;
    return inter / union;
  }

  /* Combined match for a set of shapes and a light against target
   * bands: project every shape, merge, and score against the bands. */
  function matchForShapes(shapes, light, targetBands, orientation) {
    var shadows = shadowIntervals(shapes, light, orientation);
    return matchScore(shadows, targetBands);
  }

  /* Per-band scores: for each target band, the best interval IoU
   * among the shadow intervals, one score per band. */
  function bandScores(shadow, targetBands) {
    var shadows = [];
    var i;
    var j;
    var score;
    var best;
    var out = [];
    if (shadow) {
      for (i = 0; i < shadow.length; i++) {
        if (shadow[i]) shadows.push(intervalOf(shadow[i]));
      }
    }
    if (!targetBands) return out;
    for (i = 0; i < targetBands.length; i++) {
      best = 0;
      for (j = 0; j < shadows.length; j++) {
        score = intervalIoU(shadows[j], targetBands[i]);
        if (score > best) best = score;
      }
      out.push(best);
    }
    return out;
  }

  /* Best band score for one shadow interval against one band. */
  function bandScore(shadow, band) {
    var shadows = Array.isArray(shadow) && shadow.length > 0 &&
      typeof shadow[0] === 'number' ? [shadow] : shadow;
    var scores = bandScores(shadows, [band]);
    return scores.length ? scores[0] : 0;
  }

  /* Best-matching band index for one shadow interval, or -1. */
  function bestBandIndex(shadow, targetBands) {
    var scores = bandScores([shadow], targetBands);
    var best = -1;
    var bestScore = -1;
    var i;
    for (i = 0; i < scores.length; i++) {
      if (scores[i] > bestScore) {
        bestScore = scores[i];
        best = i;
      }
    }
    return best;
  }

  /* Portrait position derived from a landscape position by the
   * scaling rule in section 2: x * 720/1280, y * 1280/720.
   * Sizes and rotations are unchanged. */
  function toPortraitPosition(position) {
    var p = pointOf(position);
    return { x: p.x * 720 / 1280, y: p.y * 1280 / 720 };
  }

  function toLandscapePosition(position) {
    var p = pointOf(position);
    return { x: p.x * 1280 / 720, y: p.y * 720 / 1280 };
  }

  SA.Math = {
    BOARD: BOARD,
    WALL: WALL,
    WIN_THRESHOLD: WIN_THRESHOLD,
    BAND_MATCH_THRESHOLD: BAND_MATCH_THRESHOLD,
    RING_INNER_RATIO: RING_INNER_RATIO,
    boardSize: function (orientation) {
      var o = normalOrientation(orientation);
      return { width: BOARD[o].width, height: BOARD[o].height };
    },
    wall: function (orientation) {
      var o = normalOrientation(orientation);
      return { position: WALL[o].position, thickness: WALL[o].thickness, axis: WALL[o].axis };
    },
    projectPoint: projectPoint,
    shapeCorners: shapeCorners,
    cornerAngles: cornerAngles,
    shadowInterval: shadowInterval,
    shadowIntervals: shadowIntervals,
    mergeIntervals: mergeIntervals,
    unionLength: totalLength,
    overlapLength: overlapLength,
    intervalIoU: intervalIoU,
    matchScore: matchScore,
    matchForShapes: matchForShapes,
    bandScores: bandScores,
    bandScore: bandScore,
    bestBandIndex: bestBandIndex,
    isBandMatched: function (score) { return score >= BAND_MATCH_THRESHOLD; },
    isWin: function (match) { return match >= WIN_THRESHOLD; },
    isAlmost: function (match) { return match >= BAND_MATCH_THRESHOLD && match < WIN_THRESHOLD; },
    toPortraitPosition: toPortraitPosition,
    toLandscapePosition: toLandscapePosition
  };

  /* Aliases using the plainest names, for callers that prefer them. */
  SA.Math.project = projectPoint;
  SA.Math.corners = shapeCorners;
  SA.Math.merge = mergeIntervals;
  SA.Math.match = matchScore;
  SA.Math.union = mergeIntervals;
})(typeof globalThis !== 'undefined' ? globalThis : this);
