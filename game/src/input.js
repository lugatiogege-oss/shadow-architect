// Shadow Architect — input (clean-room rebuild, written from SPEC.md only).
// Pointer handling uses Pointer Events only. Dragging moves shapes and the
// light; dragging empty space pans the view while zoomed. The wheel rotates
// the selected shape fifteen degrees per notch (with a modifier key held it
// zooms instead). Two pointers pinch-zoom, clearing any active drag first.
// Escape pauses and resumes; the "1" key resets the view to one times zoom.
(function () {
  'use strict';

  var SA = window.SA || (window.SA = {});
  var ROTATION_STEP = 15; // degrees per wheel notch, button press, or arrow key
  var LIGHT_HIT_RADIUS = 30; // world units around the light centre
  var MIN_ZOOM = 0.5;
  var MAX_ZOOM = 3;

  // --- small helpers -------------------------------------------------------

  function clamp(value, low, high) {
    return value < low ? low : (value > high ? high : value);
  }

  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  // Normalise the view object the game state carries. The view maps world
  // coordinates to canvas pixels: screen = world * scale + offset.
  function viewOf(state) {
    if (!state.view) {
      state.view = { scale: 1, offsetX: 0, offsetY: 0 };
    }
    var view = state.view;
    if (typeof view.scale !== 'number' || !isFinite(view.scale) || view.scale <= 0) {
      view.scale = 1;
    }
    if (typeof view.offsetX !== 'number' || !isFinite(view.offsetX)) { view.offsetX = 0; }
    if (typeof view.offsetY !== 'number' || !isFinite(view.offsetY)) { view.offsetY = 0; }
    return view;
  }

  function objectsOf(state) {
    if (Array.isArray(state.objects)) { return state.objects; }
    if (Array.isArray(state.shapes)) { return state.shapes; }
    return [];
  }

  function lightOf(state) {
    return state.light || null;
  }

  function selectedOf(state) {
    var objects = objectsOf(state);
    if (state.selected) { return state.selected; }
    if (typeof state.selectedIndex === 'number' && objects[state.selectedIndex]) {
      return objects[state.selectedIndex];
    }
    return objects[0] || null;
  }

  function selectObject(state, object) {
    state.selected = object || null;
    var objects = objectsOf(state);
    state.selectedIndex = object ? objects.indexOf(object) : -1;
    if (typeof state.onSelect === 'function') { state.onSelect(object); }
  }

  // --- coordinate conversion ----------------------------------------------

  function screenToWorld(state, canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var view = viewOf(state);
    return {
      x: (clientX - rect.left - view.offsetX) / view.scale,
      y: (clientY - rect.top - view.offsetY) / view.scale
    };
  }

  function worldToScreen(state, canvas, worldX, worldY) {
    var rect = canvas.getBoundingClientRect();
    var view = viewOf(state);
    return {
      x: worldX * view.scale + view.offsetX + rect.left,
      y: worldY * view.scale + view.offsetY + rect.top
    };
  }

  // --- hit testing ---------------------------------------------------------

  function hitShape(state, world) {
    // Topmost first: check objects in reverse draw order.
    var objects = objectsOf(state);
    for (var i = objects.length - 1; i >= 0; i--) {
      var object = objects[i];
      var dx = world.x - object.x;
      var dy = world.y - object.y;
      var radius = object.radius || 0;
      if (dx * dx + dy * dy <= radius * radius) { return object; }
    }
    return null;
  }

  function hitLight(state, world) {
    var light = lightOf(state);
    if (!light) { return false; }
    var dx = world.x - light.x;
    var dy = world.y - light.y;
    return dx * dx + dy * dy <= LIGHT_HIT_RADIUS * LIGHT_HIT_RADIUS;
  }

  // --- move accounting -----------------------------------------------------

  // A drag counts as one move when it actually changes position, counted
  // on release. Rotations count one move at the moment they happen.
  function countMove(state) {
    state.moves = (state.moves || 0) + 1;
    if (typeof state.onMove === 'function') { state.onMove(); }
    refreshMatch(state);
  }

  function refreshMatch(state) {
    if (typeof state.updateMatch === 'function') { state.updateMatch(); }
    if (SA.main && typeof SA.main.refreshMatch === 'function') { SA.main.refreshMatch(); }
  }

  function noteFirstMove(state) {
    if (typeof state.noteFirstMove === 'function') { state.noteFirstMove(); }
  }

  function rotateSelected(state, degrees) {
    var shape = selectedOf(state);
    if (!shape) { return; }
    noteFirstMove(state);
    shape.rotation = ((shape.rotation || 0) + degrees) % 360;
    if (shape.rotation < 0) { shape.rotation += 360; }
    countMove(state);
  }

  function resetView(state, canvas) {
    var view = viewOf(state);
    view.scale = 1;
    view.offsetX = 0;
    view.offsetY = 0;
    /* The main module keeps a separate zoom factor the view is
     * fitted from; reset that too, or the next fit would restore
     * the old zoom instead of one times. */
    if (typeof view.zoom === 'number') { view.zoom = 1; }
    if (typeof state.fitView === 'function') {
      state.fitView(canvas);
    } else if (SA.main && typeof SA.main.fitView === 'function') {
      SA.main.fitView();
    } else if (typeof state.onViewChange === 'function') {
      state.onViewChange();
    }
    if (typeof state.onResetView === 'function') { state.onResetView(); }
  }

  function setZoom(state, canvas, nextScale, anchorClientX, anchorClientY) {
    var view = viewOf(state);
    var rect = canvas.getBoundingClientRect();
    var anchorX = (typeof anchorClientX === 'number') ? anchorClientX - rect.left : rect.width / 2;
    var anchorY = (typeof anchorClientY === 'number') ? anchorClientY - rect.top : rect.height / 2;
    var clamped = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
    // Keep the world point under the anchor fixed while the scale changes.
    var worldX = (anchorX - view.offsetX) / view.scale;
    var worldY = (anchorY - view.offsetY) / view.scale;
    view.scale = clamped;
    view.offsetX = anchorX - worldX * clamped;
    view.offsetY = anchorY - worldY * clamped;
    /* Keep the main module's zoom factor in step with the absolute
     * scale, so a later fit from that factor does not undo the zoom. */
    if (typeof view.baseScale === 'number' && view.baseScale > 0) {
      view.zoom = clamped / view.baseScale;
    }
    if (typeof state.onViewChange === 'function') { state.onViewChange(); }
  }

  // --- the attach operation ------------------------------------------------

  function attach(first, second) {
    // Accept attach(state, canvas) or attach(canvas, state).
    var state = first;
    var canvas = second;
    if (first && first.tagName === 'CANVAS') { canvas = first; state = second; }
    if (!canvas) { canvas = document.getElementById('game-canvas'); }
    if (!state) { state = SA.state || {}; }
    if (!canvas) { return null; }

    // One active drag at a time, tracked by pointer id. A second pointer
    // turns the gesture into a pinch and clears the drag first.
    var drag = null; // { pointerId, kind, target, startX, startY, moved, lastX, lastY, panStartX, panStartY }
    var pointers = new Map(); // pointerId -> { clientX, clientY }
    var pinch = null; // { startDistance, startScale, centreX, centreY }
    var wheelAccumulator = 0;

    function cancelDrag(countIt) {
      if (!drag) { return; }
      var wasDrag = drag;
      drag = null;
      if (countIt && wasDrag.moved && (wasDrag.kind === 'shape' || wasDrag.kind === 'light')) {
        countMove(state);
      }
      if (typeof state.onPointerUp === 'function') { state.onPointerUp(); }
      if (SA.main && typeof SA.main.onPointerUp === 'function') { SA.main.onPointerUp(); }
    }

    function beginPinch() {
      // Pinch zoom clears any active drag first.
      cancelDrag(false);
      var points = Array.from(pointers.values());
      if (points.length < 2) { pinch = null; return; }
      var a = points[0];
      var b = points[1];
      pinch = {
        startDistance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        startScale: viewOf(state).scale,
        centreX: (a.clientX + b.clientX) / 2,
        centreY: (a.clientY + b.clientY) / 2
      };
    }

    function onPointerDown(event) {
      if (state.paused || state.inputLocked) { return; }
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* capture is best-effort */ }
      pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (pointers.size >= 2) { beginPinch(); return; }

      var world = screenToWorld(state, canvas, event.clientX, event.clientY);
      var light = lightOf(state);
      var shape = hitShape(state, world);
      var kind = 'pan';
      var target = null;
      if (light && hitLight(state, world)) {
        kind = 'light';
        target = light;
      } else if (shape) {
        kind = 'shape';
        target = shape;
        selectObject(state, shape);
      }
      var view = viewOf(state);
      drag = {
        pointerId: event.pointerId,
        kind: kind,
        target: target,
        startX: world.x,
        startY: world.y,
        lastX: world.x,
        lastY: world.y,
        moved: false,
        panOffsetX: view.offsetX,
        panOffsetY: view.offsetY,
        panStartClientX: event.clientX,
        panStartClientY: event.clientY
      };
      noteFirstMove(state);
      if (typeof state.onPointerDown === 'function') { state.onPointerDown(kind, target); }
    }

    function onPointerMove(event) {
      if (!pointers.has(event.pointerId)) { return; }
      pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

      if (pinch && pointers.size >= 2) {
        var points = Array.from(pointers.values());
        var a = points[0];
        var b = points[1];
        var distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        if (pinch.startDistance > 0 && distance > 0) {
          setZoom(state, canvas, pinch.startScale * (distance / pinch.startDistance),
            (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        }
        return;
      }
      if (!drag || drag.pointerId !== event.pointerId) { return; }

      var world = screenToWorld(state, canvas, event.clientX, event.clientY);
      if (drag.kind === 'shape' || drag.kind === 'light') {
        var dx = world.x - drag.lastX;
        var dy = world.y - drag.lastY;
        if (dx !== 0 || dy !== 0) { drag.moved = true; }
        drag.target.x += dx;
        drag.target.y += dy;
        drag.lastX = world.x;
        drag.lastY = world.y;
        refreshMatch(state);
      } else if (drag.kind === 'pan') {
        // Empty-space drag pans the view, but only while zoomed in.
        var view = viewOf(state);
        if (view.scale > 1) {
          var panDx = event.clientX - drag.panStartClientX;
          var panDy = event.clientY - drag.panStartClientY;
          if (panDx !== 0 || panDy !== 0) { drag.moved = true; }
          view.offsetX = drag.panOffsetX + panDx;
          view.offsetY = drag.panOffsetY + panDy;
          if (typeof state.onViewChange === 'function') { state.onViewChange(); }
        }
      }
    }

    function onPointerUp(event) {
      pointers.delete(event.pointerId);
      if (pinch) {
        if (pointers.size < 2) { pinch = null; }
        if (drag) { drag = null; }
        return;
      }
      if (drag && drag.pointerId === event.pointerId) {
        // cancelDrag already notifies the game once, on release.
        cancelDrag(true);
      }
    }

    function onPointerCancel(event) {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) { pinch = null; }
      if (drag && drag.pointerId === event.pointerId) { cancelDrag(false); }
    }

    function onWheel(event) {
      if (state.paused || state.inputLocked) { return; }
      event.preventDefault();
      // Wheel with a modifier key zooms; plain wheel rotates the selection.
      if (event.ctrlKey || event.metaKey) {
        var factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        setZoom(state, canvas, viewOf(state).scale * factor, event.clientX, event.clientY);
        return;
      }
      /* One notch is one fifteen-degree step. A wheel event from a
       * mouse carries a whole notch (about a hundred to a hundred
       * and twenty units, depending on the browser), so a whole
       * notch-sized event rotates exactly once: accumulating those
       * units against a fixed notch size would drift, gaining a
       * phantom step every few notches. Small trackpad deltas are
       * still accumulated until they add up to a notch. */
      var dy = event.deltaY;
      if (Math.abs(dy) >= 50) {
        var steps = Math.max(1, Math.round(Math.abs(dy) / 120));
        for (var i = 0; i < steps; i++) {
          rotateSelected(state, dy > 0 ? ROTATION_STEP : -ROTATION_STEP);
        }
        wheelAccumulator = 0;
        return;
      }
      wheelAccumulator += dy;
      while (wheelAccumulator >= 100) {
        rotateSelected(state, ROTATION_STEP);
        wheelAccumulator -= 100;
      }
      while (wheelAccumulator <= -100) {
        rotateSelected(state, -ROTATION_STEP);
        wheelAccumulator += 100;
      }
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (typeof state.togglePause === 'function') {
          state.togglePause();
        } else if (SA.main && typeof SA.main.togglePause === 'function') {
          SA.main.togglePause();
        } else if (SA.ui && typeof SA.ui.togglePause === 'function') {
          SA.ui.togglePause();
        }
        return;
      }
      if (event.key === '1') {
        resetView(state, canvas);
        return;
      }
      if (state.paused || state.inputLocked) { return; }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        rotateSelected(state, -ROTATION_STEP);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        rotateSelected(state, ROTATION_STEP);
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    // On-screen rotate and reset buttons.
    function wireButton(id, handler) {
      var button = document.getElementById(id);
      if (!button) { return; }
      button.addEventListener('click', function (event) {
        event.preventDefault();
        if (state.paused || state.inputLocked) { return; }
        handler();
      });
    }
    wireButton('btn-rotate-left', function () { rotateSelected(state, -ROTATION_STEP); });
    wireButton('btn-rotate-right', function () { rotateSelected(state, ROTATION_STEP); });
    wireButton('btn-reset-view', function () { resetView(state, canvas); });

    var handle = {
      state: state,
      canvas: canvas,
      rotateSelected: function (degrees) { rotateSelected(state, degrees); },
      resetView: function () { resetView(state, canvas); },
      screenToWorld: function (clientX, clientY) { return screenToWorld(state, canvas, clientX, clientY); },
      worldToScreen: function (worldX, worldY) { return worldToScreen(state, canvas, worldX, worldY); },
      detach: function () {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('wheel', onWheel);
        window.removeEventListener('keydown', onKeyDown);
        pointers.clear();
        pinch = null;
        drag = null;
      }
    };
    state.input = handle;
    return handle;
  }

  SA.input = {
    attach: attach,
    rotateSelected: rotateSelected,
    resetView: resetView,
    screenToWorld: screenToWorld,
    worldToScreen: worldToScreen,
    rotationStep: ROTATION_STEP
  };
})();
