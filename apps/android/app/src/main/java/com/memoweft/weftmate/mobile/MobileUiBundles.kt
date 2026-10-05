package com.memoweft.weftmate.mobile

import android.content.Context
import android.webkit.MimeTypeMap
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class UiBundleState(val active: String, val staged: String?, val previous: String?,
    val version: String, val stagedVersion: String?, val releaseNotes: String?, val error: String?)

/** Serves only complete, verified UI bundles. Credentials and SQLite never live under this directory. */
class MobileUiBundles(private val context: Context) {
    private val prefs = context.getSharedPreferences("mobile-ui-bundles", Context.MODE_PRIVATE)
    private val directory = File(context.filesDir, "mobile-ui-bundles").apply { mkdirs() }
    private val builtIn = "builtin"
    private val downloading = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    private val activeConnection = AtomicReference<HttpURLConnection?>()
    @Volatile private var activeId = (prefs.getString("active", builtIn) ?: builtIn)
        .takeIf { it == builtIn || it.matches(Regex("[a-f0-9]{64}")) && File(directory, "$it/index.html").isFile }
        ?: builtIn
    private val names = Regex("[A-Za-z0-9._/-]{1,180}")
    private val digest = Regex("[a-f0-9]{64}")
    private fun rejected(): Set<String> = try {
        val values = org.json.JSONArray(prefs.getString("rejectedIds", "[]"))
        (0 until values.length()).map { values.getString(it) }.filter { digest.matches(it) }.toSet()
    } catch (_: Exception) { emptySet() }

    fun state(error: String? = null): UiBundleState {
        val active = activeId
        val staged = prefs.getString("staged", null)
        return UiBundleState(active, staged, prefs.getString("previous", null),
            version(active), staged?.let(::version), staged?.let { manifest(it)?.optString("releaseNotes") },
            error ?: if (rejected().isNotEmpty()) "UI_UPDATE_REJECTED" else null)
    }

    private fun manifest(id: String): JSONObject? = if (id == builtIn) null else try {
        JSONObject(File(directory, "$id/.release-manifest.json").readText(Charsets.UTF_8))
    } catch (_: Exception) { null }

    private fun version(id: String): String = if (id == builtIn) "0.8.0（内置）"
        else manifest(id)?.optString("uiVersion")?.takeIf { it.matches(Regex("[0-9A-Za-z._-]{1,40}")) } ?: "未知"

    private fun response(path: String): WebResourceResponse {
        if (closed.get()) return WebResourceResponse("text/plain", "UTF-8", null)
        val safe = path.substringBefore('?')
        if (!names.matches(safe) || safe.startsWith('/') || safe.split('/').any { it.startsWith('.') })
            return WebResourceResponse("text/plain", "UTF-8", null)
        val input = if (activeId == builtIn) try { context.assets.open(safe) } catch (_: Exception) { null }
            else try { FileInputStream(File(directory, "$activeId/$safe")) } catch (_: Exception) { null }
        val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(safe.substringAfterLast('.', ""))
            ?: "application/octet-stream"
        return WebResourceResponse(type, if (type.startsWith("text/") || type.contains("javascript")) "UTF-8" else null, input)
    }

    val pathHandler = WebViewAssetLoader.PathHandler { path -> response(path) }

    /** Read-only manifest and immutable assets. Downloads use the configured personal host origin. */
    fun check(host: HostIdentity): UiBundleState {
        if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
        if (!downloading.compareAndSet(false, true)) throw ApiFailure(409, "UI_UPDATE_IN_PROGRESS")
        try { return download(host) } finally { downloading.set(false) }
    }

