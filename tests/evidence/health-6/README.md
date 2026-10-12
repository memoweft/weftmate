# 健康页第二轮验收

恢复、睡眠、负荷与所有分钟、范围显示整数；手机分数卡按两列排列，奇数张的最后一张占满整行。健康侧栏与其他固定入口统一尺寸和间距，五项身体指标有各自的图标；电脑使用有最后时刻就显示“用到…”，没有就只保留时长；详情顶部收为返回、日期、刷新一行。

压力、电能和体能年龄只在相应 overview（今日概况）字段不为空时出现。压力显示最新测量时间、位置色带和各次测量点；电能显示曲线与睡眠区间，小时心率降级隐藏细节；体能年龄显示与实际年龄的差值、最大摄氧量趋势和参考范围，缺个人资料只给一句补充提示。卡片和详情里的估计说明可打开公开方法名称。

各项 AI（人工智能）分析默认关闭，先展开说明，再明确打开并只生成这一项；开着也默认收起，展开才生成，已有当天结果从缓存恢复。“接着问它”只写主对话草稿，依据可展开，关闭后当天缓存仍可阅读；顶部今日解读与各项分析的开关互不影响。

## 数据和验证边界

当前对齐数据复用 HEALTH-2 的 `tests/helpers/health-sequence.mjs` 90 天合成生成器和生产 v2（第二版）投影；v3（第三版）三卡与分析由 `tests/helpers/health-6-synthetic.mjs` 按 HEALTH-5 第16节的正式形状提供。初版从 `b4509f45` 开始，当时没有 HEALTH-2 的新读取实现；初版194张原图保留，正式字段对齐后重拍的原图放在 `aligned/`。没有用真实健康数据或请求真实模型。参考图只在私人目录查看，没有复制或转录其中数值。

真实 Electron（桌面程序框架）使用生产桌面壳、合成账号与随机端口的隔离服务；身份和会话流程经过真实服务，所有健康和健康设置响应经过 UI（用户界面）夹具。手机网页用相同界面代码和合成响应。云端 Android（安卓）用既有独立测试浏览器容器拍原始整屏，验证网页与系统栏，不代表产品原生业务路径或新算法已经联调。

`verification.json` 列出本地原图、尺寸、主题和行为检查；`system-bars.json` 记录云端原图的系统/页面主题、Android 版本、状态/底部栏高度、文字像素核验和色差。网页截图仅证明页面布局，系统栏由云端原始整屏证明。

## 截图索引

每个本地前缀均有 `light` / `dark` 两套。`electron-1200` / `electron-480` 是真实程序；`mobile-360` / `mobile-390` 是 360×780 / 390×844 的手机网页。窄屏完整六卡组由第一排、中排、下排三张连续滚动位置共同覆盖，保留真实视口和底部五项导航。

| 要求 | 文件后缀 |
|---|---|
| A1 分数、分钟、范围取整 | `today-six`、`A1-A5-usage-integers`、各 `detail-A6` |
| A2 两列 / 六卡、三卡、五卡与孤卡 | `today-six`、`six-cards-first-row`、`six-cards-middle`、`six-cards-lower`、`today-three`、`today-five`、`five-orphan` |
| A3 健康侧栏选中与未选中 | `electron-1200-A3-sidebar-selected`、`electron-1200-A3-sidebar-unselected` |
| A4 五项独立图标 | `A4-vital-icons` |
| A5 最后使用时刻与缺时刻 | `A1-A5-usage-integers`、`mobile-360-no-usage-time` |
| A6 单行返回 / 日期 / 刷新 | `stress-detail-A6`、`energy-detail-A6`、`fitnessAge-detail-A6` |
| 新卡详情与方法名称 | 上述详情及 `stress-method-open`、`energy-method-open`、`fitnessAge-method-open` |
| 分析关着收起 / 展开说明 / 生成中 / 展开结果 | `analysis-off-collapsed`、`analysis-off-explanation`、`analysis-generating`、`analysis-expanded` |
| 分析依据、十二项趋势默认收起 | `analysis-basis-open`、`mobile-360-trend-analysis-collapsed` |
| 两个独立设置开关 | `settings-two-toggles`、`settings-both-off` |
| 电能降级 / 资料缺失 / 旧电脑兼容 | `mobile-360-hourly`、`mobile-360-profile-missing`、`mobile-360-legacy-no-analysis` |
| 四种失败反馈 | `mobile-360-analysis-ai_analysis_off`、`…-failed`、`…-daily_limit`、`…-host_offline` |
| 安卓原始整屏 | `phone-system-360-light-today.png`、`phone-system-360-dark-today.png` |

