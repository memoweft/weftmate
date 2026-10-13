package com.memoweft.weftmate.mobile

import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal enum class NativeFileKind { IMAGE, MARKDOWN, TEXT, CODE, PDF, OTHER }
/** Preserve the existing table/code actions until native rendering reaches feature parity. */
internal fun useOriginalFileViewer(kind:NativeFileKind):Boolean = kind in setOf(NativeFileKind.MARKDOWN,NativeFileKind.CODE)
internal fun nativeFileKind(name: String, mime: String = ""): NativeFileKind {
    val ext = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
    return when {
        ext == "pdf" || mime.substringBefore(';') == "application/pdf" -> NativeFileKind.PDF
        ext in setOf("png","jpg","jpeg","webp","gif","bmp") || mime.startsWith("image/") && ext != "svg" -> NativeFileKind.IMAGE
        ext in setOf("md","markdown") -> NativeFileKind.MARKDOWN
        ext in setOf("js","ts","tsx","jsx","py","swift","kt","java","c","cpp","h","html","css","json","yaml","yml","sh","ps1","sql","rs","go","xml","svg") -> NativeFileKind.CODE
        ext in setOf("txt","log","csv","tsv") || mime.startsWith("text/") -> NativeFileKind.TEXT
        else -> NativeFileKind.OTHER
    }
}
internal fun nativeFileName(value: String): String = value.replace('\\','/').substringAfterLast('/')
    .filterNot { it.isISOControl() }.trim().ifBlank { "文件" }
internal fun middleFileName(value: String, limit: Int = 32): String {
    val name = nativeFileName(value)
    val points = name.codePoints().toArray()
    if (points.size <= limit) return name
    val left = (limit - 1) / 2; val right = limit - 1 - left
    return String(points, 0, left) + "…" + String(points, points.size - right, right)
}
internal fun nativeFileSize(size: Long): String = when {
    size < 0 -> "大小未知"
    size < 1024 -> "$size 字节"
    size < 1024 * 1024 -> String.format(Locale.ROOT, "%.1f KB", size / 1024.0)
    size < 1024L * 1024 * 1024 -> String.format(Locale.ROOT, "%.1f MB", size / 1048576.0)
    else -> String.format(Locale.ROOT, "%.1f GB", size / 1073741824.0)
}
internal fun nativeFileTime(value: String, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String = runCatching {
    val at = Instant.parse(value).atZone(zone); val today = now.atZone(zone).toLocalDate()
    when (at.toLocalDate()) {
        today -> "今天 " + at.format(DateTimeFormatter.ofPattern("H:mm"))
        today.minusDays(1) -> "昨天 " + at.format(DateTimeFormatter.ofPattern("H:mm"))
        else -> at.format(DateTimeFormatter.ofPattern(if (at.year == today.year) "M 月 d 日" else "yyyy 年 M 月 d 日"))
    }
}.getOrDefault("时间未知")
/** Server owns path deduplication and order. Paging replaces a repeated ID without duplicating it. */
internal fun mergeLibraryRows(old: List<JSONObject>, page: List<JSONObject>): List<JSONObject> {
    val rows = linkedMapOf<String, JSONObject>()
    (old + page).forEach { rows[it.getString("id")] = it }
    return rows.values.toList()
}
internal fun realFileVersions(row: JSONObject): List<JSONObject> = row.optJSONArray("versions")?.objects().orEmpty()
    .filter { it.optString("artifactId",it.optString("id")).isNotBlank() }
    .distinctBy { it.optString("artifactId",it.optString("id")) }.takeIf { it.size > 1 }.orEmpty()
internal fun nativeFileFailure(error: Throwable): String = when {
    error is ApiFailure && error.status in setOf(401,403) -> "请重新登录后再打开文件。"
    error is ApiFailure && error.safeCode in setOf("FILE_MISSING","NOT_FOUND","ATTACHMENT_UNAVAILABLE") && error.status == 404 -> "文件已不在原位置，可以回到对话查看。"
    error is ApiFailure && error.safeCode == "FILE_DOWNLOAD_UNAVAILABLE" -> "这份文件暂时只能在电脑上打开。"
    error is ApiFailure && error.safeCode == "FILE_TOO_LARGE" -> "这份文件较大，请用其它应用打开。"
    error is ApiFailure && error.status == 409 -> "文件已更新，请重新读取。"
    error is ApiFailure && error.safeCode in setOf("REDIRECT_REFUSED","TLS_PIN_MISMATCH") -> "无法确认这台电脑的连接，请检查连接后重试。"
    else -> "那台电脑不在线，连接后再试。"
}
internal fun libraryHasNoComputer(bootstrap:JSONObject):Boolean = bootstrap.optString("authSource")=="phone" ||
    bootstrap.optBoolean("phoneOnly") || bootstrap.has("hostAttached") && !bootstrap.optBoolean("hostAttached")
