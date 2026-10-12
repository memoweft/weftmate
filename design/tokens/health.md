健康颜色以 `tokens.json` 为唯一来源。`shared.color.health-<name>-light/-dark` 是图形与文字色，`health-<name>-soft-light/-soft-dark` 是该指标的浅底与深底。网页先映射为 `--health-<name>` / `--health-<name>-soft`，只在健康页面使用，独立于使用者所选的应用强调色。

每个文字色在对应健康卡片和自身底色上均通过 4.5:1 对比度固定测试。图形与状态文字同时出现；空测量使用灰色轨道与「暂无测量」，不填成零。色带只显示已有分数的位置，状态结论继续使用服务回执；这里不定义健康算法。

| 语义名 | 浅色文字 / 图形 | 深色文字 / 图形 | Apple（苹果端）引用 |
|---|---|---|---|
| recovery | `#006E60` | `#53DEC0` | `AppleTokens.Colors.healthRecovery` |
| sleep | `#6846BA` | `#B7A0FA` | `healthSleep` |
| load | `#235FC1` | `#7AAEFF` | `healthLoad` |
| stress-calm | `#006E60` | `#53DEC0` | `healthStressCalm` |
| stress-moderate | `#936000` | `#E7BA60` | `healthStressModerate` |
| stress-high | `#B24A12` | `#FFAC75` | `healthStressHigh` |
| stress-extreme | `#BA364C` | `#FF8195` | `healthStressExtreme` |
| energy-low | `#B24A12` | `#FFAC75` | `healthEnergyLow` |
| energy-mid | `#936000` | `#E7BA60` | `healthEnergyMid` |
| energy-high | `#557316` | `#C1DA77` | `healthEnergyHigh` |
| fitness-age | `#8B650C` | `#E5C676` | `healthFitnessAge` |
| hrv | `#AF376D` | `#EF93BF` | `healthHrv` |
| resting-heart-rate | `#B7334D` | `#FF8F9E` | `healthRestingHeartRate` |
| respiratory | `#235FC1` | `#7AAEFF` | `healthRespiratory` |
| oxygen | `#A93694` | `#EAA0DD` | `healthOxygen` |
| temperature | `#B24A12` | `#FFAC75` | `healthTemperature` |

表内每个 Apple 引用都有对应的 `Soft` 后缀底色，例如 `AppleTokens.Colors.healthRecoverySoft`。睡眠分期另有 `healthSleepDeep / healthSleepCore / healthSleepRem / healthSleepAwake` 及其 `Soft` 底色。共用的健康卡片、轨道、主文字、次文字为 `healthCard / healthTrack / healthInk / healthMuted`。这些都是浅深自动适配的 SwiftUI（苹果界面框架）颜色，可直接用于 iPhone 原生健康页面；本包只生成颜色，不修改原生视图。

运行 `node scripts/generate-tokens.mjs` 同时生成网页 CSS（层叠样式表）、`generated/apple/DesignTokens.json` 和 `DesignTokens.swift`；`node scripts/generate-tokens.mjs --check` 校验一致性。新增健康颜色没有改变 Android（安卓）的原生颜色或动效生成物。固定测试见 `tests/health-visuals.test.ts` 和 `tests/design-tokens.test.ts`。
