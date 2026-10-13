# APPLE-6 实现与边界

iPhone 原生在 A14 已接 CLIENT_API 3.19 的 RSA-OAEP-256 / AES-GCM 副本、云 DPoP 授权与清理代次核对、相关记忆调用云模型以及幂等对话同步。旧入口要求先连接电脑拿到副本和模型；新账号无电脑时进入 CloudAccountHome，只看到电脑不可用和重试，不能进入五项导航。

本包新增独立手机聊天，不从云端读取或写入对话正文。模型配置完整保存在 ThisDeviceOnly Keychain；对话 AES-GCM 加密保存于 App 私有 PhoneChats 目录，文件名由云地址与 subject 哈希生成，钥匙另在 Keychain，排除备份。尚未登录的内容单独属于 device-local，登录不会混进新账号。提供方预设与取密钥说明由电脑端 onboarding-copy.js 生成；手机预设包含七家云服务，不提供在手机上运行 Ollama 的入口。

模型直连使用临时 URLSession、拒绝重定向，不携带 WeftMate 云令牌或电脑 Cookie。真实逐片 SSE 流式、停止、重新生成、复制；只有模型提供方收到这次对话的系统限制与最近 20 条消息，没有电脑工具或正式记忆。

首次连上电脑并完成 M3-A 副本/设备公钥登记后，手机对话冻结为稳定的用户消息编号、会话编号、毫秒时间和真人/助手消息，写入现有加密 outbox，再由既有 /offline/turns 提交。丢回执保留同一正文重试；仅服务器回执标记已同步。电脑必须支持该接口且有可同步的云模型配置，才能完成既有 /offline/sync；准备不足时独立对话仍在手机上，设置可重新打开。M3-A 清理代次变化时，清除已经交给该电脑的历史与旧队列，防止旧正文被重新提交。与电脑同步过的回复在手机上重新生成，不改写旧回执正文。

健康页无电脑时直接读取 HealthKit 日汇总、显示本机睡眠/活动/心率/HRV，缺失不补零。正式电脑健康分数、解读、动态、目标、成果与记忆均说明连上电脑后可用。没有把本机健康数据交给云模型。

原图的 16:05 — 23:51 来自 UTC 合成睡眠数据在 America/Los_Angeles 设备上的正确转换；显式设备本地时区与 Asia/Shanghai / America/Los_Angeles 回归已覆盖。本人 iPhone 的真实健康时间仍需真机看。今日解读分钟文案原样来自 src/personal-health/insight.mjs:17；分数依据还来自 src/personal-health/analysis.mjs:62；给电脑端改成人话时长，iPhone 不做字符串替换。

操作模式默认 SF Symbol slider.horizontal.3，候选 hand.raised / checklist，放大图见 mode-icon-candidates.png。待 MOB-5 最终结果交给 Claude 对齐。

验证全部使用本机合成账号/邮件/云端、独立文件目录、受控模型 SSE；未访问本人账户、生产云、本人电脑或真实模型密钥。Swift/原生界面/CI/真设备/正式记忆形成分别报告。
