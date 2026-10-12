# HEALTH-5 正式字段对齐截图

222张真实Electron（桌面程序框架）与手机网页原图，1200/480、360×780/390×844，浅/深均覆盖；文件全集与行为检查见 verification.json，计数见 checks.json。基础记录来自HEALTH-2合成生成器，v2（第二版）投影使用生产实现，v3（第三版）对象与分析按正式契约提供夹具，真实模型请求0。

- `*-today-six`、`*-six-cards-first-row/middle/lower`：三卡按正式字段显示。
- `*-stress/energy/fitnessAge-detail-A6`、`*-method-open`：latest测量时刻、degraded降级、nightCharged/dayDrained、当地HH:mm曲线/睡眠时段、空未来桶、fitnessAge/difference及回执免责声明。
- `*-analysis-cache-restored-collapsed/expanded`：刷新页面后从 `{day,items}` 恢复，展开不重复POST（生成请求）。
- `mobile-360-birth-missing/sex-missing/profile-missing/vo2-missing`：缺什么就提示什么，体能年龄数字不出现。
- `mobile-360-no-recommendation/disclaimer-missing/stress-missing/hourly`：建议区间、免责声明、最近测量为空与小时心率的降级。
- `*-today-five/three`、`*-five-orphan`：新卡为空整张不出现，手机两列和孤卡通栏保持。

分析恢复、四种失败、独立开关、数组身体指标详情、键盘和减少动态效果一起复验。电能细曲线保留74个有效桶，未来空桶不画，只标当前点；不是通过删除有效数据来简化曲线。安卓系统栏复用初次已通过的原始证据，本次按调度要求不追云端检查。
