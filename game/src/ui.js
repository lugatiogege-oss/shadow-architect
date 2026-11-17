// Shadow Architect — ui (clean-room rebuild, written from SPEC.md only).
// Owns every screen, the heads-up display, toasts, display hide/restore,
// and settings wiring. Screens are shown one at a time by their identifiers
// from the specification. Time is shown as minutes and seconds, two digits
// each. Toasts queue at most two at a time: hint toasts stay six seconds,
// other toasts about two and six tenths seconds.
(function () {
  'use strict';

  var SA = window.SA || (window.SA = {});

  var SCREEN_IDS = [
    'screen-menu',
    'screen-levels',
    'screen-settings',
    'screen-credits',
    'screen-game',
    'screen-pause',
    'screen-complete',
    'screen-chapter2'
  ];

  var HINT_TOAST_MS = 6000;
  var TOAST_MS = 2600;
  var MAX_TOAST_QUEUE = 2;

  var settingsReturn = 'menu'; // screen to go back to from settings
  var pauseReturn = 'menu'; // screen settings was opened from, when paused
  var toastQueue = []; // pending { message, isHint }
  var toastTimer = null;
  var toastShowing = false;
  var wired = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function formatTime(totalSeconds) {
    var seconds = Math.max(0, Math.floor(totalSeconds || 0));
    var minutes = Math.floor(seconds / 60);
    var remainder = seconds % 60;
    var minuteText = minutes < 10 ? '0' + minutes : String(minutes);
    var secondText = remainder < 10 ? '0' + remainder : String(remainder);
    return minuteText + ':' + secondText;
  }

  function formatPercent(match) {
    var value = Math.round((match || 0) * 100);
    if (value < 0) { value = 0; }
    if (value > 100) { value = 100; }
    return value + '%';
  }

  // --- screens -------------------------------------------------------------

  function showScreen(name) {
    // Accept a short name ("menu") or a full identifier ("screen-menu").
    var id = name.indexOf('screen-') === 0 ? name : 'screen-' + name;
    SCREEN_IDS.forEach(function (screenId) {
      var element = byId(screenId);
      if (!element) { return; }
      var visible = screenId === id;
      element.hidden = !visible;
      element.classList.toggle('active', visible);
      element.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
    return id;
  }

  function showMenu() { return showScreen('menu'); }
  function showLevels() { return showScreen('levels'); }
  function showSettings(from) {
    if (from) { settingsReturn = from; }
    return showScreen('settings');
  }
  function showCredits() { return showScreen('credits'); }
  function showGame() { return showScreen('game'); }
  function showPause() { return showScreen('pause'); }
  function showComplete() { return showScreen('complete'); }
  function showChapter2() { return showScreen('chapter2'); }

  function backFromSettings() {
    // From pause, settings returns to pause; otherwise to the stored screen.
    if (settingsReturn === 'pause') { return showPause(); }
    if (settingsReturn === 'game') { return showGame(); }
    return showMenu();
  }

  // --- heads-up display ----------------------------------------------------

  function updateHUD(state) {
    state = state || SA.state || {};
    var matchElement = byId('hud-match');
    var movesElement = byId('hud-moves');
    var timeElement = byId('hud-time');
    if (matchElement) { matchElement.textContent = formatPercent(state.match); }
    if (movesElement) { movesElement.textContent = String(state.moves || 0); }
    if (timeElement) {
      var seconds = state.elapsedSeconds;
      if (typeof seconds !== 'number' && typeof state.elapsedMs === 'number') {
        seconds = state.elapsedMs / 1000;
      }
      timeElement.textContent = formatTime(seconds);
    }
    updateMusicButton(state);
  }

  function updateHUDNumbers(match, moves, elapsedSeconds) {
    updateHUD({ match: match, moves: moves, elapsedSeconds: elapsedSeconds });
  }

  function updateMusicButton(state) {
    var button = byId('hud-music');
    if (!button) { return; }
    var enabled = true;
    if (SA.audio && typeof SA.audio.isMusicEnabled === 'function') {
      enabled = SA.audio.isMusicEnabled();
    } else if (typeof state.musicEnabled === 'boolean') {
      enabled = state.musicEnabled;
    }
    button.textContent = enabled ? '♪' : '♪̶';
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.classList.toggle('muted', !enabled);
  }

  function hideHUD() {
    var hud = byId('hud');
    var restore = byId('hud-restore');
    if (hud) { hud.hidden = true; hud.classList.add('hidden'); }
    if (restore) { restore.hidden = false; restore.classList.add('visible'); }
  }

  function showHUD() {
    var hud = byId('hud');
    var restore = byId('hud-restore');
    if (hud) { hud.hidden = false; hud.classList.remove('hidden'); }
    if (restore) { restore.hidden = true; restore.classList.remove('visible'); }
  }

  function toggleHUD() {
    var hud = byId('hud');
    if (hud && hud.hidden) { showHUD(); } else { hideHUD(); }
  }

  function setHudVisible(visible) {
    if (visible) { showHUD(); } else { hideHUD(); }
  }

  function setHUDOpacity(value) {
    var hud = byId('hud');
    if (!hud) { return; }
    var opacity = Math.max(0, Math.min(1, Number(value)));
    hud.style.opacity = String(opacity);
  }

  // --- toasts ---------------------------------------------------------------

  function showToastNow(item) {
    var toast = byId('toast');
    if (!toast) { toastShowing = false; return; }
    toastShowing = true;
    toast.textContent = item.message;
    toast.hidden = false;
    toast.classList.add('visible');
    toast.classList.toggle('hint', !!item.isHint);
    var duration = item.durationMs || (item.isHint ? HINT_TOAST_MS : TOAST_MS);
    toastTimer = window.setTimeout(function () {
      toastTimer = null;
      toast.hidden = true;
      toast.classList.remove('visible');
      toastShowing = false;
      showNextToast();
    }, duration);
  }

  function showNextToast() {
    if (toastShowing || toastQueue.length === 0) { return; }
    showToastNow(toastQueue.shift());
  }

  /* options may be { hint: true } or a duration in milliseconds
   * (the main module passes a number); a hint toast stays six
   * seconds, other toasts about two and six tenths seconds. */
  function showToast(message, options) {
    if (!message) { return; }
    var isHint = !!(options && options.hint);
    var duration = TOAST_MS;
    if (typeof options === 'number') { duration = options; }
    else if (isHint) { duration = HINT_TOAST_MS; }
    // Queue at most two at a time: a third toast replaces the oldest queued
    // one rather than growing the queue.
    if (toastQueue.length >= MAX_TOAST_QUEUE) { toastQueue.shift(); }
    toastQueue.push({ message: String(message), isHint: isHint, durationMs: duration });
    showNextToast();
  }

  function showHintToast(message) {
    showToast(message, { hint: true });
  }

  function clearToasts() {
    toastQueue = [];
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    var toast = byId('toast');
    if (toast) {
      toast.hidden = true;
      toast.classList.remove('visible');
    }
    toastShowing = false;
  }

  // --- complete screen ------------------------------------------------------

  function showCompleteResult(result) {
    result = result || {};
    var starsElement = byId('complete-stars');
    var matchElement = byId('complete-match');
    var timeElement = byId('complete-time');
    var movesElement = byId('complete-moves');
    var bestElement = byId('complete-best');
    var criteriaElement = byId('complete-criteria');
    if (starsElement) {
      var stars = result.stars || 1;
      starsElement.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    }
    if (matchElement) { matchElement.textContent = formatPercent(result.match); }
    if (timeElement) {
      var seconds = result.elapsedSeconds;
      if (typeof seconds !== 'number' && typeof result.timeMs === 'number') {
        seconds = result.timeMs / 1000;
      }
      timeElement.textContent = formatTime(seconds);
    }
    if (movesElement) { movesElement.textContent = String(result.moves || 0); }
    if (bestElement) {
      bestElement.textContent = result.isNewBest ? 'New best score' : '';
      bestElement.hidden = !result.isNewBest;
    }
    if (criteriaElement) {
      criteriaElement.textContent = '3 stars: 25 moves, 120 seconds, 95% match, 1 hint. ' +
        '2 stars: 40 moves, 240 seconds, 90% match, 3 hints.';
    }
    return showComplete();
  }

  // --- settings wiring ------------------------------------------------------

  function applySettings(settings) {
    settings = settings || {};
    if (typeof settings.musicVolume === 'number' && SA.audio &&
        typeof SA.audio.setMusicVolume === 'function') {
      SA.audio.setMusicVolume(settings.musicVolume);
    }
    if (typeof settings.hudOpacity === 'number') { setHUDOpacity(settings.hudOpacity); }
    var volumeSlider = byId('settings-volume');
    var opacitySlider = byId('settings-opacity');
    var musicToggle = byId('settings-music-toggle');
    if (volumeSlider && typeof settings.musicVolume === 'number') {
      volumeSlider.value = String(Math.round(settings.musicVolume * 100));
    }
    if (opacitySlider && typeof settings.hudOpacity === 'number') {
      opacitySlider.value = String(Math.round(settings.hudOpacity * 100));
    }
    if (musicToggle && typeof settings.musicEnabled === 'boolean') {
      musicToggle.checked = settings.musicEnabled;
    }
  }

  function wireSettings(state) {
    state = state || SA.state || {};
    var volumeSlider = byId('settings-volume');
    var opacitySlider = byId('settings-opacity');
    var musicToggle = byId('settings-music-toggle');

    if (volumeSlider) {
      volumeSlider.addEventListener('input', function () {
        var volume = Number(volumeSlider.value) / 100;
        state.musicVolume = volume;
        if (SA.audio && typeof SA.audio.setMusicVolume === 'function') {
          SA.audio.setMusicVolume(volume);
        }
      });
    }
    if (opacitySlider) {
      opacitySlider.addEventListener('input', function () {
        var opacity = Number(opacitySlider.value) / 100;
        state.hudOpacity = opacity;
        setHUDOpacity(opacity);
      });
    }
    if (musicToggle) {
      musicToggle.addEventListener('change', function () {
        state.musicEnabled = !!musicToggle.checked;
        if (SA.audio) {
          if (musicToggle.checked && typeof SA.audio.startMusic === 'function') {
            SA.audio.startMusic();
          } else if (!musicToggle.checked && typeof SA.audio.stopMusic === 'function') {
            SA.audio.stopMusic();
          }
        }
        updateMusicButton(state);
      });
    }
  }

  // --- pause toggle (used by the Escape key path) ---------------------------

  function togglePause() {
    if (SA.main && typeof SA.main.togglePause === 'function') {
      SA.main.togglePause();
      return;
    }
    var pauseScreen = byId('screen-pause');
    if (pauseScreen && !pauseScreen.hidden) { showGame(); } else { showPause(); }
  }

  // --- one-time wiring of the static controls -------------------------------

  function wire(state) {
    if (wired) { return; }
    wired = true;
    state = state || SA.state || {};

    var versionLabel = byId('version-label');
    if (versionLabel) { versionLabel.textContent = '1.0'; }

    function onClick(id, handler) {
      var element = byId(id);
      if (!element) { return; }
      element.addEventListener('click', function (event) {
        event.preventDefault();
        if (SA.audio && typeof SA.audio.playClick === 'function') { SA.audio.playClick(); }
        handler();
      });
    }

    onClick('btn-play', function () {
      if (SA.main && typeof SA.main.startLevel === 'function') { SA.main.startLevel('level-01'); }
      else { showGame(); }
    });
    onClick('btn-levels', function () { showLevels(); });
    onClick('btn-settings', function () { showSettings('menu'); });
    onClick('btn-credits', function () { showCredits(); });
    onClick('btn-back-levels', function () { showMenu(); });
    onClick('btn-back-credits', function () { showMenu(); });
    onClick('btn-back-settings', function () { backFromSettings(); });
    onClick('level-01-btn', function () {
      if (SA.main && typeof SA.main.startLevel === 'function') { SA.main.startLevel('level-01'); }
      else { showGame(); }
    });
    onClick('btn-resume', function () {
      if (SA.main && typeof SA.main.resume === 'function') { SA.main.resume(); }
      else { showGame(); }
    });
    onClick('btn-pause-settings', function () { showSettings('pause'); });
    onClick('btn-pause-menu', function () {
      if (SA.main && typeof SA.main.quitToMenu === 'function') { SA.main.quitToMenu(); }
      else { showMenu(); }
    });
    onClick('btn-restart', function () {
      if (SA.main && typeof SA.main.startLevel === 'function') { SA.main.startLevel('level-01'); }
      else { showGame(); }
    });
    onClick('btn-next-chapter', function () { showChapter2(); });
    onClick('btn-chapter2-back', function () { showMenu(); });

    onClick('hud-pause', function () {
      if (SA.main && typeof SA.main.pause === 'function') { SA.main.pause(); }
      else { showPause(); }
    });
    onClick('hud-hint', function () {
      if (SA.main && typeof SA.main.useHint === 'function') { SA.main.useHint(); }
    });
    onClick('hud-music', function () {
      if (SA.audio && typeof SA.audio.toggleMusic === 'function') {
        SA.audio.toggleMusic();
      } else if (SA.audio && typeof SA.audio.isMusicEnabled === 'function') {
        if (SA.audio.isMusicEnabled()) { SA.audio.stopMusic(); } else { SA.audio.startMusic(); }
      }
      updateMusicButton(state);
    });
    onClick('hud-settings', function () { showSettings('game'); });
    onClick('hud-hide', function () { hideHUD(); });
    onClick('hud-restore', function () { showHUD(); });

    // Locked chapter labels do nothing when tapped, beyond a short note.
    ['ch2-locked', 'ch3-locked', 'ch4-locked', 'ch5-locked'].forEach(function (id) {
      onClick(id, function () { showToast('That chapter is locked.'); });
    });

    wireSettings(state);
  }

  SA.ui = {
    showScreen: showScreen,
    showMenu: showMenu,
    showLevels: showLevels,
    showSettings: showSettings,
    showCredits: showCredits,
    showGame: showGame,
    showPause: showPause,
    showComplete: showComplete,
    showChapter2: showChapter2,
    showCompleteResult: showCompleteResult,
    updateHUD: updateHUD,
    updateHUDNumbers: updateHUDNumbers,
    showToast: showToast,
    showHintToast: showHintToast,
    clearToasts: clearToasts,
    hideHUD: hideHUD,
    showHUD: showHUD,
    toggleHUD: toggleHUD,
    setHudVisible: setHudVisible,
    setHUDOpacity: setHUDOpacity,
    applySettings: applySettings,
    wireSettings: wireSettings,
    togglePause: togglePause,
    backFromSettings: backFromSettings,
    formatTime: formatTime,
    formatPercent: formatPercent,
    wire: wire
  };
})();
