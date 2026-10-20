# 代码审核记录 · v2.0

日期：2026-10-20
范围：`skyline-runner` 全部源码、测试与构建脚本（v2.0 提交前的最后一轮）
方法：两名独立评审（UI 与 i18n / 测试质量）＋作者对玩法内核的逐行自审与自动对局压测；每条结论都在代码里复核后才动手。**不能复现的结论一律不改**，列在最后一节。

## 结论摘要

| | 数量 |
| --- | --- |
| 复核后确认为真 | 40 |
| 其中 P1（测试假绿 / 双重动作） | 6 |
| 其中 P2（覆盖不足 / 交互缺陷） | 14 |
| 其中 P3（细节与可访问性） | 20 |
| 已修复 | 40 |
| 复核后判定为“现状可接受” | 5 |
| 未能确认 | 3 |

测试规模从 **49 单测 + 62 E2E** 增加到 **51 单测 + 72 E2E**，新增的 10 条 E2E 全部是为了让“已通过的结论”真的可被证伪。

最严重的一类问题不是玩法 bug，而是**测试无法失败**：三个 AC 的断言写成了恒真式，删掉被测代码它们依然是绿的。

## P1 · 测试假绿与双重动作

| # | 位置 | 问题 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | `tests/unit/game.test.mjs` | 断言 `x >= floor(x/C)*C` 对任何有限数恒真，且只在 chunk 0（baseX=0）上取样，`+ chunk.baseX` 漏掉也测不出 | 改为加载 chunk 5 再生成实体，断言落在 `[5·1920, 6·1920)` | **变异测试**：把偏移改回 0，断言立刻失败（`orb 659.2 outside`）；加回偏移通过 |
| 2 | 同上 | `enemies` 循环体永远不执行（chunk 0 按设计无敌人），敌人坐标错误无人发现 | 同一个 chunk 5 生成，并要求 `minX/maxX` 也在窗口内 | 该 chunk 实际产出 1 个 walker + 4 个 orb |
| 3 | `tests/unit/world.test.mjs` | `maxChunks <= 7` 在 `ensure()` 被整个删掉时（size=0）依然通过 | 追加：访问过的 chunk 集合 > 50、spawn 事件 > 50、峰值 4–7 | 3000 m 跑完访问 60+ chunk |
| 4 | `tests/e2e.mjs` | fps 采样只统计帧数，**暂停页照样每帧 draw**，暂停也能报 60 fps；`keepAlive` 只重启 over，不恢复 paused | 采样期统计 `playing` 帧占比，要求 ≥90%，paused 也自动恢复 | 新断言 `100.0% of frames in gameplay` |
| 5 | `tests/cdp.mjs` | `setFocusEmulationEnabled` 失败被空 catch 吞掉——而这正是“测到暂停页”的唯一防线 | 记录 `warnings`，E2E 断言 `document.hasFocus()` | 新检查 `the page is focused...` |
| 6 | `tests/unit/game.test.mjs` | 尖刺测试直接调 `updateHazards()`，把 `game.js` 里的调用点删掉仍然通过 | 改为走 `g.update(DT, IDLE)` | 调用点被删则血量不变，测试失败 |

## P2 · 覆盖不足（已修复）

