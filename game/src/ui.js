/* SHADOW ARCHITECT — DOM UI: screens, HUD, settings, hints, toasts. */
var SA = (typeof SA !== 'undefined') ? SA : {};
SA.UI = (function () {
  'use strict';
  var game = null;
  var el = {};
  var hintTimer = null, toastTimer = null;
  var lastHud = { match: -1, moves: -1, time: -1 };

  function $(id) { return document.getElementById(id); }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var mm = Math.floor(s / 60);
    var ss = s % 60;
    return mm + ':' + (ss < 10 ? '0' + ss : String(ss));
  }

  function bestLabel(best) {
    if (!best) return '';
    return 'Best: ' + '★'.repeat(best.stars) + ' · ' + fmtTime(best.timeMs) + ' · ' + best.moves + ' moves';
  }

  // The HUD music button mirrors the persisted music setting.
  function refreshMusicBtn() {
    var b = $('btn-music');
    if (!b) return;
    var on = game.settings.musicOn;
    b.textContent = on ? '♪ Music' : '♪ Muted';
    b.classList.toggle('off', !on);
    b.title = on ? 'Music on — tap to turn off' : 'Music off — tap to turn on';
  }

  function setMusicOn(on) {
    game.settings.musicOn = !!on;
    SA.Audio.setMusicOn(game.settings.musicOn);
    if (game.settings.musicOn && game.screen === 'playing') SA.Audio.startMusic();
    game.saveSettings();
    refreshMusicBtn();
    var c = $('set-music-on');
    if (c) c.checked = game.settings.musicOn;
  }

  function showScreen(name) {
    var screens = ['menu', 'levels', 'settings', 'credits', 'pause', 'complete', 'chapter2'];
    var i, s;
    for (i = 0; i < screens.length; i++) {
      s = $('screen-' + screens[i]);
      if (s) s.classList.toggle('hidden', screens[i] !== name);
    }
    var inGame = (name === null);
    $('hud').classList.toggle('hidden', !inGame || game.hudHidden);
    $('hud-restore').classList.toggle('hidden', !inGame || !game.hudHidden);
    $('mobile-bar').classList.toggle('hidden', !inGame);
    clearNotifications(); // screen changes reset toast/hint/queue state
    if (name === 'levels') refreshLevelBest();
  }

  function refreshLevelBest() {
    var b = game.bestScore;
    $('level-1-best').textContent = b ? bestLabel(b) : 'No completion yet';
    $('set-best-label').textContent = b ? bestLabel(b) : 'No best score yet';
  }

  function updateHUD(state, elapsedMs) {
    var matchPct = Math.round(state.match * 100);
    if (matchPct !== lastHud.match) {
      $('hud-match').textContent = matchPct + '%';
      // Classes belong on the .hud-match box: the % span itself carries
      // no .hud-match class, so toggling there would do nothing.
      var matchBox = $('hud-match').parentElement;
      matchBox.classList.toggle('good', state.match >= 0.90);
      // 85–89%: the number pulses amber and the label reads ALMOST!,
      // so a player just under the goal knows they are close.
      // No solution is revealed.
      var almost = state.match >= 0.85 && state.match < 0.90;
      matchBox.classList.toggle('almost', almost);
      $('hud-match-label').textContent = almost ? 'ALMOST! · goal 90%' : 'MATCH · goal 90%';
      lastHud.match = matchPct;
    }
    if (state.moves !== lastHud.moves) {
      $('hud-moves').textContent = state.moves + (state.moves === 1 ? ' move' : ' moves');
      lastHud.moves = state.moves;
    }
    var t = Math.floor(elapsedMs / 1000);
    if (t !== lastHud.time) {
      $('hud-time').textContent = fmtTime(elapsedMs);
      lastHud.time = t;
    }
  }

  // One notification slot, shared in TIME, never in space. The strip
  // below the HUD fits exactly one pill in every viewport, so a toast
  // takes priority for 2.6 s, a visible hint is parked with its
  // remaining time and restored after the toast hides, a hint requested
  // during a toast waits, and toasts queue one at a time (max 2 queued;
  // a duplicate of the toast currently showing is ignored).
  var TOAST_MS = 2600, HINT_MS = 6000, TOAST_QUEUE_MAX = 2;
  var hintDeadline = 0;   // performance.now() when the visible hint expires
  var parkedHint = null;  // { text, deadline } — hidden while a toast shows;
                          // its 6 s lifetime keeps running while parked, so
                          // remaining time is computed at RESTORE, not park
  var pendingHint = null; // { text } — hint requested while a toast shows
  var toastQueue = [];    // pending toast messages
  var toastActive = false;

  function showHint(text) {
    if (toastActive) { pendingHint = { text: text }; return; }
    parkedHint = null;
    var bar = $('hint-bar');
    $('hint-text').textContent = '💡 ' + text;
    bar.classList.remove('hidden');
    if (hintTimer) clearTimeout(hintTimer);
    hintDeadline = performance.now() + HINT_MS;
    hintTimer = setTimeout(function () { bar.classList.add('hidden'); hintTimer = null; }, HINT_MS);
  }

  function hideHint() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    parkedHint = null; pendingHint = null;
    $('hint-bar').classList.add('hidden');
  }

  function parkHint() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    var bar = $('hint-bar');
    if (!bar.classList.contains('hidden')) {
      // Keep the original deadline: the hint's lifetime keeps running
      // while it is parked behind toasts (see restoreHint).
      if (hintDeadline - performance.now() > 0) {
        parkedHint = { text: $('hint-text').textContent.replace('💡 ', ''), deadline: hintDeadline };
      }
    }
    bar.classList.add('hidden');
  }

  function restoreHint() {
    if (pendingHint) {
      var t = pendingHint.text; pendingHint = null; parkedHint = null;
      showHint(t); // full 6 s — a pending hint never started its clock
      return true;
    }
    if (parkedHint) {
      var p = parkedHint; parkedHint = null;
      var remaining = Math.max(0, p.deadline - performance.now());
      if (remaining <= 0) return false; // lifetime expired while parked
      var bar = $('hint-bar');
      $('hint-text').textContent = '💡 ' + p.text;
      bar.classList.remove('hidden');
      if (hintTimer) clearTimeout(hintTimer);
      hintDeadline = performance.now() + remaining;
      hintTimer = setTimeout(function () { bar.classList.add('hidden'); hintTimer = null; }, remaining);
      return true;
    }
    return false;
  }

  function displayToast(msg) {
    toastActive = true;
    parkHint();
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(endToast, TOAST_MS);
  }

  function endToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    $('toast').classList.add('hidden');
    toastActive = false;
    if (toastQueue.length) { displayToast(toastQueue.shift()); return; }
    restoreHint();
  }

  function toast(msg) {
    if (toastActive) {
      if ($('toast').textContent === msg) return; // duplicate of the one showing
      if (toastQueue.length < TOAST_QUEUE_MAX && toastQueue[toastQueue.length - 1] !== msg) {
        toastQueue.push(msg);
      }
      return;
    }
    displayToast(msg);
  }

  function hideToast() {
    if (toastActive) endToast(); // tap dismiss; a queued toast / parked hint follows
  }

  function clearNotifications() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    toastQueue.length = 0; toastActive = false;
    parkedHint = null; pendingHint = null;
    $('toast').classList.add('hidden');
    $('hint-bar').classList.add('hidden');
  }

  function notifyState() {
    var hintMs = 0;
    if (!$('hint-bar').classList.contains('hidden')) {
      hintMs = Math.max(0, hintDeadline - performance.now());
    } else if (parkedHint) {
      hintMs = Math.max(0, parkedHint.deadline - performance.now());
    }
    return {
      toast: toastActive,
      hint: !$('hint-bar').classList.contains('hidden'),
      queued: toastQueue.length,
      parked: !!parkedHint,
      pending: !!pendingHint,
      hintMs: Math.round(hintMs)
    };
  }

  function setHudOpacity(v) {
    $('hud').style.opacity = v;
    var o1 = $('hud-opacity'), o2 = $('set-hud-opacity');
    if (o1 && o1.value !== String(v)) o1.value = v;
    if (o2 && o2.value !== String(v)) o2.value = v;
  }

  // HUD title/objective come from the loaded level's data, so a new
  // level needs no UI code changes.
  function setLevel(level) {
    $('hud-title').textContent = level.chapter + ' — ' + level.name;
    $('hud-objective').textContent = 'Match the shadow to the ivory silhouette on the wall.';
  }

  function showComplete(result) {
    $('complete-match').textContent = Math.round(result.match * 100) + '%';
    $('complete-time').textContent = fmtTime(result.timeMs);
    $('complete-moves').textContent = String(result.moves);
    $('complete-stars').textContent = '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
    // Star-criteria line, e.g. "3★: ≤25 moves · ≤120s · ≥95% · ≤1 hint".
    if ($('complete-criteria')) $('complete-criteria').textContent = result.criteria || '';
    $('complete-best').textContent = result.isNewBest ? '★ New best score! ★' : bestLabel(game.bestScore);
  }

  function init(g) {
    game = g;
    el = {};
    // Menu
    $('menu-play').addEventListener('click', function () { SA.Audio.ensure(); game.startFresh(); });
    $('menu-continue').addEventListener('click', function () { SA.Audio.ensure(); game.continueGame(); });
    $('menu-levels').addEventListener('click', function () { game.showScreen('levels'); });
    $('menu-settings').addEventListener('click', function () { game.showScreen('settings', 'menu'); });
    $('menu-credits').addEventListener('click', function () { game.showScreen('credits'); });
    // Level select
    $('level-1').addEventListener('click', function () { SA.Audio.ensure(); game.startFresh(); });
    $('levels-back').addEventListener('click', function () { game.showScreen('menu'); });
    // Settings
    $('settings-back').addEventListener('click', function () { game.showScreen(game.settingsReturn || 'menu'); });
    $('set-volume').addEventListener('input', function (e) {
      game.settings.volume = parseFloat(e.target.value);
      SA.Audio.setVolume(game.settings.volume);
      game.saveSettings();
    });
    $('set-mute').addEventListener('change', function (e) {
      game.settings.muted = e.target.checked;
      SA.Audio.setMuted(game.settings.muted);
      game.saveSettings();
    });
    // Music controls — checkbox + volume slider, persisted in the same
    // sa-settings-v1 object as volume/mute.
    $('set-music-on').addEventListener('change', function (e) { setMusicOn(e.target.checked); });
    $('set-music-volume').addEventListener('input', function (e) {
      game.settings.musicVolume = parseFloat(e.target.value);
      SA.Audio.setMusicVolume(game.settings.musicVolume);
      game.saveSettings();
    });
    $('set-hud-opacity').addEventListener('input', function (e) {
      game.setHudOpacity(parseFloat(e.target.value));
    });
    $('set-reset-best').addEventListener('click', function () {
      game.clearBest();
      refreshLevelBest();
      toast('Best score cleared.');
    });
    // Replay Tutorial from Settings. In-game (opened from pause) it
    // resumes into the level with the tutorial; from the menu it starts
    // Chapter I fresh with the tutorial forced on.
    $('set-tutorial').addEventListener('click', function () { game.replayTutorialFromSettings(); });
    // Credits
    $('credits-back').addEventListener('click', function () { game.showScreen('menu'); });
    // Pause
    $('pause-resume').addEventListener('click', function () { game.togglePause(); });
    $('pause-restart').addEventListener('click', function () { game.resetLevel(); game.resumeFromPause(); });
    // Replay Tutorial — resume into playing with the tutorial from step 1.
    $('pause-tutorial').addEventListener('click', function () { game.replayTutorial(); });
    $('pause-settings').addEventListener('click', function () { game.showScreen('settings', 'pause'); });
    $('pause-menu').addEventListener('click', function () { game.backToMenu(); });
    // Complete
    $('complete-replay').addEventListener('click', function () { game.startFresh(); });
    // NEXT CHAPTER — locked Chapter II screen (no playable content).
    $('complete-next').addEventListener('click', function () { game.showScreen('chapter2'); });
    $('complete-menu').addEventListener('click', function () { game.backToMenu(); });
    // Chapter II locked screen: back to menu, or replay Chapter I.
    $('chapter2-replay').addEventListener('click', function () { game.startFresh(); });
    $('chapter2-menu').addEventListener('click', function () { game.backToMenu(); });
    // HUD
    $('btn-hint').addEventListener('click', function () { game.nextHint(); });
    $('btn-music').addEventListener('click', function () { setMusicOn(!game.settings.musicOn); });
    $('btn-reset').addEventListener('click', function () { game.resetLevel(); });
    $('btn-pause').addEventListener('click', function () { game.togglePause(); });
    $('btn-full').addEventListener('click', function () { game.toggleFullscreen(); });
    // Desktop Reset View — same action as the mobile bar's zoom button.
    $('btn-view').addEventListener('click', function () { game.resetZoom(); toast('Zoom reset.'); });
    $('btn-hidehud').addEventListener('click', function () { game.setHudHidden(true); });
    $('hud-restore').addEventListener('click', function () { game.setHudHidden(false); });
    $('hud-opacity').addEventListener('input', function (e) { game.setHudOpacity(parseFloat(e.target.value)); });
    // Hint bar + toast dismiss on tap; the hint also has a close button.
    $('hint-bar').addEventListener('click', function () { hideHint(); });
    $('hint-close').addEventListener('click', function (e) { e.stopPropagation(); hideHint(); });
    $('toast').addEventListener('click', function () { hideToast(); });
    // Mobile bar
    $('btn-rot-l').addEventListener('click', function () { game.rotateSelected(-15); });
    $('btn-rot-r').addEventListener('click', function () { game.rotateSelected(15); });
    $('btn-m-hint').addEventListener('click', function () { game.nextHint(); });
    $('btn-m-reset').addEventListener('click', function () { game.resetLevel(); });
    $('btn-m-pause').addEventListener('click', function () { game.togglePause(); });
    $('btn-m-zoom').addEventListener('click', function () { game.resetZoom(); toast('Zoom reset.'); });

    // Apply persisted settings to the controls.
    $('set-volume').value = game.settings.volume;
    $('set-mute').checked = game.settings.muted;
    $('set-music-on').checked = game.settings.musicOn;
    $('set-music-volume').value = game.settings.musicVolume;
    refreshMusicBtn();
    $('set-hud-opacity').value = game.settings.hudOpacity;
    $('hud-opacity').value = game.settings.hudOpacity;
    setHudOpacity(game.settings.hudOpacity);
    refreshLevelBest();
  }

  return {
    init: init, showScreen: showScreen, updateHUD: updateHUD,
    showHint: showHint, hideHint: hideHint, toast: toast, hideToast: hideToast,
    clearNotifications: clearNotifications, notifyState: notifyState,
    setHudOpacity: setHudOpacity, setLevel: setLevel,
    showComplete: showComplete, refreshLevelBest: refreshLevelBest,
    fmtTime: fmtTime
  };
})();
