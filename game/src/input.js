/* SHADOW ARCHITECT — pointer + wheel + keyboard input.
   All pointing goes through Pointer Events (mouse and touch unified);
   there are no separate mouse/touch listeners. Every in-game change
   originates from a genuine user gesture. */
var SA = (typeof SA !== 'undefined') ? SA : {};
SA.Input = (function () {
  'use strict';
  var M = SA.Math;

  function attach(canvas, game) {
    var live = new Map(); // pointerId -> {x, y} in canvas CSS pixels
    var drag = null;      // {kind, id, grabDX, grabDY, moved} while dragging
    var pinch = null;     // {d0, scale0, tx0, ty0, midX, midY} while pinching

    function toCanvas(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // Topmost object first: inside its polygon, or near its centre.
    // The light is only hit by radius, after all objects have missed.
    function pick(wx, wy) {
      var st = game.state;
      var i, o, verts;
      for (i = st.objects.length - 1; i >= 0; i--) {
        o = st.objects[i];
        verts = M.worldVertices(o);
        if (M.pointInPoly(wx, wy, verts)) return { kind: 'object', id: o.id };
        if (M.dist(wx, wy, o.cx, o.cy) <= o.r + 6) return { kind: 'object', id: o.id };
      }
      if (M.dist(wx, wy, st.light.x, st.light.y) <= 30) return { kind: 'light', id: 'light' };
      return null;
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (game.screen !== 'playing') return;
      // Once a win is confirmed, the 650 ms window before the complete
      // screen appears accepts no new movement input.
      if (game.state && game.state.won) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      var p = toCanvas(e);
      live.set(e.pointerId, p);
      SA.Audio.ensure();
      if (live.size === 2) {
        // Second finger down: pinch takes over, any drag ends first.
        // The drag is cleared BEFORE endDrag() runs, so the release
        // re-evaluation sees no active drag and can confirm a win.
        var wasMoved = drag && drag.moved;
        drag = null;
        if (wasMoved) game.endDrag();
        var pts = Array.from(live.values());
        pinch = {
          d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          scale0: game.view.scale, tx0: game.view.tx, ty0: game.view.ty,
          midX: (pts[0].x + pts[1].x) / 2, midY: (pts[0].y + pts[1].y) / 2
        };
        return;
      }
      var w = game.screenToWorld(p.x, p.y);
      var hit = pick(w.x, w.y);
      if (hit) {
        game.select(hit.id);
        var gx, gy;
        if (hit.kind === 'object') {
          var o = game.getObject(hit.id);
          gx = w.x - o.cx; gy = w.y - o.cy;
        } else {
          gx = w.x - game.state.light.x; gy = w.y - game.state.light.y;
        }
        drag = { kind: hit.kind, id: hit.id, grabDX: gx, grabDY: gy, moved: false };
      } else {
        game.select(null);
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!live.has(e.pointerId)) return;
      var p = toCanvas(e);
      live.set(e.pointerId, p);
      if (pinch && live.size === 2) {
        var pts = Array.from(live.values());
        var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        var midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;
        if (pinch.d0 > 0 && d > 0) game.zoomBy(pinch.scale0 * d / pinch.d0, midX, midY, pinch);
        return;
      }
      if (!drag) return;
      // A drag still in flight when a win is confirmed (e.g. via a
      // rotate button mid-drag) must not keep moving things during
      // the 650 ms confirmation window.
      if (game.state && game.state.won) return;
      var w = game.screenToWorld(p.x, p.y);
      var nx = w.x - drag.grabDX, ny = w.y - drag.grabDY;
      if (drag.kind === 'object') game.moveObject(drag.id, nx, ny);
      else game.moveLight(nx, ny);
      drag.moved = true;
    });

    // pointerup and pointercancel share this path: the drag is cleared
    // BEFORE endDrag() re-evaluates the final position, so checkWin
    // sees "no drag active" instead of deferring to winPending.
    function endPointer(e) {
      if (live.has(e.pointerId)) live.delete(e.pointerId);
      if (pinch && live.size < 2) pinch = null;
      if (drag && e.pointerId !== undefined) {
        var moved = drag.moved;
        drag = null;
        if (moved) game.endDrag();
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener('wheel', function (e) {
      if (game.screen !== 'playing') return;
      e.preventDefault();
      var st = game.state;
      if (!st.selectedId || st.selectedId === 'light') return;
      var steps = Math.round(e.deltaY / 120) || (e.deltaY > 0 ? 1 : -1);
      game.rotateSelected(steps * 15); // 15 degrees per wheel notch
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (game.screen === 'playing') {
        var st = game.state;
        var step = e.shiftKey ? 10 : 2;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
            e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (!st.selectedId || st.selectedId === 'light') return;
          var dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          var dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          game.nudgeSelected(dx, dy);
        } else if (e.key === 'r' || e.key === 'R') {
          game.resetLevel();
        } else if (e.key === 'Escape') {
          game.togglePause();
        } else if (e.key === 'f' || e.key === 'F') {
          game.toggleFullscreen();
        } else if (e.key === '1') {
          if (game.resetZoom) game.resetZoom();
        }
      } else if (game.screen === 'paused' && e.key === 'Escape') {
        game.togglePause();
      }
    });

    return {
      activePointers: function () { return live.size; },
      pinchActive: function () { return !!pinch; },
      // The one seam main.js needs: is an object/light drag active
      // right now? A press without movement still counts as a drag
      // here, which is why main.js asks this module instead of
      // tracking drag state itself.
      isDragging: function () { return !!drag; }
    };
  }

  return { attach: attach };
})();
