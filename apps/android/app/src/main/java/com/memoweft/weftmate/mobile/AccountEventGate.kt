package com.memoweft.weftmate.mobile

/** Rechecks ownership at UI delivery, after a queued old-account callback may have become stale. */
object AccountEventGate {
    fun post(sourceEpoch: Long, currentEpoch: () -> Long,
        enqueue: (() -> Unit) -> Unit, deliver: () -> Unit) {
        enqueue { if (sourceEpoch == currentEpoch()) deliver() }
    }
}
