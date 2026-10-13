package com.memoweft.weftmate.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

internal fun nativeFileIcon(row:JSONObject):Int = when(nativeFileKind(row.optString("fileName",row.optString("name")),row.optString("contentType",row.optString("mimeType")))) {
    NativeFileKind.IMAGE -> R.drawable.wm_image;NativeFileKind.CODE -> R.drawable.wm_code
    NativeFileKind.PDF -> R.drawable.wm_book;else -> R.drawable.wm_file
}
@Composable internal fun NativeLibrary(chat:NativeChatModel,activity:NativeActivity,modifier:Modifier,onPreview:(JSONObject)->Unit) {
    NativeLibraryWebLayout(chat,activity,modifier,onPreview)
}
@Composable internal fun NativeFileLoading() {
    Column(Modifier.fillMaxWidth().padding(DesignTokens.space16.dp).semantics{contentDescription="正在读取文件"},verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
        repeat(4){Row(verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(DesignTokens.space24.dp).background(MaterialTheme.colorScheme.surfaceVariant));Spacer(Modifier.width(DesignTokens.space12.dp));Column(verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)){Box(Modifier.fillMaxWidth(0.8f).height(DesignTokens.space16.dp).background(MaterialTheme.colorScheme.surfaceVariant));Box(Modifier.fillMaxWidth(0.5f).height(DesignTokens.space8.dp).background(MaterialTheme.colorScheme.surfaceVariant))}}}
    }
}
@Composable internal fun NativeFileState(message:String,icon:Int,retry:(()->Unit)?=null) {
    Column(Modifier.fillMaxWidth().padding(DesignTokens.space24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
        Icon(painterResource(icon),null,Modifier.size(DesignTokens.space32.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        Text(message,fontSize=DesignTokens.font16.sp,lineHeight=DesignTokens.font24.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(retry!=null)OutlinedButton(onClick=retry,shape=RoundedCornerShape(DesignTokens.radius4.dp)){Text("重试")}
    }
}
