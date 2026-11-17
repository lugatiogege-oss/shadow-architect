/* SHADOW ARCHITECT — procedural WebAudio: short SFX blips plus an
   original generative bell melody. No audio files, no samples, no
   network — every sound is synthesized live from oscillators.
   Design notes (from the v0.7 physical-device lesson): there is NO
   continuous pad or drone anywhere in this module. The music is a
   composed, repeating 32-event bell motif in A natural minor, with
   one soft decaying bass root per phrase as the only low end. Gain
   staging is single-point: each bell's gain is a fixed constant and
   musicVolume scales only at the music bus, so the melody is audible
   at default settings instead of being double-scaled into silence.
   At defaults (music 0.7, master 0.5) the loudest bell peaks near
   0.057 at the destination; worst case (both volumes at 1.0, melody
   and bass attacks coinciding) peaks near 0.22 — far below clipping.
   The scheduler is wall-clock driven (1 Hz tick) because a suspended
   AudioContext's clock is frozen headlessly; notes are spaced in
   audio time so they never stack on one instant. */
var SA = (typeof SA !== 'undefined') ? SA : {};
SA.Audio = (function () {
  'use strict';

  // ---- core context / master bus ----
  var ctx = null, master = null;
  var volume = 0.5, muted = false, available = false;

  // ---- music state ----
  var musicOn = true, musicVolume = 0.7;
  var MUSIC_PEAK = 0.35; // music-bus gain when musicVolume is 1.0
  var NOTE_BASE = 0.42;  // fixed gain of the loudest melody bell
  var BASS_BASE = 0.16;  // fixed gain of each per-phrase bass root
  var musicGain = null, musicAnalyser = null;
  var musicTimer = null, musicGen = 0;
  var musicPeakHold = 0, musicPeakBuf = null;
  var nextMelodyAtMs = 0, lastMelodyCtxTime = 0;
  var musicPlaying = false, musicPaused = false;

  // ---- motif probe state (for tests / debug) ----
  var melodyRecent = [], melodyCount = 0, melodyGaps = [], bassCount = 0;
  var motifPhrase = 0, motifIdx = 0, melodyPhrasePos = 0;

  // The motif: four 8-note phrases (A / B / A / B-variation), each event
  // [frequency Hz, seconds until the next onset]. Gaps run 0.85–2.8 s;
  // a full cycle is about 40 s. Range A4 440 Hz – G5 783.99 Hz.
  // Phrase A: A4 C5 E5 D5 C5 B4 A4 G4 — the question.
  // Phrase B: A4 C5 D5 E5 G5 E5 D5 C5 — the answer, higher.
  // Phrase B-var: A4 C5 E5 G5 E5 D5 C5 A4 — the resolve on a long A4.
  var MOTIF = [
    [[440.00, 0.90], [523.25, 0.90], [659.25, 1.60], [587.33, 0.85],
     [523.25, 0.85], [493.88, 1.60], [440.00, 0.85], [392.00, 2.20]],
    [[440.00, 0.90], [523.25, 0.90], [587.33, 0.85], [659.25, 1.60],
     [783.99, 0.85], [659.25, 0.85], [587.33, 1.60], [523.25, 2.20]],
    [[440.00, 0.90], [523.25, 0.90], [659.25, 1.60], [587.33, 0.85],
     [523.25, 0.85], [493.88, 1.60], [440.00, 0.85], [392.00, 2.20]],
    [[440.00, 0.90], [523.25, 0.90], [659.25, 1.60], [783.99, 0.85],
     [659.25, 0.85], [587.33, 1.60], [523.25, 0.85], [440.00, 2.80]]
  ];
  // One bass root per phrase: A phrases on A2 110, B on E2 82.41,
  // B-var back on A2 110. Each decays in ~4 s and never drones.
  var MOTIF_BASS = [110.00, 82.41, 110.00, 110.00];

  // Create (or resume) the AudioContext. Called only from user-gesture
  // paths (SFX, music start) so the autoplay policy is respected.
  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      return true;
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
      available = true;
      return true;
    } catch (e) { available = false; return false; }
  }

  // One short synthesized blip straight onto the master bus.
  function tone(freq, dur, type, gain, when) {
    if (!ensure() || muted) return;
    try {
      var t0 = ctx.currentTime + (when || 0);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(gain || 0.12, 0.0002), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) { /* stay silent on any audio failure */ }
  }

  // ---- music bus ----
  function musicLevel() { return musicVolume * MUSIC_PEAK; }

  function applyMusicGain(rampSec) {
    if (!musicGain || !ctx) return;
    try {
      var target = (musicPlaying && !musicPaused) ? musicLevel() : 0;
      // While suspended the context clock is frozen, so a ramp never
      // converges and gain.value reads stale — set it directly there
      // so slider / on-off state stays real and verifiable; ramp only
      // on a running context.
      if (ctx.state === 'suspended' || !(rampSec > 0)) musicGain.gain.value = target;
      else musicGain.gain.setTargetAtTime(target, ctx.currentTime, rampSec / 3);
    } catch (e) { /* silent */ }
  }

  function sampleMusicPeak() {
    // Once per scheduler tick, read the analyser tap for a measured
    // peak hold. Reads 0 while suspended — expected headlessly.
    if (!musicAnalyser || !ctx || ctx.state !== 'running') return;
    try {
      if (!musicPeakBuf) musicPeakBuf = new Float32Array(musicAnalyser.fftSize);
      musicAnalyser.getFloatTimeDomainData(musicPeakBuf);
      var peak = 0, i, v;
      for (i = 0; i < musicPeakBuf.length; i++) {
        v = musicPeakBuf[i] < 0 ? -musicPeakBuf[i] : musicPeakBuf[i];
        if (v > peak) peak = v;
      }
      if (peak > musicPeakHold) musicPeakHold = peak;
    } catch (e) { /* silent */ }
  }

  function buildMusicBus() {
    // The bus is just musicGain -> master, plus an analyser tap for the
    // measured peak hold. Zero persistent oscillators by design.
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(master);
    musicAnalyser = ctx.createAnalyser();
    musicAnalyser.fftSize = 2048;
    musicGain.connect(musicAnalyser);
    musicPeakHold = 0;
  }

  function teardownMusicBus() {
    if (musicAnalyser) { try { musicAnalyser.disconnect(); } catch (e) {} musicAnalyser = null; }
    if (musicGain) { try { musicGain.disconnect(); } catch (e) {} musicGain = null; }
    musicPeakHold = 0;
  }

  // One bell: sine + exponential decay (~3 s tail) plus a faint octave
  // harmonic for shimmer. gainMul is the phrase-swell factor (0.8–1.1).
  function pluck(freq, when, gainMul) {
    try {
      var t0 = ctx.currentTime + when;
      var base = NOTE_BASE * (gainMul || 1);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(base, 0.0002), t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.0);
      o.connect(g); g.connect(musicGain);
      o.start(t0); o.stop(t0 + 3.1);
      var o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = 'sine';
      o2.frequency.value = freq * 2;
      g2.gain.setValueAtTime(0.0001, t0);
      g2.gain.exponentialRampToValueAtTime(Math.max(base * 0.18, 0.0002), t0 + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
      o2.connect(g2); g2.connect(musicGain);
      o2.start(t0); o2.stop(t0 + 1.9);
    } catch (e) { /* silent */ }
  }

  // One soft bass root per phrase: slow attack, ~4 s decay, then silence.
  function bassPluck(freq, when) {
    try {
      var t0 = ctx.currentTime + when;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(BASS_BASE, 0.0002), t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.0);
      o.connect(g); g.connect(musicGain);
      o.start(t0); o.stop(t0 + 4.1);
    } catch (e) { /* silent */ }
  }

  // Phrase swell: 1.1 on the phrase-first note (the accent), ~0.8 at
  // the phrase edges, rising mid-phrase, so each phrase breathes.
  function melodySwell() {
    var f;
    if (melodyPhrasePos === 0) f = 1.1;
    else f = 0.8 + 0.3 * Math.sin(Math.PI * melodyPhrasePos / 8);
    melodyPhrasePos++;
    if (melodyPhrasePos >= 8) melodyPhrasePos = 0;
    return f;
  }

  // Next event of the deterministic 32-event cycle. Returns { f, gap,
  // bass } where bass is the phrase root under a phrase-first note.
  function nextMotifEvent() {
    var phrase = MOTIF[motifPhrase];
    var ev = phrase[motifIdx];
    var bass = (motifIdx === 0) ? MOTIF_BASS[motifPhrase] : null;
    motifIdx++;
    if (motifIdx >= 8) { motifIdx = 0; motifPhrase = (motifPhrase + 1) % 4; }
    return { f: ev[0], gap: ev[1], bass: bass };
  }

  // 1 Hz scheduler, wall-clock driven: one motif event per gap, plus
  // the phrase bass root under each phrase-first note. Schedules ahead
  // of now; allocates nothing per frame.
  function musicTick() {
    if (!ctx || !musicPlaying || musicPaused) return;
    sampleMusicPeak();
    var nowMs = performance.now();
    var guard = 0;
    while (nowMs >= nextMelodyAtMs - 1500 && guard < 4) {
      guard++;
      var delay = Math.max(0, (nextMelodyAtMs - nowMs) / 1000);
      var ev = nextMotifEvent();
      // Audio-time spacing: never stack two notes on the same instant,
      // even if the context clock is frozen (headless) or lagging.
      var at = Math.max(ctx.currentTime + delay, lastMelodyCtxTime + 0.85);
      lastMelodyCtxTime = at;
      var when = at - ctx.currentTime;
      if (ev.bass !== null) { bassPluck(ev.bass, when); bassCount++; }
      pluck(ev.f, when, melodySwell());
      melodyRecent.push(ev.f);
      if (melodyRecent.length > 16) melodyRecent.shift();
      melodyGaps.push(ev.gap);
      if (melodyGaps.length > 16) melodyGaps.shift();
      melodyCount++;
      nextMelodyAtMs += ev.gap * 1000;
      if (nextMelodyAtMs < nowMs) nextMelodyAtMs = nowMs + ev.gap * 1000;
    }
  }

  function startScheduler() {
    stopScheduler();
    musicTimer = { tick: setInterval(musicTick, 1000) };
  }

  function stopScheduler() {
    if (!musicTimer) return;
    if (musicTimer.chord) clearInterval(musicTimer.chord); // legacy shape, defensive
    clearInterval(musicTimer.tick);
    musicTimer = null;
  }

  function startMusic() {
    if (!musicOn) return false;
    if (!ensure()) return false;
    if (musicPlaying && !musicPaused) { applyMusicGain(0.5); return true; }
    if (!musicGain) {
      try { buildMusicBus(); } catch (e) { return false; }
      // Fresh start: reset the motif probe (pause/resume keeps it).
      melodyRecent = []; melodyCount = 0;
      melodyGaps = []; bassCount = 0;
      motifPhrase = 0; motifIdx = 0;
      melodyPhrasePos = 0;
      lastMelodyCtxTime = 0;
      nextMelodyAtMs = performance.now() + 2000; // first bell ~2 s in
    }
    musicPlaying = true;
    musicPaused = false;
    startScheduler();
    applyMusicGain(1.5); // slow fade-in so the music never pops in
    return true;
  }

  function stopMusic() {
    if (!musicPlaying && !musicGain) return;
    var gen = ++musicGen;
    musicPlaying = false;
    musicPaused = false;
    stopScheduler();
    if (musicGain) applyMusicGain(0.5);
    // Let the fade-out finish, then release the bus — unless a new
    // startMusic() has begun meanwhile (generation guard).
    setTimeout(function () {
      if (gen !== musicGen) return;
      teardownMusicBus();
    }, 700);
  }

  function pauseMusic() {
    if (!musicPlaying || musicPaused) return;
    musicPaused = true;
    stopScheduler();
    applyMusicGain(0.5); // no pad oscillators exist — pause is just
    // scheduler-off + musicGain to 0; nothing keeps running.
  }

  function resumeMusic() {
    if (!musicOn) return;
    if (musicPlaying && musicPaused) {
      if (!ensure()) return;
      musicPaused = false;
      startScheduler();
      applyMusicGain(1.0);
      return;
    }
    // Resume is a transition back to 'playing': if nothing is playing
    // (e.g. music was re-enabled while paused), start fresh here.
    if (!musicPlaying) startMusic();
  }

  return {
    ensure: ensure,
    setVolume: function (v) { volume = v; if (master) master.gain.value = muted ? 0 : v; },
    setMuted: function (m) { muted = m; if (master) master.gain.value = m ? 0 : volume; },
    isAvailable: function () { return available; },
    select: function () { tone(660, 0.07, 'sine', 0.10); },
    move: function () { tone(440, 0.05, 'triangle', 0.07); },
    rotate: function () { tone(520, 0.05, 'triangle', 0.07); },
    win: function () {
      tone(523.25, 0.16, 'sine', 0.14, 0);
      tone(659.25, 0.16, 'sine', 0.14, 0.12);
      tone(783.99, 0.16, 'sine', 0.14, 0.24);
      tone(1046.5, 0.32, 'sine', 0.15, 0.36);
    },
    setMusicOn: function (on) {
      musicOn = !!on;
      if (!musicOn) stopMusic();
      else if (musicPlaying && musicPaused) resumeMusic();
    },
    setMusicVolume: function (v) {
      musicVolume = Math.max(0, Math.min(1, v || 0));
      applyMusicGain(0.3);
    },
    isMusicOn: function () { return musicOn; },
    isMusicPlaying: function () { return musicPlaying && !musicPaused; },
    startMusic: startMusic,
    stopMusic: stopMusic,
    pauseMusic: pauseMusic,
    resumeMusic: resumeMusic,
    // State probe for tests / debug (node state only, no audio data).
    getState: function () {
      // Computed destination peak of the loudest melody note at the
      // CURRENT settings: NOTE_BASE * max swell (1.1) * musicGain *
      // master gain. The worst simultaneous instant (phrase-first
      // melody attack + bass-root attack) adds BASS_BASE on top; both
      // stay far below 1.0 (no clipping).
      var mg = (musicPlaying && !musicPaused) ? musicLevel() : 0;
      var mgNow = musicGain ? musicGain.gain.value : 0;
      var mst = master ? master.gain.value : 0;
      return {
        available: available,
        ctxState: ctx ? ctx.state : 'none',
        ctxTime: ctx ? +ctx.currentTime.toFixed(2) : 0,
        masterGain: master ? +master.gain.value.toFixed(3) : null,
        muted: muted, volume: volume,
        musicOn: musicOn, musicVolume: musicVolume,
        musicPlaying: musicPlaying, musicPaused: musicPaused,
        musicGain: musicGain ? +musicGain.gain.value.toFixed(3) : null,
        musicGainTarget: +mg.toFixed(4),
        musicPeakConst: MUSIC_PEAK,
        noteBase: NOTE_BASE, bassBase: BASS_BASE,
        padOscRunning: 0, // no pad exists by design; kept for probes
        persistentOsc: 0,
        schedulerOn: !!musicTimer,
        melody: melodyRecent.slice(),
        melodyCount: melodyCount,
        melodyGaps: melodyGaps.slice(),
        motifPhrase: motifPhrase, motifIndex: motifIdx,
        bassCount: bassCount,
        musicPeakMeasured: +(musicPeakHold * mst).toFixed(4),
        musicPeakHoldAtBus: +musicPeakHold.toFixed(4),
        melodyPeakComputed: +(NOTE_BASE * 1.1 * mgNow * mst).toFixed(4),
        melodyPlusBassPeakComputed: +((NOTE_BASE * 1.1 + BASS_BASE) * mgNow * mst).toFixed(4)
      };
    }
  };
})();
