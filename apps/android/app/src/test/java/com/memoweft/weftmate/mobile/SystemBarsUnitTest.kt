package com.memoweft.weftmate.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class SystemBarsUnitTest {
    @Test fun appearanceThreeStatesTimesSystemLightDark() {
        for (systemDark in listOf(false, true)) {
            assertEquals(systemDark, resolvedAppearanceDark("system", systemDark))
            assertEquals(false, resolvedAppearanceDark("light", systemDark))
            assertEquals(true, resolvedAppearanceDark("dark", systemDark))
        }
    }
    @Test fun unknownLegacyPreferenceFollowsSystem() {
        assertEquals(false, resolvedAppearanceDark("", false))
        assertEquals(true, resolvedAppearanceDark("legacy", true))
    }
    @Test fun iconContrastAndSurfaceFollowEveryResolvedTheme() {
        for (selected in listOf("system", "light", "dark")) for (systemDark in listOf(false, true)) {
            val dark = resolvedAppearanceDark(selected, systemDark)
            val style = systemBarStyle(dark)
            assertEquals(!dark, style.darkStatusIcons)
            assertEquals(!dark, style.darkNavigationIcons)
            assertEquals(if (dark) R.color.wm_web_surface_dark else R.color.wm_web_surface_light, style.surface)
        }
    }
    @Test fun renderedPageOverridesNativePreferenceForBothSystemModes() {
        for (selected in listOf("system", "light", "dark")) for (systemDark in listOf(false, true))
            for (renderedDark in listOf(false, true)) assertEquals(renderedDark,
                resolvedAppearanceDark(selected, systemDark, renderedDark))
    }
    @Test fun followSystemClearsThePreviouslyForcedSplashOverride() {
        assertEquals(android.app.UiModeManager.MODE_NIGHT_NO, applicationAppearanceMode("light"))
        assertEquals(android.app.UiModeManager.MODE_NIGHT_YES, applicationAppearanceMode("dark"))
        assertEquals(android.app.UiModeManager.MODE_NIGHT_AUTO, applicationAppearanceMode("system"))
    }
}
