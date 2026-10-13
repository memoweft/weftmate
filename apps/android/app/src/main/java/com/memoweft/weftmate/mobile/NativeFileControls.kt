package com.memoweft.weftmate.mobile

import android.os.Build
import android.view.WindowManager
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Panel-only tokens copied from controls-spec/tokens.json. Shared page palette remains AND-4's.
internal object NativeFileControlTokens {
    const val lightFloat = 0xffffffff.toInt()
    const val darkFloat = 0xbd2c2c2e.toInt()
}

/** Only floating popup windows blur; scrolling rows and decoded file pages never do. */
@Composable internal fun NativeFileMenu(expanded:Boolean,onDismiss:()->Unit,content:@Composable ColumnScope.()->Unit) {
    val colors=MaterialTheme.colorScheme
    val dark=colors.surface.luminance()<0.5f
    val float=Color(if(dark)NativeFileControlTokens.darkFloat else NativeFileControlTokens.lightFloat)
    val background=if(Build.VERSION.SDK_INT>=31)float else float.compositeOver(Color(if(dark)DesignTokens.nativeDarkCanvas else DesignTokens.nativeCanvas))
    DropdownMenu(expanded,onDismiss,shape=RoundedCornerShape(DesignTokens.radius12.dp),containerColor=background) {
        val view=LocalView.current
        DisposableEffect(view) {
            // Compose's popup owns this root. Do not change the activity or global emulator window.
            val root=view.rootView
            val params=root.layoutParams as? WindowManager.LayoutParams
            val manager=view.context.getSystemService(WindowManager::class.java)
            val originalFlags=params?.flags
            val originalRadius=if(Build.VERSION.SDK_INT>=31)params?.blurBehindRadius else null
            if(Build.VERSION.SDK_INT>=31 && params!=null) {
                params.flags=params.flags or WindowManager.LayoutParams.FLAG_BLUR_BEHIND
                params.blurBehindRadius=(DesignTokens.space24*view.resources.displayMetrics.density).toInt()
                runCatching{manager.updateViewLayout(root,params)}
            }
            onDispose {
                if(Build.VERSION.SDK_INT>=31 && params!=null && originalFlags!=null) {
                    params.flags=originalFlags;params.blurBehindRadius=originalRadius ?: 0
                    runCatching{manager.updateViewLayout(root,params)}
                }
            }
        }
        content()
    }
}

@Composable internal fun NativeFileMenuAction(label:String,icon:Int,enabled:Boolean=true,onClick:()->Unit) {
    DropdownMenuItem(text={Text(label,fontSize=((DesignTokens.font14+DesignTokens.font16)/2).sp,fontWeight=FontWeight.Medium)},
        leadingIcon={Icon(painterResource(icon),null,Modifier.size((DesignTokens.space24-DesignTokens.space2).dp))},
        modifier=Modifier.heightIn(min=DesignTokens.space44.dp),enabled=enabled,onClick=onClick)
}
