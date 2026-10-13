package com.memoweft.weftmate.mobile

import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imeAnimationTarget
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/** The editor always has the same composition identity and InputConnection. */
@Composable internal fun NativeComposerLayout(
    expanded: Boolean,
    input: @Composable () -> Unit,
    leading: @Composable () -> Unit,
    trailing: @Composable () -> Unit
) {
    Layout(content = { Box { input() }; Box { leading() }; Box { trailing() } }) { children, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val left = children[1].measure(loose)
        val right = children[2].measure(loose)
        val gap = DesignTokens.space4.dp.roundToPx()
        val width = constraints.maxWidth
        val editor = children[0].measure(loose.copy(maxWidth = if (expanded) width else (width - left.width - right.width - gap * 2).coerceAtLeast(0)))
        val tools = maxOf(left.height, right.height)
        val height = if (expanded) editor.height + tools else maxOf(editor.height, tools)
        layout(width, height) {
            editor.placeRelative(if (expanded) 0 else left.width + gap, if (expanded) 0 else (height - editor.height) / 2)
            left.placeRelative(0, if (expanded) editor.height else (height - left.height) / 2)
            right.placeRelative(width - right.width, if (expanded) editor.height else (height - right.height) / 2)
        }
    }
}

/** Read animated insets in measurement, never in the shell's composition. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun Modifier.keyboardNavigation(): Modifier {
    val ime = if(android.os.Build.VERSION.SDK_INT>=30)WindowInsets.ime else WindowInsets.imeAnimationTarget
    val navigation = WindowInsets.navigationBars
    val density = LocalDensity.current
    return clipToBounds().layout { measurable, constraints ->
        val child = measurable.measure(constraints.copy(minHeight = 0))
        val covered = (ime.getBottom(density) - navigation.getBottom(density)).coerceAtLeast(0)
        layout(child.width, (child.height - covered).coerceAtLeast(0)) { child.placeRelative(0, 0) }
    }
}
