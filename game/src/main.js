/* Shadow Architect — main application (version 1.0).
 *
 * Owns the state machine, the per-frame update, the deferred victory,
 * the input guard, the frozen result, the star award, the best-score
 * storage and migration, the view fitting and zoom, and the wiring
 * between all the other modules. Exposes a debug object on the window
 * for testing.
 *
 * States: menu, levels, settings, credits, playing, paused, complete,
 * chapter2 (the locked second chapter).
 */
(function () {
  'use strict';

  var SA = window.SA || (window.SA = {});
  var VERSION = '1.0';

  var WIN_THRESHOLD = 0.9;
  var ALMOST_THRESHOLD = 0.85;
  var INPUT_GUARD_MS = 650;
  var ROTATE_STEP_DEG = 15;

  // --- Storage keys (exactly as specified) -------------------------------
  var KEY_BEST_OLD = 'sa-best-v1';
  var KEY_PROGRESS_OLD = 'sa-progress-v1';
  var KEY_BEST_BACKUP = 'sa-best-v1-backup';
  var KEY_PROGRESS_BACKUP = 'sa-progress-v1-backup';
  var KEY_MIGRATION_FLAG = 'sa-migration-v1-done';

  function bestKey(levelNumber) {
    return 'sa-best-v1-level-0' + levelNumber;
  }
  function progressKey(levelNumber) {
    return 'sa-progress-v1-level-0' + levelNumber;
  }
  function levelNumberOf(levelId) {
    var m = /level-(\d+)/.exec(String(levelId || 'level-01'));
    return m ? parseInt(m[1], 10) : 1;
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  // Write a value and verify it by reading it back. Returns true only
  // when the value read back matches what was written.
  function verifiedWrite(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return window.localStorage.getItem(key) === value;
    } catch (e) {
      return false;
    }
  }

  // --- Best-score migration (runs at module load time) -------------------
  // On first run after an older version, a single old global best (and
  // progress) is copied verbatim into the matching level-one per-level
  // keys, a verbatim backup copy of each old value is written, and only
  // then is the migration-done flag set. The old keys are left in place
  // as a read-only fallback and are never overwritten. A fresh profile
  // with no old best gets only the flag. A second run changes nothing.
  (function runMigrationAtLoad() {
    try {
      if (storageGet(KEY_MIGRATION_FLAG) === 'true') { return; }
      var oldBest = storageGet(KEY_BEST_OLD);
      var oldProgress = storageGet(KEY_PROGRESS_OLD);
      var ok = true;
      if (oldBest !== null) {
        ok = verifiedWrite(bestKey(1), oldBest) && ok;
        ok = verifiedWrite(KEY_BEST_BACKUP, oldBest) && ok;
      }
      if (oldProgress !== null) {
        ok = verifiedWrite(progressKey(1), oldProgress) && ok;
        ok = verifiedWrite(KEY_PROGRESS_BACKUP, oldProgress) && ok;
      }
      // The flag is set last, and only when every write verified.
      if (ok) { verifiedWrite(KEY_MIGRATION_FLAG, 'true'); }
    } catch (e) {
      // Storage unavailable: migration simply does not run.
    }
  })();

  // --- Debug object (live: fields are updated in place) ------------------
  var DEBUG = {
    state: 'menu',
    match: 0,
    winPending: false,
    frozenResult: null
  };
  window.SA_DEBUG = DEBUG;

  // --- Level data fallback (from the specification tables) ---------------
  // Used when the levels module is not available; the playable layout
  // is resolved from these tables, never by mutating them.
  var FALLBACK_LEVEL = {
    id: 'level-01',
    chapter: 1,
    difficulty: 'normal',
    winThreshold: WIN_THRESHOLD,
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
    }
  };

  var STAR_THRESHOLDS = {
    three: { moves: 25, seconds: 120, match: 0.95, hints: 1 },
    two: { moves: 40, seconds: 240, match: 0.90, hints: 3 }
  };

  // --- Game state ----------------------------------------------------------
  var G = {
    state: 'menu',
    levelId: 'level-01',
    orientation: 'landscape',
    layout: null,
    objects: [],
    light: { x: 185, y: 360 },
    targets: [],
    selectedId: 'tri',
    moves: 0,
    hintsUsed: 0,
    match: 0,
    bandScores: [],
    almostShown: false,
    pointerHeld: false,
    winPending: false,
    confirming: false,
    inputLocked: false,
    paused: false,
    inputGuardUntil: 0,
    frozenResult: null,
    best: null,
    isNewBest: false,
    timerStarted: false,
    timerRunning: false,
    timerStartAt: 0,
    elapsedAccumMs: 0,
    settingsReturn: 'menu',
    tutorialSeen: false,
    view: { baseScale: 1, zoom: 1, scale: 1, offsetX: 0, offsetY: 0 },
    renderFailed: false
  };

  function nowMs() { return Date.now(); }

  function formatTime(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var mm = String(Math.floor(total / 60)).padStart(2, '0');
    var ss = String(total % 60).padStart(2, '0');
    return mm + ':' + ss;
  }

  function $(id) {
    return (typeof document !== 'undefined')
      ? document.getElementById(id) : null;
  }

  // --- Match mathematics (specification section 2) -----------------------
  // Projection: ray from the light through a point, continued to the
  // wall. Landscape wall is vertical (projected value is a wall y);
  // portrait wall is horizontal (projected value is a wall x).
  function projectPoint(light, px, py, orientation, wallPos) {
    if (orientation === 'landscape') {
      var dx = px - light.x;
      if (dx === 0) { return null; }
      var t = (wallPos - light.x) / dx;
      if (t <= 0) { return null; }
      return light.y + t * (py - light.y);
    }
    var dy = py - light.y;
    if (dy === 0) { return null; }
    var u = (wallPos - light.y) / dy;
    if (u <= 0) { return null; }
    return light.x + u * (px - light.x);
  }

  function shapeCorners(obj) {
    var angles;
    if (obj.shape === 'triangle') {
      angles = [obj.rotation - 90, obj.rotation + 30, obj.rotation + 150];
    } else if (obj.shape === 'hexagon') {
      angles = [0, 60, 120, 180, 240, 300].map(function (a) {
        return a + obj.rotation;
      });
    } else { // ring: twelve-sided polygon
      angles = [];
      for (var i = 0; i < 12; i++) {
        angles.push(i * 30 + obj.rotation);
      }
    }
    return angles.map(function (deg) {
      var rad = deg * Math.PI / 180;
      return {
        x: obj.x + obj.radius * Math.cos(rad),
        y: obj.y + obj.radius * Math.sin(rad)
      };
    });
  }

  function shadowInterval(obj, light, orientation, wallPos) {
    var lo = Infinity, hi = -Infinity, any = false;
    shapeCorners(obj).forEach(function (p) {
      var v = projectPoint(light, p.x, p.y, orientation, wallPos);
      if (v !== null && isFinite(v)) {
        any = true;
        if (v < lo) { lo = v; }
        if (v > hi) { hi = v; }
      }
    });
    return any ? { low: lo, high: hi } : null;
  }

  function mergeIntervals(list) {
    var sorted = list.filter(Boolean).slice().sort(function (a, b) {
      return a.low - b.low;
    });
    var out = [];
    sorted.forEach(function (iv) {
      var last = out[out.length - 1];
      if (last && iv.low <= last.high) {
        if (iv.high > last.high) { last.high = iv.high; }
      } else {
        out.push({ low: iv.low, high: iv.high });
      }
    });
    return out;
  }

  function unionLength(list) {
    return mergeIntervals(list).reduce(function (sum, iv) {
      return sum + Math.max(0, iv.high - iv.low);
    }, 0);
  }

  function overlapLength(a, b) {
    return Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low));
  }

  function unionIou(shadows, targets) {
    var sUnion = mergeIntervals(shadows);
    var tUnion = mergeIntervals(targets);
    var inter = 0;
    sUnion.forEach(function (s) {
      tUnion.forEach(function (t) { inter += overlapLength(s, t); });
    });
    var union = unionLength(shadows) + unionLength(targets) - inter;
    return union > 0 ? inter / union : 0;
  }

  function computeMatch() {
    if (!G.layout) { return 0; }
    /* The level module's layout names the wall position
     * wallPosition (with wall.position as well); the fallback
     * layout names it wallPos. Accept either spelling. */
    var wallPos = G.layout.wallPosition != null ? G.layout.wallPosition
      : (G.layout.wall ? G.layout.wall.position : G.layout.wallPos);
    var shadows = [];
    G.objects.forEach(function (obj) {
      var iv = shadowInterval(obj, G.light, G.orientation, wallPos);
      if (iv) { shadows.push(iv); }
    });
    var match = unionIou(shadows, G.targets);
    G.bandScores = G.targets.map(function (band) {
      var best = 0;
      shadows.forEach(function (s) {
        var score = unionIou([s], [band]);
        if (score > best) { best = score; }
      });
      return best;
    });
    return match;
  }

  function recomputeMatch() {
    G.match = computeMatch();
    DEBUG.match = G.match;
    checkDeferredVictory();
    updateHud();
    return G.match;
  }

  // --- Star award ----------------------------------------------------------
  function awardStars(moves, seconds, match, hints) {
    // Prefer the level module's star rule when it is present.
    try {
      if (SA.level && typeof SA.level.starRating === 'function') {
        var thresholds = (typeof SA.level.starThresholds === 'function')
          ? SA.level.starThresholds('normal')
          : STAR_THRESHOLDS;
        var stars = SA.level.starRating(thresholds, moves, seconds, match, hints);
        if (stars === 1 || stars === 2 || stars === 3) { return stars; }
      }
    } catch (e) { /* fall through to the local rule */ }
    var t3 = STAR_THRESHOLDS.three;
    var t2 = STAR_THRESHOLDS.two;
    if (moves <= t3.moves && seconds <= t3.seconds &&
        match >= t3.match && hints <= t3.hints) { return 3; }
    if (moves <= t2.moves && seconds <= t2.seconds &&
        match >= t2.match && hints <= t2.hints) { return 2; }
    return 1;
  }

  // --- Best score / progress storage ---------------------------------------
  function loadBest(levelId) {
    var raw = storageGet(bestKey(levelNumberOf(levelId)));
    if (!raw) { return null; }
    try {
      var v = JSON.parse(raw);
      if (v && typeof v.stars === 'number' && typeof v.match === 'number') {
        return v;
      }
    } catch (e) { /* corrupt value: treat as no best */ }
    return null;
  }

  function saveBest(levelId, result) {
    var value = {
      stars: result.stars,
      timeMs: result.timeMs,
      moves: result.moves,
      match: result.match
    };
    return verifiedWrite(bestKey(levelNumberOf(levelId)), JSON.stringify(value));
  }

  function beatsBest(next, prev) {
    if (!prev) { return true; }
    if (next.stars !== prev.stars) { return next.stars > prev.stars; }
    if (Math.abs(next.match - prev.match) > 1e-9) {
      return next.match > prev.match;
    }
    if (next.timeMs !== prev.timeMs) { return next.timeMs < prev.timeMs; }
    return next.moves < prev.moves;
  }

  function loadProgress(levelId) {
    var raw = storageGet(progressKey(levelNumberOf(levelId)));
    if (!raw) { return null; }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveProgress(levelId, data) {
    return verifiedWrite(
      progressKey(levelNumberOf(levelId)), JSON.stringify(data));
  }

  // Progress loading tolerates a stored state with no light position:
  // the light simply falls back to its home position.
  function applyProgress(progress) {
    if (!progress) { return; }
    if (progress.light && typeof progress.light.x === 'number' &&
        typeof progress.light.y === 'number') {
      G.light = { x: progress.light.x, y: progress.light.y };
    }
    if (Array.isArray(progress.objects)) {
      progress.objects.forEach(function (saved) {
        var obj = G.objects.find(function (o) { return o.id === saved.id; });
        if (obj) {
          if (typeof saved.x === 'number') { obj.x = saved.x; }
          if (typeof saved.y === 'number') { obj.y = saved.y; }
          if (typeof saved.rotation === 'number') {
            obj.rotation = saved.rotation;
          }
        }
      });
    }
  }

  // --- Layout ---------------------------------------------------------------
  function cloneObjects(list) {
    return list.map(function (o) {
      return {
        id: o.id, shape: o.shape, x: o.x, y: o.y,
        radius: o.radius, rotation: o.rotation, color: o.color
      };
    });
  }

  function buildLayout(levelId, orientation) {
    // Prefer the levels / level modules when they are present.
    try {
      if (SA.levels && typeof SA.levels.getLevel === 'function' &&
          SA.level && typeof SA.level.layout === 'function') {
        var resolved = SA.levels.getLevel(levelId);
        var laidOut = SA.level.layout(resolved, orientation);
        if (laidOut && Array.isArray(laidOut.objects) &&
            Array.isArray(laidOut.targets)) {
          return laidOut;
        }
      }
    } catch (e) { /* fall through to the fallback tables */ }
    var landscape = orientation === 'landscape';
    var world = landscape ? { w: 1280, h: 720 } : { w: 720, h: 1280 };
    var objects = cloneObjects(FALLBACK_LEVEL.objects);
    if (!landscape) {
      // Portrait positions derive from landscape by the scaling rule.
      objects.forEach(function (o) {
        o.x = o.x * 720 / 1280;
        o.y = o.y * 1280 / 720;
      });
    }
    return {
      id: levelId,
      worldWidth: world.w,
      worldHeight: world.h,
      wallPos: landscape ? 1080 : 1010,
      wallThickness: 64,
      wallVertical: landscape,
      objects: objects,
      lightHome: landscape
        ? FALLBACK_LEVEL.lightHome.landscape
        : FALLBACK_LEVEL.lightHome.portrait,
      targets: landscape
        ? FALLBACK_LEVEL.targets.landscape.slice()
        : FALLBACK_LEVEL.targets.portrait.slice()
    };
  }

  function currentOrientation() {
    var canvas = $('game-canvas');
    var w = canvas ? canvas.clientWidth : 0;
    var h = canvas ? canvas.clientHeight : 0;
    if (!w || !h) {
      w = window.innerWidth || 1280;
      h = window.innerHeight || 720;
    }
    return w >= h ? 'landscape' : 'portrait';
  }

  // --- View fitting and zoom -------------------------------------------------
  function fitView() {
    var canvas = $('game-canvas');
    if (!canvas || !G.layout) { return; }
    var cw = canvas.clientWidth || canvas.width || 1280;
    var ch = canvas.clientHeight || canvas.height || 720;
    var base = Math.min(
      cw / G.layout.worldWidth, ch / G.layout.worldHeight);
    G.view.baseScale = base;
    G.view.scale = base * G.view.zoom;
    G.view.offsetX = (cw - G.layout.worldWidth * G.view.scale) / 2;
    G.view.offsetY = (ch - G.layout.worldHeight * G.view.scale) / 2;
  }

  function resetView() {
    G.view.zoom = 1;
    fitView();
  }

  function setZoom(zoom) {
    G.view.zoom = Math.max(0.5, Math.min(4, Number(zoom) || 1));
    fitView();
    return G.view.zoom;
  }

  // Re-lay out for a new orientation, keeping the shapes' relative
  // positions through the scaling rule.
  function relayoutForOrientation(next) {
    if (!G.layout || next === G.orientation) { return; }
    var prev = G.orientation;
    var sx = next === 'portrait' ? 720 / 1280 : 1280 / 720;
    var sy = next === 'portrait' ? 1280 / 720 : 720 / 1280;
    G.objects.forEach(function (o) {
      o.x = o.x * sx;
      o.y = o.y * sy;
    });
    G.orientation = next;
    G.layout = buildLayout(G.levelId, next);
    G.targets = G.layout.targets;
    G.light = {
      x: G.layout.lightHome.x, y: G.layout.lightHome.y
    };
    void prev;
    resetView();
    recomputeMatch();
  }

  // --- Timer ------------------------------------------------------------------
  function getElapsedMs() {
    if (G.timerRunning) {
      return G.elapsedAccumMs + (nowMs() - G.timerStartAt);
    }
    return G.elapsedAccumMs;
  }

  function startTimerOnFirstMove() {
    if (G.timerStarted) { return; }
    G.timerStarted = true;
    G.timerRunning = true;
    G.timerStartAt = nowMs();
  }

  function freezeTimer() {
    if (G.timerRunning) {
      G.elapsedAccumMs = getElapsedMs();
      G.timerRunning = false;
    }
  }

  function resumeTimer() {
    if (G.timerStarted && !G.timerRunning) {
      G.timerRunning = true;
      G.timerStartAt = nowMs();
    }
  }

  // --- Moves, rotation, hints ---------------------------------------------------
  function registerMove() {
    if (G.state !== 'playing' || isInputGuarded()) { return; }
    startTimerOnFirstMove();
    G.moves += 1;
    recomputeMatch();
  }

  function registerRotation(direction) {
    if (G.state !== 'playing' || isInputGuarded()) { return; }
    var obj = G.objects.find(function (o) { return o.id === G.selectedId; });
    if (!obj) { return; }
    obj.rotation = (obj.rotation + direction * ROTATE_STEP_DEG + 360) % 360;
    startTimerOnFirstMove();
    G.moves += 1;
    recomputeMatch();
  }

  function registerHint() {
    if (G.state !== 'playing' || isInputGuarded()) { return null; }
    G.hintsUsed += 1;
    var hints = [
      'Drag an object to move it. The light magnifies what is near it.',
      'Use the left and right arrows (or scroll) to rotate the selected object.',
      'Drag the light: near the wall shadows shrink, near objects they grow.',
      'Match the shadow to the ivory silhouette. Reach 90% to win.'
    ];
    var text = hints[Math.min(G.hintsUsed - 1, hints.length - 1)];
    showToast(text, 6000);
    updateHud();
    return text;
  }

  // --- Deferred victory ---------------------------------------------------------
  function checkDeferredVictory() {
    if (G.state !== 'playing' || G.confirming) { return; }
    if (G.match >= ALMOST_THRESHOLD && G.match < WIN_THRESHOLD) {
      if (!G.almostShown) {
        G.almostShown = true;
        showToast('ALMOST — reach 90% to win.', 2600);
      }
    } else if (G.match < ALMOST_THRESHOLD) {
      G.almostShown = false;
    }
    if (G.match >= WIN_THRESHOLD) {
      if (G.pointerHeld) {
        // Held at or above 90%: win is pending, game stays playing.
        if (!G.winPending) {
          G.winPending = true;
          DEBUG.winPending = true;
        }
      } else if (!G.winPending) {
        // Reached 90% with no pointer held (wheel / button move):
        // confirm straight away.
        confirmWin();
      }
    } else if (G.winPending) {
      // Swept back below 90% before release: pending win is cancelled.
      G.winPending = false;
      DEBUG.winPending = false;
    }
  }

  function confirmWin() {
    if (G.state !== 'playing' || G.confirming) { return null; }
    G.confirming = true;
    G.winPending = false;
    DEBUG.winPending = false;
    freezeTimer();
    var elapsed = getElapsedMs();
    var frozen = {
      levelId: G.levelId,
      match: G.match,
      moves: G.moves,
      hints: G.hintsUsed,
      timeMs: elapsed,
      timeSeconds: Math.floor(elapsed / 1000),
      stars: awardStars(G.moves, Math.floor(elapsed / 1000),
        G.match, G.hintsUsed)
    };
    G.frozenResult = frozen;
    DEBUG.frozenResult = frozen;
    G.isNewBest = beatsBest(frozen, G.best);
    if (G.isNewBest) {
      saveBest(G.levelId, frozen);
      G.best = loadBest(G.levelId);
    }
    saveProgress(G.levelId, {
      levelId: G.levelId,
      stars: frozen.stars,
      match: frozen.match,
      moves: frozen.moves,
      timeMs: frozen.timeMs,
      hints: frozen.hints,
      light: { x: G.light.x, y: G.light.y },
      objects: G.objects.map(function (o) {
        return { id: o.id, x: o.x, y: o.y, rotation: o.rotation };
      })
    });
    if (SA.audio && typeof SA.audio.playWin === 'function') {
      SA.audio.playWin();
    }
    // Input guard: input is ignored for 650 ms, then the complete
    // screen appears with the frozen values.
    G.inputGuardUntil = nowMs() + INPUT_GUARD_MS;
    G.inputLocked = true;
    setTimeout(function () {
      G.confirming = false;
      G.inputLocked = false;
      setState('complete');
      populateComplete(frozen);
    }, INPUT_GUARD_MS);
    return frozen;
  }

  function isInputGuarded() {
    return nowMs() < G.inputGuardUntil;
  }

  // --- Screens, HUD, toasts ------------------------------------------------------
  var STATE_SCREENS = {
    menu: 'screen-menu',
    levels: 'screen-levels',
    settings: 'screen-settings',
    credits: 'screen-credits',
    playing: 'screen-game',
    paused: 'screen-pause',
    complete: 'screen-complete',
    chapter2: 'screen-chapter2'
  };

  function showScreenFor(stateName) {
    /* The ui module names screens by their page identifiers
     * (screen-game, screen-pause, ...), not by state names: the
     * state 'playing' lives on screen-game. Pass the full
     * identifier, which showScreen also accepts, so the lookup
     * cannot silently match nothing and hide every screen. */
    if (SA.ui && typeof SA.ui.showScreen === 'function') {
      try { SA.ui.showScreen(STATE_SCREENS[stateName]); return; } catch (e) { /* fall through */ }
    }
    Object.keys(STATE_SCREENS).forEach(function (key) {
      var el = $(STATE_SCREENS[key]);
      if (el) { el.hidden = key !== stateName; }
    });
  }

  function setState(next) {
    if (!STATE_SCREENS.hasOwnProperty(next)) { return; }
    G.state = next;
    G.paused = (next === 'paused');
    DEBUG.state = next;
    showScreenFor(next);
    if (next === 'playing') { fitView(); }
    updateHud();
  }

  function updateHud() {
    var matchEl = $('hud-match');
    if (matchEl) {
      matchEl.textContent = Math.round(G.match * 100) + '%';
    }
    var movesEl = $('hud-moves');
    if (movesEl) { movesEl.textContent = String(G.moves); }
    var timeEl = $('hud-time');
    if (timeEl) { timeEl.textContent = formatTime(getElapsedMs()); }
    if (SA.ui && typeof SA.ui.updateHUD === 'function') {
      try {
        SA.ui.updateHUD({
          match: G.match, moves: G.moves,
          elapsedSeconds: getElapsedMs() / 1000
        });
      } catch (e) { /* HUD already updated above */ }
    }
  }

  var toastTimer = null;
  var toastQueue = [];
  function showToast(text, durationMs) {
    if (SA.ui && typeof SA.ui.showToast === 'function') {
      try { SA.ui.showToast(text, durationMs); return; } catch (e) { /* fall through */ }
    }
    toastQueue.push({ text: text, ms: durationMs || 2600 });
    if (toastQueue.length > 2) { toastQueue.shift(); }
    if (toastTimer !== null) { return; }
    var pump = function () {
      var item = toastQueue.shift();
      var el = $('toast');
      if (!item || !el) { toastTimer = null; return; }
      el.textContent = item.text;
      el.hidden = false;
      toastTimer = setTimeout(function () {
        el.hidden = true;
        toastTimer = null;
        if (toastQueue.length) { pump(); }
      }, item.ms);
    };
    pump();
  }

  function populateComplete(frozen) {
    var starsEl = $('complete-stars');
    if (starsEl) {
      starsEl.textContent = '★'.repeat(frozen.stars) +
        '☆'.repeat(3 - frozen.stars);
    }
    var matchEl = $('complete-match');
    if (matchEl) {
      matchEl.textContent = Math.round(frozen.match * 100) + '%';
    }
    var timeEl = $('complete-time');
    if (timeEl) { timeEl.textContent = formatTime(frozen.timeMs); }
    var movesEl = $('complete-moves');
    if (movesEl) { movesEl.textContent = String(frozen.moves); }
    var bestEl = $('complete-best');
    if (bestEl) {
      bestEl.textContent = G.isNewBest ? 'New best score' : '';
    }
    var criteriaEl = $('complete-criteria');
    if (criteriaEl) {
      criteriaEl.textContent =
        '3 stars: at most 25 moves, 120 seconds, 95% match, 1 hint. ' +
        '2 stars: at most 40 moves, 240 seconds, 90% match, 3 hints.';
    }
  }

  function setHudVisible(visible) {
    var hud = $('hud');
    var restore = $('hud-restore');
    if (hud) { hud.hidden = !visible; }
    if (restore) { restore.hidden = visible; }
    if (SA.ui && typeof SA.ui.setHudVisible === 'function') {
      try { SA.ui.setHudVisible(visible); } catch (e) { /* already set */ }
    }
  }

  // --- Flow -----------------------------------------------------------------------
  function startLevel(levelId) {
    G.levelId = levelId || 'level-01';
    G.orientation = currentOrientation();
    G.layout = buildLayout(G.levelId, G.orientation);
    G.objects = cloneObjects(G.layout.objects);
    G.targets = G.layout.targets;
    G.light = { x: G.layout.lightHome.x, y: G.layout.lightHome.y };
    G.selectedId = G.objects.length ? G.objects[0].id : null;
    G.selected = G.objects.length ? G.objects[0] : null;
    G.selectedIndex = G.objects.length ? 0 : -1;
    G.moves = 0;
    G.hintsUsed = 0;
    G.match = 0;
    G.bandScores = [];
    G.almostShown = false;
    G.pointerHeld = false;
    G.winPending = false;
    DEBUG.winPending = false;
    G.confirming = false;
    G.inputGuardUntil = 0;
    G.frozenResult = null;
    DEBUG.frozenResult = null;
    G.isNewBest = false;
    G.timerStarted = false;
    G.timerRunning = false;
    G.elapsedAccumMs = 0;
    G.best = loadBest(G.levelId);
    var progress = loadProgress(G.levelId);
    G.tutorialSeen = !!progress;
    resetView();
    setState('playing');
    recomputeMatch();
    if (SA.render && typeof SA.render.startParticles === 'function') {
      try { SA.render.startParticles(); } catch (e) { /* optional */ }
    }
    /* Show the tutorial only on a first play: the tutorial module
     * keeps its own seen flag, so ask it rather than starting
     * unconditionally. */
    if (!G.tutorialSeen && SA.tutorial &&
        typeof SA.tutorial.startIfFirstTime === 'function') {
      try { SA.tutorial.startIfFirstTime(); } catch (e) { /* optional */ }
    } else if (!G.tutorialSeen && SA.tutorial &&
        typeof SA.tutorial.start === 'function') {
      try { SA.tutorial.start(); } catch (e) { /* optional */ }
    }
    if (SA.audio && typeof SA.audio.playBassPulse === 'function') {
      SA.audio.playBassPulse();
    }
  }

  function pauseGame() {
    if (G.state !== 'playing') { return; }
    freezeTimer();
    setState('paused');
  }

  /* Escape and the input module both toggle pause through here. */
  function togglePause() {
    if (G.state === 'playing') { pauseGame(); }
    else if (G.state === 'paused') { resumeGame(); }
  }

  function resumeGame() {
    if (G.state !== 'paused') { return; }
    setState('playing');
    resumeTimer();
  }

  function quitToMenu() {
    freezeTimer();
    G.winPending = false;
    DEBUG.winPending = false;
    setState('menu');
  }

  function openSettings(fromState) {
    G.settingsReturn = fromState || G.state;
    setState('settings');
  }

  function closeSettings() {
    var back = G.settingsReturn || 'menu';
    if (back === 'paused') { setState('paused'); return; }
    if (back === 'playing') { setState('playing'); return; }
    setState('menu');
  }

  // Pointer-held tracking (state only; dragging itself is owned by the
  // input module). On release while a win is pending and the match is
  // still at or above 90%, the win is confirmed.
  function onPointerDown() {
    if (G.state === 'playing') { G.pointerHeld = true; }
  }
  function onPointerUp() {
    if (!G.pointerHeld) { return; }
    G.pointerHeld = false;
    if (G.state === 'playing' && G.winPending &&
        G.match >= WIN_THRESHOLD) {
      confirmWin();
    }
  }

  function setPointerHeld(held) {
    G.pointerHeld = !!held;
    if (!held) { onPointerUp(); }
  }

  // --- Wiring -----------------------------------------------------------------------
  function bindClick(id, fn) {
    var el = $(id);
    if (!el) { return; }
    el.addEventListener('click', function () {
      if (SA.audio && typeof SA.audio.playClick === 'function') {
        SA.audio.playClick();
      }
      fn();
    });
  }

  function bindControls() {
    bindClick('btn-play', function () { startLevel('level-01'); });
    bindClick('btn-levels', function () { setState('levels'); });
    bindClick('btn-settings', function () { openSettings('menu'); });
    bindClick('btn-credits', function () { setState('credits'); });
    bindClick('level-01-btn', function () { startLevel('level-01'); });
    ['ch2-locked', 'ch3-locked', 'ch4-locked', 'ch5-locked'].forEach(function (id) {
      bindClick(id, function () {
        showToast('That chapter is locked.', 2600);
      });
    });
    bindClick('btn-back-levels', function () { setState('menu'); });
    bindClick('btn-back-settings', function () { closeSettings(); });
    bindClick('btn-back-credits', function () { setState('menu'); });

    bindClick('hud-hint', function () { registerHint(); });
    bindClick('hud-pause', function () { pauseGame(); });
    bindClick('hud-music', function () {
      if (SA.audio && typeof SA.audio.toggleMusic === 'function') {
        SA.audio.toggleMusic();
      }
    });
    bindClick('hud-settings', function () { openSettings('playing'); });
    bindClick('hud-hide', function () { setHudVisible(false); });
    bindClick('hud-restore', function () { setHudVisible(true); });
    /* Rotate and reset-view buttons are owned by the input module
     * (it wires them when attached below); the tutorial buttons are
     * owned by the tutorial module (it wires itself). Binding them
     * here as well would fire each action twice per click. */

    bindClick('btn-resume', function () { resumeGame(); });
    bindClick('btn-pause-settings', function () { openSettings('paused'); });
    bindClick('btn-pause-menu', function () { quitToMenu(); });
    bindClick('btn-restart', function () { startLevel(G.levelId); });
    bindClick('btn-next-chapter', function () { setState('chapter2'); });
    bindClick('btn-chapter2-back', function () { setState('menu'); });

    var volume = $('settings-volume');
    if (volume) {
      volume.addEventListener('input', function () {
        if (SA.audio && typeof SA.audio.setMusicVolume === 'function') {
          SA.audio.setMusicVolume(Number(volume.value) / 100);
        }
      });
    }
    var opacity = $('settings-opacity');
    if (opacity) {
      opacity.addEventListener('input', function () {
        var hud = $('hud');
        if (hud) {
          hud.style.opacity = String(Number(opacity.value) / 100);
        }
      });
    }
    var musicToggle = $('settings-music-toggle');
    if (musicToggle) {
      musicToggle.addEventListener('change', function () {
        if (SA.audio && typeof SA.audio.setMusicEnabled === 'function') {
          SA.audio.setMusicEnabled(!!musicToggle.checked);
        }
      });
    }

    // Pointer-held tracking on the canvas and anywhere on the page.
    // Only the window pointerup is wired here: the input module
    // counts the released drag (the final move) before it reports
    // the release, so a canvas-level listener in this file would
    // confirm a pending win before that last move was counted and
    // freeze a move count one short. The input module reports the
    // release after counting; this window listener is the safety net
    // for a release outside the canvas.
    var canvas = $('game-canvas');
    if (canvas) {
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointercancel', function () {
        G.pointerHeld = false;
        if (G.winPending && G.match < WIN_THRESHOLD) {
          G.winPending = false;
          DEBUG.winPending = false;
        }
      });
    }
    window.addEventListener('pointerup', onPointerUp);

    // Keyboard: Escape pauses / resumes, 1 resets the view. The input
    // module owns the same keys when it is loaded; this listener only
    // acts when it is not, so a key is never handled twice.
    if (!SA.input || typeof SA.input.attach !== 'function') {
      window.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          if (G.state === 'playing') { pauseGame(); }
          else if (G.state === 'paused') { resumeGame(); }
        } else if (ev.key === '1') {
          if (G.state === 'playing') { resetView(); }
        }
      });
    }

    // First user gesture unlocks audio; music starts on the menu.
    var unlockOnce = function () {
      if (SA.audio && typeof SA.audio.unlock === 'function') {
        SA.audio.unlock();
      }
      if (SA.audio && typeof SA.audio.startMusic === 'function' &&
          SA.audio.isMusicEnabled && SA.audio.isMusicEnabled()) {
        SA.audio.startMusic();
      }
      window.removeEventListener('pointerdown', unlockOnce);
      window.removeEventListener('keydown', unlockOnce);
    };
    window.addEventListener('pointerdown', unlockOnce);
    window.addEventListener('keydown', unlockOnce);

    window.addEventListener('resize', function () {
      if (G.state === 'playing' || G.state === 'paused') {
        var next = currentOrientation();
        if (next !== G.orientation) { relayoutForOrientation(next); }
        else { fitView(); }
      }
    });
  }

  // --- Per-frame update --------------------------------------------------------------
  function frame() {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(frame);
    }
    if (G.state === 'playing' && G.layout) {
      recomputeMatch();
      updateHud();
    }
    if ((G.state === 'playing' || G.state === 'paused') &&
        SA.render && typeof SA.render.draw === 'function' &&
        !G.renderFailed) {
      try {
        /* The renderer reads flat fields: world size, wall, the
         * target bands (under the name targetBands), the view, and
         * the objects. Pass them flat, not nested under layout. */
        SA.render.draw({
          state: G.state,
          levelId: G.levelId,
          orientation: G.orientation,
          layout: G.layout,
          worldWidth: G.layout.worldWidth,
          worldHeight: G.layout.worldHeight,
          wallPosition: G.layout.wallPosition != null
            ? G.layout.wallPosition
            : (G.layout.wall ? G.layout.wall.position : G.layout.wallPos),
          wallThickness: G.layout.wallThickness || 64,
          objects: G.objects,
          light: G.light,
          targets: G.targets,
          targetBands: G.targets,
          match: G.match,
          bandScores: G.bandScores,
          selectedId: G.selectedId,
          winPending: G.winPending,
          timeMs: getElapsedMs(),
          moves: G.moves,
          view: G.view
        });
      } catch (e) {
        G.renderFailed = true;
      }
    }
  }

  function boot() {
    bindControls();
    /* Wire the game state into the input module's hooks, then attach
     * it: without this call no pointer drag, wheel rotation, or
     * keyboard handling is ever wired up. The hooks translate the
     * input module's state fields onto this file's state: updateMatch
     * recomputes the match, noteFirstMove starts the timer on the
     * first move, onMove starts the timer when a drag or rotation
     * counts a move (the input module increments the count itself),
     * onSelect keeps the selected id in step, and togglePause /
     * fitView are the pause and view operations. */
    if (SA.input && typeof SA.input.attach === 'function') {
      var canvas = $('game-canvas');
      G.updateMatch = recomputeMatch;
      G.noteFirstMove = startTimerOnFirstMove;
      G.onMove = function () { startTimerOnFirstMove(); };
      G.onPointerDown = onPointerDown;
      G.onPointerUp = onPointerUp;
      G.onSelect = function (object) {
        G.selected = object || null;
        G.selectedId = object ? object.id : null;
        G.selectedIndex = object ? G.objects.indexOf(object) : -1;
      };
      G.fitView = fitView;
      G.togglePause = togglePause;
      try { SA.input.attach(G, canvas); } catch (e) { /* input is best-effort */ }
    }
    var versionEl = $('version-label');
    if (versionEl) { versionEl.textContent = VERSION; }
    var volume = $('settings-volume');
    if (volume && SA.audio && typeof SA.audio.getMusicVolume === 'function') {
      volume.value = String(Math.round(SA.audio.getMusicVolume() * 100));
    }
    setState('menu');
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(frame);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  SA.main = {
    version: VERSION,
    state: G,
    debug: DEBUG,
    getState: function () { return G.state; },
    setState: setState,
    startLevel: startLevel,
    pauseGame: pauseGame,
    pause: pauseGame,
    resumeGame: resumeGame,
    resume: resumeGame,
    togglePause: togglePause,
    quitToMenu: quitToMenu,
    restartLevel: function () { startLevel(G.levelId); },
    openSettings: openSettings,
    closeSettings: closeSettings,
    resetView: resetView,
    fitView: fitView,
    setZoom: setZoom,
    getElapsedMs: getElapsedMs,
    registerMove: registerMove,
    countMove: registerMove,
    onMove: registerMove,
    onDragEnd: registerMove,
    registerRotation: registerRotation,
    registerHint: registerHint,
    useHint: registerHint,
    recomputeMatch: recomputeMatch,
    refreshMatch: recomputeMatch,
    getMatch: function () { return G.match; },
    awardStars: awardStars,
    confirmWin: confirmWin,
    isInputGuarded: isInputGuarded,
    onPointerDown: onPointerDown,
    onPointerUp: onPointerUp,
    setPointerHeld: setPointerHeld,
    loadBest: loadBest,
    saveBest: saveBest,
    beatsBest: beatsBest,
    loadProgress: loadProgress,
    saveProgress: saveProgress,
    showToast: showToast,
    setHudVisible: setHudVisible,
    relayoutForOrientation: relayoutForOrientation
  };
})();
