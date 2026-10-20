// Five-minute heap-growth check for PRD 8.1 ("5 min play, heap growth <= 30 MB").
// Manual run: node tests/memory.mjs [seconds]
import { startServer } from './server.mjs';
import { Browser } from './cdp.mjs';

const PORT = Number(process.env.PORT || 8125);
const CDP_PORT = Number(process.env.CDP_PORT || 9334);
const SECONDS = Number(process.argv[2] || 300);
const SAMPLE_MS = 30000;

const server = await startServer(PORT);
const browser = await Browser.launch({ port: CDP_PORT, gpu: true });
const page = await browser.newPage();
await page.init();
// A soak must keep streaming chunks and churning entities. ?auto=1 alone can
// wedge on a wall, so a stall detector taps jump and, if that fails, nudges the
// player past the obstacle. It is a test harness bot, not game logic.
await page.goto(`http://127.0.0.1:${PORT}/?test=1&auto=1&seed=MEMORY1`);

await page.eval(`(() => {
  window.__keepAlive = setInterval(() => {
    const g = __skyline.game;
    if (g.state === 'over') __skyline.startRun();
    else if (g.state === 'paused') __skyline.resumeRun();
    if (g.player) g.player.hp = g.player.maxHp;
  }, 100);
})()`);
await new Promise((r) => setTimeout(r, 1500));
const initialState = await page.eval('__skyline.game.state');
if (initialState !== 'playing') throw new Error(`memory run is not playing (state=${initialState})`);

let lastX = -1;
let lastMove = Date.now();
let wakeups = 0;
let nudges = 0;
const bot = setInterval(async () => {
  try {
    const x = await page.eval('__skyline.game.player.x');
    if (x > lastX + 2) {
      lastX = x;
      lastMove = Date.now();
      return;
    }
    if (Date.now() - lastMove > 1000) {
      wakeups += 1;
      lastMove = Date.now();
      if (wakeups % 8 === 0) {
        nudges += 1;
        await page.eval('__skyline.game.player.x += 220');
      } else {
        await page.key(' ', { down: true, code: 'Space', vk: 32, text: ' ' });
        await new Promise((r) => setTimeout(r, 160));
        await page.key(' ', { down: false, code: 'Space', vk: 32 });
      }
    }
  } catch {
    /* a navigation in flight is fine */
  }
}, 300);

const sample = async () => {
  await page.send('HeapProfiler.collectGarbage');
  const { usedSize } = await page.send('Runtime.getHeapUsage');
  const state = await page.eval(`({
    chunks: __skyline.game.world.chunks.size,
    enemies: __skyline.game.enemies.length,
    orbs: __skyline.game.orbs.length,
    distance: __skyline.game.distance,
    state: __skyline.game.state,
    fps: Math.round(__skyline.renderer.lastDrawMs * 100) / 100,
  })`);
  return { mb: usedSize / 1048576, ...state };
};

const samples = [];
const start = Date.now();
// Warm up first so one-off allocations (fonts, gradients, first chunks) do not
// count as a leak.
await new Promise((r) => setTimeout(r, 30000));
for (let i = 0; i * SAMPLE_MS < SECONDS * 1000; i++) {
  const s = await sample();
  samples.push(s);
  console.log(
    `t=${Math.round((Date.now() - start) / 1000)
      .toString()
      .padStart(3)}s  heap=${s.mb.toFixed(2)} MB  chunks=${s.chunks}  enemies=${s.enemies}  orbs=${s.orbs}  dist=${s.distance} m`,
  );
  if (i * SAMPLE_MS + SAMPLE_MS < SECONDS * 1000) await new Promise((r) => setTimeout(r, SAMPLE_MS));
}

await page.eval('clearInterval(window.__keepAlive)');
clearInterval(bot);

const first = samples[0].mb;
const last = samples[samples.length - 1].mb;
const peak = Math.max(...samples.map((s) => s.mb));
const growth = last - first;
const peakGrowth = peak - first;
const maxChunks = Math.max(...samples.map((s) => s.chunks));
const maxDist = Math.max(...samples.map((s) => s.distance));
const firstDist = samples[0].distance;
const allPlaying = samples.every((s) => s.state === 'playing');
const progressed = samples[samples.length - 1].distance > firstDist + 100;

console.log(`\nsamples       ${samples.length}`);
console.log(`heap first    ${first.toFixed(2)} MB`);
console.log(`heap last     ${last.toFixed(2)} MB`);
console.log(`heap peak     ${peak.toFixed(2)} MB`);
console.log(`growth        ${growth.toFixed(2)} MB   (budget 30 MB, peak ${peakGrowth.toFixed(2)} MB)`);
console.log(`max chunks    ${maxChunks}          (window is +/-2 -> 5-7)`);
console.log(`distance      ${firstDist} m -> ${samples[samples.length - 1].distance} m (max ${maxDist})`);
console.log(`playing       ${allPlaying}`);
console.log(`stall taps    ${wakeups} (${nudges} nudges)`);

// A run shorter than the warm-up takes one sample, and one sample always shows
// zero growth — so require a real series before believing the number.
const enoughSamples = samples.length >= 5;
const bounded = growth <= 30 && peakGrowth <= 30 && maxChunks <= 7;
const realGameplay = allPlaying && maxDist > 150 && progressed;
if (!enoughSamples) console.log('WARNING: too few samples; run the soak for at least 150 s');
if (!progressed) console.log('WARNING: distance did not advance during the soak');
const pass = enoughSamples && bounded && realGameplay;
console.log(`RESULT        ${pass ? 'PASS' : 'FAIL'}`);

await page.close();
await browser.close();
server.close();
process.exit(pass ? 0 : 1);
