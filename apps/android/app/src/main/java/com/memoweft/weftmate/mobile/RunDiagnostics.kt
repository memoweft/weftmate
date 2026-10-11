package com.memoweft.weftmate.mobile

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

internal object RunDiagnostics {
    private var journal: DiagnosticJournal? = null
    private var connection: String? = null
    @Synchronized fun start(context: Context) {
        if (journal != null) return
        val log = DiagnosticJournal(File(context.noBackupFilesDir, "diagnostics"), BuildConfig.VERSION_NAME,
            "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        journal = log
        log.begin(android.os.Process.myPid()) { old ->
            if (Build.VERSION.SDK_INT < 30) null else try {
                val since = java.time.Instant.parse(old.getString("startedAt")).toEpochMilli()
                (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
                    .getHistoricalProcessExitReasons(context.packageName, old.optInt("pid"), 16)
                    .filter { it.processName == context.packageName && it.timestamp >= since && it.timestamp <= System.currentTimeMillis() }
                    .maxByOrNull { it.timestamp }?.let { ProcessExit(it.timestamp, it.reason, it.importance) }
            } catch (_: Exception) { null }
        }
    }
    fun write(event: String, fields: JSONObject = JSONObject()) { try { journal?.write(event, fields) } catch (_: Exception) { } }
    fun failure(error: Throwable) { try { journal?.write("app.failure", DiagnosticPolicy.failure(error)) } catch (_: Throwable) { } }
    fun foreground(value: Boolean, resume: Boolean) { try { journal?.setForeground(value, resume) } catch (_: Exception) { } }
    fun status() = try { journal?.status() ?: JSONObject().put("state", "error") } catch (_: Exception) { JSONObject().put("state", "error") }
    fun errorCode(error: Throwable): String = when {
        error is ApiFailure && error.safeCode == "HOST_PIN_MISMATCH" -> "CERTIFICATE_ERROR"
        error is ApiFailure -> error.safeCode
        error is javax.net.ssl.SSLException || error.cause is javax.net.ssl.SSLException -> "CERTIFICATE_ERROR"
        error is java.net.SocketTimeoutException -> "TIMEOUT"
        error is java.io.IOException -> "NETWORK_UNAVAILABLE"
        else -> "UNAVAILABLE"
    }
    fun failed(event: String, phase: String, error: Throwable) {
        write(event, JSONObject().put("phase", phase).put("code", errorCode(error)).apply { if (error is ApiFailure) put("status", error.status) })
    }
    @Synchronized fun connection(online: Boolean, error: Throwable? = null) {
        val code = error?.let(::errorCode)
        val state = when {
            online -> "online"
            error is ApiFailure && (error.status == 401 || error.safeCode in setOf("AUTH_REQUIRED", "LOGIN_REQUIRED", "UNAUTHORIZED")) -> "login_required"
            code == "CERTIFICATE_ERROR" -> "certificate_error"
            code in setOf("RELAY_UNAVAILABLE", "RELAY_HOST_OFFLINE", "RELAY_NETWORK_UNAVAILABLE") -> "relay_unavailable"
            else -> "offline"
        }
        if (state == connection) return
        connection = state
        write("connection.change", JSONObject().put("state", state).apply { if (code != null) put("code", code); if (error is ApiFailure) put("status", error.status) })
    }
    fun share(activity: Activity) {
        val log = journal ?: return
        // Re-project historical records; only the explicitly tapped share operation grants a URI.
        val folder = File(activity.cacheDir, "diagnostic-share").apply { mkdirs() }
        folder.listFiles()?.forEach { it.delete() }
        val file = File(folder, "weftmate-run-log.jsonl")
        file.writeText(log.rows().joinToString("\n", postfix = "\n") { it.toString() })
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.diagnostics", file)
        activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/x-ndjson")
            .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "分享运行记录"))
    }
}

class WeftMateApplication : Application(), Application.ActivityLifecycleCallbacks {
    private val visible = mutableSetOf<Activity>()
    private var everVisible = false
    private var changingConfiguration = false
    override fun onCreate() {
        super.onCreate()
        RunDiagnostics.start(this)
        val original = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            RunDiagnostics.failure(error)
            // Delegate a metadata-only copy so default crash/termination still
            // runs without forwarding private text again. Android's non-SDK
            // logging pre-handler may already have printed the original error
            // before this SDK handler; local diagnostics never retain that text.
            val safe = RuntimeException("WeftMate uncaught failure; see local diagnostics")
            safe.stackTrace = emptyArray()
            DiagnosticPolicy.failure(error).optJSONArray("stackFrames")?.let { frames ->
                safe.stackTrace = (0 until frames.length()).map { index ->
                    val frame = frames.getString(index)
                    val at = frame.substringBeforeLast(':')
                    StackTraceElement(at.substringBeforeLast('.'), at.substringAfterLast('.'), null, frame.substringAfterLast(':').toInt())
                }.toTypedArray()
            }
            if (original != null) original.uncaughtException(thread, safe)
            else { android.os.Process.killProcess(android.os.Process.myPid()); kotlin.system.exitProcess(10) }
        }
        registerActivityLifecycleCallbacks(this)
    }
    override fun onActivityStarted(activity: Activity) {
        val first = visible.isEmpty()
        visible.add(activity)
        if (first) { RunDiagnostics.foreground(true, everVisible && !changingConfiguration); everVisible = true; changingConfiguration = false }
    }
    override fun onActivityStopped(activity: Activity) {
        visible.remove(activity)
        if (visible.isEmpty()) {
            changingConfiguration = activity.isChangingConfigurations
            if (!changingConfiguration) RunDiagnostics.foreground(false, false)
            if (activity.isFinishing) RunDiagnostics.write("app.exit", JSONObject().put("reason", "activity_finished").put("normal", true))
        }
    }
    override fun onActivityCreated(activity: Activity, state: Bundle?) { }
    override fun onActivityResumed(activity: Activity) { }
    override fun onActivityPaused(activity: Activity) { }
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) { }
    override fun onActivityDestroyed(activity: Activity) { }
}