| # | 位置 | 问题 | 修复 |
| --- | --- | --- | --- |
| 7 | `world.test.mjs` | 阳台高度断言等价于 `96<=96`（`by` 就是 `groundY-3`） | 从地图向上扫到 LEDGE 行，用发现的行算高度，并断言行号一致 |
| 8 | `world.test.mjs` | 峡谷循环没有计数，`gaps` 为空则整条测试空转 | `canyons > 300` |
| 9 | `e2e.mjs` | 渲染预算取**均值**且 `|| 0`，缺属性/偶发卡顿都测不出 | 采样数 ≥50 + **p95** ≤12 ms，同时输出 max |
| 10 | `e2e.mjs` | `final-dist` 读出来但从未断言，删掉赋值仍是绿的 | 与 `game.distance` 按 `Intl.NumberFormat` 比对 |
| 11 | `e2e.mjs` | `.tbtn` 空列表时 `every()` 为真 | 断言数量为 4 |
| 12 | `e2e.mjs` | 触摸跳跃只看 `y1<y0`，滞空时也可能成立 | 追加 `vy<0 \|\| !onGround` |
| 13 | `memory.mjs` | 只跑 10 s 时恰好 1 个采样，增长必然为 0 却打印 PASS | 要求采样 ≥5，并用 peak−first |
| 14 | `memory.mjs` | `maxDist>150` 是全程序最大值，中途卡死也能过 | 末次采样距离 > 首次 +100 |
| 15 | `cdp.mjs` | 端口轮询失败时浏览器进程与临时目录泄漏，后续重试全部失败 | 失败时 kill + rm，并给出端口信息 |
| 16 | `main.js` | **Enter 同时触发全局动作和按钮自身 click**：标题页 Tab 到难度按 Enter 会用旧难度开跑再切难度，画面卡死；EN 按钮会同时开跑并切语言 | 焦点在 `button/a/[role=radio]` 上时 Enter 交给控件 |
| 17 | `main.js` | Space 被无条件吞掉并 `preventDefault()`，导致**所有按钮都无法用空格激活** | 焦点在控件上时不拦截 Space |
| 18 | `main.js` | 种子是裸 `<b>`：不可聚焦、无 44 px 命中区，键盘用户无法换种子 | 改为 `<button class="seed-toggle">`，44 px + 焦点环 + toast |
| 19 | `main.js` | 暂停时 `releaseInput()` 清空按键，触摸玩家松不开的手指在恢复后不生效 | 暂停只 `loop.clear()`，按键状态交给 keyup/blur 维护 |
| 20 | `main.js` | 触摸板在遮罩下方仍可 Tab 到（触屏笔记本上焦点环消失） | 遮罩期间给 `#touch` 设 `inert`（保持可见但不可聚焦/点击） |

## P3 · 细节与可访问性（已修复）

| # | 位置 | 问题 | 修复 |
| --- | --- | --- | --- |
| 21 | `main.js` | 触摸暂停只绑 `pointerdown`，键盘 Enter 无效 | 改绑 `click`（点击与键盘都会触发） |
| 22 | `index.html` | toast 无 `role=status`，读屏用户听不到任何状态 | `role="status" aria-live="polite"` |
| 23 | `style.css` | `.lang-toggle` 只有 `min-height`，"EN" 实际宽度约 42–43 px，差 1–2 px | 加 `min-width: 44px` |
| 24 | `style.css` | `:focus-visible` 强制 `border-radius: 6px`，把圆形触摸键和胶囊按钮改成圆角矩形 | 删除该行，outline 自动贴合元素圆角 |
| 25 | `main.js` | 未过滤 Ctrl/Cmd/Alt：Ctrl+D、Cmd+P 被吞 | 修饰键按下时直接返回 |
| 26 | `main.js` | 未过滤 `e.repeat`：长按 Esc/M 每秒切换约 30 次 | 暂停/声音分支加 `e.repeat` 保护 |
| 27 | `main.js` | 语言名 `'中文'/'English'` 硬编码在逻辑里，是唯一漏出 i18n 的用户可见文案 | 新增 `lang.name.zh-CN` / `lang.name.en-US` |
| 28 | `style.css` | `.toast` 的 z-index(16) 低于遮罩(20)，面板上的提示被磨砂压暗 | 提到 24 |
| 29 | `e2e.mjs` | `keepAlive` 只在成功时清理，异常后会污染后续检查 | `try/finally` |
| 30 | `e2e.mjs` | 逻辑耗时循环在暂停态下测的是空转（`update()` 直接 return） | 同时断言 `state==='playing'` 且模拟时钟前进 >1.5 s |
| 31 | `world.test.mjs` | 2 ms/块的墙钟断言无预热、无中位数，CI 上易假失败 | 预热 64 块，取 5 次中位数 |
| 32 | `cdp.mjs` | `waitFor` 吞掉所有异常，探针写错只报“超时” | 超时信息带上最后一次错误 |
| 33 | `cdp.mjs` | `/json/new` 失败且无 page target 时报 TypeError | 显式报“no page target” |
| 34 | `server.mjs` | 端口占用时抛未捕获的 'error' 事件；EACCES 被当成 404 | `reject` + 500/日志分流 |
| 35 | `e2e.mjs` | 4G 检查不验证限速是否真的生效（localhost 100 ms 也能过） | 断言最慢资源 ≥100 ms（实测 405 ms） |
| 36 | `i18n.test.mjs` | “未翻译”检查只看空串，整表复制 zh-CN 也能过 | 除单位/自称外，禁止 en-US 与 zh-CN 取值相同 |
| 37 | `world.test.mjs` | 密度按名义带宽归一，但样本按 chunk 起点归档，band 0 实际 192 m 却除以 154 m（虚高 25%） | 按实际采样 chunk 数归一 |
| 38 | `config.js` | `label`/`labelEn` 在 i18n 落地后成了死字段（双份文案来源） | 删除 |
| 39 | `package.json` | 报告与 README 引用了 `npm run test:memory`，脚本不存在 | 补上 |
| 40 | `docs/preview.png` | README 头图是旧版英文界面，默认语言已改为 zh-CN | 新增 `tools/shoot.mjs`，用真实对局重拍 |

