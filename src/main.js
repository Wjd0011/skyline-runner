import { Renderer } from './render.js';
import { Game } from './game.js';
import { Audio } from './audio.js';
import { seedToInt, randomSeed } from './rng.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from './config.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const renderer = new Renderer(canvas);
const audio = new Audio();

const params = new URLSearchParams(location.search);
let seedLabel = (params.get('seed') || randomSeed()).toUpperCase().slice(0, 8);
let seedInt = seedToInt(seedLabel);

const DIFF_KEY = 'skyline-runner.diff.v1';
const BEST_KEY = 'skyline-runner.best.v2';

let difficulty =
  (params.get('diff') || localStorage.getItem(DIFF_KEY) || DEFAULT_DIFFICULTY).toLowerCase();
if (!DIFFICULTIES[difficulty]) difficulty = DEFAULT_DIFFICULTY;

function bestStorageKey(d) {
  return `${BEST_KEY}.${d}`;
}

function readBest(d) {
  const v = Number(localStorage.getItem(bestStorageKey(d)) || 0);
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
let jumpQueued = false;
const input = { axis: 0, jumpHeld: false, jumpPressed: false };

const LEFT = new Set(['ArrowLeft', 'a', 'A']);
const RIGHT = new Set(['ArrowRight', 'd', 'D']);
const JUMP = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);

window.addEventListener('keydown', (e) => {
  if (LEFT.has(e.key)) { keys.left = true; e.preventDefault(); }
  else if (RIGHT.has(e.key)) { keys.right = true; e.preventDefault(); }
  else if (JUMP.has(e.key)) {
    if (!keys.jump) jumpQueued = true;
    keys.jump = true;
    e.preventDefault();
  } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    togglePause();
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

window.addEventListener('blur', () => {
  keys.left = keys.right = keys.jump = false;
  if (game.state === 'playing') pauseRun();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') pauseRun();
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
      else { if (!keys.jump) jumpQueued = true; keys.jump = true; }
    };
    const up = (e) => {
      e.preventDefault();
      if (dir === 'left') keys.left = false;
      else if (dir === 'right') keys.right = false;
      else keys.jump = false;
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
  hud.classList.toggle('hidden', name !== null);
}

function hideOverlay() {
  overlay.classList.add('hidden');
  hud.classList.remove('hidden');
}

let toastTimer = 0;
function toast(text, ms = 1200) {
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
}

function updateHud() {
  const p = game.player;
  scoreEl.textContent = String(game.score);
  distEl.innerHTML = `${game.distance}<span class="unit">m</span>`;
  for (let i = 0; i < heartsEl.children.length; i++) {
    heartsEl.children[i].classList.toggle('off', i >= p.hp);
  }
}

// ---------------------------------------------------------------- difficulty

function syncDifficultyUi() {
  const d = DIFFICULTIES[difficulty];
  for (const btn of $('diffs').querySelectorAll('.diff')) {
    btn.classList.toggle('active', btn.dataset.diff === difficulty);
  }
  $('hud-diff').textContent = d.labelEn;
  $('best-title').textContent = String(readBest(difficulty));
  $('seed-label').textContent = seedLabel;
}

function setDifficulty(id) {
  if (!DIFFICULTIES[id] || id === difficulty) return;
  difficulty = id;
  localStorage.setItem(DIFF_KEY, id);
  game = makeGame();
  buildHearts(DIFFICULTIES[id].hp);
  syncDifficultyUi();
  audio.start();
  toast(`${DIFFICULTIES[id].label} ${DIFFICULTIES[id].labelEn}`, 900);
}

for (const btn of $('diffs').querySelectorAll('.diff')) {
  btn.addEventListener('click', () => setDifficulty(btn.dataset.diff));
}

// ---------------------------------------------------------------- flow

function startRun() {
  audio.init();
  audio.start();
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
  showPanel('pause');
  toast('PAUSED');
}

function resumeRun() {
  if (game.state !== 'paused') return;
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
  if (score > prev) localStorage.setItem(key, String(score));
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

const STEP = 1 / 120;
let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min(0.06, (now - last) / 1000);
  last = now;

  input.axis = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  input.jumpHeld = keys.jump;
  input.jumpPressed = jumpQueued;

  if (game.state === 'playing') {
    acc += dt;
    let iter = 0;
    while (acc >= STEP && iter < 8) {
      game.update(STEP, input);
      acc -= STEP;
      iter++;
    }
    jumpQueued = false;
  } else if (game.state === 'title') {
    acc = 0;
    game.time += dt;
    game.cam.x = 230 + Math.sin(game.time * 0.16) * 190;
    game.cam.y = -2;
    for (const e of game.enemies) e.update(dt, game);
    jumpQueued = false;
  } else {
    acc = 0;
    jumpQueued = false;
  }

  renderer.draw(game);
  updateHud();
  requestAnimationFrame(frame);
}

// init
buildHearts(DIFFICULTIES[difficulty].hp);
syncDifficultyUi();
showPanel('title');
requestAnimationFrame(frame);

// headless QA: ?auto=1 plays itself so the build can be smoke-tested
if (params.has('auto')) {
  keys.right = true;
  setTimeout(startRun, 120);
  setInterval(() => {
    jumpQueued = true;
    keys.jump = true;
    setTimeout(() => { keys.jump = false; }, 160);
  }, 760);
}
