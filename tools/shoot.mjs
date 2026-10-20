// Regenerates the README hero image from the real game.
// Usage: node tools/shoot.mjs [out.png] [width] [height] [zh-CN|en-US]
import { startServer } from '../tests/server.mjs';
import { Browser } from '../tests/cdp.mjs';

const out = process.argv[2] || 'tests/artifacts/preview.png';
const width = Number(process.argv[3] || 1440);
const height = Number(process.argv[4] || 900);
const lang = process.argv[5] || 'zh-CN';
const PORT = Number(process.env.PORT || 8126);
const CDP_PORT = Number(process.env.CDP_PORT || 9336);

const server = await startServer(PORT);
const browser = await Browser.launch({ port: CDP_PORT, gpu: true });
const page = await browser.newPage();
await page.init();
await page.send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: false,
});
// ?auto=1 plays the game by itself, so the frame shows a real run in motion.
await page.goto(`http://127.0.0.1:${PORT}/?test=1&auto=1&seed=PREVIEW1&lang=${lang}`);
await new Promise((r) => setTimeout(r, 4200));
const state = await page.eval('({ state: __skyline.game.state, dist: __skyline.game.distance })');
await page.screenshot(out);
console.log(`saved ${out} at ${width}x${height} (state=${state.state}, ${state.dist} m)`);

await page.close();
await browser.close();
server.close();
process.exit(0);
