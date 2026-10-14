package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opt-in QA on the already logged-in test account; never logs out or changes credentials. */
class Fix41LiveChatTest {
    private val i = InstrumentationRegistry.getInstrumentation()
    private lateinit var a: NativeActivity
    private val report = JSONObject()
    private fun main(work: () -> Unit) = i.runOnMainSync(work)
    private fun waitFor(label: String, timeout: Long = 60000, test: () -> Boolean) {
        val until = System.currentTimeMillis() + timeout
        while (System.currentTimeMillis() < until) { var ok = false; main { ok = test() }; if (ok) return; Thread.sleep(100) }
        error("Timed out: $label")
    }
    private fun js(source: String): String {
        val done = CountDownLatch(1); var value = ""
        main { a.embeddedWeb.evaluateJavascript(source) { value = it; done.countDown() } }
        check(done.await(10, TimeUnit.SECONDS)); return value
    }
    private fun shot(name: String) {
        Thread.sleep(400)
        val image = i.uiAutomation.takeScreenshot(); check(image != null)
        File(a.filesDir, "fix41-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
    private fun click(label: String) {
        fun find(node: android.view.accessibility.AccessibilityNodeInfo?): android.view.accessibility.AccessibilityNodeInfo? {
            if (node == null) return null
            if (node.contentDescription?.toString() == label || node.text?.toString() == label) return node
            for (index in 0 until node.childCount) find(node.getChild(index))?.let { return it }
            return null
        }
        // Accessibility queries must leave the main thread free to publish a new popup.
        fun visible() = i.uiAutomation.windows.asSequence().mapNotNull { it.root }
            .filter { it.packageName?.toString() == i.targetContext.packageName }.mapNotNull { find(it) }.firstOrNull()
        val until = System.currentTimeMillis() + 20000
        var node = visible()
        while(node == null && System.currentTimeMillis() < until) { Thread.sleep(100); node = visible() }
        check(node != null) { "Visible action unavailable: $label" }
        var target: android.view.accessibility.AccessibilityNodeInfo? = node
        while (target != null && !target.isClickable) target = target.parent
        check(target?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK) == true)
    }
    @Test fun fullHistoryCorrectWebConversationAndLiveTitle() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("fix41LiveAccount") == "authorized")
        check(i.targetContext.packageName == "com.memoweft.weftmate.mobile.debug")
        i.uiAutomation.serviceInfo = i.uiAutomation.serviceInfo.apply { flags = flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS }
        val handler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            File(i.targetContext.filesDir, "fix41-test-failure.txt").writeText(generateSequence(error) { it.cause }.joinToString("\n") { it.javaClass.name + "\n" + it.stackTrace.joinToString("\n") })
            handler?.uncaughtException(thread, error)
        }
        a = i.startActivitySync(Intent(i.targetContext, NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        waitFor("existing test login") { a.model.loggedIn && !a.model.loading && a.model.chats.isNotEmpty() }
        var appearance = "system"; var appearanceRead = false
        main { a.model.launch { appearance = a.model.call("settings.appearance").optString("value", "system"); appearanceRead = true } }
        waitFor("original appearance read") { appearanceRead }
        try {
            val previous = a.model.chatId
            val historyOnly = InstrumentationRegistry.getArguments().getString("fix41HistoryOnly") == "true"
            if (historyOnly) {
                var selected = false
                main { a.model.launch { a.model.select(a.model.chats.first { it.optString("title").contains("河流") && !it.optBoolean("nativePhone") }); selected = true } }
                waitFor("previous QA conversation") { selected }
                report.put("existingHistoryAfterShellReopen", true)
            } else {
                main { a.model.newChat() }
                waitFor("new host chat") { a.model.chatId.isNotBlank() && a.model.chatId != previous && a.model.sendAvailable && !a.model.phone }
            }
            val target = a.model.chatId
            if (!historyOnly) {
                main { a.model.edit("FIX-41 河流长文阅读验证。请直接输出90条编号中文句子，每条至少80个汉字，描写河流沿岸的风景与生活，必须完整写完90条，不使用工具，不要省略或用代码生成。最后另起一行写：FIX41全文终点。") }
                main { a.model.send() }
                waitFor("message accepted") { a.model.draft.isEmpty() && a.model.rows.any { it.optString("type") == "user.message" } }
                waitFor("title generated without reopening") { a.model.title != "新对话" && a.model.title.isNotBlank() }
                report.put("titleUpdatedWithoutReopen", true)
            }
            waitFor("long response completed", 600000) { !a.model.running && a.model.rows.any { it.optString("type") == "assistant.message" } }
            var full = ""; var source: JSONObject? = null
            main { val row = a.model.rows.last { it.optString("type") == "assistant.message" }; full = row.getJSONObject("data").getString("text"); source = row.optJSONObject("sourceRef") }
            assertTrue("real response exceeds 6000 characters: ${full.length}", full.length > 6000)
            assertTrue("model emitted final marker", full.contains("FIX41全文终点"))
            waitFor("title generated without reopening") { a.model.title != "新对话" && a.model.title.isNotBlank() }
            var listed = false
            main { a.model.launch { a.model.refreshChats(); listed = true } }
            waitFor("header matches sidebar") { listed && a.model.chats.first { it.optString("chatId") == target }.optString("title") == a.model.title }
            report.put("responseCharacters", full.length).put("sidebarMatchesHeader", true)
            // Leave both the page and the conversation, then reload durable history.
            main { a.model.tab = "health" }
            Thread.sleep(400)
            var selected = false
            main { a.model.launch { a.model.select(a.model.chats.first { it.optString("chatId") != target && !it.optBoolean("nativePhone") }); selected = true } }
            waitFor("other conversation") { selected }
            selected = false
            main { a.model.launch { a.model.select(a.model.chats.first { it.optString("chatId") == target }); a.model.tab = "chat"; selected = true } }
            waitFor("long history reloaded") { selected && a.model.rows.any { it.optString("type") == "assistant.message" && it.optJSONObject("data")?.optString("text") == full } }
            report.put("historyEqualsCompletedReply", true)
            var detailMatches = false
            main { a.model.launch { val ref = source!!; val detail = nativeMessageDetail(ref.getString("sessionId"), ref.getLong("seq"), a.model::call); detailMatches = detail.getString("text") == full } }
            waitFor("original detail matches full native text") { detailMatches }
            report.put("originalDetailMatches", true)
            val webExcerpt = full.lineSequence().first { it.isNotBlank() }.trim().replace(Regex("^\\d+[.)]\\s*"), "").take(30)
            for (theme in listOf("light", "dark")) {
                var themed = false
                main { a.model.launch { a.settings.bridge.call("appearance", JSONObject().put("theme", theme)); a.model.dark = theme == "dark"; themed = true } }
                waitFor("$theme appearance saved and applied") { themed && a.model.dark == (theme == "dark") }
                Thread.sleep(500); shot("$theme-native-full-tail-title")
                // Poison the web selection with another real conversation first.
                val other = a.model.chats.first { it.optString("chatId") != target && it.optString("activeSessionId").startsWith("session-") }
                js("void uiCore.selectLogicalSession(${JSONObject.quote(other.getString("activeSessionId"))});")
                Thread.sleep(1500)
                click("更多")
                click("完整对话功能")
                val until = System.currentTimeMillis() + 60000; var matched = false
                while (System.currentTimeMillis() < until) {
                    if (js("Boolean(uiCore.state.selectedChatId===${JSONObject.quote(target)} && (document.getElementById('chat-content')?.textContent||'').includes(${JSONObject.quote(webExcerpt)}) && (document.getElementById('chat-content')?.textContent||'').includes('FIX41全文终点'))") == "true") { matched = true; break }
                    Thread.sleep(200)
                }
                if (!matched) {
                    report.put("webDiagnostic", js("JSON.stringify({selectedMatches:uiCore.state.selectedChatId===${JSONObject.quote(target)},sessionMatches:uiCore.state.selectedSessionId===${JSONObject.quote(a.model.sessionId)},page:state.page,source:state.chatSource,text:(document.getElementById('chat-content')?.textContent||'').slice(0,200),expected:${JSONObject.quote(full.take(30).trim())}})"))
                    shot("$theme-web-failure")
                }
                assertTrue("full web conversation matches native selection", matched)
                report.put("$theme-webMatchesCurrentConversation", true); shot("$theme-web-same-conversation")
                main { a.model.tab = "chat" }; Thread.sleep(400)
            }
            if (historyOnly) {
                main { a.model.newChat() }
                waitFor("fresh title probe") { a.model.chatId.isNotBlank() && a.model.chatId != target && a.model.sendAvailable }
                main { assertEquals("新对话", a.model.title); a.model.edit("FIX-41 标题刷新验证，请只回答：收到。"); a.model.send() }
                waitFor("fresh title updates without reopening", 120000) { a.model.rows.any { it.optString("type") == "assistant.message" } && a.model.title != "新对话" }
                var listedTitle = false
                main { a.model.launch { a.model.refreshChats(); listedTitle = true } }
                waitFor("fresh header and sidebar agree") { listedTitle && a.model.chats.first { it.optString("chatId") == a.model.chatId }.optString("title") == a.model.title }
                report.put("titleUpdatedWithoutReopen", true); shot("fresh-title-after-reply")
            }
        } finally {
            var restored = false
            main { a.model.tab = "chat"; a.model.launch { a.settings.bridge.call("appearance", JSONObject().put("theme", appearance)); val value = a.model.call("settings.appearance"); a.model.dark = resolvedAppearanceDark(value.optString("value"), value.optBoolean("systemDark")); restored = value.optString("value") == appearance } }
            waitFor("original appearance restored") { restored }
            report.put("appearanceRestored", appearance)
            File(a.filesDir, "fix41-live-chat.json").writeText(report.toString(2))
            Thread.setDefaultUncaughtExceptionHandler(handler)
        }
    }
}
