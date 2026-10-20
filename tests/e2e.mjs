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
    // game-over panel instead, and a paused page still renders (draw is called
    // every frame) so fps alone cannot tell "running" from "frozen".
    await page.eval(`window.__keepAlive = setInterval(() => {
      const g = window.__skyline && __skyline.game;
      if (!g) return;
      if (g.state === 'over') __skyline.startRun();
      else if (g.state === 'paused') __skyline.resumeRun();
      if (g.player) g.player.hp = g.player.maxHp;
    }, 100)`);
    await page.waitFor("__skyline.game.state === 'playing'", { timeout: 5000 });
  }
  try {
    const out = await page.eval(`new Promise((res) => {
      let n = 0;
      let playing = 0;
      let draw = 0;
      let samples = 0;
      const draws = [];
      const t0 = performance.now();
      function tick() {
        n += 1;
        const g = window.__skyline && __skyline.game;
        if (g && g.state === 'playing') playing += 1;
        const d = window.__skyline && __skyline.renderer.lastDrawMs;
        if (typeof d === 'number' && Number.isFinite(d)) {
          samples += 1;
          draw += d;
          draws.push(d);
        }
        if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
        else {
          draws.sort((a, b) => a - b);
          res({
            fps: Math.round((n / (performance.now() - t0)) * 10000) / 10,
            mean: samples ? Math.round((draw / samples) * 100) / 100 : -1,
            p95: draws.length ? Math.round(draws[Math.floor(draws.length * 0.95)] * 100) / 100 : -1,
            max: draws.length ? Math.round(draws[draws.length - 1] * 100) / 100 : -1,
            samples,
            playingRatio: Math.round((playing / n) * 1000) / 1000,
          });
        }
      }
      requestAnimationFrame(tick);
    })`, { awaitPromise: true, timeout: ms + 5000 });
    return out;
  } finally {
    if (keepAlive) await page.eval('clearInterval(window.__keepAlive)');
  }
}