    private fun download(host: HostIdentity): UiBundleState {
        if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
        val origin = Endpoints.hostOrigin(host.origin)
        val base = "$origin/personal/v1/app"
        val body = bytes("$base/manifest", 256 * 1024, host.cookie)
        val manifest = JSONObject(String(body, Charsets.UTF_8))
        if (manifest.getInt("schemaVersion") != 1 || manifest.getInt("bridgeVersion") != 1)
            throw ApiFailure(409, "UI_UPDATE_INCOMPATIBLE")
        if (manifest.getInt("minNativeVersionCode") > BuildConfig.VERSION_CODE)
            throw ApiFailure(409, "NATIVE_UPDATE_REQUIRED")
        val version = manifest.getString("uiVersion")
        require(version.matches(Regex("[0-9A-Za-z._-]{1,40}")))
        val assetBase = manifest.getString("assetBase")
        val contentHash = Regex("^/personal/v1/app/assets/([a-f0-9]{64})/$")
            .matchEntire(assetBase)?.groupValues?.get(1) ?: throw IllegalArgumentException("Invalid asset root")
        require(manifest.getString("entry") == "index.html")
        val releaseId = sha256("$version|$contentHash|${manifest.optString("releaseNotes")}|${manifest.getInt("minNativeVersionCode")}".toByteArray(Charsets.UTF_8))
        if (releaseId in rejected()) return state("UI_UPDATE_REJECTED")
        if (releaseId == activeId || releaseId == prefs.getString("staged", null)) return state()
        val items = manifest.getJSONArray("assets")
        require(items.length() in 1..250)
        var total = 0L
        val paths = mutableSetOf<String>()
        val work = File(directory, "$releaseId.${UUID.randomUUID()}.tmp")
        check(work.mkdir())
        try {
            for (i in 0 until items.length()) {
                if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
                val row = items.getJSONObject(i)
                val path = row.getString("path")
                val hash = row.getString("sha256")
                val size = row.getLong("size")
                require(path.length <= 180 && names.matches(path) && !path.startsWith('/') &&
                    path.split('/').none { it.startsWith('.') } &&
                    paths.add(path) && digest.matches(hash) && size in 1..(4L * 1024 * 1024))
                total += size
                require(total <= 16L * 1024 * 1024)
                val data = bytes("$origin$assetBase$path", size.toInt(), host.cookie)
                require(data.size.toLong() == size && sha256(data) == hash)
                val file = File(work, path)
                check(file.canonicalPath.startsWith(work.canonicalPath + File.separator))
                file.parentFile?.mkdirs()
                file.outputStream().use { out -> out.write(data); out.fd.sync() }
            }
            require("index.html" in paths)
            File(work, ".release-manifest.json").outputStream().use { out ->
                out.write(manifest.toString().toByteArray(Charsets.UTF_8)); out.fd.sync()
            }
            synchronized(this) {
                if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
                val target = File(directory, releaseId)
                if (target.exists()) {
                    if (verify(releaseId)) work.deleteRecursively()
                    else {
                        check(target.deleteRecursively())
                        check(work.renameTo(target))
                    }
                } else check(work.renameTo(target))
                check(prefs.edit().putString("staged", releaseId).commit())
            }
            return state()
        } catch (error: Exception) {
            work.deleteRecursively()
            throw error
        }
    }

    @Synchronized fun apply(): UiBundleState {
        if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
        val staged = prefs.getString("staged", null) ?: return state()
        require(digest.matches(staged) && verify(staged))
        val old = activeId
        check(prefs.edit().putString("active", staged).putString("previous", old).remove("staged").commit())
        activeId = staged
        return state()
    }

    @Synchronized fun rollback(): UiBundleState {
        if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
        val previous = prefs.getString("previous", null) ?: builtIn
        require(previous == builtIn || digest.matches(previous) && verify(previous))
        val old = activeId
        check(prefs.edit().putString("active", previous).putString("previous", old).commit())
        activeId = previous
        return state()
    }

    @Synchronized fun rejectActive(): UiBundleState {
        if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
        val failed = activeId
        val candidate = prefs.getString("previous", builtIn) ?: builtIn
        val next = if (candidate != failed && (candidate == builtIn || digest.matches(candidate) && verify(candidate))) candidate else builtIn
        val oldRejected = rejected().toMutableList()
        if (failed != builtIn && failed !in oldRejected) oldRejected += failed
        val list = org.json.JSONArray()
        for (id in oldRejected.takeLast(10)) list.put(id)
        check(prefs.edit().putString("active", next).putString("previous", builtIn)
            .putString("rejectedIds", list.toString()).remove("staged").commit())
        activeId = next
        return state("UI_UPDATE_REJECTED")
    }

    @Synchronized fun retryRejected() {
        if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
        check(prefs.edit().remove("rejectedIds").commit())
    }

    fun close() {
        synchronized(this) { closed.set(true) }
        activeConnection.getAndSet(null)?.disconnect()
    }

    private fun verify(id: String): Boolean {
        if (id == builtIn) return true
        return try {
            val root = File(directory, id)
            val manifest = JSONObject(File(root, ".release-manifest.json").readText(Charsets.UTF_8))
            val items = manifest.getJSONArray("assets")
            if (items.length() !in 1..250) return false
            var total = 0L
            val seen = mutableSetOf<String>()
            for (index in 0 until items.length()) {
                val row = items.getJSONObject(index)
                val path = row.getString("path")
                val size = row.getLong("size")
                if (path.length > 180 || !names.matches(path) || path.startsWith('/') ||
                    path.split('/').any { it.startsWith('.') } || !seen.add(path) || size !in 1..(4L * 1024 * 1024)) return false
                total += size
                if (total > 16L * 1024 * 1024) return false
                val file = File(root, path)
                if (!file.isFile || file.length() != size || sha256(file.readBytes()) != row.getString("sha256")) return false
            }
            "index.html" in seen
        } catch (_: Exception) { false }
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    private fun bytes(url: String, limit: Int, cookie: String): ByteArray {
        if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
        val connection = URL(url).openConnection() as HttpURLConnection
        activeConnection.set(connection)
        try {
            if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
            require(Endpoints.allowedProtocol(connection.url))
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 20_000
            connection.setRequestProperty("Cookie", cookie)
            connection.setRequestProperty("Accept", "application/json, text/html, text/css, application/javascript")
            if (connection.responseCode != 200) throw ApiFailure(connection.responseCode, "UI_UPDATE_UNAVAILABLE")
            connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING")
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > limit) throw ApiFailure(413, "UI_UPDATE_TOO_LARGE")
                    output.write(buffer, 0, count)
                }
                return output.toByteArray()
            }
        } finally { activeConnection.compareAndSet(connection, null); connection.disconnect() }
    }
}
