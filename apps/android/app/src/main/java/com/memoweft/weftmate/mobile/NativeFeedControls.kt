package com.memoweft.weftmate.mobile

import android.os.Build
import android.view.View
import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import java.util.function.Consumer

private val controlHeight = DesignTokens.space44.dp
private val controlIcon = ((DesignTokens.space20 + DesignTokens.space24) / 2).dp
private val controlLabel = ((DesignTokens.font14 + DesignTokens.font16) / 2).sp
private val controlShape = RoundedCornerShape(DesignTokens.radius999.dp)

/** Quiet or secondary action: shared touch size, feedback and keyboard focus. */
@Composable internal fun FeedControlButton(
    label: String,
    enabled: Boolean = true,
    icon: Int? = null,
    modifier: Modifier = Modifier,
    softColor: Color = MaterialTheme.colorScheme.surfaceVariant,
    inkSecondary: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    trailingIcon: Int? = null,
    contentDescription: String? = null,
    secondary: Boolean = false,
    primary: Boolean = false,
    danger: Boolean = false,
    choice: Boolean = false,
    loading: Boolean = false,
    action: () -> Unit
) {
    val semantics = if (contentDescription == null) Modifier else Modifier.semantics { this.contentDescription = contentDescription }
    FeedControlSurface(enabled, modifier.then(semantics).height(controlHeight), controlShape,
        if (danger) MaterialTheme.colorScheme.errorContainer else if (primary) MaterialTheme.colorScheme.primary else if (secondary) MaterialTheme.colorScheme.surface else Color.Transparent,
        softColor, MaterialTheme.colorScheme.primary, action,
        borderColor = if (secondary && !primary && !danger) MaterialTheme.colorScheme.outline else null) { active ->
        Row((if(choice) Modifier.fillMaxWidth() else Modifier).padding(horizontal = ((DesignTokens.space16 + DesignTokens.space20) / 2).dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.space8.dp)) {
            val ink = if (danger) MaterialTheme.colorScheme.error else if (primary && !active) MaterialTheme.colorScheme.onPrimary else if (active || secondary) MaterialTheme.colorScheme.onSurface else inkSecondary
            if (loading) androidx.compose.material3.CircularProgressIndicator(Modifier.size(controlIcon), color = ink, strokeWidth = DesignTokens.space2.dp)
            if (icon != null) Icon(painterResource(icon), null, Modifier.size(controlIcon), tint = ink)
            Text(label, modifier=if(choice)Modifier.weight(1f) else Modifier, fontSize = controlLabel, lineHeight = DesignTokens.space20.sp, fontWeight = FontWeight.Medium,
                color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (trailingIcon != null) Icon(painterResource(trailingIcon), null, Modifier.size(controlIcon), tint = ink)
        }
    }
}

/** The readable name is semantics only; fixed floating controls sample the shared frost. */
@Composable internal fun FeedControlIconButton(
    icon: Int,
    label: String,
    enabled: Boolean = true,
    floating: Boolean = false,
    compact: Boolean = false,
    modifier: Modifier = Modifier,
    softColor: Color = MaterialTheme.colorScheme.surfaceVariant,
    inkSecondary: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    action: () -> Unit
) {
    // Compact is kept for caller compatibility; all tool glyphs now share icon-touch (22).
    @Suppress("UNUSED_VARIABLE") val sharedTouchGlyph = compact
    FeedControlSurface(enabled, modifier.size(controlHeight).semantics { contentDescription = label }, controlShape,
        Color.Transparent, softColor, MaterialTheme.colorScheme.primary, action, frosted = floating) { active ->
        Icon(painterResource(icon), null, Modifier.size(controlIcon), tint = if (active) MaterialTheme.colorScheme.onSurface else inkSecondary)
    }
}

@Composable private fun FeedControlSurface(
    enabled: Boolean,
    modifier: Modifier,
    shape: RoundedCornerShape,
    baseColor: Color,
    feedbackColor: Color,
    focusColor: Color,
    action: () -> Unit,
    borderColor: Color? = null,
    frosted: Boolean = false,
    content: @Composable BoxScope.(Boolean) -> Unit
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val hovered by interactions.collectIsHoveredAsState()
    val focused by interactions.collectIsFocusedAsState()
    val active = enabled && (pressed || hovered)
    Box(modifier
        .graphicsLayer { scaleX = if (enabled && pressed) .97f else 1f; scaleY = scaleX; alpha = if (enabled) 1f else .45f }
        .drawWithContent {
            drawContent()
            if (borderColor != null) {
                val stroke = DesignTokens.space1.dp.toPx()
                val inset = stroke / 2
                val radius = (shape.topStart.toPx(size, this) - inset).coerceAtLeast(0f)
                drawRoundRect(borderColor, Offset(inset, inset), Size(size.width - stroke, size.height - stroke),
                    CornerRadius(radius), style = Stroke(stroke))
            }
            if (enabled && focused) {
                val stroke = DesignTokens.space2.dp.toPx()
                val outset = DesignTokens.space2.dp.toPx() + stroke / 2
                val radius = shape.topStart.toPx(size, this)
                drawRoundRect(focusColor, Offset(-outset, -outset), Size(size.width + outset * 2, size.height + outset * 2),
                    CornerRadius(radius + outset), style = Stroke(stroke))
            }
        }
        // The parent's frost modifier paints the soft tint exactly once, with an
        // opaque generated-token fallback. Keep the focus ring outside its clip.
        .then(if (frosted) Modifier.nativeFrost(shape) else Modifier)
        .background(if (active) feedbackColor else baseColor, shape)
        .clickable(interactionSource = interactions, indication = null, enabled = enabled, role = Role.Button, onClick = action),
        contentAlignment = Alignment.Center) { content(active) }
}

/** Caller puts destructive entries last; the shared separator belongs to the danger item. */
@Composable internal fun FeedControlMenuItem(
    label: String,
    enabled: Boolean = true,
    danger: Boolean = false,
    icon: Int? = null,
    modifier: Modifier = Modifier,
    softColor: Color = MaterialTheme.colorScheme.surfaceVariant,
    dangerSoftColor: Color = MaterialTheme.colorScheme.surfaceVariant,
    checked: Boolean? = null,
    action: () -> Unit
) {
    if (danger) Box(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space4.dp, vertical = DesignTokens.space5.dp)
        .height(DesignTokens.space1.dp).background(MaterialTheme.colorScheme.outline))
    val ink = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    val selection = if (checked == null) Modifier else Modifier.semantics { selected = checked }
    FeedControlSurface(enabled, modifier.then(selection).fillMaxWidth().height(controlHeight), RoundedCornerShape(DesignTokens.radius12.dp),
        Color.Transparent, if (danger) dangerSoftColor else softColor, MaterialTheme.colorScheme.primary, action) { _ ->
        Row(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space10.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(DesignTokens.space10.dp)) {
            if (checked == null && icon != null) Icon(painterResource(icon), null, Modifier.size(controlIcon), tint = ink)
            Text(label, Modifier.weight(1f), fontSize = controlLabel, lineHeight = DesignTokens.space20.sp,
                fontWeight = FontWeight.Medium, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (checked == true) Icon(painterResource(R.drawable.wm_check), null, Modifier.size(controlIcon), tint = ink)
        }
    }
}

/** Anchored, focusable menu. Only this Popup's window receives the optional blur flag. */
@Composable internal fun FeedControlMenu(
    expanded: Boolean,
    dismiss: () -> Unit,
    modifier: Modifier = Modifier,
    dark: Boolean = MaterialTheme.colorScheme.surface.luminance() < .5f,
    floatColor: Color = MaterialTheme.colorScheme.surface,
    fallbackColor: Color = MaterialTheme.colorScheme.surface.copy(alpha = 1f),
    content: @Composable ColumnScope.() -> Unit
) {
    if (!expanded) return
    val density = LocalDensity.current
    val maxHeight = (LocalConfiguration.current.screenHeightDp - DesignTokens.space48 * 2).coerceAtLeast(DesignTokens.space44).dp
    val position = remember(density) { FeedControlMenuPosition(with(density) { DesignTokens.space8.dp.roundToPx() }) }
    Popup(popupPositionProvider = position, onDismissRequest = dismiss, properties = PopupProperties(focusable = true)) {
        val blurEnabled = FeedPopupBlur(dark)
        val shape = RoundedCornerShape(DesignTokens.radius12.dp)
        // No opaque Material surface is laid over the supplied frosted float color.
        androidx.compose.material3.Surface(modifier = modifier.width(IntrinsicSize.Max).widthIn(min = (DesignTokens.space220 + DesignTokens.space12).dp),
            shape = shape, color = if (blurEnabled) floatColor else fallbackColor, contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = 0.dp, shadowElevation = DesignTokens.space8.dp,
            border = androidx.compose.foundation.BorderStroke(DesignTokens.space1.dp, MaterialTheme.colorScheme.outline)) {
            Column(Modifier.heightIn(max = maxHeight).verticalScroll(rememberScrollState()).padding(DesignTokens.space6.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.space1.dp), content = content)
        }
    }
}

private class FeedControlMenuPosition(private val margin: Int) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
        val start = if (layoutDirection == LayoutDirection.Ltr) anchorBounds.left else anchorBounds.right - popupContentSize.width
        val end = if (layoutDirection == LayoutDirection.Ltr) anchorBounds.right - popupContentSize.width else anchorBounds.left
        val maxX = (windowSize.width - popupContentSize.width - margin).coerceAtLeast(margin)
        val x = when { start in margin..maxX -> start; end in margin..maxX -> end; else -> start.coerceIn(margin, maxX) }
        val maxY = (windowSize.height - popupContentSize.height - margin).coerceAtLeast(margin)
        val below = anchorBounds.bottom
        val above = anchorBounds.top - popupContentSize.height
        val y = when { below in margin..maxY -> below; above in margin..maxY -> above; else -> below.coerceIn(margin, maxY) }
        return IntOffset(x, y)
    }
}

