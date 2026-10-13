package com.memoweft.weftmate.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Shared AND-4 GPU backdrop; only the panel is blurred, never the page or system bars. */
@Composable internal fun NativeFileMenu(expanded:Boolean,onDismiss:()->Unit,content:@Composable ColumnScope.()->Unit) {
    val shape=RoundedCornerShape(DesignTokens.radius12.dp)
    DropdownMenu(expanded,onDismiss,modifier=Modifier.nativeFrost(shape,floating=true),shape=shape,
        containerColor=Color.Transparent,tonalElevation=0.dp,content=content)
}

@Composable internal fun NativeFileMenuAction(label:String,icon:Int,enabled:Boolean=true,onClick:()->Unit) {
    DropdownMenuItem(text={Text(label,fontSize=((DesignTokens.font14+DesignTokens.font16)/2).sp,fontWeight=FontWeight.Medium)},
        leadingIcon={Icon(painterResource(icon),null,Modifier.size((DesignTokens.space24-DesignTokens.space2).dp))},
        modifier=Modifier.height(DesignTokens.space44.dp),enabled=enabled,onClick=onClick,
        colors=MenuDefaults.itemColors(disabledTextColor=MaterialTheme.colorScheme.onSurface.copy(alpha=.45f),disabledLeadingIconColor=MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha=.45f)))
}

@Composable internal fun NativeFileIconButton(icon:Int,label:String,modifier:Modifier=Modifier,enabled:Boolean=true,action:()->Unit) {
    val source=remember{MutableInteractionSource()}
    val pressed by source.collectIsPressedAsState()
    IconButton(onClick=action,enabled=enabled,interactionSource=source,
        modifier=modifier.size(DesignTokens.space44.dp).graphicsLayer{scaleX=if(pressed).97f else 1f;scaleY=scaleX},
        colors=IconButtonDefaults.iconButtonColors(contentColor=MaterialTheme.colorScheme.onSurfaceVariant,disabledContentColor=MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha=.45f))) {
        Icon(painterResource(icon),label,Modifier.size((DesignTokens.space24-DesignTokens.space2).dp))
    }
}
