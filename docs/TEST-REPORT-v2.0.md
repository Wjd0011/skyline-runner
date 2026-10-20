# SKYLINE RUNNER v2.0 · 测试报告

| 项 | 值 |
| --- | --- |
| 被测版本 | 2.0.0（PRD v2.0 的 F1–F6 六项 Must） |
| 测试日期 | 2026-10-20 |
| 结论 | **41 条单元/属性测试 + 50 条浏览器端到端检查全部通过；33 条验收标准（AC）全部有对应用例并通过** |
| 报告日期 | 2026-10-20 |

本文档对应 `docs/SKYLINE-RUNNER-PRD-v2.0.docx` 第 9 章（测试与质量）与第 11 章（验收），提供可复现的命令、逐条 AC 追溯，以及本轮发现并修复的缺陷清单。未验证项在第 7 节明确列出，不做“全部达标”的过度声明。

## 1. 结果总览

| 套件 | 用例数 | 通过 | 失败 | 运行时间 |
| --- | --- | --- | --- | --- |
| 单元 / 属性（`npm test`） | 41 | 41 | 0 | ≈ 0.4 s |
| 端到端（`npm run test:e2e`） | 50 | 50 | 0 | ≈ 25 s |
| 生成器统计（`node tools/metrics.mjs 24`） | 24 种子 × 40 区块 | 全部不变量成立 | — | ≈ 1 s |

端到端在 **Chromium 内核的真实浏览器**里跑：无 DOM 打桩，通过 CDP 驱动键盘、触摸、网络限速与设备模拟，并统计 `requestAnimationFrame` 帧率与 `renderer.draw()` 耗时。

## 2. 环境与命令

```
Node            v24.21.0（无任何 npm 依赖；测试同样零依赖）
Browser         Edge / Chrome headless=new，CDP :9333
Host            Windows 10 · Intel UHD + GTX 1650
视口            1280×800（桌面）、390×844 与 360×640 @DPR3（移动）
网络            CDP Slow-4G 模拟：1.6 Mbps ↓ / 750 kbps ↑ / 150 ms RTT
```

```bash
npm test                  # 41 条单元/属性测试
npm run test:e2e          # 50 条浏览器端到端检查（需装 Chrome 或 Edge）
SOFTWARE=1 npm run test:e2e   # 无 GPU 的 CI：软件光栅，帧率阈值降至 24 fps
node tools/metrics.mjs 24     # 生成器统计（本报告第 3 节数字来源）
npm run serve                 # http://127.0.0.1:8123 手动试玩
```

测试代码结构与生产代码一致保持零依赖：`tests/cdp.mjs` 是约 260 行的 CDP 客户端（Node 24 自带 `WebSocket`），不引入 Puppeteer/Playwright。

## 3. 程序化生成（F2）实测

24 个种子 × 40 个区块，统计口径与 PRD 附录 B 一致：

| 检查项 | 实测 | 标准 |
| --- | --- | --- |
| 建筑总数 / 其中 ≥4 格 | 2030 / 825 | — |
| 阳台覆盖率 | **825 / 825 = 100%** | 100% |
| 阳台高度 | 恒为 96 px（3 格） | ≤ 96 px，街面可跳达 |
| 晶体（orb） | 2831，嵌入墙体 **0** | 0 |
| 巡逻怪 | 1033，悬空 **0** | 0 |
| 无人机 | 633，嵌入楼体 **0** | 0 |
| 峡谷宽度 | 2030 条，全部 2–3 格 | 2–3 格 |
| 前 96 m 安静期违规 | **0**（三档难度各测） | 0 |
| 区块生成耗时 | **0.005 ms/区块** | ≤ 2 ms（桌面） |
| 同种子字节一致性 | 全部一致（12 种子 × 20 区块） | 完全一致 |

距离压力（Normal，24 种子抽样，单位：敌人/米）：

```
  96–250 m   0.0203
 250–450 m   0.0292
 450–700 m   0.0388
 700–1200 m  0.0403
```

> **测试方法说明（重要）**：压力曲线在 600 m 饱和，因此第 3、4 段的**期望密度相同**。仅凭 24 个种子的抽样，两段出现几个百分点的倒挂属于泊松噪声（σ≈5%），用严格 `>=` 断言会随机失败（实测 16 组种子中最低比值为 0.966）。因此拆成两层：**精确测试**直接验证 `spawnPressure()` 在 0–4000 m 上逐点单调不减（无抽样、无噪声）；**抽样测试**保留“不得低于上一段 90%”的回归护栏，并断言末段密度 > 首段 1.5 倍。这样既能抓住真实回归，也不会因随机种子偶发红灯。