## 并行规则 8

- [x] 8.1 复用统一开关、按钮、分段、图标与焦点样式；没有原生日期、下拉或展开三角。
- [x] 8.2 卡片、分析和依据均为按钮/整行控件；估计说明有信息图标和按钮边界；悬停、按下、聚焦、禁用态齐全。
- [x] 8.3 新设置放在设置 → 健康数据；分析只在详情和趋势，不向聊天输入区追加入口。
- [x] 8.4 窄屏两列，奇数孤卡通栏；360 与 480 横向无溢出；侧栏四个固定入口均为 16px 图标和同一间距；详情顶栏一行。
- [x] 8.5 数值、缺测、降级、资料不足、生成、旧回执和四种失败均有明确状态；两个设置开关独立。
- [x] 8.6 真实程序 1200 / 480 与网页 360×780 / 390×844 均验浅深；减少动态效果关闭页面动画。
- [x] 8.7 对照健康参考 README（说明文件）：顶部一句解读、两列单重点、大数字/状态、小图、通栏睡眠、每项身体图标、详情比较与趋势；没有加入饮食、付费墙、训练计划或专有算法。
- [x] 8.8 三项方法、分析说明、生成结果、分析依据与健康设置都有打开状态的浅深截图；使用现有组件。
- [x] 8.9 窄屏顶栏溢出已修；固定检查保留溢出断言，最终原图来自修复后界面。
- [x] 8.10 云端 Android 原始整屏带可见系统状态栏和底部导航区域，系统/页面主题一致；版本、高度、色差与文字区域见系统栏记录。

## 并行规则 8a

- [x] 列表/身体指标整格打开详情；建议保留一个提醒主操作，估计说明和分析是独立展开行，没有危险操作。
- [x] 固定页顶栏为健康，健康数据设置子页有自身标题；隐藏对话专属工具，引用回到主对话恢复。
- [x] 进入、前台恢复及事件沿原自动读取；保留一个小刷新图标。
- [x] 趋势指标胶囊、天数分段和手机五项导航有选中态。
- [x] 日期和时刻用中文与时分，分钟取整；没有 ISO（标准时间串）、秒或内部时区名。
- [x] 设置成功沿统一轻提示；没有永久保存提示行。
- [x] 原未接入、空、加载、错误设计保留；单项新增加载骨架和失败重试。
- [x] 沿 HEALTH-3 与已通过的目标页页面家族、控件和设计令牌。

## 正式字段与联调边界

页面与夹具已按 `origin/wp/health-5-stress-energy-age:docs/CLIENT_API.md` 第16节及调度补充对齐，正式字段替代初版的临时名称：

| 对象 | 当前正式字段 |
|---|---|
| `stress` | `score,average,latest:{value,time},samples:[{time,value,method}],baselineDays,state,label,missing,disclaimer`；`latest:null` 有缺测反馈 |
| `energy` | `score,current,highest,lowest,nightCharged,dayDrained,degraded,state,label,missing,disclaimer`；`curve` 固定96格当地 `HH:mm`，空值/未来时段不画；`sleepPeriods:[{start,end}]` 同为当地时分 |
| `fitnessAge` | `fitnessAge,actualAge,difference,vo2Max,vo2MaxDay,trend,bounded,state,missing,disclaimer`；`referenceRange` 可为空；按 `missing` 分别提示出生年份/性别/摄氧量 |
| `usage` / `load` | `usage.lastUsedAt`；`load.recommendedRange:{low,high,unit}` 有值时显示当天相对负荷与建议带，无值保留个人范围 |
| 当天分析缓存 | `{day,items:[analysis]}`，按选定日期恢复，不重复POST（生成请求） |
| 历史指标 | v3能力使用 `metrics/:id?days=…&to=YYYY-MM-DD`；旧能力保留原合法查询，避免向旧电脑发送不支持的参数 |

