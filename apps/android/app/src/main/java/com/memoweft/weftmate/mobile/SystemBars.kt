package com.memoweft.weftmate.mobile

import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.graphics.Color
import android.os.Build
import android.view.View
import android.view.WindowManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

internal fun resolvedAppearanceDark(selected: String, systemDark: Boolean, renderedDark: Boolean? = null): Boolean =
    renderedDark ?: when (selected) { "dark" -> true; "light" -> false; else -> systemDark }

internal data class SystemBarStyle(val darkStatusIcons: Boolean, val darkNavigationIcons: Boolean, val surface: Int)
internal fun systemBarStyle(dark: Boolean) = SystemBarStyle(!dark, !dark,
    if (dark) R.color.wm_web_surface_dark else R.color.wm_web_surface_light)
internal fun applicationAppearanceMode(selected: String): Int = when (selected) {
    "dark" -> UiModeManager.MODE_NIGHT_YES
    "light" -> UiModeManager.MODE_NIGHT_NO
    else -> UiModeManager.MODE_NIGHT_AUTO
}

internal fun systemAppearanceDark(): Boolean =
    (Resources.getSystem().configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

internal fun savedAppearance(context: Context): String {
    val prefs = context.getSharedPreferences("display-settings", Context.MODE_PRIVATE)
    val scope = prefs.getString("lastScope", "local") ?: "local"
    return prefs.getString("appearance:$scope", "system") ?: "system"
}

/** Transparent bars on API 26+, including Android 15's enforced edge-to-edge.
 * Insets are geometry; their backgrounds belong to the actual page, never a system colour. */
internal object SystemBars {
    fun surface(activity: Activity, dark: Boolean) = activity.getColor(systemBarStyle(dark).surface)

    fun prepare(activity: Activity, selected: String) {
        activity.setTheme(if (resolvedAppearanceDark(selected, systemAppearanceDark()))
            R.style.WeftTheme_Dark else R.style.WeftTheme_Light)
    }

    @Suppress("DEPRECATION")
    fun apply(activity: Activity, dark: Boolean, selected: String) {
        val window = activity.window
        val style = systemBarStyle(dark)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS or WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) {
            window.decorView.isForceDarkAllowed = false
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        if (Build.VERSION.SDK_INT >= 28) window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30)
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        window.decorView.setBackgroundColor(surface(activity, dark))
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = style.darkStatusIcons
            isAppearanceLightNavigationBars = style.darkNavigationIcons
        }
        // Android 12+ remembers this for the next system-created splash screen.
        if (Build.VERSION.SDK_INT >= 31) {
            val manager = activity.getSystemService(UiModeManager::class.java)
            // AUTO maps to UI_MODE_NIGHT_UNDEFINED in the package configuration,
            // clearing a previous forced override and inheriting future system changes.
            manager.setApplicationNightMode(applicationAppearanceMode(selected))
        }
    }

    fun nativeInsets(root: View) {
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(safe.left, safe.top, safe.right, maxOf(safe.bottom, ime.bottom))
            insets
        }
        ViewCompat.requestApplyInsets(root)
    }
}
