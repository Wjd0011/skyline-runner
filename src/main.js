import { Renderer } from './render.js';
import { Game } from './game.js';
import { Audio } from './audio.js';
import { seedToInt, randomSeed } from './rng.js';
import { UI } from './config.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const renderer = new Renderer(canvas);
const audio = new Audio();

const params = new URLSearchParams(location.search);
let seedLabel = (params.get('seed') || randomSeed()).toUpperCase().slice(0, 8);
let seedInt = seedToInt(seedLabel);

const BEST_KEY = 'skyline-runner.best.v1';
let best = Number(localStorage.getItem(BEST_KEY) || 0);
if (!Number.isFinite(best)) best = 0;

let game = makeGame();

function makeGame() {
  const g = new Game(renderer, audio, seedInt, seedLabel);
  g.onOver = onGameOver;
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
    if (game.state === 'title') startRun();
    else if (game.state === 'over') startRun();
    else if (game.state === 'paused') resumeRun();
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
const flashEl = $('flash');

for (let i = 0; i < UI.maxHp; i++) {
  const h = document.createElement('div');
  h.className = 'heart';
  heartsEl.appendChild(h);
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
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1200);
}

function updateHearts() {
  const hs = heartsEl.children;
  for (let i = 0; i < hs.length; i++) hs[i].classList.toggle('off', i >= game.player.hp);
}

function updateHud() {
  const p = game.player;
  scoreEl.textContent = String(game.score);
  distEl.innerHTML = `${game.distance}<span class="unit">m</span>`;
  for (let i = 0; i < heartsEl.children.length; i++) {
    heartsEl.children[i].classList.toggle('off', i >= p.hp);
  }
}

// ---------------------------------------------------------------- flow

function startRun() {
  audio.init();
  audio.start();
  game.reset();
  game.start();
  hideOverlay();
  updateHearts();
  toast('RUN');
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
  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
  }
  $('final-score').textContent = String(score);
  $('final-dist').textContent = `${distance} m`;
  $('final-best').textContent = String(best);
  $('final-seed').textContent = seedLabel;
  showPanel('over');
}

$('btn-start').addEventListener('click', startRun);
$('btn-retry').addEventListener('click', startRun);
$('btn-resume').addEventListener('click', resumeRun);
$('btn-quit').addEventListener('click', () => {
  game.reset();
  showPanel('title');
  $('seed-label').textContent = seedLabel;
  $('best-title').textContent = String(best);
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
$('seed-label').textContent = seedLabel;
$('best-title').textContent = String(best);
showPanel('title');
requestAnimationFrame(frame);

// headless QA mode: ?auto=1 plays itself so the game can be smoke-tested
if (params.has('auto')) {
  keys.right = true;
  setTimeout(startRun, 120);
  setInterval(() => {
    jumpQueued = true;
    keys.jump = true;
    setTimeout(() => { keys.jump = false; }, 160);
  }, 760);
}

