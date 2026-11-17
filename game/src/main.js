/* SHADOW ARCHITECT — main controller: state machine, game loop,
   resize, persistence, zoom, debug handle. Version 1.0.
   Behaviors carried over from the v0.9 reference, in my own code:
   - per-level best/progress storage, with the v0.8 global keys
     (sa-best-v1 / sa-progress-v1) migrated into
     sa-best-v1-level-01 / sa-progress-v1-level-01 at module top;
   - victory deferred until pointer release (winPending, confirmation
     freeze, 650 ms input guard);
   - 4-factor AND star rating (confirmation match + deliberate hints,
     per-difficulty par tables);
   - victory-score freeze (the complete screen shows values frozen at
     confirmation, never a re-compute);
   - 'chapter2' locked screen; music lifecycle (start on PLAY,
     pause/resume, stop on menu);
   - zoom auto-reset to 1x on level start / restart / re-entry plus a
     desktop Reset View button;
   - data-driven levels (Chapter I loads from src/levels.js by id),
     tutorial feedback (per-band indicators + 85–89% "almost" state).
   The level is DATA, loaded by id. The engine never hardcodes a level;
   a new level needs a new entry in src/levels.js, not code. */
var SA = (typeof SA !== 'undefined') ? SA : {};
(function () {
  'use strict';
  var M = SA.Math, L = SA.Level;

  var canvas, ctx, dpr = 1;
  var screen = 'menu'; // menu|levels|settings|credits|playing|paused|complete|chapter2
  var settingsReturn = 'menu';
  var currentLevel = L.resolveLevel('level-01');
  var layout = L.makeLayout('landscape', currentLevel);
  var orientation = 'landscape';
  var state = null;
  var view = { scale: 1, tx: 0, ty: 0, fitScale: 1 };
  var rafId = null, lastT = 0, frozenTime = 0;
  var elapsedMs = 0, timerOn = false;
  var lastResult = null; // frozen win snapshot { match, moves, timeMs, hintsUsed } — null until a win is CONFIRMED
  var winPending = false; // match reached >= threshold mid-drag; victory NOT yet confirmed. Internal only, never shown.
  var hudHidden = false;
  var inputApi = null;

  // Is a pointer drag active right now? Drag state lives in input.js;
  // this is the only seam the victory logic needs.
  function isDragging() {
    return !!(inputApi && inputApi.isDragging && inputApi.isDragging());
  }
  // "Almost" band: distinct feedback at 85–89%, below the win
  // threshold. No solution is revealed.
  var ALMOST_LO = 0.85;

  var SETTINGS_KEY = 'sa-settings-v1', BEST_KEY = 'sa-best-v1', PROGRESS_KEY = 'sa-progress-v1';
  // BEST_KEY / PROGRESS_KEY are now the MIGRATION SOURCE ONLY (read raw
  // by migrateStorageV1 below). No game code reads or writes
  // best/progress through them anymore — see bestKeyFor /
  // progressKeyFor. They stay defined so the source keys stay grep-able.
  var settings = loadJSON(SETTINGS_KEY) || { volume: 0.5, muted: false, hudOpacity: 1 };
  // Backward-compatible defaults for saves that predate these fields.
  if (typeof settings.musicOn !== 'boolean') settings.musicOn = true;
  if (typeof settings.musicVolume !== 'number') settings.musicVolume = 0.7;
  if (typeof settings.tutorialSeen !== 'boolean') settings.tutorialSeen = false;

  // ---------- per-level storage + migration (module top) ----------
  // Runs ONCE, at module top, BEFORE the bestScore load below — NOT at
  // the top of init(): init() never reads bestScore (bestScore was
  // loaded at module scope in v0.8), so a migration inside init()
  // would be a no-op for the live session. This block uses raw
  // localStorage getItem/setItem only — never loadJSON / saveJSON
  // (loadJSON swallows corrupt JSON and returns null; saveJSON swallows
  // quota errors) — so it has no dependence on the hoisted helpers
  // below it. Old keys are never written or deleted; they are the
  // read-only fallback.
  var MIGRATION_FLAG_KEY = 'sa-migration-v1-done';
  var BEST_BACKUP_KEY = 'sa-best-v1-backup-pre-migration';
  var PROGRESS_BACKUP_KEY = 'sa-progress-v1-backup-pre-migration';
  function bestKeyFor(levelId) { return 'sa-best-v1-' + levelId; }
  function progressKeyFor(levelId) { return 'sa-progress-v1-' + levelId; }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isValidBest(v) {
    return isPlainObject(v) &&
      typeof v.stars === 'number' && Number.isInteger(v.stars) && v.stars >= 0 && v.stars <= 3 &&
      typeof v.timeMs === 'number' && isFinite(v.timeMs) && v.timeMs >= 0 &&
      typeof v.moves === 'number' && Number.isInteger(v.moves) && v.moves >= 0;
  }
  function isValidLight(v) {
    return isPlainObject(v) &&
      typeof v.x === 'number' && isFinite(v.x) &&
      typeof v.y === 'number' && isFinite(v.y);
  }
  function isValidProgress(v) {
    return isPlainObject(v) &&
      Array.isArray(v.objects) && v.objects.length === 3 && // Chapter I has exactly 3 objects
      isValidLight(v.light) &&
      typeof v.moves === 'number' && typeof v.elapsedMs === 'number';
  }
  // writeVerified(key, value): write, read back, compare with the
  // intended raw string; false on any mismatch or thrown error.
  // value may be an object (serialised) or a raw string (backup).
  // Used for ALL migration writes — never saveJSON for migration.
  function writeVerified(key, value) {
    try {
      var raw = (typeof value === 'string') ? value : JSON.stringify(value);
      localStorage.setItem(key, raw);
      return localStorage.getItem(key) === raw;
    } catch (e) { return false; }
  }
  function migrateStorageV1() {
    var rawBest = null, rawProgress = null;
    try {
      if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'done') return;
      rawBest = localStorage.getItem(BEST_KEY);
      rawProgress = localStorage.getItem(PROGRESS_KEY);
    } catch (e) { console.warn('[sa-migration] storage unreadable, skipping; will retry next load'); return; }
    if (rawBest !== null) {
      var parsedBest = null;
      try { parsedBest = JSON.parse(rawBest); } catch (e) { parsedBest = null; }
      if (isValidBest(parsedBest)) {
        if (!writeVerified(bestKeyFor('level-01'), { stars: parsedBest.stars, timeMs: parsedBest.timeMs, moves: parsedBest.moves })) {
          console.warn('[sa-migration] best write failed, flag NOT set; will retry next load');
          return;
        }
      }
      // Invalid best: no per-level write (fail closed); the raw string
      // is still backed up below.
    }
    if (rawProgress !== null) {
      var parsedProgress = null;
      try { parsedProgress = JSON.parse(rawProgress); } catch (e) { parsedProgress = null; }
      if (isValidProgress(parsedProgress)) {
        if (!writeVerified(progressKeyFor('level-01'), {
          objects: parsedProgress.objects, light: parsedProgress.light,
          moves: parsedProgress.moves, elapsedMs: parsedProgress.elapsedMs,
          started: !!parsedProgress.started,
          hintsUsed: (typeof parsedProgress.hintsUsed === 'number') ? parsedProgress.hintsUsed : 0
        })) {
          console.warn('[sa-migration] progress write failed, flag NOT set; will retry next load');
          return;
        }
      }
      // Invalid progress: no per-level write (fail closed); the raw
      // string is still backed up below.
    }
    if (rawBest !== null && !writeVerified(BEST_BACKUP_KEY, rawBest)) {
      console.warn('[sa-migration] best backup write failed, flag NOT set; will retry next load');
      return;
    }
    if (rawProgress !== null && !writeVerified(PROGRESS_BACKUP_KEY, rawProgress)) {
      console.warn('[sa-migration] progress backup write failed, flag NOT set; will retry next load');
      return;
    }
    // Flag LAST: only after every verified write succeeded. Any failure
    // above returns early with the flag unset, so the next load re-runs
    // the same deterministic steps (idempotent).
    try { localStorage.setItem(MIGRATION_FLAG_KEY, 'done'); }
    catch (e) { console.warn('[sa-migration] flag write failed, flag NOT set; will retry next load'); }
  }
  migrateStorageV1();
  // bestScore is the CURRENT level's best, loaded from the per-level
  // key. applyLevel() reloads it whenever the level changes.
  var bestScore = loadJSON(bestKeyFor(currentLevel.id)) || null;

  function loadJSON(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- state / layout / view ----------
  function freshState() {
    var objs = SA.Levels.clone(currentLevel.objects);
    // Start positions are authored in landscape space; in portrait they
    // are proportionally remapped into the portrait stage (same remap
    // as an orientation change), so the level is playable in both.
    if (orientation === 'portrait') {
      var base = L.makeLayout('landscape', currentLevel);
      for (var i = 0; i < objs.length; i++) {
        objs[i].cx = clamp(objs[i].cx / base.W * layout.W, layout.stage.x[0], layout.stage.x[1]);
        objs[i].cy = clamp(objs[i].cy / base.H * layout.H, layout.stage.y[0], layout.stage.y[1]);
      }
    }
    return {
      objects: objs,
      light: { x: layout.lightHome.x, y: layout.lightHome.y },
      selectedId: null, moves: 0, match: 0,
      bandScores: [], bandMatched: [],
      started: false, won: false, hintIndex: 0,
      // Deliberate Hint-button presses this attempt. Reset on every
      // fresh attempt. Tutorial/onboarding hints do NOT count — they
      // never call nextHint() (they use SA.UI.showHint directly), so
      // nextHint() IS the deliberate path.
      hintsUsed: 0
    };
  }

  // Load a level definition and start it fresh. The engine's
  // level-loading API: the menu only ever loads 'level-01'; tests use
  // it to validate other defs. A new level always starts at zoom 1x —
  // a leftover pinch zoom must never carry into a fresh level.
  function applyLevel(def) {
    currentLevel = def;
    // bestScore tracks the CURRENT level — reload it from the per-level
    // key whenever the level changes.
    bestScore = loadJSON(bestKeyFor(def.id)) || null;
    layout = L.makeLayout(orientation, currentLevel);
    state = freshState();
    elapsedMs = 0; timerOn = false; lastResult = null; winPending = false;
    screen = 'playing';
    fitView();
    SA.UI.setLevel(currentLevel);
    SA.UI.showScreen(null);
  }

  function isAlmost() {
    return state && state.match >= ALMOST_LO && state.match < currentLevel.win.threshold;
  }

  function computeLayout() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    var orient = (w >= h) ? 'landscape' : 'portrait';
    if (orient !== orientation) {
      // Remap positions proportionally across the orientation change.
      var oldW = layout.W, oldH = layout.H;
      var nl = L.makeLayout(orient, currentLevel);
      if (state) {
        for (var i = 0; i < state.objects.length; i++) {
          var o = state.objects[i];
          o.cx = clamp(o.cx / oldW * nl.W, nl.stage.x[0], nl.stage.x[1]);
          o.cy = clamp(o.cy / oldH * nl.H, nl.stage.y[0], nl.stage.y[1]);
        }
        state.light.x = clamp(state.light.x / oldW * nl.W, nl.lightZone.x[0], nl.lightZone.x[1]);
        state.light.y = clamp(state.light.y / oldH * nl.H, nl.lightZone.y[0], nl.lightZone.y[1]);
      }
      layout = nl; orientation = orient;
    }
    return { w: w, h: h };
  }

  function fitView() {
    var size = computeLayout();
    var cw = size.w, ch = size.h;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    var s = Math.min(cw / layout.W, ch / layout.H);
    view.fitScale = s;
    view.scale = s;
    view.tx = (cw - layout.W * s) / 2;
    view.ty = (ch - layout.H * s) / 2;
  }

  function screenToWorld(px, py) {
    return { x: (px - view.tx) / view.scale, y: (py - view.ty) / view.scale };
  }

  // Tutorial probe — screen coords (the inverse of screenToWorld).
  // The tutorial overlay positions its highlight rings from this,
  // never from hardcoded positions.
  function tutorialProbe() {
    if (!state) return null;
    var toScreen = function (x, y) { return { x: x * view.scale + view.tx, y: y * view.scale + view.ty }; };
    var lp = toScreen(state.light.x, state.light.y);
    var wallRect = null;
    if (layout.axis === 'x') {
      var wx = toScreen(layout.wall, layout.wallSpan[0]);
      wallRect = { x: wx.x, y: wx.y, w: layout.wallThick * view.scale, h: (layout.wallSpan[1] - layout.wallSpan[0]) * view.scale };
    } else {
      var wy = toScreen(layout.wallSpan[0], layout.wall);
      wallRect = { x: wy.x, y: wy.y, w: (layout.wallSpan[1] - layout.wallSpan[0]) * view.scale, h: layout.wallThick * view.scale };
    }
    return {
      objects: state.objects.map(function (o) {
        var p = toScreen(o.cx, o.cy);
        return { id: o.id, x: p.x, y: p.y, r: o.r * view.scale };
      }),
      light: { x: lp.x, y: lp.y },
      lightR: 30 * view.scale,
      wall: wallRect,
      selectedId: state.selectedId,
      match: state.match,
      threshold: currentLevel.win.threshold
    };
  }

  // ---------- game actions ----------
  function computeMatch() {
    var ivs = [];
    for (var i = 0; i < state.objects.length; i++) {
      var iv = M.shadowInterval(state.objects[i], state.light, layout);
      ivs.push(iv ? M.clampInterval(iv, layout.wallSpan) : null);
    }
    state.match = M.matchScore(ivs, layout.target);
    // Per-band best single-object IoU drives the target-band
    // indicators; a band counts as matched at >= 0.85.
    state.bandScores = M.bandScores(ivs, layout.target);
    state.bandMatched = state.bandScores.map(function (s) { return s >= 0.85; });
    return state.match;
  }

  function markStarted() {
    if (!state.started) { state.started = true; timerOn = true; }
  }

  function saveProgress() {
    if (!state || state.won) { try { localStorage.removeItem(progressKeyFor(currentLevel.id)); } catch (e) {} return; }
    saveJSON(progressKeyFor(currentLevel.id), {
      objects: state.objects, light: state.light,
      moves: state.moves, elapsedMs: elapsedMs, started: state.started,
      // Persist the deliberate-hint count with the attempt so a
      // back-to-menu -> CONTINUE round-trip keeps it. Old saves
      // without it load as 0 (see loadProgress).
      hintsUsed: state.hintsUsed
    });
  }

  function loadProgress() {
    var p = loadJSON(progressKeyFor(currentLevel.id));
    if (!p || !p.objects || p.objects.length !== currentLevel.objects.length) return false;
    // A payload with 3 objects but a missing/non-object light used to
    // be assigned blindly, then clampLight(state.light) threw TypeError
    // (reads .x of undefined) and crashed continueGame. Guard the light
    // the same way migration does: fail closed, return false.
    if (!isValidLight(p.light)) return false;
    state.objects = p.objects; state.light = p.light;
    // Clamp into the current layout (progress may have been saved in
    // the other orientation).
    for (var i = 0; i < state.objects.length; i++) clampObject(state.objects[i]);
    clampLight(state.light);
    state.moves = p.moves || 0; elapsedMs = p.elapsedMs || 0;
    state.hintsUsed = p.hintsUsed || 0; // absent in pre-v0.8 saves -> 0
    state.started = !!p.started; timerOn = state.started;
    computeMatch();
    return true;
  }

  function getObject(id) {
    for (var i = 0; i < state.objects.length; i++) if (state.objects[i].id === id) return state.objects[i];
    return null;
  }
  function clampObject(o) {
    o.cx = clamp(o.cx, layout.stage.x[0], layout.stage.x[1]);
    o.cy = clamp(o.cy, layout.stage.y[0], layout.stage.y[1]);
    // Never let an object cross in front of the light.
    if (layout.axis === 'x') o.cx = Math.max(o.cx, state.light.x + 45);
    else o.cy = Math.max(o.cy, state.light.y + 45);
  }
  function clampLight(p) {
    p.x = clamp(p.x, layout.lightZone.x[0], layout.lightZone.x[1]);
    p.y = clamp(p.y, layout.lightZone.y[0], layout.lightZone.y[1]);
  }

  // ---------- victory (P1: deferred until pointer release) ----------
  // Called from the frame loop every frame while playing, and from
  // endDrag() (pointer release) and rotateSelected() (no-drag win path).
  function checkWin() {
    if (state.won || screen !== 'playing') return;
    if (state.match < currentLevel.win.threshold) {
      // Below threshold: any pending win is gone (a drag that swept
      // past 90% and came back before release must NOT win).
      winPending = false;
      return;
    }
    if (isDragging()) {
      // Match is live at/above threshold but a finger/mouse is still
      // holding an object/light: record PENDING only. No lock, no
      // frozen values, no win sound, no timer, no screen. The HUD
      // keeps updating in real time; the player sees nothing different.
      winPending = true;
      return;
    }
    // No drag active: confirm now. This also covers the frame-loop
    // safety net — if winPending was set and the release event was ever
    // lost, the next frame with no drag active confirms here instead
    // of leaving a pending win stuck forever.
    confirmWin();
  }

  // The old checkWin body, now run ONLY at confirmation time. The
  // frozen snapshot is taken HERE (after pointer release for drag
  // wins), not at first crossing — so the displayed match / moves /
  // time and the star-rating accuracy input are the FINAL position's
  // values. The win sound also moves here (confirmation, not crossing).
  function confirmWin() {
    if (state.won || screen !== 'playing') return;
    winPending = false;
    state.won = true; timerOn = false;
    SA.Audio.win();
    // Victory-score freeze, retimed to confirmation: capture the result
    // when the win is confirmed. The completion screen appears 650 ms
    // later but displays these SAVED values — never a re-compute. A
    // drag cannot be in progress at confirmation, and post-confirmation
    // movement input is ignored by the guards in moveObject /
    // moveLight / rotateSelected / nudgeSelected, so the frozen values
    // cannot drift.
    var frozen = { match: state.match, moves: state.moves, timeMs: elapsedMs, hintsUsed: state.hintsUsed };
    lastResult = frozen;
    setTimeout(function () {
      if (!state.won) return;
      // Stars from the AND model over moves, seconds, CONFIRMATION
      // match (frozen.match — never the drag peak) and deliberate
      // hints (frozen.hintsUsed).
      var stars = L.starsFor(frozen.moves, frozen.timeMs / 1000, frozen.match, frozen.hintsUsed, currentLevel);
      var result = { match: frozen.match, moves: frozen.moves, timeMs: frozen.timeMs, stars: stars, hintsUsed: frozen.hintsUsed, isNewBest: false, criteria: criteriaLine() };
      // Best-score comparison: more stars wins, tie broken by faster
      // time (strict < keeps the incumbent on an exact tie). Old stored
      // bests are grandfathered — never re-rated, never wiped.
      if (!bestScore || stars > bestScore.stars ||
          (stars === bestScore.stars && frozen.timeMs < bestScore.timeMs)) {
        bestScore = { stars: stars, timeMs: frozen.timeMs, moves: frozen.moves };
        saveJSON(bestKeyFor(currentLevel.id), bestScore);
        result.isNewBest = true;
      }
      try { localStorage.removeItem(progressKeyFor(currentLevel.id)); } catch (e) {}
      screen = 'complete'; SA.UI.showComplete(result); SA.UI.showScreen('complete');
    }, 650);
  }

  // One-line star-criteria text for the complete screen, from the
  // current level's Normal par table. E.g. "3★: ≤25 moves · ≤120s ·
  // ≥95% · ≤1 hint". Legacy levels whose par has no hint cap omit the
  // hint part (maxHints Infinity).
  function criteriaLine() {
    var par = L.parFor(currentLevel)[0];
    var s = '3★: ≤' + par.moves + ' moves · ≤' + par.seconds + 's · ≥' + Math.round(par.minMatch * 100) + '%';
    if (isFinite(par.maxHints)) s += ' · ≤' + par.maxHints + (par.maxHints === 1 ? ' hint' : ' hints');
    return s;
  }

  // ---------- public game API (used by UI + input) ----------
  var game = {
    get screen() { return screen; },
    get state() { return state; },
    get view() { return view; },
    get settings() { return settings; },
    get settingsReturn() { return settingsReturn; },
    get bestScore() { return bestScore; },
    // Per-level best read (live, for level cards / harness).
    // game.bestScore is the CURRENT level's best; this reads any
    // level's key (levels 02–06 are empty until played).
    bestScoreFor: function (levelId) { return loadJSON(bestKeyFor(levelId)) || null; },
    get hudHidden() { return hudHidden; },

    saveSettings: function () { saveJSON(SETTINGS_KEY, settings); },
    // Clears ONLY the current level's best — other levels' earned
    // bests are untouched. Also resets the in-memory bestScore.
    clearBest: function () { bestScore = null; try { localStorage.removeItem(bestKeyFor(currentLevel.id)); } catch (e) {} },
    setHudOpacity: function (v) {
      settings.hudOpacity = v; saveJSON(SETTINGS_KEY, settings);
      SA.UI.setHudOpacity(v);
    },
    setHudHidden: function (h) {
      hudHidden = h;
      SA.UI.showScreen(null);
    },
    showScreen: function (name, ret) {
      if (name === 'settings') settingsReturn = ret || 'menu';
      // Settings-back from the pause screen calls showScreen('pause'),
      // which used to store the literal string 'pause' — a state the
      // engine does not know ('paused' is the real state). RESUME, ESC
      // and RESTART all test for 'paused', so the game softlocked on
      // the pause screen with a dead RESUME button. Only MAIN MENU
      // escaped. Map it to the real state here.
      screen = name === null ? 'playing' : (name === 'pause' ? 'paused' : name);
      SA.UI.showScreen(name);
    },
    startFresh: function () {
      state = freshState(); elapsedMs = 0; timerOn = false; lastResult = null; winPending = false;
      try { localStorage.removeItem(progressKeyFor(currentLevel.id)); } catch (e) {}
      screen = 'playing';
      fitView(); // zoom reset to 1x on level start
      SA.UI.setLevel(currentLevel);
      SA.UI.showScreen(null);
      SA.Audio.startMusic(); // music starts on the PLAY gesture
      SA.UI.toast(currentLevel.chapter + ' — ' + currentLevel.name + '. Match the shadow to the silhouette (' + Math.round(currentLevel.win.threshold * 100) + '%).');
      SA.UI.showHint(currentLevel.hints[0]);
      // First-time tutorial — auto-shows ONLY on a fresh entry (PLAY /
      // level select / REPLAY all come through startFresh). CONTINUE
      // (continueGame) never triggers it.
      if (SA.Tutorial) SA.Tutorial.start(false);
    },
    continueGame: function () {
      state = freshState(); elapsedMs = 0; timerOn = false; winPending = false;
      var resumed = loadProgress();
      screen = 'playing';
      fitView(); // zoom reset to 1x on re-entering the level
      SA.UI.setLevel(currentLevel);
      SA.UI.showScreen(null);
      SA.Audio.startMusic(); // music starts on the CONTINUE gesture
      SA.UI.toast(resumed ? 'Progress restored. The light is where you left it.' : 'No saved progress — starting ' + currentLevel.chapter + ' fresh.');
      if (!resumed) SA.UI.showHint(currentLevel.hints[0]);
    },
    backToMenu: function () {
      saveProgress();
      winPending = false; // leaving the level drops any pending win
      if (SA.Tutorial) SA.Tutorial.stop(); // leaving mid-tutorial ends it (it will auto-show on the next fresh PLAY)
      screen = 'menu';
      SA.Audio.stopMusic(); // menu is quiet — music restarts on PLAY
      SA.UI.showScreen('menu');
    },
    // Replay Tutorial — the primary path is the pause-screen button:
    // resume into playing with the tutorial running from step 1.
    replayTutorial: function () {
      if (screen === 'paused') { screen = 'playing'; SA.Audio.resumeMusic(); SA.UI.showScreen(null); }
      if (screen !== 'playing') return;
      if (SA.Tutorial) SA.Tutorial.start(true);
    },
    // Settings-screen Replay Tutorial. Settings opened from pause
    // (settingsReturn === 'pause') means we are in-game: resume into
    // playing with the tutorial. Settings opened from the menu means no
    // level is running: start Chapter I fresh, with the tutorial forced
    // on (startFresh alone would only auto-show it if never seen).
    replayTutorialFromSettings: function () {
      if (settingsReturn === 'pause') {
        screen = 'playing'; SA.Audio.resumeMusic(); SA.UI.showScreen(null);
        if (SA.Tutorial) SA.Tutorial.start(true);
      } else {
        game.startFresh();
        if (SA.Tutorial) SA.Tutorial.start(true);
      }
    },
    togglePause: function () {
      if (screen === 'playing') {
        screen = 'paused'; frozenTime = performance.now();
        SA.Audio.pauseMusic(); // music ducks out while paused
        SA.UI.showScreen('pause');
      } else if (screen === 'paused') {
        screen = 'playing';
        SA.Audio.resumeMusic();
        SA.UI.showScreen(null);
      }
    },
    resumeFromPause: function () {
      if (screen === 'paused') { screen = 'playing'; SA.Audio.resumeMusic(); SA.UI.showScreen(null); }
    },
    resetLevel: function () {
      state = freshState(); elapsedMs = 0; timerOn = false; lastResult = null; winPending = false;
      try { localStorage.removeItem(progressKeyFor(currentLevel.id)); } catch (e) {}
      if (screen === 'paused') { screen = 'playing'; }
      fitView(); // zoom reset to 1x on level restart
      SA.UI.showScreen(null);
      SA.UI.toast('Level reset.');
    },
    toggleFullscreen: function () {
      try {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
        else document.exitFullscreen().catch(function () {});
      } catch (e) {}
    },
    select: function (id) {
      if (state.selectedId !== id) { state.selectedId = id; if (id) SA.Audio.select(); }
    },
    getObject: getObject,
    screenToWorld: screenToWorld,
    isDragging: isDragging, // input.js drag state, for UI/tests
    tutorialProbe: tutorialProbe,
    moveObject: function (id, x, y) {
      if (state.won) return; // no movement after confirmation
      var o = getObject(id); if (!o) return;
      markStarted();
      o.cx = x; o.cy = y; clampObject(o);
      computeMatch();
      if (SA.Tutorial) SA.Tutorial.notify('object-drag');
    },
    moveLight: function (x, y) {
      if (state.won) return; // no movement after confirmation
      markStarted();
      state.light.x = x; state.light.y = y; clampLight(state.light);
      computeMatch();
      if (SA.Tutorial) SA.Tutorial.notify('light-drag');
    },
    endDrag: function () {
      if (!state.started) return;
      if (state.won) return; // no moves counted after confirmation
      state.moves++;
      SA.Audio.move();
      saveProgress();
      // Release re-evaluation. input.js clears drag BEFORE calling
      // endDrag, so checkWin() here sees no active drag: if the final
      // position is still >= threshold it confirms the win (freezing
      // the FINAL values); if it dropped below, the pending win is
      // cleared and play continues. A press-without-move never reaches
      // here (input only calls endDrag when drag.moved).
      computeMatch();
      checkWin();
    },
    rotateSelected: function (deg) {
      if (state.won) return; // no movement after confirmation
      var o = getObject(state.selectedId); if (!o) return;
      markStarted();
      o.rotDeg = ((o.rotDeg + deg) % 360 + 360) % 360;
      state.moves++;
      SA.Audio.rotate();
      computeMatch(); saveProgress(); checkWin();
      if (SA.Tutorial) SA.Tutorial.notify('rotate');
    },
    nudgeSelected: function (dx, dy) {
      if (state.won) return; // no movement after confirmation
      var o = getObject(state.selectedId); if (!o) return;
      markStarted();
      o.cx += dx; o.cy += dy; clampObject(o);
      state.moves++;
      computeMatch(); saveProgress();
    },
    // DELIBERATE Hint-button presses only. This is the only caller
    // path that counts: both Hint buttons (desktop + mobile bar) call
    // game.nextHint(). The automatic hint at level start and the
    // tutorial/onboarding hints NEVER call nextHint() — startFresh /
    // continueGame show hints[0] via SA.UI.showHint() directly, and
    // tutorial.js shows its own steps via its overlay — so they do not
    // increment hintsUsed (or hintIndex).
    nextHint: function () {
      var h = currentLevel.hints[state.hintIndex % currentLevel.hints.length];
      state.hintIndex++;
      state.hintsUsed++;
      SA.UI.showHint(h);
    },
    // Level-loading API. The menu only loads 'level-01'; loadLevelData
    // accepts any validated def (tests use it for level-02 test data).
    loadLevel: function (id) {
      var def = L.resolveLevel(id);
      if (!def) return { ok: false, error: 'unknown level: ' + id };
      applyLevel(def);
      return { ok: true, id: def.id };
    },
    loadLevelData: function (def) {
      var err = L.validateLevelData(def);
      if (err) return { ok: false, error: err };
      applyLevel(SA.Levels.clone(def));
      return { ok: true, id: def.id };
    },
    zoomBy: function (scale, midX, midY, pinch) {
      var s = clamp(scale, view.fitScale, view.fitScale * 2.5);
      var ratio = s / pinch.scale0;
      view.scale = s;
      view.tx = midX - (midX - pinch.tx0) * ratio;
      view.ty = midY - (midY - pinch.ty0) * ratio;
    },
    resetZoom: function () { fitView(); }
  };

  // ---------- loop ----------
  function frame(t) {
    rafId = requestAnimationFrame(frame);
    var dt = lastT ? t - lastT : 16;
    lastT = t;
    if (screen === 'playing' && timerOn && state && state.started && !state.won) {
      elapsedMs += dt;
    }
    var timeMs = (screen === 'paused') ? frozenTime : t;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.fillStyle = '#0b1026';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (state) {
      // checkWin() every frame is also the safety net — a winPending
      // left over from a lost release event confirms here as soon as
      // no drag is active.
      if (screen === 'playing') { computeMatch(); checkWin(); }
      SA.Render.draw(state, ctx, layout, view, timeMs);
    }
    if (screen === 'playing' && state) SA.UI.updateHUD(state, elapsedMs);
  }

  function onResize() { fitView(); }
  function onVisibility() {
    if (document.hidden) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (screen === 'playing') { game.togglePause(); }
    } else if (!rafId) {
      lastT = 0;
      rafId = requestAnimationFrame(frame);
    }
  }

  function init() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    state = freshState();
    SA.Audio.setVolume(settings.volume);
    SA.Audio.setMuted(settings.muted);
    SA.Audio.setMusicOn(settings.musicOn);
    SA.Audio.setMusicVolume(settings.musicVolume);
    fitView();
    SA.UI.init(game);
    if (SA.Tutorial) SA.Tutorial.init(game);
    SA.UI.setLevel(currentLevel);
    SA.UI.showScreen('menu');
    inputApi = SA.Input.attach(canvas, game);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    rafId = requestAnimationFrame(frame);
  }

  // Read-only debug handle for the automated test script (no setters,
  // except the level-loading probes, which load level DATA only).
  window.SA_DEBUG = {
    version: '1.0',
    // Migration state probe + test-only re-run hook. runMigration is a
    // no-op once the flag is set; the harness deletes the flag first,
    // then calls it. It also refreshes the in-memory bestScore from
    // the per-level key, so a harness-driven re-migration is visible
    // to game.bestScore.
    migration: function () {
      var flag = null;
      try { flag = localStorage.getItem(MIGRATION_FLAG_KEY); } catch (e) {}
      return { done: flag === 'done', flag: flag, bestKey: bestKeyFor(currentLevel.id), progressKey: progressKeyFor(currentLevel.id), levelId: currentLevel.id };
    },
    bestScoreFor: function (levelId) { return game.bestScoreFor(levelId); },
    runMigration: function () {
      migrateStorageV1();
      bestScore = loadJSON(bestKeyFor(currentLevel.id)) || null;
      return true;
    },
    screen: function () { return screen; },
    layout: function () { return JSON.parse(JSON.stringify(layout)); },
    getState: function () {
      return {
        objects: JSON.parse(JSON.stringify(state.objects)),
        light: { x: state.light.x, y: state.light.y },
        match: state.match, moves: state.moves,
        elapsedMs: elapsedMs, selectedId: state.selectedId,
        won: state.won, started: state.started,
        hintsUsed: state.hintsUsed // deliberate Hint presses
      };
    },
    view: function () { return { scale: view.scale, tx: view.tx, ty: view.ty, fitScale: view.fitScale }; },
    threshold: function () { return currentLevel.win.threshold; },
    levelId: function () { return currentLevel.id; },
    level: function () { return JSON.parse(JSON.stringify(currentLevel)); },
    loadLevel: function (id) { return game.loadLevel(id); },
    loadLevelData: function (def) { return game.loadLevelData(def); },
    // Tutorial-feedback probe — per-band best single-object IoU,
    // which bands are matched, and whether the 85–89% "almost" state
    // is active.
    feedback: function () {
      computeMatch();
      return {
        match: state.match,
        bandScores: state.bandScores.slice(),
        bandMatched: state.bandMatched.slice(),
        almost: isAlmost(),
        threshold: currentLevel.win.threshold
      };
    },
    // Live shadow intervals per object (null = unprojectable) and the
    // cost of one live match recompute.
    intervals: function () {
      var out = [];
      for (var i = 0; i < state.objects.length; i++) {
        var iv = M.shadowInterval(state.objects[i], state.light, layout);
        out.push(iv ? M.clampInterval(iv, layout.wallSpan) : null);
      }
      return out;
    },
    matchCostUs: function () {
      var t0 = performance.now();
      for (var i = 0; i < 1000; i++) computeMatch();
      return performance.now() - t0; // ms per 1000 calls == us per call
    },
    tutorial: function () { return SA.Tutorial ? SA.Tutorial.probe() : { active: false, step: 0, seen: false, overlayVisible: false }; },
    // Frozen win snapshot (null until a win is CONFIRMED) — the values
    // the completion screen displays. Frozen at confirmation (pointer
    // release), not at first crossing; includes hintsUsed. A drag
    // during the 650 ms reveal window cannot happen (input is guarded
    // after confirmation) and never changes this snapshot.
    lastResult: function () { return lastResult ? { match: lastResult.match, moves: lastResult.moves, timeMs: lastResult.timeMs, hintsUsed: lastResult.hintsUsed } : null; },
    winPending: function () { return winPending; },
    isDragging: function () { return isDragging(); },
    tutorialProbe: function () { return tutorialProbe(); },
    audioAvailable: function () { return SA.Audio.isAvailable(); },
    audioMusic: function () { return SA.Audio.getState(); },
    hudHidden: function () { return hudHidden; },
    notify: function () { return SA.UI.notifyState(); },
    inputPointers: function () { return inputApi ? inputApi.activePointers() : 0; },
    pinchActive: function () { return inputApi ? inputApi.pinchActive() : false; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