/** Android 12 cross-window blur softens the screen behind the Popup, never its text.
 * It intentionally does not call Window#setBackgroundBlurRadius on the Activity.
 * FLAG_BLUR_BEHIND's scope is the whole screen behind this menu, not just its rectangle.
 */
@Composable private fun FeedPopupBlur(dark: Boolean): Boolean {
    var enabled by remember { mutableStateOf(false) }
    val view = LocalView.current
    val context = LocalContext.current
    val radius = with(LocalDensity.current) { controlIcon.roundToPx() }
    DisposableEffect(view, dark, radius) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !dark) {
            enabled = false
            onDispose { }
        } else {
            val manager = context.getSystemService(WindowManager::class.java)
            var popupRoot: View? = null
            var originalBlurFlag = 0
            var originalRadius = 0
            var registered = false
            fun apply(available: Boolean) {
                val root = popupRoot ?: return
                val params = root.layoutParams as? WindowManager.LayoutParams ?: return
                params.flags = if (available) params.flags or WindowManager.LayoutParams.FLAG_BLUR_BEHIND
                    else (params.flags and WindowManager.LayoutParams.FLAG_BLUR_BEHIND.inv()) or originalBlurFlag
                params.setBlurBehindRadius(if (available) radius else originalRadius)
                enabled = if (root.isAttachedToWindow) runCatching { manager.updateViewLayout(root, params); available }.getOrDefault(false) else false
            }
            val consumer = Consumer<Boolean> { apply(it) }
            fun attach() {
                val root = view.rootView
                val params = root.layoutParams as? WindowManager.LayoutParams ?: return
                // Only standalone Popup roots have these params; never touch an Activity DecorView.
                if (root === context.activityDecorView()) return
                popupRoot = root
                originalBlurFlag = params.flags and WindowManager.LayoutParams.FLAG_BLUR_BEHIND
                originalRadius = params.blurBehindRadius
                if (!registered) { manager.addCrossWindowBlurEnabledListener(context.mainExecutor, consumer); registered = true }
                apply(manager.isCrossWindowBlurEnabled)
            }
            fun restore() {
                if (registered) { manager.removeCrossWindowBlurEnabledListener(consumer); registered = false }
                popupRoot?.let { root ->
                    (root.layoutParams as? WindowManager.LayoutParams)?.let { params ->
                        params.flags = (params.flags and WindowManager.LayoutParams.FLAG_BLUR_BEHIND.inv()) or originalBlurFlag
                        params.setBlurBehindRadius(originalRadius)
                        if (root.isAttachedToWindow) runCatching { manager.updateViewLayout(root, params) }
                    }
                }
                popupRoot = null
                enabled = false
            }
            val listener = object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(v: View) = attach()
                override fun onViewDetachedFromWindow(v: View) = restore()
            }
            view.addOnAttachStateChangeListener(listener)
            if (view.isAttachedToWindow) attach()
            onDispose { view.removeOnAttachStateChangeListener(listener); restore() }
        }
    }
    return enabled
}

private fun android.content.Context.activityDecorView(): View? = when (this) {
    is android.app.Activity -> window.decorView
    is android.content.ContextWrapper -> if (baseContext === this) null else baseContext.activityDecorView()
    else -> null
}
