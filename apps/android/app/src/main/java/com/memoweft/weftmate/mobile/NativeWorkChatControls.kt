package com.memoweft.weftmate.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable internal fun NativeConversationModes(m: NativeChatModel) {
    val shape = RoundedCornerShape(DesignTokens.radius999.dp)
    Row(Modifier.fillMaxWidth().padding(horizontal=DesignTokens.space20.dp).clip(shape)
        .background(MaterialTheme.colorScheme.surfaceVariant).selectableGroup().semantics { contentDescription="对话模式" }) {
        for ((id,label,icon) in listOf(Triple("chat","对话",R.drawable.wm_chat),Triple("work","工作",R.drawable.wm_folder))) {
            val selected = m.sidebarMode == id
            FeedControlSurface(true,Modifier.weight(1f).height(DesignTokens.space44.dp).semantics { contentDescription=label;this.selected=selected },shape,
                if(selected)Color(if(LocalNativeDark.current)DesignTokens.nativeDarkSelectedOnSoft else DesignTokens.nativeSelectedOnSoft) else Color.Transparent,
                MaterialTheme.colorScheme.surfaceVariant,MaterialTheme.colorScheme.primary,{m.chooseSidebarMode(id)},
                borderColor=if(selected)MaterialTheme.colorScheme.outline else null,role=Role.Tab) {
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp,Alignment.CenterHorizontally),verticalAlignment=Alignment.CenterVertically) {
                    Icon(painterResource(icon),null,Modifier.size(DesignTokens.iconTouch.dp))
                    Text(label,fontSize=DesignTokens.font14.sp,color=if(selected)MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable internal fun NativeWorkSelection(m: NativeChatModel) {
    var computerMenu by remember { mutableStateOf(false) }
    var projectMenu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal=DesignTokens.space12.dp).semantics { contentDescription="工作电脑与文件夹" }) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
            if (m.computers.count { it.optBoolean("online") } != 1 || !m.newWork) Box(Modifier.weight(1f)) {
                FeedControlButton(m.hostName,icon=R.drawable.wm_pc,trailingIcon=R.drawable.wm_down,choice=true,
                    enabled=m.newWork && !m.workChoicesBusy,contentDescription="电脑：${m.hostName}"){computerMenu=true}
                NativeFileMenu(computerMenu,{computerMenu=false}) { m.computers.forEach { computer ->
                    val label=computer.stringOrEmpty("displayName").ifEmpty{computer.stringOrEmpty("name")}
                    FeedControlMenuItem(if(computer.optBoolean("online"))label else "$label · 不在线",enabled=computer.optBoolean("online"),checked=computer.stringOrEmpty("hostId")==m.hostId) {
                        computerMenu=false;m.chooseWorkComputer(computer.getString("hostId"))
                    }
                } }
            }
            Box(Modifier.weight(1f)) {
                val label=m.workProject?.stringOrEmpty("name")?.ifEmpty{null} ?: "选择项目或文件夹"
                FeedControlButton(label,icon=R.drawable.wm_folder,trailingIcon=R.drawable.wm_down,choice=true,
                    contentDescription="项目或文件夹：$label",enabled=m.connected && !m.running && !m.workChoicesBusy){projectMenu=true;m.launch{m.refreshWorkChoices(false)}}
                NativeFileMenu(projectMenu,{projectMenu=false}) {
                    m.projects.forEach { project ->
                        FeedControlMenuItem(project.stringOrEmpty("name"),enabled=!m.workChoicesBusy,checked=project.stringOrEmpty("projectId")==m.workProject?.stringOrEmpty("projectId")){projectMenu=false;m.chooseWorkProject(project)}
                    }
                    if(m.projects.isEmpty())NativeFileMenuAction(if(m.workChoicesBusy)"正在读取项目…" else "还没有项目或文件夹",R.drawable.wm_folder,false){}
                    NativeFileMenuAction("新文件夹请在电脑上添加",R.drawable.wm_pc,false){}
                    NativeFileMenuAction("重新读取项目",R.drawable.wm_sync,!m.workChoicesBusy){m.launch{m.refreshWorkChoices(false)}}
                }
            }
        }
        val hint=if(!m.connected)"这段工作所在的电脑不在线，连接后可继续。" else m.workChoicesError.ifEmpty { if(m.workProject==null)"选好项目或文件夹，就能开始工作。" else "" }
        if(hint.isNotEmpty())Text(hint,Modifier.padding(horizontal=DesignTokens.space16.dp,vertical=DesignTokens.space4.dp),fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable internal fun NativeWorkSwitch(m: NativeChatModel, row: JSONObject) {
    val approvalId=row.getString("approvalId")
    LaunchedEffect(approvalId){m.refreshWorkChoices(false)}
    var selected by remember(approvalId) { mutableStateOf("") }
    LaunchedEffect(m.projects.toString()) { if(m.projects.none{it.stringOrEmpty("projectId")==selected})selected=m.projects.firstOrNull()?.stringOrEmpty("projectId").orEmpty() }
    val pending=row.optJSONObject("nativeDecision")
    decisionReceipt(row)?.let { Text(if(row.stringOrEmpty("decisionOutcome")=="rejected")"已选择先不用" else "已切换到工作",fontSize=DesignTokens.font13.sp);return }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(DesignTokens.radius16.dp)).background(MaterialTheme.colorScheme.surface)
        .padding(DesignTokens.space16.dp).semantics{contentDescription="切换到工作"},verticalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp)) {
        Text("这件事需要在电脑上做。要切换到工作吗？",fontWeight=FontWeight.SemiBold,fontSize=DesignTokens.font16.sp)
        Text(if(m.connected)"在 ${m.hostName} 上做，原来的消息都会保留。" else "这段对话所在的电脑不在线，连接后可继续。",fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(pending!=null) {
            Text(if(pending.stringOrEmpty("outcome")=="rejected")"正在确认先不用" else "正在确认切换到工作",fontSize=DesignTokens.font14.sp)
            FeedControlButton("重试原决定",secondary=true){m.decide(row,pending.getString("outcome"),"once",pending.stringOrEmpty("workProjectId").ifEmpty{null})}
        } else {
            if(m.computers.size>1)m.computers.forEach { computer ->
                val id=computer.stringOrEmpty("hostId");val name=computer.stringOrEmpty("displayName").ifEmpty{computer.stringOrEmpty("name")}
                Text("$name · ${if(!computer.optBoolean("online"))"不在线" else if(id==m.hostId)"这段对话所在的电脑" else "这段对话由另一台电脑回答"}",fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            m.projects.forEach { project ->
                val checked=selected==project.stringOrEmpty("projectId")
                Row(Modifier.fillMaxWidth().heightIn(min=DesignTokens.space44.dp).clip(RoundedCornerShape(DesignTokens.radius12.dp))
                    .background(if(checked)MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
                    .selectable(checked,enabled=m.connected && !m.workChoicesBusy,role=Role.RadioButton,onClick={selected=project.getString("projectId")}).padding(horizontal=DesignTokens.space8.dp),verticalAlignment=Alignment.CenterVertically) {
                    RadioButton(checked,null,colors=RadioButtonDefaults.colors(selectedColor=MaterialTheme.colorScheme.primary,unselectedColor=MaterialTheme.colorScheme.onSurfaceVariant))
                    Column(Modifier.weight(1f)) { Text(project.stringOrEmpty("name"),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=DesignTokens.font14.sp)
                        project.stringOrEmpty("pathHint").takeIf{it.isNotEmpty()}?.let{Text(it,fontSize=DesignTokens.font12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)} }
                }
            }
            if(m.projects.isEmpty())Text(if(m.workChoicesBusy)"正在读取项目…" else m.workChoicesError.ifEmpty{"先在这台电脑上添加项目或文件夹。"},fontSize=DesignTokens.font13.sp)
            if(m.workChoicesError.isNotEmpty())FeedControlButton("重新读取项目",icon=R.drawable.wm_sync){m.launch{m.refreshWorkChoices(false)}}
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(DesignTokens.space8.dp,Alignment.End)) {
                FeedControlButton("先不用",secondary=true){m.decide(row,"rejected")}
                FeedControlButton("切换到工作",primary=true,enabled=m.connected && !m.workChoicesBusy && selected.isNotEmpty()){m.decide(row,"allowed-once","once",selected)}
            }
            if(!m.connected && m.offlineWorkReady)FeedControlButton("交给电脑，上线后做"){m.openOfflineWork()}
        }
    }
}
