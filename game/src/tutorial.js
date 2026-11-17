/* SHADOW ARCHITECT — interactive first-time tutorial.
   Teaches the three verbs (drag an object, rotate, drag the light),
   matching the shadow to the silhouette, and the 90% goal, on the
   player's FIRST entry into Chapter I. Short, dismissible, never
   traps the player: steps 1-3 advance on the REAL action OR a Next
   button; steps 4-5 advance via Next / Got it only. Highlights
   follow the objects'/light's CURRENT positions via
   game.tutorialProbe() (never hardcoded, never the solution) and a
   rAF loop while the tutorial is active.
   NO-LEAK: copy and highlights never reveal final positions, angles,
   or a solved state. The only number in the step copy is the 90% goal.
   No mechanic, zoom, audio, or level-data change. Loaded after ui.js,
   before main.js; main.js drives it (startFresh trigger, action hooks
   in moveObject/moveLight/rotateSelected, replay from pause/settings).
   DOM skeleton lives in index.html (#tutorial); styles in styles.css. */
var SA = (typeof SA !== 'undefined') ? SA : {};
SA.Tutorial = (function () {
  'use strict';
  var game = null;
  var active = false, step = 0; // step: 1..5 while active, 0 when idle
  var encouraged = false;       // one-time encouragement toast per run
  var rafId = null;
  var el = {};

  // Step copy — English, game voice, matching the existing hints.
  // No final positions, no angles, no "move X to..." — only the verbs
  // and the 90% goal.
  var STEPS = [
    null, // 1-based
    { label: 'First light · 1 of 5', next: 'Next',
      text: 'Drag an object — grab any shape and move it. Watch its shadow move on the wall.' },
    { label: 'First light · 2 of 5', next: 'Next',
      text: 'Rotate — tap an object to select it, then tap ◀ ▶ to turn it.' },
    { label: 'First light · 3 of 5', next: 'Next',
      text: 'Drag the light — move it closer to an object and its shadow grows.' },
    { label: 'First light · 4 of 5', next: 'Next',
      text: 'Match your shadow to the ivory silhouette on the wall.' },
    { label: 'First light · 5 of 5', next: 'Got it',
      text: 'The % is your shadow against the ivory silhouette. Reach 90% to win.' }
  ];

  function $(id) { return document.getElementById(id); }
  function appRect() { var a = $('app'); return a ? a.getBoundingClientRect() : { left: 0, top: 0 }; }

  function init(g) {
    game = g;
    el.overlay = $('tutorial');
    el.rings = $('tut-rings');
    el.card = $('tut-card');
    el.label = $('tut-step-label');
    el.text = $('tut-text');
    el.next = $('tut-next');
    el.skip = $('tut-skip');
    if (el.next) el.next.addEventListener('click', function () { next(); });
    if (el.skip) el.skip.addEventListener('click', function () { skip(); });
  }

  function markSeen() {
    if (!game) return;
    game.settings.tutorialSeen = true;
    game.saveSettings();
  }
  function seen() { return !!(game && game.settings.tutorialSeen); }

  // Start (or restart) the tutorial. force=true is the Replay path
  // (pause/settings buttons) — it ignores the seen flag.
  function start(force) {
    if (!game || !el.overlay) return false;
    if (!force && seen()) return false;
    if (game.screen !== 'playing') return false;
    active = true; step = 1; encouraged = false;
    el.overlay.classList.remove('hidden');
    // General tutorial-visible class on #app, so the short-landscape
    // rule can dock the touch bar at the top for ALL steps (the
    // step-2-only class covers step 2 alone). Removed in stop().
    var app = $('app');
    if (app) app.classList.add('tut-active');
    showStep();
    if (!rafId) rafId = requestAnimationFrame(tick);
    return true;
  }

  function stop() {
    active = false; step = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (el.overlay) el.overlay.classList.add('hidden');
    var app = $('app');
    if (app) app.classList.remove('tut-show-rot');
    if (app) app.classList.remove('tut-active');
  }

  // Finish via Got it / completing the last step: never show again.
  function finish() { markSeen(); stop(); }
  // Skip: seen, back to normal play, game state untouched.
  function skip() { markSeen(); stop(); }

  function next() {
    if (!active) return;
    if (step >= 5) { finish(); return; }
    step++;
    showStep();
  }

  // Advance when the player does the real action. Called from main.js
  // (moveObject / moveLight / rotateSelected) — i.e. only on a genuine
  // drag or rotate, never on reset / level load / orientation remap.
  // Steps 1-3 advance on the real action; steps 4-5 advance via
  // Next / Got it only (matching the silhouette and the goal are
  // things to understand, not actions to perform on cue).
  function notify(kind) {
    if (!active) return;
    if (kind === 'object-drag') {
      if (!encouraged) {
        encouraged = true;
        SA.UI.toast('Good — watch the shadow follow!');
      }
      if (step === 1) { step = 2; showStep(); }
    } else if (kind === 'rotate') {
      if (step === 2) { step = 3; showStep(); }
    } else if (kind === 'light-drag') {
      if (step === 3) { step = 4; showStep(); }
    }
  }

  function showStep() {
    var s = STEPS[step];
    if (!s || !el.label) return;
    el.label.textContent = s.label;
    el.text.textContent = s.text;
    el.next.textContent = s.next;
    // Step 2 highlights the ◀ ▶ buttons. They live in the mobile bar,
    // which desktop CSS hides — show the bar while this step is up so
    // the buttons are visible AND tappable on desktop too. Removed on
    // any step change away from 2 and on stop().
    var app = $('app');
    if (app) app.classList.toggle('tut-show-rot', step === 2);
    buildRings();
  }

  // One ring div per highlight target; positions are refreshed every
  // frame in tick() from the live probe, so rings follow a dragged
  // object / the light while it moves.
  function buildRings() {
    if (!el.rings) return;
    el.rings.innerHTML = '';
    var n = step === 1 ? 3 : 1; // step 1 rings all three objects
    var i;
    for (i = 0; i < n; i++) {
      var d = document.createElement('div');
      d.className = 'tut-ring' + (step === 2 || step === 4 || step === 5 ? ' tut-ring-rect' : '');
      el.rings.appendChild(d);
    }
  }

  function ringTargets() {
    if (!game || !game.tutorialProbe) return [];
    var p = game.tutorialProbe();
    if (!p) return [];
    var a = appRect();
    var i;
    if (step === 1) {
      return p.objects.map(function (o) {
        return { x: o.x - o.r - 10, y: o.y - o.r - 10, w: (o.r + 10) * 2, h: (o.r + 10) * 2, circle: true };
      });
    }
    if (step === 2) {
      var l = $('btn-rot-l'), r = $('btn-rot-r');
      if (!l || !r) return [];
      var bl = l.getBoundingClientRect(), br = r.getBoundingClientRect();
      if (bl.width === 0 || br.width === 0) return [];
      var x0 = Math.min(bl.left, br.left) - a.left, y0 = Math.min(bl.top, br.top) - a.top;
      var x1 = Math.max(bl.right, br.right) - a.left, y1 = Math.max(bl.bottom, br.bottom) - a.top;
      return [{ x: x0 - 6, y: y0 - 6, w: x1 - x0 + 12, h: y1 - y0 + 12, circle: false }];
    }
    if (step === 3) {
      return [{ x: p.light.x - p.lightR - 8, y: p.light.y - p.lightR - 8,
                w: (p.lightR + 8) * 2, h: (p.lightR + 8) * 2, circle: true }];
    }
    if (step === 4) {
      // Ring the target wall / silhouette panel (screen rect from the
      // probe, padded so the ring sits around the ivory silhouette).
      if (!p.wall) return [];
      return [{ x: p.wall.x - 10, y: p.wall.y - 10,
                w: p.wall.w + 20, h: p.wall.h + 20, circle: false }];
    }
    if (step === 5) {
      var m = $('hud-match');
      if (!m) return [];
      var box = m.parentElement.getBoundingClientRect(); // .hud-match box
      if (box.width === 0) return [];
      return [{ x: box.left - a.left - 6, y: box.top - a.top - 4,
                w: box.width + 12, h: box.height + 8, circle: false }];
    }
    return [];
  }

  function tick() {
    rafId = null;
    if (!active) return;
    // Winning mid-tutorial ends it cleanly (seen — the player proved
    // they understood). Pausing just leaves the overlay under the
    // pause screen; rings resume positioning on resume.
    if (game.screen === 'complete') { finish(); return; }
    if (game.screen === 'playing') {
      var targets = ringTargets();
      var rings = el.rings ? el.rings.children : [];
      var i, t, d;
      for (i = 0; i < rings.length; i++) {
        t = targets[i];
        d = rings[i];
        if (!t) { d.style.display = 'none'; continue; }
        d.style.display = 'block';
        d.style.left = t.x + 'px';
        d.style.top = t.y + 'px';
        d.style.width = t.w + 'px';
        d.style.height = t.h + 'px';
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  // Test probe: { active, step (1-5, 0 when idle), seen, overlayVisible }.
  function probe() {
    return {
      active: active,
      step: active ? step : 0,
      seen: seen(),
      overlayVisible: !!(el.overlay && !el.overlay.classList.contains('hidden'))
    };
  }

  return { init: init, start: start, stop: stop, skip: skip, next: next,
           finish: finish, notify: notify, probe: probe, seen: seen };
})();