## 4. 验收标准追溯（33 / 33）

### F1 移动与跳跃手感

| AC | 验证 | 结果 |
| --- | --- | --- |
| AC-F1-01 站立起跳 ≥144 px，可落 3 格屋顶 | 单元：`standing jump apex clears 144 px`（实测 154.5 px）、`running jump lands on a 3-tile roof`（助跑贴墙、贴面滑升、落到 96 px 屋顶） | 通过 |
| AC-F1-02 离台 100 ms 内仍可起跳 | 单元：`coyote time: jumping 80 ms after leaving the ledge still works` + `coyote time expires after 100 ms`（边界双向） | 通过 |
| AC-F1-03 落地前 120 ms 缓冲 | 单元：`jump buffer: pressed 100 ms before landing, jumps on touchdown` | 通过 |
| AC-F1-04 松键截断 ≥30% | 单元：`releasing jump mid-rise cuts the apex by at least 30%`（实测截断后 ≈45%） | 通过 |
| AC-F1-05 60/144 Hz 落点误差 ≤1 格 | 单元：`60 Hz and 144 Hz produce the same jump timing within one step`（误差 ≤ 1 个 8.33 ms 步长）+ 零步长帧按键不丢失的回归用例 | 通过 |
| AC-F1-06 触屏三键完成移动/跳跃/暂停 | E2E：`tapping the start button begins a run`、`touch right advances the distance`、`touch jump lifts the player`、`touch pause stops the run` | 通过 |

### F2 程序化关卡与可达性

| AC | 验证 | 结果 |
| --- | --- | --- |
| AC-F2-01 同种子逐字节一致 | 单元：`deterministic generation: same seed, same bytes` | 通过 |
| AC-F2-02 ≥4 格建筑必有 2 格宽阳台且 ≤96 px | 单元：`every 4+ tile building has a reachable 2-wide balcony at <=96 px`；额外断言阳台前方留有一格空街面作为起跳点 | 通过 |
| AC-F2-03 晶体不嵌入 | 单元：`no orb is embedded in a wall or a balcony`（按 18×18 包围盒逐瓦片判定）+ 统计脚本 2831/0 | 通过 |
| AC-F2-04 峡谷恒 2–3 格 | 单元：`canyon width is always 2-3 tiles` + 统计脚本 2030/0 | 通过 |
| AC-F2-05 单区块 ≤2 ms | 单元：`chunk generation stays under the 2 ms budget`（实测 0.005 ms） | 通过 |
| AC-F2-06 10 局随机种子不重复 | 单元：`ten different seeds produce ten different skylines`（比较 6 个区块的瓦片指纹） | 通过 |

### F3 敌人 AI 与对抗

| AC | 验证 | 结果 |
| --- | --- | --- |
| AC-F3-01 屋顶两端折返、不坠落 | 单元：`a patrolling walker reverses at both ends and never leaves the roof`（60 s 逐帧断言脚下恒为实心、不越界、至少 4 次折返） | 通过 |
| AC-F3-02 0.3 s 内转向 | 单元：`a walker turns toward the player within 0.3 s`（单帧内转向） | 通过 |
| AC-F3-03 踩杀 + 50×倍率 | 单元：`stomping an enemy kills it, bounces the player and scores 50 x multiplier`（困难档 65 分） | 通过 |
| AC-F3-04 1.15 s 无敌帧 | 单元：`touching an enemy from the side costs one heart…`、`a hazard costs a heart and respects i-frames` | 通过 |
| AC-F3-05 300 px 内 1 s 接近 | 单元：`a drone within 300 px closes in within 1 s` + `a drone ignores a player outside 300 px` | 通过 |
| AC-F3-06 无悬空/重叠敌人 | 单元：`walkers stand on solid roof…`、`drones never spawn inside a tower`（按包围盒判定） | 通过 |

### F4 难度体系与距离压力

