package com.memoweft.weftmate.mobile

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

/** Network-only periodic fetch; never promotes itself to a foreground service. */
class NotificationWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val settings = SecureSettings(applicationContext)
        val host = settings.host() ?: return Result.success()
        val expected = inputData.getString("scope")
        if (expected != Endpoints.ownerKey(host.origin, host.ownerId)) return Result.success()
        return try {
            ActivityNotifications(applicationContext).poll(host) { !isStopped && ActivityNotificationPolicy.current(host, settings.host()) }
            Result.success()
        } catch (error: ApiFailure) { if (ActivityNotificationPolicy.retry(error.status)) Result.retry() else Result.failure() }
        catch (_: Exception) { if (isStopped) Result.success() else Result.retry() }
    }
    companion object {
        private const val NAME = "weftmate-activity-notifications"
        fun schedule(context: Context) {
            val host = SecureSettings(context).host() ?: return cancel(context)
            val work = PeriodicWorkRequest.Builder(NotificationWorker::class.java, 15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInputData(Data.Builder().putString("scope", Endpoints.ownerKey(host.origin, host.ownerId)).build()).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, work)
        }
        fun cancel(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(NAME) }
    }
}
