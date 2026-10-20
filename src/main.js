import { Renderer } from './render.js';
import { Game } from './game.js';
import { Audio } from './audio.js';
import { seedToInt, randomSeed } from './rng.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY, VERSION } from './config.js';
import { FixedStep } from './loop.js';
import { t, applyStatic, setLocale, getLocale, fmtInt, normalizeLocale, DEFAULT_LOCALE } from './i18n.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const renderer = new Renderer(canvas);
const audio = new Audio();

const params = new URLSearchParams(location.search);
let seedLabel = (params.get('seed') || randomSeed()).toUpperCase().slice(0, 8);
let seedInt = seedToInt(seedLabel);

const DIFF_KEY = 'skyline-runner.diff.v1';
const BEST_KEY = 'skyline-runner.best.v2';
const SOUND_KEY = 'skyline-runner.sound.v1';
const LANG_KEY = 'skyline-runner.lang.v1';

// Private-mode browsers throw on setItem; fall back to memory so the game
// still runs and the score simply does not survive a refresh (PRD F5).
const store = (() => {
  try {
    const probe = '__skyline_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: (k) => { mem.delete(k); },
    };
  }
})();

let difficulty =
  (params.get('diff') || store.getItem(DIFF_KEY) || DEFAULT_DIFFICULTY).toLowerCase();
if (!DIFFICULTIES[difficulty]) difficulty = DEFAULT_DIFFICULTY;

let soundOn = store.getItem(SOUND_KEY) !== '0';
audio.enabled = soundOn;

// Language: ?lang= wins for a session (shareable links), then the last choice,
// then the zh-CN default required by PRD 8.5.
let locale = normalizeLocale(params.get('lang')) || normalizeLocale(store.getItem(LANG_KEY)) || DEFAULT_LOCALE;

function bestStorageKey(d) {
  return `${BEST_KEY}.${d}`;
}

function readBest(d) {
  const v = Number(store.getItem(bestStorageKey(d)) || 0);
  return Number.isFinite(v) ? v : 0;
}

let game = makeGame();

function makeGame() {
  const g = new Game(renderer, audio, seedInt, seedLabel, DIFFICULTIES[difficulty]);
  g.onOver = onGameOver;
  g.onMilestone = (meters) => toast(t('toast.milestone', { m: fmtInt(meters) }), 800);
  return g;
}

// ---------------------------------------------------------------- input

const keys = { left: false, right: false, jump: false };
const input = { axis: 0, jumpHeld: false, jumpPressed: false };
const loop = new FixedStep();

const LEFT = new Set(['ArrowLeft', 'a', 'A']);
const RIGHT = new Set(['ArrowRight', 'd', 'D']);
const JUMP = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);

window.addEventListener('keydown', (e) => {
  // Never swallow browser shortcuts (Ctrl+D, Cmd+P, ...).
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // A focused control owns Enter/Space: the browser turns those into a click,
  // and acting on them here as well would run two actions at once.
  const onControl = !!(e.target instanceof Element && e.target.closest('button, a[href], [role="radio"]'));

  // Space activates a focused button on keyup, so consuming it here would kill
  // keyboard activation for every control in the UI. Arrow/W jumps still work.
  if ((e.key === ' ' || e.key === 'Spacebar') && onControl) return;

  if (LEFT.has(e.key)) { keys.left = true; e.preventDefault(); }
  else if (RIGHT.has(e.key)) { keys.right = true; e.preventDefault(); }
  else if (JUMP.has(e.key)) {
    if (!keys.jump) loop.pressJump();
    keys.jump = true;
    e.preventDefault();
  } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (e.repeat) return;
    togglePause();
  } else if (e.key === 'm' || e.key === 'M') {
    if (e.repeat) return;
    toggleSound();
  } else if (e.key === 'Enter') {
    if (onControl) return; // the control's own click handler runs instead
    if (game.state === 'title' || game.state === 'over') startRun();
    else if (game.state === 'paused') resumeRun();
  } else if (e.key === '1' || e.key === '2' || e.key === '3') {
    if (game.state === 'title') {
      setDifficulty(e.key === '1' ? 'easy' : e.key === '2' ? 'normal' : 'hard');
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (LEFT.has(e.key)) keys.left = false;
  else if (RIGHT.has(e.key)) keys.right = false;
  else if (JUMP.has(e.key)) keys.jump = false;
});

function releaseInput() {
  keys.left = keys.right = keys.jump = false;
  loop.clear();
}

window.addEventListener('blur', () => {
  releaseInput();
  if (game.state === 'playing') pauseRun();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseInput();
    if (game.state === 'playing') pauseRun();
  }
});

