package com.memoweft.weftmate.mobile

import android.os.Build
import androidx.compose.runtime.*
import androidx.compose.foundation.background
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

/** GPU display list only: no bitmap readback and no blur on message text or controls. */
internal class NativeFrost(val layer: GraphicsLayer) {
    var paused by mutableStateOf(false)
    var keyboardAnimating by mutableStateOf(false)
    var revision = 0
    var origin = Offset.Zero
    // Display-list dependencies carry updates to the GPU. A snapshot write on every
    // draw would itself schedule another draw and keep an idle chat rendering forever.
    var frame = 0
}
internal val LocalNativeFrost = staticCompositionLocalOf<NativeFrost?> { null }
internal val LocalNativeDark = staticCompositionLocalOf { false }

internal fun Modifier.frostSource(source: NativeFrost) = composed {
    val view = LocalView.current
    val enabled = LocalNativeDark.current && Build.VERSION.SDK_INT >= 31
    if(!enabled)return@composed this
    this.onGloballyPositioned { coordinates ->
        val location = IntArray(2); view.getLocationOnScreen(location)
        source.origin = coordinates.positionInRoot() + Offset(location[0].toFloat(), location[1].toFloat())
    }.drawWithContent {
        if(enabled && !source.paused && !source.keyboardAnimating) {
            source.layer.record { this@drawWithContent.drawContent() }
            drawLayer(source.layer)
            source.frame = ++source.revision
        } else drawContent()
    }
}

/** Only fixed chrome/popup backgrounds sample the conversation layer. API 26–30 use composites. */
internal fun Modifier.nativeFrost(shape: Shape, floating: Boolean = false) = composed {
    val dark = LocalNativeDark.current
    val source = LocalNativeFrost.current
    val tint = Color(if (dark) {
        if (floating) DesignTokens.nativeDarkSurfaceFloat else DesignTokens.nativeDarkSoft
    } else if (floating) DesignTokens.nativeSurfaceFloat else DesignTokens.nativeSoft)
    val fallback = Color(if (dark) {
        if (floating) DesignTokens.nativeDarkFloatOpaque else DesignTokens.nativeDarkSoftOpaque
    } else if (floating) DesignTokens.nativeSurfaceFloat else DesignTokens.nativeSoft)
    if(!dark || Build.VERSION.SDK_INT < 31 || source==null)return@composed this.clip(shape).background(fallback)
    val layer = rememberGraphicsLayer()
    val view = LocalView.current
    var origin by remember { mutableStateOf(Offset.Zero) }
    this.clip(shape).onGloballyPositioned { coordinates ->
        val location = IntArray(2); view.getLocationOnScreen(location)
        origin = coordinates.positionInRoot() + Offset(location[0].toFloat(), location[1].toFloat())
    }.drawWithContent {
        if (!source.paused && !source.keyboardAnimating && source.frame > 0) {
            val delta = source.origin - origin
            layer.renderEffect = BlurEffect(DesignTokens.frostRadius.dp.toPx(), DesignTokens.frostRadius.dp.toPx(), TileMode.Clamp)
            layer.record(size = IntSize(size.width.toInt(), size.height.toInt())) {
                // An opaque backdrop prevents the original sharp text underneath
                // the sampled display list from showing through the blurred layer.
                drawRect(Color(DesignTokens.nativeDarkCanvas))
                translate(delta.x, delta.y) { drawLayer(source.layer) }
            }
            drawLayer(layer)
            drawRect(tint)
        } else drawRect(fallback)
        drawContent()
    }
}
