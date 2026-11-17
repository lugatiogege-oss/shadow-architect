// Shadow Architect — tutorial (clean-room rebuild, written from SPEC.md only).
// A five-step overlay shown the first time First Light is played. Each step
// has a short title and one or two sentences of instruction. The step label
// reads "First light", then the step number, then "of five". The copy teaches
// dragging shapes, dragging the light, rotating, zooming, and the ninety
// percent win rule. It never reveals solution positions, and the only
// number in the copy is ninety percent.
(function () {
  'use strict';

  var SA = window.SA || (window.SA = {});

  var SEEN_KEY = 'sa-tutorial-seen';

  var STEPS = [
    {
      title: 'Move the shapes',
      body: 'Drag a shape across the board to move it. Its shadow on the wall shifts as it moves.'
    },
    {
      title: 'Move the light',
      body: 'Drag the glowing light to a new spot. Shadows grow larger near the light and shrink near the wall.'
    },
    {
      title: 'Turn a shape',
      body: 'Use the wheel or the on-screen arrows to rotate the selected shape. Rotation changes the shape of its shadow.'
    },
    {
      title: 'Look closer',
      body: 'Pinch to zoom in and out, or drag empty space to pan while zoomed. Reset the view whenever you like.'
    },
    {
      title: 'Match the silhouette',
      body: 'Arrange the shadows to match the ivory silhouette on the wall. Reach ninety percent to win.'
    }
  ];

  var currentStep = 0;
  var active = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function markSeen() {
    try { window.localStorage.setItem(SEEN_KEY, 'true'); } catch (err) { /* storage is best-effort */ }
  }

  function hasSeen() {
    try { return window.localStorage.getItem(SEEN_KEY) === 'true'; } catch (err) { return false; }
  }

  function showStep(index) {
    var overlay = byId('tutorial-overlay');
    var titleElement = byId('tutorial-title');
    var bodyElement = byId('tutorial-body');
    var stepElement = byId('tutorial-step');
    var nextButton = byId('tutorial-next');
    if (!overlay || !titleElement || !bodyElement || !stepElement) { return false; }
    if (index < 0 || index >= STEPS.length) { return false; }

    currentStep = index;
    var step = STEPS[index];
    titleElement.textContent = step.title;
    bodyElement.textContent = step.body;
    stepElement.textContent = 'First light, step ' + (index + 1) + ' of five';
    if (nextButton) {
      nextButton.textContent = index === STEPS.length - 1 ? 'Begin' : 'Next';
    }
    overlay.hidden = false;
    overlay.classList.add('visible');
    active = true;
    return true;
  }

  function hideOverlay() {
    var overlay = byId('tutorial-overlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove('visible');
    }
    active = false;
  }

  function start() {
    currentStep = 0;
    return showStep(0);
  }

  // Only shows the overlay on a first play; later plays skip straight on.
  function startIfFirstTime() {
    if (hasSeen()) { return false; }
    return start();
  }

  function next() {
    if (!active) { return false; }
    if (currentStep >= STEPS.length - 1) {
      finish();
      return true;
    }
    return showStep(currentStep + 1);
  }

  function skip() {
    finish();
    return true;
  }

  function finish() {
    markSeen();
    hideOverlay();
    if (typeof SA.onTutorialDone === 'function') { SA.onTutorialDone(); }
    if (SA.main && typeof SA.main.onTutorialDone === 'function') { SA.main.onTutorialDone(); }
  }

  function wire() {
    var nextButton = byId('tutorial-next');
    var skipButton = byId('tutorial-skip');
    if (nextButton) {
      nextButton.addEventListener('click', function (event) {
        event.preventDefault();
        next();
      });
    }
    if (skipButton) {
      skipButton.addEventListener('click', function (event) {
        event.preventDefault();
        skip();
      });
    }
  }

  // Wire the buttons once the page is ready, if it is not ready yet.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  SA.tutorial = {
    start: start,
    startIfFirstTime: startIfFirstTime,
    next: next,
    skip: skip,
    showStep: showStep,
    hide: hideOverlay,
    finish: finish,
    hasSeen: hasSeen,
    steps: STEPS,
    isActive: function () { return active; },
    currentStep: function () { return currentStep; }
  };
})();
