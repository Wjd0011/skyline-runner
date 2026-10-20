# SKYLINE RUNNER · 天际行者

A neon skyline platformer where every building is procedurally generated from a seed — and the drones are hunting you.

**▶ Play in your browser:** https://wjd0011.github.io/skyline-runner/

[![Play](https://img.shields.io/badge/PLAY-skyline--runner-161B22?style=for-the-badge&logo=googlechrome&logoColor=22D3EE)](https://wjd0011.github.io/skyline-runner/)
![No dependencies](https://img.shields.io/badge/dependencies-0-161B22?style=flat-square&logo=javascript&logoColor=7DD3FC)
![Canvas 2D](https://img.shields.io/badge/render-Canvas%202D-161B22?style=flat-square&logo=html5&logoColor=A78BFA)
![Tests](https://img.shields.io/badge/tests-41%20unit%20%2B%2050%20e2e-161B22?style=flat-square&logo=nodedotjs&logoColor=34D399)
![License](https://img.shields.io/badge/license-MIT-161B22?style=flat-square&logo=opensourceinitiative&logoColor=34D399)

![Gameplay](docs/preview.png)

## What makes it different

- **Procedural architecture** — buildings, canyons, stepping ledges and rooftop props are generated chunk by chunk from a seed. Same seed, same skyline; share it via `?seed=NEON42`.
- **Every roof is reachable** — tall blocks grow stepped shoulders, and any building over three tiles gets a two-tile balcony 96 px above the street, inside the 155 px jump. Tall blocks always get a three-tile canyon so the balcony keeps a street tile free to jump from.
- **AI enemies that react** — walkers patrol the terraced roofs and chase you across them, drones drift until you enter their range and then dive. Both can be stomped; both can end your run.
- **Distance-driven pressure** — the first 96 m are deliberately calm, then enemy density and speed ramp with distance instead of hitting you with a wall of robots on spawn.
- **Three difficulty modes** — Easy / Normal / Hard change hearts, spawn curve, enemy speed and score multiplier. High scores are tracked per mode.
- **Hand-tuned movement** — coyote time, jump buffering, variable jump height, air control and a 120 Hz fixed-step simulation. The jump feels right before anything else.
- **Zero dependencies** — no engine, no bundler, no build step, no test framework. Canvas 2D and ES modules, served straight from GitHub Pages.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `A` / `D` or `←` / `→` | ◀ ▶ |
| Jump | `Space` / `W` / `↑` | ▲ |
| Pause | `Esc` / `P` | ❚❚ |
| Restart | `Enter` | buttons |
| Sound | `M` or the SOUND toggle | same |
| Difficulty | `1` / `2` / `3` or the title-screen buttons | same |
| New seed | click the seed on the title screen | same |

Hold jump longer to jump higher. You have three hearts — contact costs one and grants brief invulnerability.

## Difficulty

| | Hearts | Spawn curve (enemies / chunk) | Enemy speed | Score |
| --- | --- | --- | --- | --- |
| **Easy** | 4 | 0 → 1.3 | 0.82× → 0.98× | ×0.8 |
| **Normal** | 3 | 0 → 2.2 | 0.95× → 1.10× | ×1.0 |
| **Hard** | 2 | 0 → 2.9 | 1.06× → 1.26× | ×1.3 |

The first two chunks (96 m) never spawn enemies or street hazards, so every run opens with a clean runway. After that, spawn chance is lerped between the difficulty's start and end values across its ramp window (for example Normal ramps from 70 m to 600 m).

## How it works

```
src/
  main.js       bootstrap, UI state machine, input, fixed-step loop
  loop.js       fixed-step scheduler with a latched jump press
  game.js       world streaming, collisions, scoring, camera, run lifecycle
  world.js      seeded chunk generation: ground, buildings, ledges, hazards, spawns
  player.js     movement, AABB tile collision, coyote time, jump buffering
  entities.js   walker / drone AI and collectible orbs
  scoring.js    orb + stomp values and the combo window
  render.js     parallax skyline, synthwave sun, buildings, neon, particles, post FX
  audio.js      WebAudio synth SFX (no audio files)
  rng.js        mulberry32 + hashing for deterministic generation
  config.js     physics tuning and palette
tests/
  unit/         generator invariants, physics, scoring, AI (node:test, no deps)
  cdp.mjs       ~260-line Chrome DevTools Protocol client (no Puppeteer)
  e2e.mjs       real-browser keyboard / touch / network / perf checks
  server.mjs    tiny static server used by the E2E run
tools/
  metrics.mjs   prints the generator numbers quoted in the test report
```

- **Determinism**: chunk `i` is generated from `mulberry32(seed ^ hash(i))`, so regeneration never changes a level you have already seen.
- **Streaming**: only a ±2 chunk window is kept in memory; entities are born and retired with their chunk.
- **Reachability by construction**: buildings taper towards both edges (`heights[]` per column), tall blocks always get a balcony at row `groundY - 3`, and canyons widen to three tiles in front of them so the balcony always has a launch tile. Tests verify the invariant over 24 seeds × 40 chunks (825/825 balconies).
- **Spawn legality**: every orb, walker and drone is placed only after an AABB test against the finished tile map, so nothing is ever embedded in a wall.
- **Physics**: 120 Hz fixed timestep with an accumulator. The jump press is latched until a step consumes it — otherwise a 144 Hz frame that runs zero simulation steps silently eats the input.
- **Feel**: gravity is increased by 2.2× while the jump key is released mid-rise, giving variable jump height without a second timer.
- **Paint budget**: gradients are cached per size and ground level, and the sky repaint doubles as the clear, keeping `renderer.draw()` around 1.5 ms.

## Testing

Zero-dependency test suites; the browser suite drives a real Chromium through CDP instead of mocking the DOM.

```bash
npm test                # 41 unit / property tests
npm run test:e2e        # 50 real-browser checks (needs Chrome or Edge)
SOFTWARE=1 npm run test:e2e   # GPU-less CI: software raster, lower fps bar
node tools/metrics.mjs 24     # generator statistics
```

Measured on the reference machine (Edge headless, GTX 1650):

| | Result |
| --- | --- |
| Unit / property tests | 41 / 41 |
| Browser E2E checks | 50 / 50 |
| Desktop frame rate | 60.1 fps, draw 1.56 ms |
| Mobile 390×844 | 60.2 fps, draw 1.05 ms |
| Simulation step | 0.002 ms (budget 3 ms) |
| Chunk generation | 0.005 ms (budget 2 ms) |
| First interactive on Slow-4G | 1027 ms (budget 3000 ms) |

Full AC-by-AC traceability and the defect list live in [docs/TEST-REPORT-v2.0.md](docs/TEST-REPORT-v2.0.md). The spec is [docs/SKYLINE-RUNNER-PRD-v2.0.docx](docs/SKYLINE-RUNNER-PRD-v2.0.docx).

## Accessibility

- `prefers-reduced-motion` turns off camera shake, rain and particle bursts.
- Sound can be muted with `M` or the SOUND toggle; the choice persists.
- Every panel is keyboard operable with a visible `:focus-visible` outline.
- Touch targets are at least 44×44 px, including the pause button.
- Hearts carry a text equivalent (`aria-label="生命 3/3"`), and body text stays above 6:1 contrast.

## Run locally

```bash
python -m http.server 8000
# open http://localhost:8000
```

No install, no build. Any static server works. `npm run serve` also works if you have Node.

## Browser support

Chromium (Chrome / Edge) is tested. Firefox and Safari are expected to work — the code uses Canvas 2D, ES modules and WebAudio — but iOS Safari and Firefox are not covered by the automated suite yet.

## Roadmap

- [ ] More enemy archetypes (turrets, swarmers)
- [ ] Rooftop modifiers: moving platforms, collapsing cranes
- [ ] Daily challenge seeds and a local leaderboard
- [ ] Gamepad support
- [ ] i18n layer (zh-CN default, en-US reserve) and full a11y sweep
- [ ] Real-device perf matrix (mid-range Android, iPhone)

## License

MIT — art, code and audio are original and generated at runtime.