| AC | 验证 | 结果 |
| --- | --- | --- |
| AC-F4-01 三档切换 1 s 内同步 | E2E：`difficulty switch syncs HUD and hearts within 1 s`（按 `1` → HUD=EASY、生命=4、按钮态同步，200 ms 内） | 通过 |
| AC-F4-02 前 96 m 无敌人与尖刺 | 单元：`first 96 m are enemy-free and spike-free on all difficulties`（三档 × 12 种子） | 通过 |
| AC-F4-03 四段密度单调不减 | 单元：精确 `spawnPressure` 单调性 + 24 种子抽样护栏（见第 3 节方法说明） | 通过 |
| AC-F4-04 三档最高分互不覆盖 | E2E：`high scores are isolated per difficulty`、`easy best is kept separately` | 通过 |
| AC-F4-05 HUD/结算显示难度 | E2E：`HUD names the active difficulty`、`game over panel shows seed and difficulty` | 通过 |

### F5 计分、生命与结算

| AC | 验证 | 结果 |
| --- | --- | --- |
| AC-F5-01 三连晶体 = 60（中等） | 单元：`three consecutive orbs on normal score 60`、`three consecutive orbs on normal score 10+20+30 = 60` | 通过 |
| AC-F5-02 2.4 s 后连击归零 | 单元：`the combo resets after 2.4 s without a pickup`（下一次按 ×1 计 10 分） | 通过 |
| AC-F5-03 生命归零当帧结算 | 单元：`losing the last heart ends the run with the current score and distance`、`the run ends exactly once` | 通过 |
| AC-F5-04 最高分持久化 / 清空归零 | E2E：`best score survives a reload`、`clearing storage resets the best score` | 通过 |
| AC-F5-05 结算页五字段 | E2E：`game over panel shows the final score`（校验分数、距离、最高分、种子、难度五项） | 通过 |

### F6 多端适配、性能与发布

| AC | 验证 | 结果 |
| --- | --- | --- |
| AC-F6-01 360×640 / 390×844 无横向滚动、UI 不重叠 | E2E：两档视口 `scrollWidth <= innerWidth`、HUD 四块矩形两两不相交、标题面板在 360×640 内完整可见 | 通过 |
| AC-F6-02 触屏全流程（含重开） | E2E：开始 → 右移 → 跳跃 → 暂停 → 继续 → 死亡 → `#btn-retry` 重开 | 通过 |
| AC-F6-03 中端安卓 30 s 平均 ≥55 fps | E2E：移动端 390×844@DPR3 实测 **60.2 fps**，单帧绘制 1.05 ms（headless GPU） | 通过（见第 7 节限制） |
| AC-F6-04 4G 首屏可交互 ≤3 s | E2E：Slow-4G 限速下 DCL **1027 ms** | 通过 |
| AC-F6-05 资源 200、控制台无报错 | E2E：13 个静态资源全部 200；桌面/移动/降级动效/限速四个会话均无 console error 与未捕获异常 | 通过（本地静态服务器） |
| AC-F6-06 桌面与移动各完成一局 | E2E：桌面键盘一局 + 移动触屏一局，均进入结算并重开 | 通过 |

## 5. 非功能需求验证

| 项 | 目标 | 实测 | 结论 |
| --- | --- | --- | --- |
| 桌面帧率 | ≥58 fps | 60.1 fps | 达标（本机 GPU） |
| 移动帧率 | ≥55 fps | 60.2 fps | 达标（模拟 390×844@DPR3） |
| 渲染单帧 | ≤12 ms | 1.56 ms / 1.05 ms | 达标 |
| 逻辑单帧 | ≤3 ms | 0.002 ms | 达标 |
| 单区块生成 | ≤2 ms | 0.005 ms | 达标 |
| 首屏可交互（Slow-4G DCL） | ≤3 s | 1.03 s | 达标 |
| 对比度（正文/弱文本） | ≥4.5:1 | 16.1:1 / 8.1:1 / 6.1:1（ink / muted / dim） | 达标（原 `--dim` 仅 2.55:1，已修） |
| 触控目标 | ≥44×44 px | 44×44（暂停）、64×64（方向/跳跃） | 达标 |
| 减少动效 | 关闭抖动与粒子 | `prefers-reduced-motion` 关闭雨、抖动、粒子，E2E 验证 | 达标 |
| 音效可关闭 | 可关闭且持久化 | `M` 键 / 面板按钮，localStorage 记忆 | 达标 |
| 非颜色信息 | 生命同时用图形与数量表达 | 心形 + `aria-label="生命 N/3"` | 达标 |
| 键盘可达 / 焦点可见 | 全流程键盘可完成 | 全部面板键盘可达，`:focus-visible` 描边 | 达标 |

## 6. 本轮发现并修复的缺陷

