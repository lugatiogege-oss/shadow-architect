/* SHADOW ARCHITECT — Canvas 2D renderer.
   Paints the observatory: the dark room, the amber point light and its
   cone, the three draggable objects, their live shadows on the wall,
   the ivory target silhouette with per-band match feedback, dust motes
   and a vignette. No assets, no network, no fonts fetched remotely.
   The controller owns canvas sizing (devicePixelRatio) and hands us a
   view transform (tx/ty/scale) for pinch zoom; we only draw in stage
   coordinates. shadowBlur is used sparingly — one glow pass on matched
   target bands only — so a frame stays cheap. */
var SA = (typeof SA !== 'undefined') ? SA : {};
SA.Render = (function () {
  'use strict';

  var PAL = {
    bgTop: '#131a3a', bgBot: '#0b1026', obsidian: '#0d0f1a',
    wall: '#1a1f38', wallEdge: '#2c3464', violet: '#9d8df1',
    ivory: '#f2ead8', cyan: '#6fd3e7', amber: '#e8b25c',
    dim: '#8b93b8'
  };

  /* Band feedback thresholds. A band whose shadow covers at least 85% of
     it is "almost there" (warm amber tint); at 90% it is matched and
     lights up solid cyan. Callers may pass per-band IoU numbers in
     state.bandIoU; when only the boolean state.bandMatched array is
     supplied, true counts as matched. */
  var ALMOST_IOU = 0.85;
  var MATCH_IOU = 0.90;

  function bandState(state, i) {
    if (state.bandIoU && typeof state.bandIoU[i] === 'number') {
      if (state.bandIoU[i] >= MATCH_IOU) return 'matched';
      if (state.bandIoU[i] >= ALMOST_IOU) return 'almost';
      return 'open';
    }
    if (state.bandMatched && state.bandMatched[i]) return 'matched';
    return 'open';
  }

  /* Dust motes drifting inside the light cone. A tiny deterministic
     generator keeps the field stable between loads. */
  var particles = [];
  function initParticles(seed) {
    particles = [];
    var s = seed || 12345;
    function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    for (var i = 0; i < 36; i++) {
      particles.push({
        u: rnd(), v: rnd(),
        r: 0.8 + rnd() * 1.8,
        sp: 0.00008 + rnd() * 0.00025,
        tw: rnd() * 6.28
      });
    }
  }
  initParticles(20261116);

  /* Top-level frame: clear, apply the view transform, paint back to
     front, restore. Signature matches the controller's call. */
  function draw(state, ctx, layout, view, timeMs) {
    var W = layout.W, H = layout.H;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    drawRoom(ctx, layout);
    drawLightCone(ctx, state, layout);
    drawTarget(ctx, layout, state);
    drawShadows(ctx, state, layout);
    drawObjects(ctx, state, layout);
    drawLight(ctx, state, layout, timeMs);
    drawParticles(ctx, state, layout, timeMs);
    drawVignette(ctx, layout);
    ctx.restore();
  }

  /* The room: vertical midnight gradient, floor/ceiling lines, the wall
     panel the shadows land on, a soft ambient-occlusion falloff at the
     wall edge, and faint platform lines on the open floor. */
  function drawRoom(ctx, layout) {
    var W = layout.W, H = layout.H;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PAL.bgTop);
    g.addColorStop(1, PAL.bgBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(157,141,241,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H - 26); ctx.lineTo(W, H - 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 26); ctx.lineTo(W, 26); ctx.stroke();

    var span = layout.wallSpan[1] - layout.wallSpan[0];
    ctx.fillStyle = PAL.wall;
    ctx.strokeStyle = PAL.wallEdge;
    ctx.lineWidth = 2;
    if (layout.axis === 'x') {
      ctx.fillRect(layout.wall, layout.wallSpan[0] - 18, layout.wallThick + 40, span + 36);
      ctx.strokeRect(layout.wall, layout.wallSpan[0] - 18, layout.wallThick + 40, span + 36);
      var ao = ctx.createLinearGradient(layout.wall - 90, 0, layout.wall, 0);
      ao.addColorStop(0, 'rgba(0,0,0,0)');
      ao.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = ao;
      ctx.fillRect(layout.wall - 90, layout.wallSpan[0] - 18, 90, span + 36);
    } else {
      ctx.fillRect(layout.wallSpan[0] - 18, layout.wall, span + 36, layout.wallThick + 40);
      ctx.strokeRect(layout.wallSpan[0] - 18, layout.wall, span + 36, layout.wallThick + 40);
      var ao2 = ctx.createLinearGradient(0, layout.wall - 90, 0, layout.wall);
      ao2.addColorStop(0, 'rgba(0,0,0,0)');
      ao2.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = ao2;
      ctx.fillRect(layout.wallSpan[0] - 18, layout.wall - 90, span + 36, 90);
    }

    ctx.strokeStyle = 'rgba(111,211,231,0.10)';
    ctx.lineWidth = 1;
    for (var i = 0; i < 4; i++) {
      var y = H - 90 - i * 26;
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(layout.axis === 'x' ? 320 : W - 40, y);
      ctx.stroke();
    }
  }

  /* The light cone: a soft amber wash from the fixture to the wall span,
     drawn additively so it brightens rather than covers the room. */
  function drawLightCone(ctx, state, layout) {
    var L = state.light;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g;
    if (layout.axis === 'x') {
      g = ctx.createLinearGradient(L.x, 0, layout.wall, 0);
      g.addColorStop(0, 'rgba(232,178,92,0.20)');
      g.addColorStop(1, 'rgba(232,178,92,0.02)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(L.x, L.y);
      ctx.lineTo(layout.wall, layout.wallSpan[0]);
      ctx.lineTo(layout.wall, layout.wallSpan[1]);
      ctx.closePath();
      ctx.fill();
    } else {
      g = ctx.createLinearGradient(0, L.y, 0, layout.wall);
      g.addColorStop(0, 'rgba(232,178,92,0.20)');
      g.addColorStop(1, 'rgba(232,178,92,0.02)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(L.x, L.y);
      ctx.lineTo(layout.wallSpan[0], layout.wall);
      ctx.lineTo(layout.wallSpan[1], layout.wall);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* A target band's rectangle on the wall, oriented by the layout axis. */
  function targetBarRect(layout, band, width) {
    if (layout.axis === 'x') {
      return { x: layout.wall + 6, y: band[0], w: width, h: band[1] - band[0] };
    }
    return { x: band[0], y: layout.wall + 6, w: band[1] - band[0], h: width };
  }

  /* The ivory target silhouette: one rounded bar per band. Unmatched
     bands stay dashed ivory; a band at 85–89% IoU warms to an amber
     "almost" tint; a matched band (>= 90%) turns solid cyan with a
     single soft glow. The feedback only ever reflects the live shadow —
     it never reveals a solution. */
  function drawTarget(ctx, layout, state) {
    ctx.save();
    for (var i = 0; i < layout.target.length; i++) {
      var r = targetBarRect(layout, layout.target[i], layout.targetWidths[i]);
      var st = bandState(state, i);
      if (st === 'matched') {
        ctx.setLineDash([]);
        ctx.shadowColor = 'rgba(111,211,231,0.9)';
        ctx.shadowBlur = 12;
        ctx.fillStyle = 'rgba(111,211,231,0.38)';
        ctx.strokeStyle = 'rgba(111,211,231,0.95)';
        ctx.lineWidth = 2.5;
        roundRect(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (st === 'almost') {
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(232,178,92,0.30)';
        ctx.strokeStyle = 'rgba(232,178,92,0.9)';
        ctx.lineWidth = 2;
        roundRect(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = 'rgba(242,234,216,0.85)';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(242,234,216,0.07)';
        roundRect(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(242,234,216,0.55)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    if (layout.axis === 'x') ctx.fillText('TARGET', layout.wall + 52, layout.wallSpan[1] + 32);
    else ctx.fillText('TARGET', layout.W / 2, layout.wall - 28);
    ctx.restore();
  }

  /* Live shadows: each object's projected interval (SA.Math) is clamped
     to the wall span and painted as a dark bar with a cyan rim. No
     shadowBlur here — the rim carries the edge and the frame stays fast. */
  function drawShadows(ctx, state, layout) {
    ctx.save();
    for (var i = 0; i < state.objects.length; i++) {
      var iv = SA.Math.shadowInterval(state.objects[i], state.light, layout);
      if (!iv) continue;
      iv = SA.Math.clampInterval(iv, layout.wallSpan);
      if (!iv) continue;
      var width = layout.targetWidths[i % layout.targetWidths.length] - 26;
      var r = targetBarRect(layout, [iv[0], iv[1]], width);
      ctx.fillStyle = 'rgba(5,7,16,0.88)';
      roundRect(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(111,211,231,0.65)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* The three objects: filled polygons from SA.Math.worldVertices, in
     their level colours. The selected object gets a brighter outline, a
     centre dot and a dashed orbit ring; rings get their hollow centre
     punched back out in the background colour. */
  function drawObjects(ctx, state, layout) {
    for (var i = 0; i < state.objects.length; i++) {
      var o = state.objects[i];
      var verts = SA.Math.worldVertices(o);
      var selected = state.selectedId === o.id;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (var j = 1; j < verts.length; j++) ctx.lineTo(verts[j].x, verts[j].y);
      ctx.closePath();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = o.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeStyle = selected ? PAL.cyan : 'rgba(13,15,26,0.9)';
      ctx.stroke();
      if (o.shape === 'ring') {
        ctx.beginPath();
        ctx.arc(o.cx, o.cy, o.r * 0.53, 0, Math.PI * 2);
        ctx.fillStyle = PAL.bgBot;
        ctx.fill();
        ctx.strokeStyle = 'rgba(13,15,26,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (selected) {
        ctx.beginPath();
        ctx.arc(o.cx, o.cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = PAL.cyan;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(o.cx, o.cy, o.r + 10, 0, Math.PI * 2);
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(111,211,231,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  /* The point light: a ceiling/wall mount line, a pulsing radial glow,
     the fixture body with an amber core, and a dashed selection ring
     when the light itself is selected. */
  function drawLight(ctx, state, layout, timeMs) {
    var L = state.light;
    var pulse = 1 + 0.05 * Math.sin(timeMs / 450);
    ctx.save();
    ctx.strokeStyle = 'rgba(242,234,216,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (layout.axis === 'x') { ctx.moveTo(L.x, 26); ctx.lineTo(L.x, L.y - 16); }
    else { ctx.moveTo(40, L.y); ctx.lineTo(L.x - 16, L.y); }
    ctx.stroke();

    var g = ctx.createRadialGradient(L.x, L.y, 2, L.x, L.y, 70 * pulse);
    g.addColorStop(0, 'rgba(232,178,92,0.85)');
    g.addColorStop(0.25, 'rgba(232,178,92,0.28)');
    g.addColorStop(1, 'rgba(232,178,92,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.x, L.y, 70 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(L.x, L.y, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2f4a';
    ctx.fill();
    ctx.strokeStyle = PAL.amber;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(L.x, L.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = PAL.amber;
    ctx.fill();
    if (state.selectedId === 'light') {
      ctx.beginPath();
      ctx.arc(L.x, L.y, 26, 0, Math.PI * 2);
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = PAL.cyan;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /* Dust motes: each particle interpolates along the cone (u) and across
     it (v), widening with distance from the light, with a slow twinkle
     and a gentle sinusoidal drift. */
  function drawParticles(ctx, state, layout, timeMs) {
    var L = state.light;
    var span = layout.wallSpan[1] - layout.wallSpan[0];
    ctx.save();
    ctx.fillStyle = 'rgba(242,234,216,0.5)';
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var tw = 0.35 + 0.65 * Math.abs(Math.sin(timeMs / 900 + p.tw));
      var drift = Math.sin(timeMs * p.sp + i) * 4;
      var across = (p.v - 0.5) * span * (0.15 + 0.85 * p.u);
      ctx.globalAlpha = 0.5 * tw * 0.6;
      ctx.beginPath();
      if (layout.axis === 'x') {
        ctx.arc(L.x + p.u * (layout.wall - L.x), L.y + across + drift, p.r, 0, Math.PI * 2);
      } else {
        ctx.arc(L.x + across + drift, L.y + p.u * (layout.wall - L.y), p.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  /* Soft darkening toward the corners so the lit centre holds focus. */
  function drawVignette(ctx, layout) {
    var g = ctx.createRadialGradient(
      layout.W / 2, layout.H / 2, Math.min(layout.W, layout.H) * 0.42,
      layout.W / 2, layout.H / 2, Math.max(layout.W, layout.H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, layout.W, layout.H);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { draw: draw, initParticles: initParticles, PAL: PAL };
})();
