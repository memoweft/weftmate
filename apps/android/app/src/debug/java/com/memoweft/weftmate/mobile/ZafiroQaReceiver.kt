package com.memoweft.weftmate.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.time.Instant

/** Synthetic-package-only stream player: plays one scripted turn through the real chat page and shared mapper. */
class ZafiroQaReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (context.packageName != "com.memoweft.weftmate.mobile.zafiroqa") return
        val visible = WeftMateApplication::class.java.getDeclaredField("visible").apply { isAccessible = true }.get(context.applicationContext) as Set<*>
        val model = visible.filterIsInstance<NativeActivity>().firstOrNull()?.model ?: return
        (NativeChatModel::class.java.getDeclaredField("poll").apply { isAccessible = true }.get(model) as Job?)?.cancel()
        when (intent.getStringExtra("command")) {
            "stream" -> { player?.cancel(); player = model.scope.launch { play(model, intent.getLongExtra("pace", 140)) } }
            "error" -> { player?.cancel(); model.running = false; model.canRetryPhoneReply = true; model.error = "模型服务暂时连不上，回复没有完成。" }
            "empty" -> { player?.cancel(); model.running = false; model.canRetryPhoneReply = false; model.error = ""; model.rows = emptyList() }
            "theme" -> model.dark = intent.getBooleanExtra("dark", false)
        }
        val state = JSONObject().put("rows", model.rows.size).put("running", model.running).put("dark", model.dark).put("error", model.error).put("loggedIn", model.loggedIn)
        File(context.filesDir, "zafiro-qa.json").writeText(state.toString())
        resultData = state.toString()
    }

    private suspend fun play(model: NativeChatModel, pace: Long) {
        val events = mutableListOf<JSONObject>()
        fun event(id: String, type: String, data: JSONObject) = JSONObject().put("eventId", id).put("type", type).put("at", Instant.now().toString()).put("data", data)
        fun publish() { model.rows = events.map { JSONObject(it.toString()) } }
        model.error = ""
        events += event("u1", "user.message", JSONObject().put("text", "帮我查一下明天上海的天气，看看日历里有没有冲突，再给个出行建议。"))
        model.running = true
        publish()
        val tools = listOf(
            Triple("c1", "web_search", JSONObject().put("query", "上海 明天 天气")),
            Triple("c2", "calendar_list", JSONObject().put("date", "明天")),
            Triple("c3", "read_file", JSONObject().put("path", "notes/出行清单.md")),
        )
        for ((id, name, args) in tools) {
            delay(pace * 5)
            events += event("$id-start", "tool.started", JSONObject().put("callId", id).put("toolName", name).put("arguments", args).put("turn", 1))
            publish()
            delay(pace * 8)
            events += event("$id-done", "tool.completed", JSONObject().put("callId", id).put("toolName", name).put("arguments", args).put("turn", 1))
            publish()
        }
        val answer = """
            ## 明天的安排

            上海明天**多云转小雨**，午后降水概率较高，出门带伞。

            日历里有两件事：

            1. 上午 10:00 和设计组过稿
            2. 下午 15:30 牙医复诊

            | 时间 | 事项 | 建议 |
            |---|---|---|
            | 09:20 | 出门 | 地铁 2 号线，避开早高峰 |
            | 14:50 | 去诊所 | 雨大就打车，留 20 分钟 |

            > 两件事之间有三个多小时，可以回家吃午饭。

            ## 出门带上

            - 折叠伞
            - 充电宝
            - 医保卡和预约单
            - 一件薄外套，傍晚会降温
            - 设计稿打印件

            ## 路线备选

            如果 2 号线拥堵，可以改乘 10 号线到陕西南路再换乘；打车大约 35 分钟，雨天可能更久。

            晚上回家前再看一眼天气预报，必要时把明早出门时间提前十分钟。

            需要的话，把提醒设成这样：

            ```json
            {"remind": "14:30", "text": "带伞去复诊"}
            ```
        """.trimIndent()
        var shown = 0
        while (shown < answer.length) {
            delay(pace)
            shown = (shown + 6 + (shown % 5)).coerceAtMost(answer.length)
            events.removeAll { it.optString("eventId") == "a1" }
            events += event("a1", "assistant.delta", JSONObject().put("text", answer.take(shown)))
            publish()
        }
        events.removeAll { it.optString("eventId") == "a1" }
        events += event("a1", "assistant.message", JSONObject().put("text", answer))
        events += event("t1-end", "turn.ended", JSONObject().put("turn", 1).put("reason", "completed"))
        model.running = false
        publish()
    }

    private companion object { var player: Job? = null }
}
