package com.memoweft.weftmate.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RefreshRatePreferenceUnitTest {
    private val width = 1440
    private val height = 3168
    private fun mode(rate: Float, width: Int = this.width, height: Int = this.height) =
        DisplayRefreshMode(width, height, rate)

    @Test fun leavesSixtyHertzOnlyDisplayOnSystemDefault() {
        assertNull(selectPreferredRefreshRate(width, height, listOf(mode(60f))))
    }

    @Test fun selectsHighestSupportedRateAtCurrentResolution() {
        assertEquals(120f, selectPreferredRefreshRate(width, height,
            listOf(mode(60f), mode(90f), mode(120f)))!!, 0f)
        assertEquals(180f, selectPreferredRefreshRate(width, height,
            listOf(mode(15f), mode(180f)))!!, 0f)
    }

    @Test fun excludesModesWithDifferentPhysicalResolution() {
        assertEquals(90f, selectPreferredRefreshRate(width, height,
            listOf(mode(90f), mode(180f, 1080, 2400)))!!, 0f)
    }

    @Test fun excludesMalformedRates() {
        assertEquals(90f, selectPreferredRefreshRate(width, height,
            listOf(mode(Float.NaN), mode(Float.POSITIVE_INFINITY), mode(-120f), mode(0f), mode(90f)))!!, 0f)
        assertNull(selectPreferredRefreshRate(width, height,
            listOf(mode(Float.NEGATIVE_INFINITY), mode(Float.NaN))))
    }
}
