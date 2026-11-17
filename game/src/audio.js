/* Shadow Architect — audio (generative, Web Audio API only).
 *
 * All sound is synthesised at run time; no audio files are used.
 * The music is a bell-like motif in A minor: a cycle of thirty-two
 * events, about forty seconds long, with note frequencies between
 * 392 Hz and 783.99 Hz. There is no continuous drone pad and no
 * oscillator that runs forever: every oscillator is created for one
 * note and stopped shortly after that note ends.
 *
 * The audio context is created only after a user gesture, never at
 * load time. Music starts on entering the menu after that gesture.
 */
(function () {
  'use strict';

  var SA = window.SA || (window.SA = {});

  // --- Constants from the specification ---------------------------------
  var BASE_NOTE_GAIN = 0.42;   // gain of one bell note before the music bus
  var MUSIC_PEAK_GAIN = 0.35;  // peak gain of the music bus
  var DEFAULT_VOLUME = 0.70;   // default music volume (70%)
  var BASS_PULSE_GAIN = 0.16;  // base gain of the soft bass pulse
  var CYCLE_SECONDS = 40;      // about forty seconds per motif cycle
  var EVENT_COUNT = 32;        // thirty-two events per cycle

  // A-minor frequencies inside 392 Hz .. 783.99 Hz.
  var G4 = 392.00;
  var A4 = 440.00;
  var B4 = 493.88;
  var C5 = 523.25;
  var D5 = 587.33;
  var E5 = 659.25;
  var F5 = 698.46;
  var G5 = 783.99;

  // --- The motif: thirty-two events, one per 1.25 s (32 x 1.25 = 40 s).
  // Each entry is [frequency, velocity 0..1]. Rests are velocity 0.
  // The line wanders through A minor, rises toward G5 in the middle of
  // the cycle, and settles back down to A4 by the end.
  var MOTIF = [
    [A4, 1.00], [C5, 0.80], [E5, 0.90], [A4, 0.70],
    [G4, 0.85], [B4, 0.75], [D5, 0.90], [E5, 0.65],
    [C5, 1.00], [E5, 0.80], [G5, 0.90], [E5, 0.70],
    [D5, 0.85], [C5, 0.75], [B4, 0.90], [A4, 0.65],
    [A4, 0.90], [E5, 0.70], [F5, 0.85], [G5, 1.00],
    [E5, 0.80], [D5, 0.75], [C5, 0.90], [B4, 0.65],
    [G4, 0.85], [A4, 1.00], [C5, 0.75], [E5, 0.85],
    [D5, 0.70], [B4, 0.80], [A4, 0.90], [0, 0]
  ];

  // The win arpeggio: four rising notes, also inside the motif range.
  var WIN_NOTES = [A4, C5, E5, G5];

  // --- Private state ------------------------------------------------------
  var audioCtx = null;      // created only after a user gesture
  var masterGain = null;    // overall output
  var musicBus = null;      // music volume bus (peak 0.35)
  var delaySend = null;     // gentle feedback delay for space
  var musicTimer = null;    // cycle scheduler timer, null when stopped
  var musicOn = true;       // music enabled (toggleable from the HUD)
  var musicVolume = DEFAULT_VOLUME;
  var cycleStartAt = 0;     // context time the current cycle started
  var bassTimer = null;     // slow bass-pulse timer, null when stopped

  function now() {
    return audioCtx ? audioCtx.currentTime : 0;
  }

  // Create the graph. Called only from a user gesture path.
  function ensureContext() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') { audioCtx.resume(); }
      return audioCtx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { return null; }
    audioCtx = new AC();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(audioCtx.destination);

    musicBus = audioCtx.createGain();
    musicBus.gain.value = MUSIC_PEAK_GAIN * musicVolume;
    musicBus.connect(masterGain);

    // Gentle feedback delay: bell tones are sent here for space.
    var delay = audioCtx.createDelay(1.0);
    delay.delayTime.value = 0.32;
    var feedback = audioCtx.createGain();
    feedback.gain.value = 0.28;
    var wet = audioCtx.createGain();
    wet.gain.value = 0.25;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(musicBus);
    delaySend = delay;

    return audioCtx;
  }

  // One bell tone. The oscillator is stopped after its decay ends, so
  // nothing runs forever. `when` is a context time.
  function playBell(freq, when, velocity) {
    if (!audioCtx || freq <= 0) { return; }
    var dur = 2.4; // long decay, short attack
    var osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // A faint upper partial gives the bell its shimmer.
    var partial = audioCtx.createOscillator();
    partial.type = 'sine';
    partial.frequency.value = freq * 2.76;
    var noteGain = audioCtx.createGain();
    var peak = BASE_NOTE_GAIN * (velocity || 1);
    noteGain.gain.setValueAtTime(0, when);
    noteGain.gain.linearRampToValueAtTime(peak, when + 0.015);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    var partialGain = audioCtx.createGain();
    partialGain.gain.value = 0.18;
    var filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    osc.connect(noteGain);
    partial.connect(partialGain);
    partialGain.connect(noteGain);
    noteGain.connect(filter);
    filter.connect(musicBus);
    filter.connect(delaySend);
    osc.start(when);
    partial.start(when);
    osc.stop(when + dur + 0.1);
    partial.stop(when + dur + 0.1);
  }

  // Schedule one full thirty-two-event cycle starting at `startAt`.
  function scheduleCycle(startAt) {
    var step = CYCLE_SECONDS / EVENT_COUNT; // 1.25 s per event
    for (var i = 0; i < EVENT_COUNT; i++) {
      var ev = MOTIF[i];
      if (ev[1] > 0) {
        playBell(ev[0], startAt + i * step, ev[1]);
      }
    }
  }

  // Schedule the next cycle just before the current one ends.
  function armNextCycle() {
    if (musicTimer !== null) { return; }
    musicTimer = setTimeout(function () {
      musicTimer = null;
      if (!musicOn || !audioCtx) { return; }
      cycleStartAt = now() + 0.05;
      scheduleCycle(cycleStartAt);
      armNextCycle();
    }, (CYCLE_SECONDS - 0.5) * 1000);
  }

  function startMusic() {
    if (!ensureContext()) { return; }
    if (musicTimer !== null) { return; } // already playing
    musicOn = true;
    cycleStartAt = now() + 0.05;
    scheduleCycle(cycleStartAt);
    armNextCycle();
    startBassPulse();
  }

  function stopMusic() {
    musicOn = false;
    if (musicTimer !== null) {
      clearTimeout(musicTimer);
      musicTimer = null;
    }
    stopBassPulse();
  }

  function setMusicVolume(value) {
    musicVolume = Math.max(0, Math.min(1, Number(value) || 0));
    if (musicBus && audioCtx) {
      musicBus.gain.setTargetAtTime(
        MUSIC_PEAK_GAIN * musicVolume, now(), 0.05);
    }
    return musicVolume;
  }

  function isMusicEnabled() {
    return musicOn;
  }

  function setMusicEnabled(enabled) {
    if (enabled) {
      startMusic();
    } else {
      stopMusic();
    }
    return musicOn;
  }

  function toggleMusic() {
    return setMusicEnabled(!musicOn);
  }

  // A soft bass pulse on a slow cycle: one low note every eight seconds,
  // each its own short-lived oscillator. Base gain 0.16.
  function startBassPulse() {
    if (bassTimer !== null || !audioCtx) { return; }
    var pulse = function () {
      if (!audioCtx || !musicOn) { return; }
      var t = now() + 0.02;
      var osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, t); // A2
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.9);
      var g = audioCtx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(BASS_PULSE_GAIN, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      osc.connect(g);
      g.connect(musicBus);
      osc.start(t);
      osc.stop(t + 1.2);
    };
    pulse();
    bassTimer = setInterval(pulse, 8000);
  }

  function stopBassPulse() {
    if (bassTimer !== null) {
      clearInterval(bassTimer);
      bassTimer = null;
    }
  }

  // One-off bass pulse, e.g. for a level start. Public for the app.
  function playBassPulse() {
    if (!ensureContext()) { return; }
    var t = now() + 0.02;
    var osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.9);
    var g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(BASS_PULSE_GAIN, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t);
    osc.stop(t + 1.2);
  }

  // Short click for buttons.
  function playClick() {
    if (!ensureContext()) { return; }
    var t = now() + 0.01;
    var osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 880;
    var g = audioCtx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  // Four-note rising win arpeggio.
  function playWin() {
    if (!ensureContext()) { return; }
    var t0 = now() + 0.02;
    for (var i = 0; i < WIN_NOTES.length; i++) {
      var t = t0 + i * 0.16;
      var osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = WIN_NOTES[i];
      var g = audioCtx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.32, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      osc.connect(g);
      g.connect(masterGain);
      if (delaySend) { g.connect(delaySend); }
      osc.start(t);
      osc.stop(t + 1.5);
    }
  }

  // Soft thud when a shape is picked up, and a slightly lower one when
  // it is dropped. One short oscillator each, stopped after the thud.
  function playThud(low) {
    if (!ensureContext()) { return; }
    var t = now() + 0.01;
    var osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(low ? 150 : 190, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.16);
    var g = audioCtx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  function playPickup() { playThud(false); }
  function playDrop() { playThud(true); }

  // Unlock the context from a user gesture; safe to call repeatedly.
  function unlock() {
    ensureContext();
  }

  SA.audio = {
    BASE_NOTE_GAIN: BASE_NOTE_GAIN,
    MUSIC_PEAK_GAIN: MUSIC_PEAK_GAIN,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    BASS_PULSE_GAIN: BASS_PULSE_GAIN,
    CYCLE_SECONDS: CYCLE_SECONDS,
    EVENT_COUNT: EVENT_COUNT,
    unlock: unlock,
    startMusic: startMusic,
    stopMusic: stopMusic,
    setMusicVolume: setMusicVolume,
    getMusicVolume: function () { return musicVolume; },
    isMusicEnabled: isMusicEnabled,
    setMusicEnabled: setMusicEnabled,
    toggleMusic: toggleMusic,
    playClick: playClick,
    playWin: playWin,
    playBassPulse: playBassPulse,
    playPickup: playPickup,
    playDrop: playDrop
  };
})();
