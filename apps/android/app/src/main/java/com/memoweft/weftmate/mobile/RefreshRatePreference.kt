package com.memoweft.weftmate.mobile

internal data class DisplayRefreshMode(val width: Int, val height: Int, val rate: Float)

/** Only modes at the display's current physical resolution can inform a rate-only request. */
internal fun selectPreferredRefreshRate(currentWidth: Int, currentHeight: Int,
    supported: Iterable<DisplayRefreshMode>): Float? = supported.asSequence()
    .filter { it.width == currentWidth && it.height == currentHeight &&
        it.rate.isFinite() && it.rate > 60f }
    .map { it.rate }
    .maxOrNull()
