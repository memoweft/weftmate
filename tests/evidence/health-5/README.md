# HEALTH-5 · 压力、电能、体能年龄与按需分析

压力按本人28天清醒测量的百分位定位，优先Baevsky（巴耶夫斯基）指数，缺指数用SDNN（正常心搏间期标准差）与当时心率；电能按15分钟充放电；体能年龄反推公开同性别参考中位数。公式与依据见[HEALTH.md](../../../docs/HEALTH.md)，参考小表为[fitness-reference.json](../../../src/personal-health/fitness-reference.json)。都是按公开原理做的估计，不是医学结论，不等同于任何厂商的同名指标。

顶部modelInsightsEnabled仍默认true；各项itemAnalysisEnabled默认false，明确生成请求才发模型，同日同项缓存。关闭各项返回409 AI_ANALYSIS_OFF，GET可读已生成缓存；关闭时单项请求数为0，顶部不受它影响，反之亦然。

相对编排约定没有改字段名；增量补充有：v3单条64 KiB（千字节）、返回形状、metrics结束日期to、独立weekly、提醒sessionId可省、两项追加字段sleepPeriods／referenceRange、无逐搏心率时使用测量所在心率桶（missing=measurementHeartRate）。每天40次生成包括统计退回，缓存不计；清空删除资料／正文，但保留当天无健康内容的额度计数，不能重新获得40次。完整接口见[CLIENT_API第16.4节](../../../docs/CLIENT_API.md#164-v3个人资料与按需各项分析health-5)。

## 验证

- 最终required（完整必过）：1810通过／0失败／14既有条件跳过，320文件；首轮1809／0，增加普通无逐搏采集降级后再跑最终轮。没有删用例、加跳过或放宽断言。
- vendor（固定运行时集成）：230通过／0失败／0跳过，33文件；直接复用共享固定缓存，vendor文件未改。
- 手机五文件：114通过／0失败；Android JVM（安卓Java虚拟机）73通过／0失败／0跳过。
- 类型检查、共享资源生成／一致性与public hygiene（公开卫生检查）通过，身份命中0。最终记录见[checks.json](checks.json)。
- 固定测试覆盖三版原请求／校验、数值关键点、缺输入／不足7个不同日期／小时心率降级、两个开关／周回顾互不影响、关闭零模型请求、缓存／40次上限／取消／超时／统计退回／禁用词、账号隔离、清空资料与缓存，以及七天背景长度与私密来源排除。
- 真实Electron（桌面程序框架）与原生DSH（助手运行时）：90天v3与资料灌入，三块有值、96点曲线和两个增量字段存在，关闭409，打开生成模型版并命中缓存，两次主对话调用health_query后回答。见[verification.json](verification.json)。
- MiMo（云端模型）mimo-v2.6-flash：最终验收6次，其中单项分析1次、顶部0次、缓存额外0次；计入早先校验／截图断言试跑和一次汇总诊断，总计14次。密钥仅在进程内从机器环境变量读，不进证据。详见[mimo-requests.json](mimo-requests.json)。
- 本机MuMu（安卓模拟器）原生读通所有新增路由和四项趋势、profile PUT、analysis关闭409；硬件标记隐藏导航栏，临时尝试不改变策略，已还原，未把该截图当作系统栏验收。见[mumu-verification.json](mumu-verification.json)。
- [独立云端原生验收](https://github.com/memoweft/weftmate/actions/runs/38267484622)：真实HybridActivity、真实业务白名单／认证／HTTP（网页传输协议），新增读取／设置／生成通过，仪器化测试通过。原系统栏断言保持；[native-verification.json](native-verification.json)记录原图与状态栏色差。

## 截图

桌面1200×900，浅／深各三张：`electron-1200-*-stress.png`、`electron-1200-*-fitness-age.png`、`electron-1200-*-settings.png`。截图中的健康数字与两个回复全部来自合成资料，工具完成状态由原生事件核对。

安卓原始720×1560，设备像素比2；Android 14，系统初始浅色，应用分别强制浅／深并报告渲染主题，栏图标跟随应用。底部手势区域可见；`android-*-settings.png`、`android-*-retention-open.png`、`android-*-clear-open.png`各有浅／深。状态栏／页顶颜色差浅0.923、深1.314；逐图几何、颜色及通过结果在native-verification.json。新开关使用原设置控件，没有新弹层；已有保留期和清空弹层也保留打开证据。

## 给页面与Apple（苹果端）

- 以CLIENT_API第16.4节既定字段为准；capabilities.record>=3再送v3，profile=true才PUT资料，旧电脑继续v2。最多100天且总请求≤1280 KiB，较大分期记录须分批。
- 无逐搏间期时rmssdMs／stressIndex／meanHeartRateBpm仍按约定null；电脑会取同15分钟／同小时心率，不需要为此上传逐搏原文。
- energy.sleepPeriods为当地HH:mm（时:分），可跨零点；fitnessAge.referenceRange为本人性别和实际十岁年龄组的VO₂max（最大摄氧量）25–75百分位。没有资料为null，不填零。
- itemAnalysisEnabled缺字段按旧电脑不支持处理；POST只在本人展开时调用，GET回执仍是{day,items}，off409与limit429按契约处理。modelInsightsEnabled默认true、itemAnalysisEnabled默认false。
- 趋势to指定结束日期；独立weekly读取健康段；提醒没有会话时可不传sessionId，由电脑准备主对话空会话，不发模型消息。接着问仍只填草稿。
- 合成入口generateHealthV3Sequence与generateHealthV3Fixture（返回items／profile／records／overview），页面夹具可直接使用生产算法投影；不存在真人来源。

## 安卓发布与遗留

需要新壳版本：增加profile、analysis、weekly和三项metrics精确路径、to查询及profile PUT方法。允许／拒绝用例与真实原生桥均已验证，本包不递增版本号，交编排统一发布。

健康视图／样式由HEALTH-6，Apple采集与页面由HEALTH-4；本包仅新增设置登记一处及生成副本，未改它们的界面文件。未做Health Connect（健康连接平台）、健康提醒／精灵、长时浸泡或真人校准。主对话首段仍可见既有“排队中”投影文字，但原生工具已完成且两段答案已显示；对话状态投影交公共对话包核对，本包未改公共对话界面。

## 清理与边界

只用合成账号、合成宿主、随机端口与受管临时目录；不请求18186、不接管桌面、不碰本人安装或日用数据。临时目录删除前解除内部联接，只删链接；有独立合成联接目标保留验证。三个受控Electron窗口与两次MuMu测试应用已退出，独立云端模拟器由工作流关闭；复用的MuMu与共享后台未结束。所有本包重活锁均在finally释放。

已清理进程：5；末次额外残留清理0。本人程序／共享后台未动。本包 `.local` 现占用 1.77 MB（health5前缀新增物）；整个工作树 `.local` 含既有文件 114.15 MB；没有生成或留下1 GB大件。
