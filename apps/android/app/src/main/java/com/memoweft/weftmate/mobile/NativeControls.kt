package com.memoweft.weftmate.mobile

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.layout.layout
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.LocalDate

internal val LocalReadingSize=staticCompositionLocalOf { DesignTokens.font15 }
internal val LocalCodeSize=staticCompositionLocalOf { DesignTokens.font13 }

internal val nativeGap = DesignTokens.space8.dp
internal val nativePad = DesignTokens.space16.dp
internal val nativeTouch = DesignTokens.space44.dp
internal val nativePill = RoundedCornerShape(DesignTokens.radius26.dp)
internal val nativeCard = RoundedCornerShape(DesignTokens.radius16.dp)
internal val nativeBubble = RoundedCornerShape(DesignTokens.radius26.dp)

@Composable internal fun NativeTheme(dark: Boolean, content: @Composable () -> Unit) {
    val accent=Color(if(dark)DesignTokens.nativeDarkAccent else DesignTokens.nativeAccent)
    val surface=Color(if(dark)DesignTokens.nativeDarkSurface else DesignTokens.nativeSurface)
    val ink=Color(if(dark)DesignTokens.nativeDarkInk else DesignTokens.nativeInk)
    val soft=Color(if(dark)DesignTokens.nativeDarkSoft else DesignTokens.nativeSoft)
    val accentSoft=Color(if(dark)DesignTokens.nativeDarkAccentSoft else DesignTokens.nativeAccentSoft)
    val secondary=Color(if(dark)DesignTokens.nativeDarkSecondary else DesignTokens.nativeSecondary)
    val line=Color(if(dark)DesignTokens.nativeDarkLine else DesignTokens.nativeLine)
    val danger=Color(if(dark)DesignTokens.nativeDarkDanger else DesignTokens.nativeDanger)
    val dangerSoft=Color(if(dark)DesignTokens.nativeDarkDangerSoft else DesignTokens.nativeDangerSoft)
    val canvas=Color(if(dark)DesignTokens.nativeDarkCanvas else DesignTokens.nativeSurface)
    val onAccent=Color(if(dark)DesignTokens.nativeDarkOnAccent else DesignTokens.nativeOnAccent)
    val c = (if(dark)darkColorScheme() else lightColorScheme()).copy(primary=accent,onPrimary=onAccent,primaryContainer=accentSoft,onPrimaryContainer=ink,
        secondary=accent,onSecondary=onAccent,secondaryContainer=accentSoft,onSecondaryContainer=ink,tertiary=accent,onTertiary=onAccent,tertiaryContainer=accentSoft,onTertiaryContainer=ink,
        background=canvas,onBackground=ink,surface=surface,onSurface=ink,surfaceVariant=soft,onSurfaceVariant=secondary,outline=line,outlineVariant=line,error=danger,onError=surface,errorContainer=dangerSoft,onErrorContainer=danger,
        surfaceTint=surface,surfaceBright=surface,surfaceDim=soft,surfaceContainer=surface,surfaceContainerLow=surface,surfaceContainerLowest=surface,surfaceContainerHigh=soft,surfaceContainerHighest=soft,
        inverseSurface=ink,inverseOnSurface=surface,inversePrimary=surface,scrim=Color(if(dark)DesignTokens.nativeDarkOverlay else DesignTokens.nativeOverlay))
    MaterialTheme(colorScheme=c,typography=Typography(labelLarge=TextStyle(fontSize=DesignTokens.font15.sp,lineHeight=DesignTokens.space20.sp,fontWeight=FontWeight.Medium))) { CompositionLocalProvider(LocalContentColor provides c.onSurface,LocalNativeDark provides dark,content=content) }
}
@Composable internal fun NativeIconButton(icon: Int, label: String, modifier: Modifier = Modifier, solid: Boolean = false, selected: Boolean = false, enabled: Boolean = true, compact: Boolean = false, action: () -> Unit) {
    val c=MaterialTheme.colorScheme
    val interaction=remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    IconButton(onClick=action,enabled=enabled,interactionSource=interaction,modifier=modifier.size(nativeTouch).graphicsLayer { scaleX=if(pressed).97f else 1f;scaleY=scaleX }.alpha(if(enabled)1f else .45f).clip(CircleShape).background(if(solid)c.primary else if(pressed)c.surfaceVariant else if(selected)Color(if(LocalNativeDark.current)DesignTokens.nativeDarkSelectedOnSoft else DesignTokens.nativeSelectedOnSoft) else Color.Transparent)) {
        Icon(painterResource(icon),label,Modifier.size(if(compact)DesignTokens.space16.dp else DesignTokens.iconTouch.dp),tint=if(solid)c.onPrimary else if(selected)c.onSurface else c.onSurfaceVariant)
    }
}
@Composable internal fun NativeDialogBars() {
        val view=LocalView.current
        val light=MaterialTheme.colorScheme.surface.red > 0.5f
        SideEffect { (view.parent as? DialogWindowProvider)?.window?.let { window ->
            window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window.statusBarColor=android.graphics.Color.TRANSPARENT
            window.navigationBarColor=android.graphics.Color.TRANSPARENT
            androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window,false)
            if(android.os.Build.VERSION.SDK_INT>=29){window.isStatusBarContrastEnforced=false;window.isNavigationBarContrastEnforced=false}
            androidx.core.view.WindowCompat.getInsetsController(window,view).apply { isAppearanceLightStatusBars=light;isAppearanceLightNavigationBars=light }
        } }
}