// touch
const touchWrap = $('touch');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

function bindTouch() {
  for (const btn of touchWrap.querySelectorAll('.tbtn')) {
    const dir = btn.dataset.dir;
    if (dir === 'pause') {
      // click fires for both tap and keyboard activation, pointerdown does not
      btn.addEventListener('click', (e) => { e.preventDefault(); togglePause(); });
      continue;
    }
    const down = (e) => {
      e.preventDefault();
      if (dir === 'left') keys.left = true;
      else if (dir === 'right') keys.right = true;
      else { if (!keys.jump) loop.pressJump(); keys.jump = true; }
    };
    const up = (e) => {
      e.preventDefault();
      if (dir === 'left') keys.left = false;
      else if (dir === 'right') keys.right = false;
      else if (dir === 'jump') keys.jump = false;
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }
}
if (isTouch) { touchWrap.classList.remove('hidden'); bindTouch(); }

// ---------------------------------------------------------------- ui

const panels = { title: $('panel-title'), pause: $('panel-pause'), over: $('panel-over') };
const overlay = $('overlay');
const hud = $('hud');
const heartsEl = $('hearts');
const scoreEl = $('score');
const distEl = $('dist');
const toastEl = $('toast');

function buildHearts(n) {
  heartsEl.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const h = document.createElement('div');
    h.className = 'heart';
    heartsEl.appendChild(h);
  }
}

function showPanel(name) {
  overlay.classList.remove('hidden');
  for (const [k, el] of Object.entries(panels)) el.classList.toggle('hidden', k !== name);
  hud.classList.add('hidden');
  // The touch pad sits under the overlay's scrim. `inert` keeps it visible but
  // takes its four buttons out of the tab order and out of reach of taps.
  if (isTouch) touchWrap.inert = true;
}

function hideOverlay() {
  overlay.classList.add('hidden');
  hud.classList.remove('hidden');
  if (isTouch) touchWrap.inert = false;
}

let toastTimer = 0;
let lastHp = -1;
function toast(text, ms = 1200) {
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
}

function updateHud() {
  const p = game.player;
  scoreEl.textContent = fmtInt(game.score);
  distEl.textContent = fmtInt(game.distance);
  for (let i = 0; i < heartsEl.children.length; i++) {
    heartsEl.children[i].classList.toggle('off', i >= p.hp);
  }
  // Hearts are colour-coded; keep a text equivalent for assistive tech.
  if (p.hp !== lastHp) {
    lastHp = p.hp;
    heartsEl.setAttribute('aria-label', t('a11y.hearts', { hp: p.hp, max: p.maxHp }));
  }
}

// ---------------------------------------------------------------- sound

function applySoundUi() {
  for (const btn of document.querySelectorAll('.sound-toggle')) {
    btn.textContent = soundOn ? t('sound.on') : t('sound.off');
    btn.setAttribute('aria-pressed', String(soundOn));
  }
}

function toggleSound() {
  soundOn = !soundOn;
  audio.enabled = soundOn;
  store.setItem(SOUND_KEY, soundOn ? '1' : '0');
  applySoundUi();
  if (soundOn) audio.start();
}

// ---------------------------------------------------------------- difficulty

function syncDifficultyUi() {
  for (const btn of $('diffs').querySelectorAll('.diff')) {
    btn.classList.toggle('active', btn.dataset.diff === difficulty);
    btn.setAttribute('aria-checked', String(btn.dataset.diff === difficulty));
  }
  const hudDiff = $('hud-diff');
  hudDiff.textContent = t(`diff.${difficulty}.code`);
  hudDiff.dataset.diff = difficulty;
  $('final-diff').textContent = t(`diff.${difficulty}.code`);
  $('best-title').textContent = fmtInt(readBest(difficulty));
  $('seed-label').textContent = seedLabel;
  $('version').textContent = `v${VERSION}`;
}

function setDifficulty(id) {
  if (!DIFFICULTIES[id] || id === difficulty) return;
  difficulty = id;
  store.setItem(DIFF_KEY, id);
  game = makeGame();
  buildHearts(DIFFICULTIES[id].hp);
  syncDifficultyUi();
  audio.start();
  toast(t('toast.diff', { name: t(`diff.${id}`) }), 900);
}

for (const btn of $('diffs').querySelectorAll('.diff')) {
  btn.addEventListener('click', () => setDifficulty(btn.dataset.diff));
}

for (const btn of document.querySelectorAll('.sound-toggle')) {
  btn.addEventListener('click', toggleSound);
}

// ---------------------------------------------------------------- language

const langBtn = document.querySelector('.lang-toggle');