async function runDesktop(browser) {
  console.log('\n--- desktop 1280x800 ---');
  const page = await browser.newPage();
  await page.init();
  await page.goto(`${BASE}/?test=1&seed=E2E2026&diff=normal&lang=en`);

  check('boot without page errors', page.errors.length === 0, page.errors.join(' | '));
  check('the page is focused so keyboard tests measure live play', await page.eval('document.hasFocus()'), page.warnings.join(' | '));
  check('version is 2.0.0', (await page.eval('__skyline.version')) === '2.0.0');
  check('starts on the title screen', (await page.eval('__skyline.game.state')) === 'title');
  check('title screen shows the seed', (await page.eval("document.getElementById('seed-label').textContent")) === 'E2E2026');

  // Enter on a focused control must not also fire the global "start run" —
  // that used to start a run with the old difficulty and then swap it out.
  await page.eval("document.querySelector('.diff[data-diff=\"easy\"]').focus()");
  await page.press('Enter', { code: 'Enter', vk: 13, text: '\r' });
  await sleep(150);
  const afterEnter = await page.eval(`({
    state: __skyline.game.state,
    hud: document.getElementById('hud-diff').textContent,
    overlayVisible: !document.getElementById('overlay').classList.contains('hidden'),
    titleVisible: !document.getElementById('panel-title').classList.contains('hidden'),
  })`);
  check(
    'Enter on a focused control fires only that control',
    afterEnter.state === 'title' && afterEnter.hud === 'EASY' && afterEnter.overlayVisible && afterEnter.titleVisible,
    JSON.stringify(afterEnter),
  );
  await page.eval("document.querySelector('.diff[data-diff=\"normal\"]').click()");

  // Space must activate a focused button instead of being eaten as "jump".
  const sound0 = await page.eval('__skyline.soundOn');
  await page.eval("document.querySelector('#panel-title .sound-toggle').focus()");
  await page.press(' ', { code: 'Space', vk: 32, text: ' ' });
  await sleep(150);
  const sound1 = await page.eval('__skyline.soundOn');
  check('Space activates a focused button', sound0 !== sound1, `${sound0} -> ${sound1}`);
  await page.press(' ', { code: 'Space', vk: 32, text: ' ' });
  await sleep(100);
  await page.eval('document.activeElement && document.activeElement.blur()');

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
  const perf = await fps(page, FPS_WINDOW, true);
  await page.key('ArrowRight', { down: false, code: 'ArrowRight', vk: 39 });
  check(`desktop frame rate >= ${MIN_DESKTOP_FPS} fps`, perf.fps >= MIN_DESKTOP_FPS, `${perf.fps} fps`);
  check(
    'desktop render p95 inside the 12 ms budget',
    perf.samples >= 50 && perf.p95 <= 12,
    `p95 ${perf.p95} ms, max ${perf.max} ms over ${perf.samples} frames`,
  );
  check('the frame sample itself ran in gameplay', perf.playingRatio >= 0.9, `${(perf.playingRatio * 100).toFixed(1)}% of frames in gameplay`);
  await page.screenshot(join(ART, 'desktop-run.png'));

  const logic = await page.eval(`(() => {
    const g = __skyline.game;
    const before = { state: g.state, time: g.time };
    const input = { axis: 1, jumpHeld: false, jumpPressed: false };
    const t0 = performance.now();
    for (let i = 0; i < 240; i++) g.update(1 / 120, input);
    return {
      ms: (performance.now() - t0) / 240,
      before,
      after: { state: g.state, time: g.time },
    };
  })()`);
  check('simulation step stays inside the 3 ms logic budget', logic.ms <= 3, `${logic.ms.toFixed(3)} ms`);
  // update() returns immediately unless the run is live, so a paused game
  // would report ~0.00 ms for all 240 calls without advancing the clock.
  check(
    'the logic sample measured live updates',
    logic.before.state === 'playing' && logic.after.state === 'playing' && logic.after.time - logic.before.time > 1.5,
    JSON.stringify(logic),
  );

  const deathDist = await page.eval('__skyline.game.distance');
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
  check('game over panel shows the distance reached', over.dist === `${new Intl.NumberFormat('en-US').format(deathDist)} m`, `${over.dist} vs ${deathDist} m`);
  check('best score recorded', over.best === '777');

  // The over panel must not be a dead end: without a way back, the language
  // and difficulty controls stay unreachable until a reload.
  await page.eval("document.getElementById('btn-title').click()");
  await page.waitFor("__skyline.game.state === 'title'");
  check('the game over panel can return to the title screen', await page.eval("!document.getElementById('panel-title').classList.contains('hidden')"));
  await page.eval('__skyline.startRun()');
  await page.waitFor("__skyline.game.state === 'playing'");
  await page.eval('(__skyline.game.player.hp = 0, __skyline.game.player.alive = false)');
  await page.waitFor("__skyline.game.state === 'over'");

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
  return { fps: perf.fps, p95: perf.p95, logic: logic.ms };
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
  check('every touch target is at least 44x44', sizes.length === 4 && sizes.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(sizes));
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
  const jumpState = await page.eval('({ y: __skyline.game.player.y, vy: __skyline.game.player.vy, onGround: __skyline.game.player.onGround })');
  check(
    'touch jump lifts the player',
    jumpState.y < y0 && (jumpState.vy < 0 || !jumpState.onGround),
    `${y0.toFixed(1)} -> ${jumpState.y.toFixed(1)} vy ${jumpState.vy.toFixed(0)} onGround ${jumpState.onGround}`,
  );

  const pause = await rect(page, '.tbtn[data-dir="pause"]');
  await page.touch(pause.x, pause.y);
  await page.waitFor("__skyline.game.state === 'paused'");
  check('touch pause stops the run', true);
  const resume = await rect(page, '#btn-resume');
  await page.touch(resume.x, resume.y);
  await page.waitFor("__skyline.game.state === 'playing'");
  check('touch resume continues the run', true);
  await page.screenshot(join(ART, 'mobile-run.png'));

  const mPerf = await fps(page, FPS_WINDOW, true);
  check(`mobile frame rate >= ${MIN_MOBILE_FPS} fps`, mPerf.fps >= MIN_MOBILE_FPS, `${mPerf.fps} fps`);
  check(
    'mobile render p95 inside the 12 ms budget',
    mPerf.samples >= 50 && mPerf.p95 <= 12,
    `p95 ${mPerf.p95} ms, max ${mPerf.max} ms over ${mPerf.samples} frames`,
  );
  check('the mobile frame sample itself ran in gameplay', mPerf.playingRatio >= 0.9, `${(mPerf.playingRatio * 100).toFixed(1)}% of frames in gameplay`);

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
  await page.eval("__skyline.startRun(), (__skyline.game.player.hp = 0, __skyline.game.player.alive = false)");
  await page.waitFor("__skyline.game.state === 'over'");
  const overFits = await page.eval(`(() => {
    const r = document.getElementById('panel-over').getBoundingClientRect();
    return r.top >= -1 && r.bottom <= innerHeight + 1;
  })()`);
  check('game over panel fits a 360x640 viewport', overFits == true);
  await page.screenshot(join(ART, 'mobile-360.png'));

  check('mobile session raised no errors', page.errors.length === 0, page.errors.join(' | '));

  await page.close();
  return { fps: mPerf.fps, p95: mPerf.p95 };
}