## 复核后不修改（附理由）

1. **`MIN_DESKTOP_FPS=55` 在无 GPU 机器上是否可达**：本机（GTX 1650，headless）30 s 窗口实测 60.0–60.3 fps；CI 已用 `SOFTWARE=1` 单独设 24 fps 护栏。这是环境差异，不是代码缺陷。
2. **密度测试 3.4% 的余量**：标签是固定的 24 个种子，运行期无随机性，只有“有人改种子”才可能触发；改为固定更宽的容差反而会掩盖真实回退，保留。
3. **`tools/metrics.mjs` 的阳台覆盖率是整体比例**：该数字只用于报告叙述，逐栋校验由单测负责（825/825），保留。
4. **减少动效仍保留标题页镜头推移与星星闪烁**：PRD 只要求“尊重 prefers-reduced-motion”，已关闭震屏、雨丝、粒子与转场；镜头推移属于低速背景运动，产品判断保留。
5. **`#hearts` 初始 `aria-label="生命 3"` 未走 i18n**：初始化后第一帧即被 `updateHud()` 覆盖，不存在持久错误播报，保留静态回退。

## 未能确认（不改）

1. **多语言下的数字分组**：`#final-score/#final-dist/#final-best` 在 `applyLocale()` 时不重算，但现有两种语言的分组与单位一致，构造不出可见差异；新增语言时需要复查。
2. **`HeapProfiler.collectGarbage` 是否需先 `HeapProfiler.enable`**：在本机 Edge 上可直接调用；若某些版本需要，脚本会显式报错而非假绿。
3. **触屏笔记本上的 `inert` 回退**：`inert` 在 Chromium 102+/Safari 15.5+ 可用；更老的浏览器会退化为“可 Tab 但被遮罩盖住”，不构成新缺陷。

## 复核方法说明

- 每条结论先在源码里定位并构造触发条件，确认后才改；
- 对“测试假绿 / 双重动作”类结论做了**变异验证**：把被测逻辑改回错误版本，确认新断言确实失败（见 #1 与 #16）；
- 玩法内核（`game.js` / `player.js` / `world.js` / `entities.js`）另做了自动对局压测：8 个种子 × 90 秒硬核模式，逐步检查坐标有限、玩家不出世界、实体不漂移、chunk 窗口 ≤6、速度不超上限 —— 17 局、零异常；
- 修复按严重度分批，每批跑一次对应套件；最终 `npm test` 51/51、`npm run test:e2e` 72/72、`npm run test:memory` 5 分钟通过。
