import { Renderer } from './render.js';
import { Game } from './game.js';
import { Audio } from './audio.js';
import { seedToInt, randomSeed } from './rng.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY, VERSION } from './config.js';
import { FixedStep } from './loop.js';

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
  g.onMilestone = (meters) => toast(`${meters} m`, 800);
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
  if (LEFT.has(e.key)) { keys.left = true; e.preventDefault(); }
  else if (RIGHT.has(e.key)) { keys.right = true; e.preventDefault(); }
  else if (JUMP.has(e.key)) {
    if (!keys.jump) loop.pressJump();
    keys.jump = true;
    e.preventDefault();
  } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    togglePause();
  } else if (e.key === 'm' || e.key === 'M') {
    toggleSound();
  } else if (e.key === 'Enter') {
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
    const down = (e) => {
      e.preventDefault();
      if (dir === 'left') keys.left = true;
      else if (dir === 'right') keys.right = true;
      else if (dir === 'pause') togglePause();
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
}

function hideOverlay() {
  overlay.classList.add('hidden');
  hud.classList.remove('hidden');
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
  scoreEl.textContent = String(game.score);
  distEl.textContent = String(game.distance);
  for (let i = 0; i < heartsEl.children.length; i++) {
    heartsEl.children[i].classList.toggle('off', i >= p.hp);
  }
  // Hearts are colour-coded; keep a text equivalent for assistive tech.
  if (p.hp !== lastHp) {
    lastHp = p.hp;
    heartsEl.setAttribute('aria-label', `生命 ${p.hp}/${p.maxHp}`);
  }
}

// ---------------------------------------------------------------- sound

function applySoundUi() {
  for (const btn of document.querySelectorAll('.sound-toggle')) {
    btn.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
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
  const d = DIFFICULTIES[difficulty];
  for (const btn of $('diffs').querySelectorAll('.diff')) {
    btn.classList.toggle('active', btn.dataset.diff === difficulty);
    btn.setAttribute('aria-checked', String(btn.dataset.diff === difficulty));
  }
  $('hud-diff').textContent = d.labelEn;
  $('best-title').textContent = String(readBest(difficulty));
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
  toast(`${DIFFICULTIES[id].label} ${DIFFICULTIES[id].labelEn}`, 900);
}

for (const btn of $('diffs').querySelectorAll('.diff')) {
  btn.addEventListener('click', () => setDifficulty(btn.dataset.diff));
}

for (const btn of document.querySelectorAll('.sound-toggle')) {
  btn.addEventListener('click', toggleSound);
}

// ---------------------------------------------------------------- flow

function startRun() {
  audio.init();
  audio.start();
  loop.clear();
  game.reset();
  game.start();
  buildHearts(game.player.maxHp);
  $('hud-diff').textContent = DIFFICULTIES[difficulty].labelEn;
  hideOverlay();
  toast('A / D 移动 · SPACE 跳跃', 1800);
}

function pauseRun() {
  if (game.state !== 'playing') return;
  game.pause();
  releaseInput();
  showPanel('pause');
  toast('PAUSED');
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

  $('final-score').textContent = String(score);
  $('final-dist').textContent = `${distance} m`;
  $('final-best').textContent = String(best);
  $('final-seed').textContent = seedLabel;
  $('final-diff').textContent = DIFFICULTIES[difficulty].labelEn;
  showPanel('over');
}

$('btn-start').addEventListener('click', startRun);
$('btn-retry').addEventListener('click', startRun);
$('btn-resume').addEventListener('click', resumeRun);
$('btn-quit').addEventListener('click', () => {
  loop.clear();
  game.reset();
  syncDifficultyUi();
  showPanel('title');
});

$('seed-label').addEventListener('click', () => {
  seedLabel = randomSeed();
  seedInt = seedToInt(seedLabel);
  $('seed-label').textContent = seedLabel;
  game = makeGame();
  game.cam.x = 0;
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
syncDifficultyUi();
applySoundUi();
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
    startRun,
    pauseRun,
    resumeRun,
    setDifficulty,
    toggleSound,
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
