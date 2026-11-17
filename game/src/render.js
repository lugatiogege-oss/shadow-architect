/* Shadow Architect — renderer.
   Everything drawn on the canvas lives here: background, wall, target
   silhouette, shadow bars, shapes, light and its cone, ambient drifting
   particles, and the glow around each target band.
   Public surface: SA.render.draw(state) paints one frame, and
   SA.render.startParticles(count) (re)starts the particle field.
   The draw function reads the game state described at the top of draw();
   it never mutates that state. When the math module is present, shadow
   intervals and band scores are taken from it; otherwise the small
   projection helpers below are used as a fallback so a frame can still
   be painted. */
(function () {
  var SA = (typeof window !== 'undefined' && window.SA) || {};
  if (typeof window !== 'undefined') window.SA = SA;

  var MATCHED_AT = 0.85;
  var CLOSE_AT = 0.5;
  var DEFAULT_SHADOW_DEPTH = 92;
  var RING_HOLE_RATIO = 0.53;

  var particles = [];
  var lastTime = 0;

  function toRadians(degrees) { return degrees * Math.PI / 180; }

  /* Fallback projection, used only when SA.Math is not loaded yet. */
  function projectPointFallback(light, point, wallPosition, orientation) {
    if (orientation === 'portrait') {
      var dy = point.y - light.y;
      if (dy === 0) return null;
      var t = (wallPosition - light.y) / dy;
      if (t <= 0) return null;
      return light.x + (point.x - light.x) * t;
    }
    var dx = point.x - light.x;
    if (dx === 0) return null;
    var s = (wallPosition - light.x) / dx;
    if (s <= 0) return null;
    return light.y + (point.y - light.y) * s;
  }

  function shapeCornersFallback(shape) {
    var angles;
    if (shape.shape === 'triangle') {
      angles = [shape.rotation - 90, shape.rotation + 30, shape.rotation + 150];
    } else if (shape.shape === 'hexagon') {
      angles = [0, 60, 120, 180, 240, 300].map(function (a) { return a + shape.rotation; });
    } else {
      angles = [];
      for (var i = 0; i < 12; i++) angles.push(shape.rotation + i * 30);
    }
    return angles.map(function (a) {
      var r = toRadians(a);
      return { x: shape.x + Math.cos(r) * shape.radius, y: shape.y + Math.sin(r) * shape.radius };
    });
  }

  function shadowIntervalFallback(shape, light, wallPosition, orientation) {
    var values = [];
    shapeCornersFallback(shape).forEach(function (corner) {
      var p = projectPointFallback(light, corner, wallPosition, orientation);
      if (p !== null && isFinite(p)) values.push(p);
    });
    if (!values.length) return null;
    return { low: Math.min.apply(null, values), high: Math.max.apply(null, values) };
  }

  function intervalOverlap(aLow, aHigh, bLow, bHigh) {
    return Math.max(0, Math.min(aHigh, bHigh) - Math.max(aLow, bLow));
  }

  function bandScoreFallback(shadow, band) {
    if (!shadow) return 0;
    var inter = intervalOverlap(shadow.low, shadow.high, band.low, band.high);
    var union = Math.max(shadow.high, band.high) - Math.min(shadow.low, band.low);
    return union <= 0 ? 0 : inter / union;
  }

  function startParticles(count) {
    var total = count || 48;
    particles = [];
    for (var i = 0; i < total; i++) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.8 + Math.random() * 1.8,
        speedX: (Math.random() - 0.5) * 0.012,
        speedY: (Math.random() - 0.5) * 0.008,
        cyan: Math.random() < 0.5,
        alpha: 0.15 + Math.random() * 0.35
      });
    }
  }

  function drawParticles(ctx, width, height, now) {
    var dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0.016;
    lastTime = now;
    particles.forEach(function (p) {
      p.x += p.speedX * dt * 10;
      p.y += p.speedY * dt * 10;
      if (p.x < 0) p.x += 1;
      if (p.x > 1) p.x -= 1;
      if (p.y < 0) p.y += 1;
      if (p.y > 1) p.y -= 1;
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.cyan ? '#6fd3e7' : '#f2ead8';
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawShape(ctx, shape, toScreen, isSelected) {
    var corners = shapeCornersFallback(shape);
    var centre = toScreen(shape.x, shape.y);
    var scale = toScreen.scale;
    ctx.save();
    if (isSelected) {
      ctx.shadowColor = '#6fd3e7';
      ctx.shadowBlur = 18;
    }
    ctx.beginPath();
    corners.forEach(function (corner, i) {
      var p = toScreen(corner.x, corner.y);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = shape.color || '#f2ead8';
    ctx.fill();
    if (shape.shape === 'ring') {
      /* Cut the annulus hole with an even-odd inner circle. */
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, shape.radius * scale * RING_HOLE_RATIO, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0e27';
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.lineWidth = isSelected ? 3 : 1.5;
    ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(242, 234, 216, 0.7)';
    ctx.beginPath();
    corners.forEach(function (corner, i) {
      var p = toScreen(corner.x, corner.y);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /* Draw one frame.
     Expected state shape (all world coordinates are in world units):
       {
         orientation: 'landscape' or 'portrait',
         worldWidth: number, worldHeight: number,
         wallPosition: number, wallThickness: number,
         objects: [{ id, shape: 'triangle'|'ring'|'hexagon',
                      x, y, radius, rotation, color }],
         light: { x, y },
         targetBands: [{ low, high, depth }],
         shadows: optional [{ id, low, high }] (computed if absent),
         bandScores: optional [number, ...] aligned with targetBands
                     (computed if absent),
         match: number 0..1,
         selectedId: string or null,
         zoom: number (1 = fitted view),
         view: optional { scale, offsetX, offsetY } (overrides zoom fit),
         winPending: boolean,
         state: string (for example 'playing')
       }
     The canvas is found by id 'game-canvas'. */
  function draw(state) {
    if (!state || typeof document === 'undefined') return;
    var canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var cssWidth = canvas.clientWidth || canvas.width || 720;
    var cssHeight = canvas.clientHeight || canvas.height || 720;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var orientation = state.orientation || 'landscape';
    var portrait = orientation === 'portrait';
    var worldWidth = state.worldWidth || (portrait ? 720 : 1280);
    var worldHeight = state.worldHeight || (portrait ? 1280 : 720);
    var wallPosition = state.wallPosition != null ? state.wallPosition : (portrait ? 1010 : 1080);
    var wallThickness = state.wallThickness || 64;
    var objects = state.objects || [];
    var light = state.light || { x: 185, y: 360 };
    var targetBands = state.targetBands || [];
    var zoom = state.zoom || 1;

    var view = state.view;
    var scale, offsetX, offsetY;
    if (view) {
      scale = view.scale; offsetX = view.offsetX; offsetY = view.offsetY;
    } else {
      var fit = Math.min(cssWidth / worldWidth, cssHeight / worldHeight);
      scale = fit * zoom;
      offsetX = (cssWidth - worldWidth * scale) / 2;
      offsetY = (cssHeight - worldHeight * scale) / 2;
    }
    function toScreen(x, y) {
      return { x: offsetX + x * scale, y: offsetY + y * scale };
    }
    toScreen.scale = scale;

    /* Background: vertical gradient, midnight blue to obsidian. */
    var bg = ctx.createLinearGradient(0, 0, 0, cssHeight);
    bg.addColorStop(0, '#0a0e27');
    bg.addColorStop(1, '#05070f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    /* Faint violet nebula glow. */
    var nebula = ctx.createRadialGradient(cssWidth * 0.7, cssHeight * 0.25, 0, cssWidth * 0.7, cssHeight * 0.25, cssWidth * 0.55);
    nebula.addColorStop(0, 'rgba(157, 141, 241, 0.16)');
    nebula.addColorStop(1, 'rgba(157, 141, 241, 0)');
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    if (!particles.length) startParticles(48);
    drawParticles(ctx, cssWidth, cssHeight, (typeof performance !== 'undefined' ? performance.now() : Date.now()));

    /* Light cone: soft translucent amber spreading toward the wall. */
    var lightScreen = toScreen(light.x, light.y);
    var wallScreen = toScreen(wallPosition, 0);
    var cone = ctx.createLinearGradient(lightScreen.x, lightScreen.y, wallScreen.x, lightScreen.y);
    cone.addColorStop(0, 'rgba(242, 181, 68, 0.20)');
    cone.addColorStop(1, 'rgba(242, 181, 68, 0.02)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    if (portrait) {
      var wallY = toScreen(0, wallPosition).y;
      ctx.moveTo(lightScreen.x, lightScreen.y);
      ctx.lineTo(toScreen(0, wallPosition).x, wallY);
      ctx.lineTo(toScreen(worldWidth, wallPosition).x, wallY);
    } else {
      ctx.moveTo(lightScreen.x, lightScreen.y);
      ctx.lineTo(wallScreen.x, toScreen(0, 0).y);
      ctx.lineTo(wallScreen.x, toScreen(0, worldHeight).y);
    }
    ctx.closePath();
    ctx.fill();

    /* Shadows and band scores, from the math module when available.
     * SA.Math.shadowInterval(shape, light, orientation) returns an
     * array [low, high]; convert it to the { low, high } shape the
     * drawing code below uses. SA.Math.bandScore takes a shadow as
     * an [low, high] array, so pass [shadow.low, shadow.high]. */
    var shadows = state.shadows;
    if (!shadows) {
      shadows = objects.map(function (obj) {
        var interval = null;
        if (SA.Math && SA.Math.shadowInterval) {
          interval = SA.Math.shadowInterval(obj, light, orientation);
        } else {
          interval = shadowIntervalFallback(obj, light, wallPosition, orientation);
        }
        if (Array.isArray(interval)) {
          return { id: obj.id, low: interval[0], high: interval[1] };
        }
        return interval ? { id: obj.id, low: interval.low, high: interval.high } : { id: obj.id, low: 0, high: 0 };
      });
    }
    var bandScores = state.bandScores;
    if (!bandScores) {
      bandScores = targetBands.map(function (band) {
        var best = 0;
        shadows.forEach(function (shadow) {
          var score;
          if (SA.Math && SA.Math.bandScore) {
            score = SA.Math.bandScore([shadow.low, shadow.high], band);
          } else {
            score = bandScoreFallback(shadow, band);
          }
          if (score > best) best = score;
        });
        return best;
      });
    }
    /* Best-matching band per shape, for shadow-bar depth. */
    var shadowDepth = {};
    shadows.forEach(function (shadow) {
      var bestScore = -1, bestDepth = DEFAULT_SHADOW_DEPTH;
      targetBands.forEach(function (band) {
        var score = SA.Math && SA.Math.bandScore
          ? SA.Math.bandScore([shadow.low, shadow.high], band) : bandScoreFallback(shadow, band);
        if (score > bestScore) { bestScore = score; bestDepth = band.depth || DEFAULT_SHADOW_DEPTH; }
      });
      shadowDepth[shadow.id] = bestScore > 0 ? bestDepth : DEFAULT_SHADOW_DEPTH;
    });

    /* Wall: dark violet-grey bar with a lighter edge on the play side. */
    ctx.fillStyle = '#2a2740';
    if (portrait) {
      var wallTop = toScreen(0, wallPosition);
      ctx.fillRect(0, wallTop.y, cssWidth, wallThickness * scale);
      ctx.fillStyle = 'rgba(242, 234, 216, 0.55)';
      ctx.fillRect(0, wallTop.y, cssWidth, 2);
    } else {
      ctx.fillRect(wallScreen.x, 0, wallThickness * scale, cssHeight);
      ctx.fillStyle = 'rgba(242, 234, 216, 0.55)';
      ctx.fillRect(wallScreen.x, 0, 2, cssHeight);
    }

    /* Target bands with glow: cyan when matched, amber when close. */
    targetBands.forEach(function (band, i) {
      var score = bandScores[i] || 0;
      var matched = score >= MATCHED_AT;
      var close = !matched && score >= CLOSE_AT;
      var glow = matched ? '#6fd3e7' : (close ? '#f2b544' : null);
      var rect;
      if (portrait) {
        var a = toScreen(band.low, wallPosition);
        var b = toScreen(band.high, wallPosition);
        rect = { x: a.x, y: a.y, w: b.x - a.x, h: (band.depth || DEFAULT_SHADOW_DEPTH) * scale };
      } else {
        var c = toScreen(wallPosition, band.low);
        var d = toScreen(wallPosition, band.high);
        rect = { x: c.x, y: c.y, w: (band.depth || DEFAULT_SHADOW_DEPTH) * scale, h: d.y - c.y };
      }
      if (glow) {
        ctx.save();
        ctx.shadowColor = glow;
        ctx.shadowBlur = 22;
        ctx.fillStyle = glow;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
      }
      ctx.fillStyle = '#f2ead8';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    });

    /* Shadow bars: dark translucent, over the target where they overlap. */
    shadows.forEach(function (shadow) {
      var depth = shadowDepth[shadow.id] || DEFAULT_SHADOW_DEPTH;
      ctx.fillStyle = 'rgba(5, 7, 15, 0.55)';
      if (portrait) {
        var a = toScreen(shadow.low, wallPosition);
        var b = toScreen(shadow.high, wallPosition);
        ctx.fillRect(a.x, a.y, b.x - a.x, depth * scale);
      } else {
        var c = toScreen(wallPosition, shadow.low);
        var d = toScreen(wallPosition, shadow.high);
        ctx.fillRect(c.x, c.y, depth * scale, d.y - c.y);
      }
    });

    /* Shapes. */
    objects.forEach(function (obj) {
      drawShape(ctx, obj, toScreen, obj.id === state.selectedId);
    });

    /* Light: bright amber core with a radial glow. */
    var glowRadius = 46 * scale;
    var lightGlow = ctx.createRadialGradient(lightScreen.x, lightScreen.y, 0, lightScreen.x, lightScreen.y, glowRadius);
    lightGlow.addColorStop(0, 'rgba(242, 181, 68, 0.85)');
    lightGlow.addColorStop(1, 'rgba(242, 181, 68, 0)');
    ctx.fillStyle = lightGlow;
    ctx.beginPath();
    ctx.arc(lightScreen.x, lightScreen.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2b544';
    ctx.beginPath();
    ctx.arc(lightScreen.x, lightScreen.y, Math.max(4, 7 * scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(lightScreen.x, lightScreen.y, Math.max(2, 3 * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  SA.render = { draw: draw, startParticles: startParticles };
})();
