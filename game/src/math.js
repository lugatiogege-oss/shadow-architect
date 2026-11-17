/* SHADOW ARCHITECT — point-light shadow math (pure, no DOM).
   A point light shines past each polygon vertex onto a wall line.
   The ray from the light through a vertex meets the wall at one
   "along-wall" coordinate; an object's shadow is the span between
   its lowest and highest projected vertices. The whole scene's
   shadow is the union of the objects' spans, and the match score
   is the intersection-over-union of that shadow against the
   target silhouette bands.
   Works in the browser as SA.Math and under Node as module.exports.
   Landscape: wall is a vertical line x = wall, spans run along y.
   Portrait:  wall is a horizontal line y = wall, spans run along x.
*/
var SA = (typeof SA !== 'undefined') ? SA : {};
SA.Math = (function () {
  'use strict';

  // Unit-radius vertex templates, counter-clockwise. The ring's hole
  // is only visual: it never changes the projected interval.
  var SHAPES = {
    triangle: { verts: [[0, -1], [0.866, 0.5], [-0.866, 0.5]], hole: 0 },
    ring: { verts: regularVerts(12, -Math.PI / 2), hole: 0.53 },
    hexagon: { verts: regularVerts(6, 0), hole: 0 }
  };

  function regularVerts(n, startAngle) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = startAngle + (i / n) * Math.PI * 2;
      out.push([Math.cos(a), Math.sin(a)]);
    }
    return out;
  }

  // Rotate + scale a shape's template and move it to the object's
  // centre, giving world-space vertices for {shape, cx, cy, r, rotDeg}.
  function worldVertices(obj) {
    var def = SHAPES[obj.shape];
    var rad = (obj.rotDeg || 0) * Math.PI / 180;
    var c = Math.cos(rad), s = Math.sin(rad);
    var out = [];
    for (var i = 0; i < def.verts.length; i++) {
      var lx = def.verts[i][0] * obj.r, ly = def.verts[i][1] * obj.r;
      out.push({
        x: obj.cx + lx * c - ly * s,
        y: obj.cy + lx * s + ly * c
      });
    }
    return out;
  }

  // Where the ray from light L through vertex V meets the wall line.
  // Returns the along-wall coordinate, or null when the ray runs
  // away from the wall (or parallel to it) and never arrives.
  function projectPoint(L, V, layout) {
    if (layout.axis === 'x') {
      var dx = V.x - L.x;
      if (dx <= 0.001) return null;
      var t = (layout.wall - L.x) / dx;
      if (t <= 0) return null;
      return L.y + t * (V.y - L.y);
    }
    var dy = V.y - L.y;
    if (dy <= 0.001) return null;
    var t2 = (layout.wall - L.y) / dy;
    if (t2 <= 0) return null;
    return L.x + t2 * (V.x - L.x);
  }

  // One object's shadow on the wall: [min, max] over its projected
  // vertices, or null when no vertex projects onto the wall.
  function shadowInterval(obj, light, layout) {
    var verts = worldVertices(obj);
    var lo = Infinity, hi = -Infinity, count = 0;
    for (var i = 0; i < verts.length; i++) {
      var p = projectPoint(light, verts[i], layout);
      if (p === null) continue;
      count++;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    return count === 0 ? null : [lo, hi];
  }

  // Clip an interval to a span; null when nothing survives the clip.
  function clampInterval(iv, span) {
    if (!iv) return null;
    var lo = Math.max(iv[0], span[0]), hi = Math.min(iv[1], span[1]);
    return hi <= lo ? null : [lo, hi];
  }

  // Merge a set of intervals (sorted, non-overlapping) and return
  // the merged list. Null/empty entries are dropped.
  function mergeIntervals(intervals) {
    var ivs = [];
    for (var i = 0; i < intervals.length; i++) {
      if (intervals[i]) ivs.push(intervals[i].slice());
    }
    if (!ivs.length) return [];
    ivs.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [ivs[0]];
    for (var j = 1; j < ivs.length; j++) {
      var cur = merged[merged.length - 1];
      if (ivs[j][0] <= cur[1]) {
        if (ivs[j][1] > cur[1]) cur[1] = ivs[j][1];
      } else {
        merged.push(ivs[j]);
      }
    }
    return merged;
  }

  // Total length covered by a set of intervals (overlaps counted once).
  function unionLength(intervals) {
    var merged = mergeIntervals(intervals);
    var total = 0;
    for (var i = 0; i < merged.length; i++) total += merged[i][1] - merged[i][0];
    return total;
  }

  // Length covered by both interval sets at once (pairwise overlap,
  // merged so shared ground is counted once).
  function intersectionLength(a, b) {
    var inter = [];
    for (var m = 0; m < a.length; m++) {
      if (!a[m]) continue;
      for (var n = 0; n < b.length; n++) {
        if (!b[n]) continue;
        var lo = Math.max(a[m][0], b[n][0]);
        var hi = Math.min(a[m][1], b[n][1]);
        if (hi > lo) inter.push([lo, hi]);
      }
    }
    return unionLength(inter);
  }

  // Overall match 0..1: IoU of the shadow union vs the target union
  // (shared length divided by combined length). 0 when either side
  // covers nothing.
  function matchScore(shadowIntervals, targetIntervals) {
    var inter = intersectionLength(shadowIntervals, targetIntervals);
    var uni = unionLength(shadowIntervals.concat(targetIntervals));
    if (uni <= 0) return 0;
    return inter / uni;
  }

  // Per-band score 0..1: for each target band, the best single
  // object's interval IoU against that band. Deliberately NOT union
  // coverage: at the level start the triangle and hexagon shadows
  // together happen to cover band 3 completely while neither fits
  // it alone (best ~0.69), so union coverage would light the band
  // before the player has done anything. A band only glows when one
  // object is really casting (nearly) that silhouette. Callers
  // treat >= 0.85 as matched.
  function bandScores(shadowIntervals, targetIntervals) {
    var out = [];
    for (var i = 0; i < targetIntervals.length; i++) {
      var band = targetIntervals[i];
      var best = 0;
      for (var j = 0; j < shadowIntervals.length; j++) {
        var iv = shadowIntervals[j];
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

  function dist(x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Ray-cast point-in-polygon, for click/tap selection of objects.
  function pointInPoly(px, py, verts) {
    var inside = false;
    for (var i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      var xi = verts[i].x, yi = verts[i].y, xj = verts[j].x, yj = verts[j].y;
      if (((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  var api = {
    SHAPES: SHAPES,
    worldVertices: worldVertices,
    projectPoint: projectPoint,
    shadowInterval: shadowInterval,
    // Aliases kept for callers using the alternate names.
    objectInterval: shadowInterval,
    projectObject: shadowInterval,
    clampInterval: clampInterval,
    unionLength: unionLength,
    intersectionLength: intersectionLength,
    mergeIntervals: mergeIntervals,
    unionIntervals: mergeIntervals,
    matchScore: matchScore,
    computeMatch: matchScore,
    bandScores: bandScores,
    dist: dist,
    pointInPoly: pointInPoly
  };
  return api;
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SA.Math;