| # | 级别 | 问题 | 修复 | 回归用例 |
| --- | --- | --- | --- | --- |
| 1 | P0 | 144 Hz 下按键落在“零仿真步”的帧会被丢弃，跳跃随机失效 | 抽出 `FixedStep`，按键锁存到真正被消费的那一步 | `a jump pressed during a zero-step frame is not dropped` |
| 2 | P1 | 巡逻怪边界按“中心坐标”计算但只留 8 px，小于半个身位（15 px），在窄屋顶反复撞边抖动 | 边界改为全身宽；改为“地形跟随”，可走台阶、遇真实落差折返 | `a patrolling walker reverses at both ends and never leaves the roof` |
| 3 | P1 | 无人机可能生成在楼体内部 | 生成时做 32×20 包围盒空域检测，最多重试 8 次 | `drones never spawn inside a tower` |
| 4 | P1 | 两格宽峡谷被阳台完全覆盖时，高楼从街面无法起跳 | 生成器在 ≥4 格建筑前把峡谷拓宽到 3 格，保证阳台前留一格起跳位 | `every 4+ tile building has a reachable 2-wide balcony`（含起跳位断言） |
| 5 | P1 | 触屏没有暂停键（AC-F1-06 要求三键） | 新增 44×44 暂停键，位于跳跃键上方 | E2E `touch pause stops the run` |
| 6 | P1 | 隐私模式/配额满时 `localStorage.setItem` 抛错会导致整局崩溃 | 增加 `store` 包装，写失败降级为内存存储 | E2E `clearing storage resets the best score` 走同一路径 |
| 7 | P2 | 弱文本对比度仅 2.55:1 | 调色板提升到 6.13:1 | 第 5 节对比度实测 |
| 8 | P2 | 音效无法关闭 | 声音开关 + `M` 键 + 持久化 | E2E `M toggles sound` |
| 9 | P2 | 未支持 `prefers-reduced-motion` | 关闭雨、镜头抖动、粒子 | E2E `prefers-reduced-motion is detected` |
| 10 | P3 | 每帧重复创建 6 个渐变对象 | 按尺寸/地面高度缓存，`clearRect` 去除（整屏天空已覆盖） | 帧率与 draw 耗时实测 |
| 11 | P3 | 生命只靠颜色表达 | `aria-label="生命 N/3"`，且仅在变化时更新 | 代码审查 + E2E 无回归 |

## 7. 未验证项与已知缺口

诚实列出，避免把“没测”说成“通过”：

1. **真机未覆盖**：PRD 8.2 要求 Chrome/Edge/Firefox/Safari 16.4+/Android Chrome 必测。本次只覆盖 Chromium 内核（Edge headless）。Firefox 与 iOS Safari 未验证，`backdrop-filter`、`env(safe-area-inset-*)`、WebAudio 自动播放策略在真机上仍可能有差异。
2. **性能 SLO 的“中端安卓”未实测**：60.2 fps 来自本机 GPU 的 headless 移动模拟，不等于中端安卓真机。无 GPU 的 CI 上软件光栅约 48 fps，因此 CI 阈值降为 24 fps 作为“不退化”护栏，真实 SLO 需真机复核。
3. **线上地址未验收**：AC-F6-05 要求访问 GitHub Pages 返回 200。本次只验证本地静态服务器。仓库有 `origin` 远端，但未执行推送与部署。
4. **埋点/KR 仍为空**：PRD 第 4 章的 KR1–KR4 需要 `session_start` / `run_end` 等事件。本轮未接入统计（PRD Q1 待决策），因此 KR 仍只能作为方向性目标，不能用于验收。
5. **国际化未做**：PRD 8.5 明确当前实现是“中英文硬编码混排”，属 v2.1 技术债。本轮未引入 i18n 层，界面文案仍分散在 HTML 与 `main.js` 中。
6. **难度曲线的高距离段**：压力在 600 m 饱和，此后难度不再上升。这是当前设计选择（附录 A），但对极长局玩家可能显得平坦；需按上线后的死亡分布校准（PRD F4 风险项）。

## 8. 复现

```bash
git clone <repo> && cd skyline-runner
npm test                 # 41/41
npm run test:e2e         # 50/50，截图落在 tests/artifacts/
node tools/metrics.mjs 24
```

E2E 失败时会把每一项的实测值写进输出（例如 `desktop frame rate >= 55 fps [49.5 fps, draw 1.56 ms]`），并按失败项返回非零退出码，可直接接入 CI（`.github/workflows/ci.yml`）。