免责声明优先显示回执字段，缺少时才使用页面默认文案。最大摄氧量参考灰带注明公开参考范围。共享模型保留主线的健康设置写入队列，两个开关各只更新自己的字段。

`real-v2-verification.json` 记录 HEALTH-2 生成的90天数据经过真实批量、设置、概况、指标和睡眠分期接口，旧电脑不请求分析、不发送未支持的 `to`。v3三卡与分析仍为正式接口夹具；HEALTH-5实际算法和模型版生成需合入后联调。调度承诺由HEALTH-5补齐 `energy.sleepPeriods` 与 `fitnessAge.referenceRange` 的实际回执，页面已消费这两个字段。

## 原生端接线

安卓产品壳须允许精确 `GET /personal/v1/health/analysis?day=…`、`POST /personal/v1/health/analysis` 和健康设置 GET/PATCH；按既有规则补白名单/拒绝用例并由编排统一新壳版本。本包未改安卓原生代码或版本。

iPhone 原生应跟进同样的三项可用性、资料提示、估计依据、十二项分析位置与独立开关；`record >= 3` 才上传第三版采集字段。使用 `variability/pulse/lungs/oxygen/thermometer` 五个图标母版，16px 使用 1.5 线宽；引用只进主对话草稿。苹果端资源和代码由 Apple（苹果端）工作包生成与接线，本包只提交网页使用的新资产。

## 固定验证

最终计数见 `checks.json`；required（完整必过）、vendor（固定运行时集成）、手机交互五文件组、健康定向测试、类型、共享构建与公开卫生逐项记录。没有跳过或删除原保护断言。重活按名额运行；一次提前启动的 vendor 试跑已中止，清理自有工作进程后重新顺序执行，保留最终完整结果。

- 完整必过组：1776 通过、0 失败、14 项既有平台跳过；316 文件，隔离目录完成清理。
- 固定运行时集成组：232 通过、0 失败、0 跳过；窗口恢复后重新整组执行并取得明确回执。
- 手机交互五文件：114 通过、0 失败、0 跳过。
- 健康定向：17 通过；共享资源一致性：5 通过；类型检查、共享构建与公开卫生 0 命中。
- 最终本地原图 194 张、页面异常 0；云端原始整屏 2 张，Android 14、底部导航可见。状态栏色差浅/深均 0，底部色差浅 1、深 0。[云端原始取证](https://github.com/memoweft/weftmate/actions/runs/38256450521)。
- 聚焦取证修复：Android 窗口记录同时包含启动器与测试浏览器；读取完整聚焦列表后，仍逐张验证原生截图确实包含网页的标题与数字像素，没有降低画面核验。

## 正式字段对齐复验

健康/设置定向22项通过，手机五文件114项通过，均0失败；HEALTH-2基础13项（含真实HTTP路径）通过。新原图与缓存恢复截图详见 `aligned/verification.json`，包括三卡、详情、小时降级、生日/性别各自缺失、空参考范围、未来空白桶、负荷有/无建议区间、免责声明回执/回退及分析GET缓存恢复。初版的1776/232/114完整验证计数保持为交接前快照，不冒充对齐后的全量重跑。

正式字段对齐最终原图222张、界面异常0；缓存恢复收起/展开各有截图，后端写入数没有增加。[本轮索引](aligned/README.md)，真实v2路径记录在 real-v2-verification.json。
