package com.memoweft.weftmate.mobile

/** In-memory authorization for one JobScheduler execution; no credential is written to JobInfo. */
class SyncJobLease(val generation: String?, private val issuedTo: HostIdentity) {
    private fun sameCredential(current: HostIdentity?): Boolean = current != null &&
        issuedTo.origin == current.origin && issuedTo.ownerId == current.ownerId &&
        issuedTo.deviceId == current.deviceId && issuedTo.cookie == current.cookie &&
        issuedTo.csrf == current.csrf

    fun canContinue(current: HostIdentity?, scheduledGeneration: String?): Boolean =
        sameCredential(current) && generation != null && generation == scheduledGeneration

    fun canCancelScheduled(current: HostIdentity?, scheduledGeneration: String?): Boolean =
        sameCredential(current) && generation != null && generation == scheduledGeneration

    fun canShowNotification(current: HostIdentity?): Boolean = sameCredential(current)
}
