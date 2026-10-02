package com.memoweft.weftmate.mobile

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.PersistableBundle
import java.net.HttpURLConnection
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Network-constrained retry. Only the currently scheduled credential generation may affect this Job ID. */
class SyncJobService : JobService() {
    private class Run(val params: JobParameters, val generation: String?) {
        @Volatile var lease: SyncJobLease? = null
        @Volatile var thread: Thread? = null
        val stopped = AtomicBoolean(false)
        val cancelled = AtomicBoolean(false)
        val active = AtomicReference<HttpURLConnection?>()
        fun abort() {
            cancelled.set(true)
            thread?.interrupt()
            active.getAndSet(null)?.disconnect()
        }
    }
    private val running = ConcurrentHashMap<String, Run>()
    private fun runKey(params: JobParameters): String =
        params.extras?.getString(GENERATION_KEY) ?: "legacy-${System.identityHashCode(params)}"

    private fun currentHost(): HostIdentity? = try { SecureSettings(this).host() } catch (_: Exception) { null }
    private fun currentGeneration(): String? = try {
        val scheduler = getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        scheduledGeneration(this, scheduler)
    } catch (_: Exception) { null }

    private fun stillCurrent(run: Run): Boolean = !run.cancelled.get() &&
        run.generation != null && run.generation !in INVALIDATED_GENERATIONS &&
        run.lease?.canContinue(currentHost(), currentGeneration()) == true

    private fun cancelOnlyThisGeneration(run: Run) {
        synchronized(JOB_LOCK) {
            val scheduler = getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
            if (run.lease?.canCancelScheduled(currentHost(), scheduledGeneration(this, scheduler)) == true) {
                run.generation?.let { INVALIDATED_GENERATIONS.add(it) }
                jobPreferences(this).edit().remove(GENERATION_KEY).commit()
                scheduler.cancel(JOB_ID)
            }
        }
    }

    private fun recordFailure(run: Run, title: String, summary: String, scope: String) {
        if (!stillCurrent(run)) return
        val lease = run.lease ?: return
        val current = currentHost()
        if (!lease.canShowNotification(current)) return
        try { MobileNotifications(this, scope).record("sync", title, summary,
            showSystem = NotificationScopeGate.mayShow(scope,
                current?.let { Endpoints.ownerKey(it.origin, it.ownerId) } ?: "local", false, false)) }
        catch (_: Exception) { }
    }

    override fun onStartJob(params: JobParameters): Boolean {
        val run = Run(params, params.extras?.getString(GENERATION_KEY))
        val key = runKey(params)
        running.put(key, run)?.abort()
        val thread = Thread({
            var retry = false
            var scope = "local"
            try {
                if (run.cancelled.get()) throw SyncInterrupted()
                val host = currentHost() ?: throw SyncInterrupted()
                scope = Endpoints.ownerKey(host.origin, host.ownerId)
                run.lease = SyncJobLease(run.generation, host)
                if (!stillCurrent(run)) throw SyncInterrupted()
                val store = LocalStore(this)
                try {
                    SyncManager(store, PersonalApi(), AttachmentStore(this, store)).syncOnce(host,
                        { stillCurrent(run) }, run.active)
                } finally { store.close() }
            } catch (_: SyncInterrupted) {
                // Identity changed or Android stopped this execution. The next owner keeps its own Job.
            } catch (error: ApiFailure) {
                if (stillCurrent(run)) {
                    retry = error.status !in setOf(401, 409, 413, 429)
                    recordFailure(run, "同步未完成", "本机记录仍保留，请在应用中查看状态", scope)
                    if (!retry) cancelOnlyThisGeneration(run)
                }
            } catch (_: Exception) {
                if (stillCurrent(run)) {
                    retry = true
                    recordFailure(run, "暂时无法同步", "本机记录仍保留，稍后会再试", scope)
                }
            } finally {
                running.remove(key, run)
                if (!run.stopped.get() && stillCurrent(run)) jobFinished(params, retry)
            }
        }, "weftmate-sync-job")
        run.thread = thread
        try { thread.start(); return true }
        catch (_: Exception) { running.remove(key, run); return false }
    }

    override fun onStopJob(params: JobParameters): Boolean {
        val run = running[runKey(params)] ?: return false
        val persisted = jobPreferences(this).getString(GENERATION_KEY, null)
        val reschedule = run.generation != null && run.generation == persisted &&
            run.generation !in INVALIDATED_GENERATIONS &&
            run.lease?.canContinue(currentHost(), currentGeneration()) == true
        run.stopped.set(true)
        run.abort()
        return reschedule
    }

    companion object {
        private const val JOB_ID = 64005
        private const val GENERATION_KEY = "weftmate.sync.generation"
        private val JOB_LOCK = Any()
        private val INVALIDATED_GENERATIONS = ConcurrentHashMap.newKeySet<String>()
        private fun jobPreferences(context: Context) =
            context.getSharedPreferences("weftmate-sync-job", Context.MODE_PRIVATE)
        private fun scheduledGeneration(context: Context, scheduler: JobScheduler): String? {
            val pending = scheduler.getPendingJob(JOB_ID)
            if (pending != null) return pending.extras?.getString(GENERATION_KEY)
            return jobPreferences(context).getString(GENERATION_KEY, null)
        }

        fun schedule(context: Context): Boolean = synchronized(JOB_LOCK) {
            var previous: String? = null
            try {
                val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
                previous = scheduledGeneration(context, scheduler)
                previous?.let { INVALIDATED_GENERATIONS.add(it) }
                val generation = UUID.randomUUID().toString()
                val extras = PersistableBundle().apply { putString(GENERATION_KEY, generation) }
                val accepted = scheduler.schedule(JobInfo.Builder(JOB_ID,
                    ComponentName(context, SyncJobService::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(15 * 60 * 1000L)
                    .setPersisted(true)
                    .setExtras(extras)
                    .build()) == JobScheduler.RESULT_SUCCESS
                if (!accepted) {
                    previous?.let { INVALIDATED_GENERATIONS.remove(it) }
                    return@synchronized false
                }
                if (!jobPreferences(context).edit().putString(GENERATION_KEY, generation).commit()) {
                    scheduler.cancel(JOB_ID)
                    return@synchronized false
                }
                true
            } catch (_: Exception) {
                previous?.let { INVALIDATED_GENERATIONS.remove(it) }
                false
            }
        }

        fun status(context: Context): String = try {
            val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
            val pending = scheduler.getPendingJob(JOB_ID)
            if (pending?.service == ComponentName(context, SyncJobService::class.java)) "scheduled"
            else "not_scheduled"
        } catch (_: Exception) { "unknown" }

        fun cancel(context: Context) {
            synchronized(JOB_LOCK) {
                try {
                    val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
                    scheduledGeneration(context, scheduler)?.let { INVALIDATED_GENERATIONS.add(it) }
                    jobPreferences(context).edit().remove(GENERATION_KEY).commit()
                    scheduler.cancel(JOB_ID)
                }
                catch (_: Exception) { /* Manual sync remains available. */ }
            }
        }
    }
}
