package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.util.UUID
import java.nio.file.Files
import java.nio.file.StandardCopyOption

internal data class ProcessExit(val at: Long, val reason: Int, val importance: Int)

/** Pure file implementation, also exercised on the JVM with isolated directories. */
internal class DiagnosticJournal(val directory: File, private val appVersion: String, private val osVersion: String,
    private val now: () -> Long = { System.currentTimeMillis() }, private val maxBytes: Long = DiagnosticPolicy.MAX_BYTES,
    private val retentionDays: Int = DiagnosticPolicy.RETENTION_DAYS) {
    val runId = UUID.randomUUID().toString()
    private var recordIndex = 0
    private var failed = false
    private var startedAt = ""
    private var foreground = false
    private var pid = 0
    private var previous: JSONObject? = null
    private val uuid = Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    private val logBudget get() = (maxBytes - minOf(4096, maxBytes / 3)).coerceAtLeast(1)
    private fun validTime(value: String) = try { Instant.parse(value).toString() } catch (_: Exception) { null }
    private val marker get() = File(directory, "current-run.json")
    private fun stamp(time: Long = now()) = Instant.ofEpochMilli(time).toString()
    private fun files() = directory.listFiles()?.filter { it.name.matches(Regex("android-\\d{4}-\\d{2}-\\d{2}(?:-\\d+)?\\.jsonl")) }
        ?.sortedWith(compareBy<File> { it.name.substring(8, 18) }.thenBy { it.name.substring(18).removePrefix("-").removeSuffix(".jsonl").toIntOrNull() ?: 0 }) ?: emptyList()
    private fun prune() {
        val cutoff = stamp(now() - (retentionDays - 1) * 86400000L).take(10)
        files().filter { it.name.substring(8, 18) < cutoff }.forEach { check(it.delete()) }
        var total = files().sumOf { it.length() }
        for (file in files()) if (total > logBudget) { val size = file.length(); check(file.delete()); total -= size }
    }
    private fun saveMarker() {
        val temporary = File(directory, "current-run.tmp")
        FileOutputStream(temporary).use { stream ->
            stream.write(JSONObject().put("runId", runId).put("startedAt", startedAt).put("lastAt", stamp()).put("foreground", foreground).put("pid", pid).toString().toByteArray())
            stream.fd.sync()
        }
        Files.move(temporary.toPath(), marker.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
    @Synchronized fun begin(processId: Int, history: (JSONObject) -> ProcessExit? = { null }) {
        startedAt = stamp(); pid = processId
        try {
            directory.mkdirs(); prune()
            val old = try { if (marker.isFile) JSONObject(marker.readText()) else null } catch (_: Exception) { failed = true; null }
            if (old != null && uuid.matches(old.optString("runId")) && validTime(old.optString("startedAt")) != null) {
                val exit = try { history(old) } catch (_: Exception) { null }
                val nativeFailure = rows().any { it.getString("runId") == old.getString("runId") && it.getString("event") == "app.failure" &&
                    it.getJSONObject("fields").optString("source") == "native-uncaught" }
                val decision = if (exit != null) DiagnosticPolicy.exit(exit.reason, exit.importance, old.optBoolean("foreground"))
                    else if (nativeFailure) "crash" to false
                    else if (!old.optBoolean("foreground")) "terminated_in_background" to true else "unknown" to false
                previous = JSONObject().put("runId", old.getString("runId")).put("startedAt", old.optString("startedAt"))
                    .put("at", exit?.let { stamp(it.at) } ?: JSONObject.NULL).put("lastAt", validTime(old.optString("lastAt")) ?: old.getString("startedAt"))
                    .put("reason", decision.first).put("normal", decision.second).put("exitTimeKnown", exit != null)
                    .put("importance", if (exit == null) "unknown" else if (exit.importance in 1..200) "foreground" else "background")
                write(if (decision.second) "app.previous_exit" else "app.previous_unclean_exit",
                    JSONObject(previous.toString()).put("previousRunId", old.getString("runId")).put("previousAt", exit?.let { stamp(it.at) } ?: "")
                        .put("reasonCode", exit?.reason ?: 0).put("importanceCode", exit?.importance ?: 0))
            }
        } catch (_: Exception) { failed = true }
        // Even a damaged prior marker must not prevent this run being durable.
        try { saveMarker() } catch (_: Exception) { failed = true }
        write("app.start", JSONObject().put("phase", "cold"))
    }
    @Synchronized fun setForeground(value: Boolean, resume: Boolean = false) {
        foreground = value
        try { saveMarker() } catch (_: Exception) { failed = true }
        if (!value) write("app.background", JSONObject().put("phase", "background"))
        else if (resume) write("app.start", JSONObject().put("phase", "resume"))
    }
    @Synchronized fun write(event: String, input: JSONObject = JSONObject()): JSONObject? {
        if (event !in DiagnosticPolicy.events) return null
        return try {
            directory.mkdirs()
            val row = JSONObject().put("at", stamp()).put("event", event).put("runId", runId).put("platform", "android")
                .put("appVersion", appVersion).put("osVersion", osVersion)
                .put("fields", DiagnosticPolicy.fields(input).put("recordIndex", ++recordIndex))
            val encoded = (row.toString() + "\n").toByteArray()
            if (encoded.size > minOf(logBudget, 256 * 1024L)) return null
            val day = stamp().take(10)
            val latest = files().lastOrNull { it.name.substring(8, 18) == day }
            var index = latest?.name?.substring(18)?.removePrefix("-")?.removeSuffix(".jsonl")?.toIntOrNull() ?: 0
            var file = latest ?: File(directory, "android-$day.jsonl")
            while (file.length() + encoded.size + 1 > minOf(logBudget, 256 * 1024L)) file = File(directory, "android-$day-${++index}.jsonl")
            // A power cut can truncate a line; delimit before appending another record.
            if (file.length() > 0 && java.io.RandomAccessFile(file, "r").use { it.seek(it.length() - 1); it.read() } != 10) file.appendText("\n")
            FileOutputStream(file, true).use { it.write(encoded); it.fd.sync() }
            prune(); row
        } catch (_: Exception) { failed = true; null }
    }
    @Synchronized fun rows(): List<JSONObject> {
        try { prune() } catch (_: Exception) { failed = true }
        return files().flatMap { file -> try { file.readLines().mapNotNull { line -> try {
            val row = JSONObject(line)
            val at = Instant.parse(row.getString("at"))
            if (row.optString("platform") != "android" || row.optString("event") !in DiagnosticPolicy.events ||
                !uuid.matches(row.optString("runId"))) null
            else JSONObject().put("at", at.toString()).put("event", row.getString("event")).put("runId", row.getString("runId"))
                .put("platform", "android").put("appVersion", row.optString("appVersion").takeIf { it.matches(Regex("\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}(?:[-+][a-z0-9.]{1,12})?")) } ?: "unknown")
                .put("osVersion", row.optString("osVersion").takeIf { it.matches(Regex("\\d{1,3}(?:\\.\\d{1,3}){0,3} \\(API \\d{1,3}\\)")) } ?: "unknown")
                .put("fields", DiagnosticPolicy.fields(row.optJSONObject("fields") ?: JSONObject()))
        } catch (_: Exception) { null } } } catch (_: Exception) { failed = true; emptyList() } }
            .distinctBy { "${it.optString("runId")}:${it.getJSONObject("fields").optInt("recordIndex")}" }
            .sortedWith(compareBy<JSONObject> { it.getString("at") }.thenBy { it.getJSONObject("fields").optInt("recordIndex") })
    }
    @Synchronized fun status(): JSONObject {
        val abnormal = rows().filter { DiagnosticPolicy.abnormal(it.getString("event")) && Instant.parse(it.getString("at")).toEpochMilli() >= now() - 7 * 86400000L }
        val counts = JSONObject(); abnormal.groupingBy { it.getString("event") }.eachCount().forEach { (event, count) -> counts.put(event, count) }
        val projected = abnormal.takeLast(20).map { row ->
            val envelope = JSONObject(row.toString())
            val values = row.getJSONObject("fields")
            val fields = JSONObject()
            values.keys().forEach { key ->
                if (key == "stackFrames") {
                    val frames = values.getJSONArray(key)
                    for (i in 0 until frames.length()) fields.put("stackFrame${i + 1}", frames.getString(i))
                } else fields.put(key, values.get(key).toString())
            }
            envelope.put("fields", fields)
        }
        val summary = JSONObject().put("platform", "android").put("appVersion", appVersion).put("osVersion", osVersion).put("generatedAt", stamp())
            .put("recentAbnormalRecords", JSONArray(projected)).put("abnormalCountsLast7Days", counts)
            .put("retentionPolicy", JSONObject().put("retentionDays", retentionDays).put("maxBytes", maxBytes))
        return JSONObject().put("state", if (failed) "error" else "ready").put("runId", runId).put("startedAt", startedAt)
            .put("previous", previous ?: JSONObject.NULL).put("uncleanCount7Days", abnormal.count { it.getString("event") == "app.previous_unclean_exit" })
            .put("abnormalCountsLast7Days", counts).put("summary", summary.toString(2))
            .put("summaryPreview", "WeftMate $appVersion · Android $osVersion\n最近 7 天：${abnormal.size} 条异常记录\n只保存在这部手机 · 最长 $retentionDays 天 · 最多 2 MB\n" +
                abnormal.takeLast(20).joinToString("\n") { "${it.getString("at").replace('T', ' ').take(16)} · ${it.getString("event")}" })
    }
}