async function runI18n(browser) {
  console.log('\n--- i18n ---');
  const page = await browser.newPage();
  await page.init();
  await page.goto(`${BASE}/?test=1&seed=LANG01`);
  await page.eval('localStorage.clear()');
  await page.goto(`${BASE}/?test=1&seed=LANG01`);

  check('defaults to zh-CN (PRD 8.5)', (await page.eval('__skyline.locale')) === 'zh-CN');
  check('document lang is zh-CN', (await page.eval('document.documentElement.lang')) === 'zh-CN');
  const zhStart = await page.eval("document.querySelector('#btn-start [data-i18n]').textContent");
  check('static copy ships in Chinese', zhStart === '开始奔跑', zhStart);

  const leaks = await page.eval(`(() => {
    const bad = [];
    for (const el of document.querySelectorAll('[data-i18n]')) {
      if (el.tagName === 'SMALL') continue;
      const key = el.dataset.i18n;
      const text = (el.textContent || '').trim();
      if (!text || text === key || /\\{\\w+\\}/.test(text)) bad.push(key + '=' + text);
    }
    return bad;
  })()`);
  check('every localized node resolved to real copy', leaks.length === 0, JSON.stringify(leaks));

  await page.eval("document.querySelector('.lang-toggle').click()");
  const enStart = await page.eval("document.querySelector('#btn-start [data-i18n]').textContent");
  check('the toggle relabels the UI in English', enStart === 'Start run', enStart);
  check('html lang follows the switch', (await page.eval('document.documentElement.lang')) === 'en-US');
  check('the tab title is localized', (await page.eval('document.title')).includes('neon'));
  const diffLabel = await page.eval(`document.querySelector('[data-diff="normal"] [data-i18n]').textContent`);
  check('difficulty labels are translated', diffLabel === 'Normal', diffLabel);

  // The language toggle legitimately shows the target language ("中文").
  const cjk = await page.eval(`(() => {
    const bad = [];
    const walk = (el) => {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          if (/[\\u4e00-\\u9fff]/.test(n.nodeValue)) bad.push(n.nodeValue.trim());
        } else if (n.nodeType === 1 && !n.classList.contains('lang-toggle')) {
          const st = getComputedStyle(n);
          if (st.display !== 'none' && st.visibility !== 'hidden') walk(n);
        }
      }
    };
    walk(document.body);
    return bad;
  })()`);
  check('English mode leaves no Chinese copy on screen', cjk.length === 0, JSON.stringify(cjk));

  await page.goto(`${BASE}/?test=1&seed=LANG01`);
  check('the language choice persists across reloads', (await page.eval('__skyline.locale')) === 'en-US');

  await page.goto(`${BASE}/?test=1&seed=LANG01&lang=zh-CN`);
  check('?lang= overrides the stored choice', (await page.eval('__skyline.locale')) === 'zh-CN');

  check('i18n session raised no errors', page.errors.length === 0, page.errors.join(' | '));
  await page.close();
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
  // A browser that accepts but ignores the throttle would report a ~100 ms
  // localhost DCL and pass the budget for the wrong reason.
  const rtt = await page.eval(`(() => {
    const slowest = performance.getEntriesByType('resource')
      .map((r) => r.responseEnd - r.requestStart)
      .filter((ms) => Number.isFinite(ms));
    return slowest.length ? Math.round(Math.max(...slowest)) : -1;
  })()`);
  check('the network throttle is actually in effect', rtt >= 100, `slowest resource took ${rtt} ms`);
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
  await runI18n(browser);
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
  console.log(`desktop ${desktops.fps} fps (p95 draw ${desktops.p95} ms, logic ${desktops.logic.toFixed(3)} ms), mobile ${mobiles ? `${mobiles.fps} fps (p95 draw ${mobiles.p95} ms)` : 'n/a'}`);
}
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(` - ${f.name} ${f.detail}`);
  process.exit(1);
}
