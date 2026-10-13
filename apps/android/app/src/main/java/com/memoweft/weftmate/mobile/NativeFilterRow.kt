package com.memoweft.weftmate.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** All page filters stay one row. Overflow scrolls instead of changing control type. */
@Composable internal fun NativeFilterRow(label:String,options:List<Pair<String,String>>,value:String,enabled:Boolean=true,choose:(String)->Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).selectableGroup().semantics{contentDescription=label},horizontalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)) {
        options.forEach{(id,name)->
            val interactions=remember{MutableInteractionSource()};val pressed by interactions.collectIsPressedAsState();val hovered by interactions.collectIsHoveredAsState();val focused by interactions.collectIsFocusedAsState()
            val selected=id==value;val shape=RoundedCornerShape(DesignTokens.radius999.dp)
            Box(Modifier.height(DesignTokens.space44.dp).widthIn(min=DesignTokens.space44.dp).graphicsLayer{scaleX=if(pressed).97f else 1f;scaleY=scaleX;alpha=if(enabled)1f else .45f}
                .then(if(focused)Modifier.border(DesignTokens.space2.dp,MaterialTheme.colorScheme.primary,shape) else Modifier).clip(shape)
                .background(if(selected)MaterialTheme.colorScheme.primaryContainer else if(pressed||hovered)MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
                .selectable(selected,interactionSource=interactions,indication=null,enabled=enabled,role=Role.Tab,onClick={choose(id)}).padding(horizontal=DesignTokens.space12.dp),contentAlignment=Alignment.Center){Text(name,fontSize=DesignTokens.font15.sp,color=if(selected)MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)}
        }
    }
}