@Composable internal fun nativeRadioColors()=RadioButtonDefaults.colors(selectedColor=MaterialTheme.colorScheme.primary,unselectedColor=Color(if(LocalNativeDark.current)DesignTokens.nativeDarkMuted else DesignTokens.nativeMuted))
@Composable internal fun NativePrimary(onClick:()->Unit,modifier:Modifier=Modifier,enabled:Boolean=true,shape:androidx.compose.ui.graphics.Shape=nativePill,content:@Composable RowScope.()->Unit) {
    Button(onClick,modifier.height(nativeTouch).alpha(if(enabled)1f else .45f),enabled=enabled,shape=shape,colors=ButtonDefaults.buttonColors(disabledContainerColor=MaterialTheme.colorScheme.primary,disabledContentColor=MaterialTheme.colorScheme.onPrimary),contentPadding=PaddingValues(horizontal=DesignTokens.space18.dp),content=content)
}
@Composable internal fun NativeSecondary(onClick:()->Unit,modifier:Modifier=Modifier,enabled:Boolean=true,shape:androidx.compose.ui.graphics.Shape=nativePill,content:@Composable RowScope.()->Unit) {
    OutlinedButton(onClick,modifier.height(nativeTouch).alpha(if(enabled)1f else .45f),enabled=enabled,shape=shape,colors=ButtonDefaults.outlinedButtonColors(containerColor=MaterialTheme.colorScheme.surface,contentColor=MaterialTheme.colorScheme.onSurfaceVariant,disabledContainerColor=MaterialTheme.colorScheme.surface,disabledContentColor=MaterialTheme.colorScheme.onSurfaceVariant),contentPadding=PaddingValues(horizontal=DesignTokens.space18.dp),content=content)
}
@Composable internal fun NativeMenu(expanded:Boolean,onDismissRequest:()->Unit,keepEditorFocus:Boolean=false,content:@Composable ColumnScope.()->Unit) {
    DropdownMenu(expanded,onDismissRequest,properties=PopupProperties(focusable=!keepEditorFocus),modifier=Modifier.nativeFrost(RoundedCornerShape(DesignTokens.radius12.dp),floating=true),containerColor=Color.Transparent,tonalElevation=0.dp,shape=RoundedCornerShape(DesignTokens.radius12.dp),content=content)
}

@Composable internal fun NativeMenuItem(text:@Composable ()->Unit,onClick:()->Unit,leadingIcon:(@Composable ()->Unit)?=null,trailingIcon:(@Composable ()->Unit)?=null,enabled:Boolean=true) {
    DropdownMenuItem(text={ProvideTextStyle(MaterialTheme.typography.labelLarge,content=text)},onClick=onClick,modifier=Modifier.height(nativeTouch),leadingIcon=leadingIcon,trailingIcon=trailingIcon,enabled=enabled,contentPadding=PaddingValues(horizontal=DesignTokens.space18.dp))
}
