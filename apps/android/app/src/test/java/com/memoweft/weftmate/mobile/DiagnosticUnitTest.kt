package com.memoweft.weftmate.mobile

import org.junit.Test
import org.junit.Assert.*
import org.json.JSONObject
import org.json.JSONArray
import java.nio.file.Files

class DiagnosticUnitTest {
    @Test fun privateTextIsOmittedInEveryField() {
        val sensitive = listOf("conversation text", "prompt content", "model output", "file contents", "private.txt", "synthetic-account",
            "person@example.invalid", "synthetic-device", "server.example.invalid", "192.0.2.1", "https://example.invalid/?token=secret",
            "Bearer abc", "Cookie=session", "sk-secret-key", "a".repeat(64))
        for (value in sensitive) {
            val safe = DiagnosticPolicy.fields(JSONObject().put("message", value).put("reason", value).put("code", value)
                .put("name", value).put("script", value).put("source", value).put("stackFrames", JSONArray(listOf(value))))
            assertFalse(value, safe.toString().contains(value))
            assertEquals("UNAVAILABLE", safe.getString("code")); assertEquals("Error", safe.getString("name"))
        }
        val safe = DiagnosticPolicy.fields(JSONObject().put("name", "TypeError").put("code", "NETWORK_UNAVAILABLE").put("script", "app.js")
            .put("source", "web-error").put("line", 42).put("column", 5).put("reason", "crash"))
        assertEquals("TypeError", safe.getString("name")); assertEquals(42, safe.getInt("line")); assertEquals("app.js", safe.getString("script"))
    }
    @Test fun throwableOnlyContainsOurFramesWithoutMessage() {
        val error = IllegalStateException("private prompt person@example.invalid")
        error.stackTrace = arrayOf(StackTraceElement("com.memoweft.weftmate.mobile.HybridActivity", "handle", "PrivateFilename.kt", 21),
            StackTraceElement("outside.Secret", "privateAccount", "secret.txt", 20))
        val safe = DiagnosticPolicy.failure(error)
        assertEquals("java.lang.IllegalStateException", safe.getString("name"))
        assertEquals("com.memoweft.weftmate.mobile.HybridActivity.handle:21", safe.getJSONArray("stackFrames").getString(0))
        assertFalse(safe.toString().contains("PrivateFilename")); assertFalse(safe.toString().contains("outside")); assertFalse(safe.has("message"))
    }
    @Test fun exitMappingsAndBackgroundCollection() {
        mapOf(4 to "crash", 5 to "native_crash", 6 to "anr", 3 to "low_memory", 10 to "user_requested", 11 to "user_stopped",
            8 to "permission_change", 16 to "system_update", 0 to "unknown", 2 to "system_other").forEach { (code, reason) ->
            assertEquals(reason, DiagnosticPolicy.exit(code, 100, true).first)
        }
        assertEquals("terminated_in_background" to true, DiagnosticPolicy.exit(3, 400, false))
        assertEquals("terminated_in_background" to true, DiagnosticPolicy.exit(2, 400, true))
        assertEquals("crash" to false, DiagnosticPolicy.exit(4, 400, false))
        assertEquals("user_requested" to false, DiagnosticPolicy.exit(10, 100, true))
        assertEquals("permission_change" to true, DiagnosticPolicy.exit(8, 100, true))
    }
    private fun isolated(run: (java.io.File) -> Unit) {
        val root = Files.createTempDirectory("diag-unit-").toFile()
        try { run(root) } finally { root.deleteRecursively() }
    }
    @Test fun markerSurvivesProcessKillAndBackgroundResume() = isolated { root ->
        var time = 1791720000000L
        val first = DiagnosticJournal(root, "test", "test", { time }); first.begin(1); first.setForeground(true)
        time += 1000
        val second = DiagnosticJournal(root, "test", "test", { time }); second.begin(2) { ProcessExit(time - 100, 10, 100) }
        val previous = second.status().getJSONObject("previous")
        assertFalse(previous.getBoolean("normal")); assertEquals("user_requested", previous.getString("reason")); assertTrue(previous.getBoolean("exitTimeKnown"))
        assertEquals(1, second.status().getInt("uncleanCount7Days"))
        second.setForeground(true); second.setForeground(false)
        time += 1000
        val third = DiagnosticJournal(root, "test", "test", { time }); third.begin(3) { ProcessExit(time - 100, 3, 400) }
        assertTrue(third.status().getJSONObject("previous").getBoolean("normal"))
        assertEquals("terminated_in_background", third.status().getJSONObject("previous").getString("reason"))
        third.setForeground(true, true)
        assertEquals("resume", third.rows().last().getJSONObject("fields").getString("phase"))
    }
    @Test fun unknownReasonFallbackAndSameSecondRecords() = isolated { root ->
        val first = DiagnosticJournal(root, "test", "test"); first.begin(1); first.setForeground(true)
        val second = DiagnosticJournal(root, "test", "test"); second.begin(2)
        assertEquals("unknown", second.status().getJSONObject("previous").getString("reason"))
        repeat(25) { second.write("app.failure", JSONObject().put("name", "TypeError").put("message", "private")) }
        val summary = JSONObject(second.status().getString("summary"))
        assertEquals(20, summary.getJSONArray("recentAbnormalRecords").length())
        assertEquals(25, summary.getJSONObject("abnormalCountsLast7Days").getInt("app.failure"))
        assertEquals(26, second.rows().filter { it.getString("runId") == second.runId }.map { it.getJSONObject("fields").getInt("recordIndex") }.toSet().size - 1)
        assertFalse(summary.toString().contains("private"))
    }
    @Test fun retentionAndTotalSizeAndTruncatedLines() = isolated { root ->
        var time = 1791720000000L
        val journal = DiagnosticJournal(root, "test", "test", { time }, maxBytes = 1200)
        journal.begin(1)
        repeat(20) { journal.write("app.failure", JSONObject().put("name", "Error")) }
        assertTrue(root.listFiles()!!.filter { it.extension == "jsonl" }.sumOf { it.length() } <= 1200)
        time += 8 * 86400000L
        journal.write("app.start", JSONObject().put("phase", "resume"))
        assertTrue(root.listFiles()!!.filter { it.extension == "jsonl" }.all { it.name.contains("2026-10-19") })
        root.listFiles()!!.first { it.extension == "jsonl" }.appendText("{broken")
        journal.write("app.failure", JSONObject().put("name", "TypeError"))
        assertEquals("app.failure", journal.rows().last().getString("event"))
    }
    @Test fun unwritableLogNeverThrows() = isolated { root ->
        val blocked = java.io.File(root, "blocked"); blocked.writeText("file")
        val journal = DiagnosticJournal(blocked, "test", "test"); journal.begin(1); journal.setForeground(true)
        assertNull(journal.write("app.failure")); assertEquals("error", journal.status().getString("state"))
    }
    @Test fun damagedMarkerDoesNotLoseTheNewRun() = isolated { root ->
        java.io.File(root, "current-run.json").writeText("{damaged")
        val first = DiagnosticJournal(root, "0.8.27", "15 (API 35)"); first.begin(1); first.setForeground(true)
        assertEquals(first.runId, JSONObject(java.io.File(root, "current-run.json").readText()).getString("runId"))
        val second = DiagnosticJournal(root, "0.8.28", "15 (API 35)"); second.begin(2)
        assertEquals("unknown", second.status().getJSONObject("previous").getString("reason"))
    }
    @Test fun historicalVersionsAndSafeStringSummary() = isolated { root ->
        val first = DiagnosticJournal(root, "0.8.27", "15 (API 35)"); first.begin(1)
        first.write("app.failure", JSONObject().put("name", "TypeError").put("line", 1))
        val second = DiagnosticJournal(root, "0.8.28", "16 (API 36)"); second.begin(2)
        val summary = JSONObject(second.status().getString("summary"))
        val row = summary.getJSONArray("recentAbnormalRecords").getJSONObject(0)
        assertEquals("0.8.27", row.getString("appVersion")); assertEquals("15 (API 35)", row.getString("osVersion"))
        assertTrue(row.getJSONObject("fields").get("line") is String)
        assertTrue(root.listFiles()!!.sumOf { it.length() } <= DiagnosticPolicy.MAX_BYTES)
    }
    @Test fun spoofedNativeStackCannotCarryRandomIdentifiers() {
        val safe = DiagnosticPolicy.fields(JSONObject().put("stackFrames", JSONArray(listOf(
            "com.memoweft.weftmate.mobile.HybridActivity.${"x".repeat(40)}:4",
            "com.memoweft.weftmate.mobile.HybridActivity\$${"x".repeat(40)}.handle:4"))))
        assertFalse(safe.has("stackFrames"))
        assertEquals(-8, DiagnosticPolicy.fields(JSONObject().put("status", -8)).getInt("status"))
    }
}