function applyLocale() {
  setLocale(locale);
  applyStatic();
  applySoundUi();
  syncDifficultyUi();
  if (langBtn) langBtn.textContent = t('lang.switchTo');
  lastHp = -1; // force the hearts label to re-render in the new locale
  if (game.player) updateHud();
}

function toggleLang() {
  locale = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
  store.setItem(LANG_KEY, locale);
  applyLocale();
  toast(t('toast.lang', { name: t(`lang.name.${locale}`) }), 1400);
}

if (langBtn) langBtn.addEventListener('click', toggleLang);

// ---------------------------------------------------------------- flow

function startRun() {
  audio.init();
  audio.start();
  loop.clear();
  game.reset();
  game.start();
  buildHearts(game.player.maxHp);
  $('hud-diff').textContent = t(`diff.${difficulty}.code`);
  hideOverlay();
  toast(t('toast.controls'), 1800);
}

function pauseRun() {
  if (game.state !== 'playing') return;
  game.pause();
  // Only drop the latched jump. Clearing the held keys here would strand a
  // finger that is still on a touch button, because no second pointerdown
  // arrives after resume.
  loop.clear();
  showPanel('pause');
  toast(t('toast.paused'));
}

function resumeRun() {
  if (game.state !== 'paused') return;
  loop.clear();
  game.resume();
  hideOverlay();
}

function togglePause() {
  if (game.state === 'playing') pauseRun();
  else if (game.state === 'paused') resumeRun();
}

function onGameOver(score, distance) {
  const key = bestStorageKey(difficulty);
  const prev = readBest(difficulty);
  if (score > prev) store.setItem(key, String(score));
  const best = Math.max(prev, score);

  $('final-score').textContent = fmtInt(score);
  $('final-dist').textContent = `${fmtInt(distance)} ${t('hud.unit')}`;
  $('final-best').textContent = fmtInt(best);
  $('final-seed').textContent = seedLabel;
  $('final-diff').textContent = t(`diff.${difficulty}.code`);
  showPanel('over');
}

$('btn-start').addEventListener('click', startRun);
function backToTitle() {
  loop.clear();
  game.reset();
  syncDifficultyUi();
  showPanel('title');
}

$('btn-retry').addEventListener('click', startRun);
$('btn-resume').addEventListener('click', resumeRun);
$('btn-quit').addEventListener('click', backToTitle);
$('btn-title').addEventListener('click', backToTitle);

$('seed-btn').addEventListener('click', () => {
  seedLabel = randomSeed();
  seedInt = seedToInt(seedLabel);
  $('seed-label').textContent = seedLabel;
  game = makeGame();
  game.cam.x = 0;
  toast(t('toast.seed', { seed: seedLabel }), 1200);
});

// ---------------------------------------------------------------- loop

let last = performance.now();

function frame(now) {
  const dt = Math.min(0.06, (now - last) / 1000);
  last = now;

  input.axis = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  input.jumpHeld = keys.jump;

  if (game.state === 'playing') {
    // Jump presses are latched inside the scheduler so a press made on a
    // frame that runs zero simulation steps is not dropped (144 Hz bug).
    loop.advance(dt, (step, jumpPressed) => {
      input.jumpPressed = jumpPressed;
      game.update(step, input);
    });
  } else if (game.state === 'title') {
    loop.clear();
    game.time += dt;
    game.cam.x = 230 + Math.sin(game.time * 0.16) * 190;
    game.cam.y = -2;
    for (const e of game.enemies) e.update(dt, game);
  } else {
    loop.clear();
  }

  renderer.draw(game);
  updateHud();
  requestAnimationFrame(frame);
}

// init
buildHearts(DIFFICULTIES[difficulty].hp);
applyLocale();
showPanel('title');
requestAnimationFrame(frame);

// Test hook: only exposed with ?test=1 so production pages stay clean.
// tests/e2e.mjs drives the real game through this instead of faking state.
if (params.has('test')) {
  window.__skyline = {
    get game() { return game; },
    get difficulty() { return difficulty; },
    get seed() { return seedLabel; },
    get soundOn() { return soundOn; },
    get storage() { return store; },
    get renderer() { return renderer; },
    get locale() { return getLocale(); },
    startRun,
    pauseRun,
    resumeRun,
    setDifficulty,
    toggleSound,
    toggleLang,
    version: VERSION,
  };
}

// headless QA: ?auto=1 plays itself so the build can be smoke-tested
if (params.has('auto')) {
  keys.right = true;
  setTimeout(startRun, 120);
  setInterval(() => {
    loop.pressJump();
    keys.jump = true;
    setTimeout(() => { keys.jump = false; }, 160);
  }, 760);
}
