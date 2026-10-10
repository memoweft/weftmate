package com.memoweft.weftmate.mobile

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/** Native compatibility palette generated from design/tokens/tokens.json. */
object Weave {
    var dark = false
    val accent get() = if (dark) DesignTokens.nativeDarkAccent else DesignTokens.nativeAccent
    val ink get() = if (dark) DesignTokens.nativeDarkInk else DesignTokens.nativeInk
    val secondary get() = if (dark) DesignTokens.nativeDarkSecondary else DesignTokens.nativeSecondary
    val muted get() = if (dark) DesignTokens.nativeDarkMuted else DesignTokens.nativeMuted
    val canvas get() = if (dark) DesignTokens.nativeDarkCanvas else DesignTokens.nativeCanvas
    val surface get() = if (dark) DesignTokens.nativeWebSurfaceDark else DesignTokens.nativeWebSurfaceLight
    val soft get() = if (dark) DesignTokens.nativeDarkSoft else DesignTokens.nativeSoft
    val accentSoft get() = if (dark) DesignTokens.nativeDarkAccentSoft else DesignTokens.nativeAccentSoft
    val line get() = if (dark) DesignTokens.nativeDarkLine else DesignTokens.nativeLine
    const val lineStrong = DesignTokens.nativeLineStrong
    val danger get() = if (dark) DesignTokens.nativeDarkDanger else DesignTokens.nativeDanger
    const val overlay = DesignTokens.nativeOverlay

    fun dp(context: Context, value: Int): Int = (context.resources.displayMetrics.density * value).toInt()
    fun shape(context: Context, color: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(context, radius).toFloat()
        if (stroke != null) setStroke(dp(context, DesignTokens.space1), stroke)
    }
    fun topSheet(context: Context, color: Int = surface) = GradientDrawable().apply {
        setColor(color)
        val radius = dp(context, DesignTokens.radius32).toFloat()
        cornerRadii = floatArrayOf(radius, radius, radius, radius, 0f, 0f, 0f, 0f)
    }
    fun drawer(context: Context) = GradientDrawable().apply {
        setColor(surface)
        val radius = dp(context, DesignTokens.radius32).toFloat()
        cornerRadii = floatArrayOf(0f, 0f, radius, radius, radius, radius, 0f, 0f)
    }
    fun text(context: Context, value: String, size: Float = DesignTokens.font14, color: Int = ink, weight: Int = Typeface.NORMAL) =
        TextView(context).apply {
            text = value; textSize = size; setTextColor(color); typeface = Typeface.create(Typeface.DEFAULT, weight)
            includeFontPadding = false
        }
    fun icon(context: Context, resId: Int, tint: Int = secondary, size: Int = DesignTokens.space20) = ImageView(context).apply {
        setImageResource(resId)
        imageTintList = ColorStateList.valueOf(tint)
        scaleType = ImageView.ScaleType.FIT_CENTER
        layoutParams = LinearLayout.LayoutParams(dp(context, size), dp(context, size))
    }
    fun iconButton(context: Context, resId: Int, description: String, tint: Int = secondary,
        onClick: () -> Unit): FrameLayout = FrameLayout(context).apply {
        contentDescription = description
        isClickable = true; isFocusable = true
        background = shape(context, surface, DesignTokens.radius16)
        minimumWidth = dp(context, DesignTokens.space48); minimumHeight = dp(context, DesignTokens.space48)
        addView(icon(context, resId, tint), FrameLayout.LayoutParams(dp(context, DesignTokens.space20), dp(context, DesignTokens.space20), Gravity.CENTER))
        setOnClickListener { onClick() }
    }
    fun mark(context: Context, size: Int = DesignTokens.space32, softMark: Boolean = false): FrameLayout = FrameLayout(context).apply {
        background = shape(context, if (softMark) accentSoft else accent, if (size >= DesignTokens.space48) DesignTokens.radius19 else DesignTokens.radius10)
        addView(ImageView(context).apply {
            setImageResource(R.drawable.weftmate_foreground)
            imageTintList = ColorStateList.valueOf(if (softMark) accent else surface)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }, FrameLayout.LayoutParams(dp(context, size), dp(context, size), Gravity.CENTER))
    }
    fun divider(context: Context): View = View(context).apply { setBackgroundColor(line) }
}
