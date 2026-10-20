// End-to-end pass over the real game in a real browser engine.
// Run: node tests/e2e.mjs   (needs Chrome or Edge installed)
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer } from './server.mjs';
import { Browser } from './cdp.mjs';

const PORT = Number(process.env.PORT || 8123);
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const BASE = `http://127.0.0.1:${PORT}`;
const ART = join(process.cwd(), 'tests', 'artifacts');
const SOFTWARE = process.env.SOFTWARE === '1';
// LONG=1 measures the 30 s window the PRD's SLO is defined over.
const LONG = process.env.LONG === '1';
const FPS_WINDOW = LONG ? 30000 : 2500;
const MIN_DESKTOP_FPS = SOFTWARE ? 24 : 55;
const MIN_MOBILE_FPS = SOFTWARE ? 24 : 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

async function rect(page, selector) {
  return page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  })()`);
}

async function fps(page, ms = FPS_WINDOW, keepAlive = false) {
  if (keepAlive) {
    // A 30 s sample must stay in gameplay; a random death would measure the
    // game-over panel instead. Topping up hearts keeps the load realistic.
    await page.eval(`window.__keepAlive = setInterval(() => {
      const g = window.__skyline && __skyline.game;
      if (!g) return;
      if (g.state === 'over') __skyline.startRun();
      if (g.player) g.player.hp = g.player.maxHp;
    }, 100)`);
  }
  const out = await page.eval(`new Promise((res) => {
    let n = 0;
    let draw = 0;
    const t0 = performance.now();
    function tick() {
      n += 1;
      draw += (window.__skyline && __skyline.renderer.lastDrawMs) || 0;
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
      else res([
        Math.round((n / (performance.now() - t0)) * 10000) / 10,
        Math.round((draw / n) * 100) / 100,
      ]);
    }
    requestAnimationFrame(tick);
  })`, { awaitPromise: true, timeout: ms + 5000 });
  if (keepAlive) await page.eval('clearInterval(window.__keepAlive)');
  return out;
}

async function runDesktop(browser) {
  console.log('\n--- desktop 1280x800 ---');
  const page = await browser.newPage();
  await page.init();
  await page.goto(`${BASE}/?test=1&seed=E2E2026&diff=normal`);

  check('boot without page errors', page.errors.length === 0, page.errors.join(' | '));
  check('version is 2.0.0', (await page.eval('__skyline.version')) === '2.0.0');
  check('starts on the title screen', (await page.eval('__skyline.game.state')) === 'title');
  check('title screen shows the seed', (await page.eval("document.getElementById('seed-label').textContent")) === 'E2E2026');

  const [sw, iw] = await page.eval('[document.documentElement.scrollWidth, innerWidth]');
  check('no horizontal scroll on desktop', sw <= iw, `${sw} <= ${iw}`);

  const assets = await page.eval(`Promise.all(
    ['index.html', 'style.css', 'src/main.js', 'src/game.js', 'src/render.js', 'src/world.js',
     'src/player.js', 'src/entities.js', 'src/audio.js', 'src/config.js', 'src/rng.js',
     'src/loop.js', 'src/scoring.js']
      .map(async (p) => [p, (await fetch(p, { cache: 'no-store' })).status])
  )`, { awaitPromise: true });
  check('every static asset returns 200 (AC-F6-05)', assets.every(([, s]) => s === 200), JSON.stringify(assets.filter(([, s]) => s !== 200)));

  await page.press('1', { code: 'Digit1', vk: 49, text: '1' });
  await sleep(200);
  const easyUi = await page.eval(`({
    hud: document.getElementById('hud-diff').textContent,
    hearts: document.querySelectorAll('.heart').length,
    active: document.querySelector('.diff.active').dataset.diff,
  })`);
  check(
    'difficulty switch syncs HUD and hearts within 1 s (AC-F4-01)',
    easyUi.hud === 'EASY' && easyUi.hearts === 4 && easyUi.active === 'easy',
    JSON.stringify(easyUi),
  );
  await page.press('2', { code: 'Digit2', vk: 50, text: '2' });
  await sleep(200);

  await mkdir(ART, { recursive: true });
  await page.screenshot(join(ART, 'desktop-title.png'));

  await page.press('Enter', { code: 'Enter', vk: 13, text: '\r' });
  await page.waitFor("__skyline.game.state === 'playing'");
  check('Enter starts the run', true);
  check('HUD is visible while playing', await page.eval("!document.getElementById('hud').classList.contains('hidden')"));
  check('HUD names the active difficulty (AC-F4-05)', (await page.eval("document.getElementById('hud-diff').textContent")) === 'NORMAL');

  const x0 = await page.eval('__skyline.game.player.x');
  await page.key('ArrowRight', { down: true, code: 'ArrowRight', vk: 39 });
  await sleep(2200);
  await page.key('ArrowRight', { down: false, code: 'ArrowRight', vk: 39 });
  const d = await page.eval('__skyline.game.distance');
  check('running forward advances the distance', d > 5, `${d} m`);
  check('player actually moved', (await page.eval('__skyline.game.player.x')) > x0);

  await page.press('Escape', { code: 'Escape', vk: 27 });
  await page.waitFor("__skyline.game.state === 'paused'");
  check('Escape pauses', true);
  check('pause panel is shown', await page.eval("!document.getElementById('panel-pause').classList.contains('hidden')"));
  await page.press('Escape', { code: 'Escape', vk: 27 });
  await page.waitFor("__skyline.game.state === 'playing'");
  check('Escape resumes', true);

  await page.key('ArrowRight', { down: true, code: 'ArrowRight', vk: 39 });
  const [f, drawMs] = await fps(page, FPS_WINDOW, true);
  await page.key('ArrowRight', { down: false, code: 'ArrowRight', vk: 39 });
  check(`desktop frame rate >= ${MIN_DESKTOP_FPS} fps`, f >= MIN_DESKTOP_FPS, `${f} fps, draw ${drawMs} ms`);
  check('desktop render stays inside the 12 ms budget', drawMs <= 12, `${drawMs} ms`);
  await page.screenshot(join(ART, 'desktop-run.png'));

  const logicMs = await page.eval(`(() => {
    const g = __skyline.game;
    const input = { axis: 1, jumpHeld: false, jumpPressed: false };
    const t0 = performance.now();
    for (let i = 0; i < 240; i++) g.update(1 / 120, input);
    return (performance.now() - t0) / 240;
  })()`);
  check('simulation step stays inside the 3 ms logic budget', logicMs <= 3, `${logicMs.toFixed(3)} ms`);

  await page.eval('(__skyline.game.score = 777, __skyline.game.player.hp = 1, __skyline.game.player.alive = false)');
  await page.waitFor("__skyline.game.state === 'over'");
  const over = await page.eval(`({
    score: document.getElementById('final-score').textContent,
    dist: document.getElementById('final-dist').textContent,
    best: document.getElementById('final-best').textContent,
    seed: document.getElementById('final-seed').textContent,
    diff: document.getElementById('final-diff').textContent,
  })`);
  check('game over panel shows the final score', over.score === '777', JSON.stringify(over));
  check('game over panel shows seed and difficulty', over.seed === 'E2E2026' && over.diff === 'NORMAL');
  check('best score recorded', over.best === '777');

  await page.press('Enter', { code: 'Enter', vk: 13, text: '\r' });
  await page.waitFor("__skyline.game.state === 'playing'");
  check('Enter restarts from the game over panel', true);

  await page.goto(`${BASE}/?test=1&seed=E2E2026&diff=normal`);
  check('best score survives a reload', (await page.eval("document.getElementById('best-title').textContent")) === '777');

  // difficulty isolation
  await page.eval("__skyline.setDifficulty('easy'), __skyline.startRun()");
  await page.eval('(__skyline.game.score = 42, __skyline.game.player.hp = 1, __skyline.game.player.alive = false)');
  await page.waitFor("__skyline.game.state === 'over'");
  await page.eval("__skyline.setDifficulty('hard')");
  const hardBest = await page.eval("document.getElementById('best-title').textContent");
  check('high scores are isolated per difficulty', hardBest === '0', `hard best=${hardBest}`);
  await page.eval("__skyline.setDifficulty('easy')");
  const easyBest = await page.eval("document.getElementById('best-title').textContent");
  check('easy best is kept separately', easyBest === '42', `easy best=${easyBest}`);

  // sound toggle
  const before = await page.eval('__skyline.soundOn');
  await page.press('m', { code: 'KeyM', vk: 77, text: 'm' });
  const after = await page.eval('__skyline.soundOn');
  check('M toggles sound', before !== after);
  check('sound state is persisted', (await page.eval("__skyline.storage.getItem('skyline-runner.sound.v1')")) === (after ? '1' : '0'));

  await page.eval('localStorage.clear()');
  await page.goto(`${BASE}/?test=1&seed=E2E2026&diff=normal`);
  check('clearing storage resets the best score (AC-F5-04)', (await page.eval("document.getElementById('best-title').textContent")) === '0');

  check('desktop session raised no errors', page.errors.length === 0, page.errors.join(' | '));
  await page.close();
  return { fps: f, drawMs };
}

async function runMobile(browser) {
  console.log('\n--- mobile 390x844 (touch) ---');
  const page = await browser.newPage();
  await page.init();
  await page.mobile(390, 844, 3);
  await page.goto(`${BASE}/?test=1&seed=MOBILE7&diff=normal`);

  check('mobile boot without errors', page.errors.length === 0, page.errors.join(' | '));
  const [sw, iw] = await page.eval('[document.documentElement.scrollWidth, innerWidth]');
  check('no horizontal scroll at 390x844', sw <= iw, `${sw} <= ${iw}`);

  const touchVisible = await page.eval("!document.getElementById('touch').classList.contains('hidden')");
  check('touch controls are revealed on a touch device', touchVisible);

  const sizes = await page.eval(`[...document.querySelectorAll('.tbtn')].map((b) => {
    const r = b.getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height)];
  })`);
  check('every touch target is at least 44x44', sizes.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(sizes));
  await page.screenshot(join(ART, 'mobile-title.png'));

  const start = await rect(page, '#btn-start');
  await page.touch(start.x, start.y);
  await page.waitFor("__skyline.game.state === 'playing'");
  check('tapping the start button begins a run', true);

  const right = await rect(page, '.tbtn[data-dir="right"]');
  await page.touchHold(right.x, right.y, 1300);
  const d = await page.eval('__skyline.game.distance');
  check('touch right advances the distance', d > 2, `${d} m`);

  const jump = await rect(page, '.tbtn[data-dir="jump"]');
  const y0 = await page.eval('__skyline.game.player.y');
  await page.touchHold(jump.x, jump.y, 200);
  await sleep(120);
  const y1 = await page.eval('__skyline.game.player.y');
  check('touch jump lifts the player', y1 < y0, `${y0.toFixed(1)} -> ${y1.toFixed(1)}`);

  const pause = await rect(page, '.tbtn[data-dir="pause"]');
  await page.touch(pause.x, pause.y);
  await page.waitFor("__skyline.game.state === 'paused'");
  check('touch pause stops the run', true);
  const resume = await rect(page, '#btn-resume');
  await page.touch(resume.x, resume.y);
  await page.waitFor("__skyline.game.state === 'playing'");
  check('touch resume continues the run', true);
  await page.screenshot(join(ART, 'mobile-run.png'));

  const [f, mDraw] = await fps(page, FPS_WINDOW, true);
  check(`mobile frame rate >= ${MIN_MOBILE_FPS} fps`, f >= MIN_MOBILE_FPS, `${f} fps, draw ${mDraw} ms`);
  check('mobile render stays inside the 12 ms budget', mDraw <= 12, `${mDraw} ms`);

  const hudOverlap = await page.eval(`(() => {
    const ids = ['hearts', 'hud-diff', 'score', 'dist'];
    const rects = ids.map((id) => [id, document.getElementById(id).getBoundingClientRect()]);
    const hits = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i][1], b = rects[j][1];
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          hits.push(rects[i][0] + '/' + rects[j][0]);
        }
      }
    }
    return hits;
  })()`);
  check('HUD blocks do not overlap on mobile (AC-F6-01)', hudOverlap.length === 0, JSON.stringify(hudOverlap));

  await page.eval('(__skyline.game.score = 99, __skyline.game.player.hp = 1, __skyline.game.player.alive = false)');
  await page.waitFor("__skyline.game.state === 'over'");
  const retry = await rect(page, '#btn-retry');
  await page.touch(retry.x, retry.y);
  await page.waitFor("__skyline.game.state === 'playing'");
  check('touch restart works end to end (AC-F6-02)', true);

  // 360x640 is the narrowest required viewport
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 360, height: 640, deviceScaleFactor: 2, mobile: true,
  });
  await page.goto(`${BASE}/?test=1&seed=NARROW1`);
  const [sw2, iw2] = await page.eval('[document.documentElement.scrollWidth, innerWidth]');
  check('no horizontal scroll at 360x640 (AC-F6-01)', sw2 <= iw2, `${sw2} <= ${iw2}`);
  const fits = await page.eval(`(() => {
    const r = document.getElementById('panel-title').getBoundingClientRect();
    return r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1;
  })()`);
  check('title panel fits a 360x640 viewport', fits == true);
  await page.screenshot(join(ART, 'mobile-360.png'));

  check('mobile session raised no errors', page.errors.length === 0, page.errors.join(' | '));

  await page.close();
  return { fps: f, drawMs: mDraw };
}

async function runNetworkProfile(browser) {
  console.log('\n--- slow 4G ---');
  const page = await browser.newPage();
  await page.init();
  await page.send('Network.enable');
  await page.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    connectionType: 'cellular4g',
  });
  await page.goto(`${BASE}/?test=1&seed=SLOW4G`);
  const dcl = await page.eval(`(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return n ? Math.round(n.domContentLoadedEventEnd) : -1;
  })()`);
  check('interactive within 3 s on slow 4G (AC-F6-04)', dcl > 0 && dcl <= 3000, `${dcl} ms to DCL`);
  check('slow-network session raised no errors', page.errors.length === 0, page.errors.join(' | '));
  await page.close();
}

async function runReducedMotion(browser) {
  console.log('\n--- reduced motion ---');
  const page = await browser.newPage();
  await page.init();
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await page.goto(`${BASE}/?test=1&seed=QUIET1`);
  check('prefers-reduced-motion is detected', (await page.eval('__skyline.renderer.reducedMotion')) === true);
  await page.eval('__skyline.startRun()');
  await page.key('ArrowRight', { down: true, code: 'ArrowRight', vk: 39 });
  await sleep(900);
  await page.key('ArrowRight', { down: false, code: 'ArrowRight', vk: 39 });
  check('the game still runs with reduced motion', (await page.eval('__skyline.game.distance')) > 0);
  check('reduced-motion session raised no errors', page.errors.length === 0, page.errors.join(' | '));
  await page.close();
}

const server = await startServer(PORT);
// gpu:true measures what players actually get; set SOFTWARE=1 for a pure
// software raster (CI without a GPU) where the 55 fps bar cannot apply.
const browser = await Browser.launch({
  port: CDP_PORT,
  gpu: process.env.SOFTWARE !== '1',
});
let desktops = null;
let mobiles = null;
try {
  desktops = await runDesktop(browser);
  mobiles = await runMobile(browser);
  await runReducedMotion(browser);
  await runNetworkProfile(browser);
} catch (err) {
  console.error('\nE2E aborted:', err);
  results.push({ name: 'e2e run completed', ok: false, detail: String(err) });
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (desktops) {
  console.log(`desktop ${desktops.fps} fps (draw ${desktops.drawMs} ms), mobile ${mobiles ? `${mobiles.fps} fps (draw ${mobiles.drawMs} ms)` : 'n/a'}`);
}
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(` - ${f.name} ${f.detail}`);
  process.exit(1);
}
