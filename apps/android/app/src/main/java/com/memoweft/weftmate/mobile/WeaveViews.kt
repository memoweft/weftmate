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

/** Direct native mapping of MobileStyle_v1_2/source/src/tokens.json. */
object Weave {
    const val accent = 0xff2859d8.toInt()
    const val ink = 0xff1c2940.toInt()
    const val secondary = 0xff56657b.toInt()
    const val muted = 0xff64748a.toInt()
    const val canvas = 0xfff3f5fa.toInt()
    const val surface = Color.WHITE
    const val soft = 0xfff7f9fd.toInt()
    const val accentSoft = 0xffeaf0ff.toInt()
    const val line = 0xffe4e9f2.toInt()
    const val lineStrong = 0xffcdd7e7.toInt()
    const val danger = 0xffbf374d.toInt()
    const val overlay = 0x4718263e

    fun dp(context: Context, value: Int): Int = (context.resources.displayMetrics.density * value).toInt()
    fun shape(context: Context, color: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(context, radius).toFloat()
        if (stroke != null) setStroke(dp(context, 1), stroke)
    }
    fun topSheet(context: Context, color: Int = surface) = GradientDrawable().apply {
        setColor(color)
        val radius = dp(context, 32).toFloat()
        cornerRadii = floatArrayOf(radius, radius, radius, radius, 0f, 0f, 0f, 0f)
    }
    fun drawer(context: Context) = GradientDrawable().apply {
        setColor(surface)
        val radius = dp(context, 32).toFloat()
        cornerRadii = floatArrayOf(0f, 0f, radius, radius, radius, radius, 0f, 0f)
    }
    fun text(context: Context, value: String, size: Float = 14f, color: Int = ink, weight: Int = Typeface.NORMAL) =
        TextView(context).apply {
            text = value; textSize = size; setTextColor(color); typeface = Typeface.create(Typeface.DEFAULT, weight)
            includeFontPadding = false
        }
    fun icon(context: Context, resId: Int, tint: Int = secondary, size: Int = 20) = ImageView(context).apply {
        setImageResource(resId)
        imageTintList = ColorStateList.valueOf(tint)
        scaleType = ImageView.ScaleType.FIT_CENTER
        layoutParams = LinearLayout.LayoutParams(dp(context, size), dp(context, size))
    }
    fun iconButton(context: Context, resId: Int, description: String, tint: Int = secondary,
        onClick: () -> Unit): FrameLayout = FrameLayout(context).apply {
        contentDescription = description
        isClickable = true; isFocusable = true
        background = shape(context, surface, 16)
        minimumWidth = dp(context, 48); minimumHeight = dp(context, 48)
        addView(icon(context, resId, tint), FrameLayout.LayoutParams(dp(context, 20), dp(context, 20), Gravity.CENTER))
        setOnClickListener { onClick() }
    }
    fun mark(context: Context, size: Int = 32, softMark: Boolean = false): FrameLayout = FrameLayout(context).apply {
        background = shape(context, if (softMark) accentSoft else accent, if (size >= 48) 19 else 10)
        addView(ImageView(context).apply {
            setImageResource(R.drawable.weftmate_foreground)
            imageTintList = ColorStateList.valueOf(if (softMark) accent else surface)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }, FrameLayout.LayoutParams(dp(context, size), dp(context, size), Gravity.CENTER))
    }
    fun divider(context: Context): View = View(context).apply { setBackgroundColor(line) }
}
