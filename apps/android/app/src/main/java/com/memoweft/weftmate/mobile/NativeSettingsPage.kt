package com.memoweft.weftmate.mobile

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONArray
import org.json.JSONObject

private val settingsGap=DesignTokens.space8.dp
private val settingsShape=RoundedCornerShape(DesignTokens.radius16.dp)

@Composable internal fun NativeSettingsToolbar(s:NativeSettingsModel) {
    var more by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().height(DesignTokens.space80.dp).padding(DesignTokens.space12.dp),verticalAlignment=Alignment.CenterVertically) {
        FeedControlIconButton(R.drawable.wm_back,"返回",action=s::back)
        Text(s.title,Modifier.weight(1f),fontSize=DesignTokens.font17.sp,fontWeight=FontWeight.SemiBold)
        Box { FeedControlIconButton(R.drawable.wm_more,"更多"){more=true}
            NativeFileMenu(more,{more=false}) {
                if(s.page=="models")FeedControlMenuItem("账户云模型",icon=R.drawable.wm_model){more=false;s.original("models");s.run{ s.bridge.call("cloudModels") }}
                FeedControlMenuItem("刷新",icon=R.drawable.wm_sync){more=false;s.refresh()}
            }
        }
    }
}
@Composable internal fun NativeSettingsPage(s:NativeSettingsModel,modifier:Modifier=Modifier) {
    LaunchedEffect(s.chat.owner,s.chat.loggedIn) {s.refresh()}
    if(s.webPage.isNotEmpty()) {
        key(s.webPage,s.activity.embeddedWebIdentity) {AndroidView(factory={s.activity.webPage(s.webPage)},onRelease={s.activity.parkWeb()},modifier=modifier.fillMaxWidth())}
        return
    }
    val route="${s.page}:${s.adding}:${s.editingService?.optString("serviceId")}:${s.device?.optString("id")}:${s.accountFlow}"
    val scroll=remember(route){ScrollState(s.scrollPositions[route] ?: 0)}
    DisposableEffect(route){onDispose{s.scrollPositions[route]=scroll.value}}
    Column(modifier.fillMaxWidth().verticalScroll(scroll).padding(DesignTokens.space16.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
        if(s.error.isNotEmpty())SettingsGroup("暂时没能完成") {Text(s.error,color=MaterialTheme.colorScheme.error);FeedControlButton("重试",secondary=true){s.refresh()}}
        if(s.loading && s.home.length()==0) {repeat(3){Box(Modifier.fillMaxWidth().height(DesignTokens.space80.dp).background(MaterialTheme.colorScheme.surfaceVariant,settingsShape).semantics{contentDescription="正在读取设置"})};return@Column}
        when(s.page) {
            "" -> SettingsHome(s)
            "general" -> SettingsGeneral(s)
            "models" -> if(s.adding||s.editingService!=null)SettingsServiceEditor(s) else SettingsServices(s)
            "account" -> SettingsAccount(s)
            "devices" -> SettingsDevices(s)
            "appearance" -> SettingsAppearance(s)
            "about" -> SettingsAbout(s)
            else -> LaunchedEffect(s.page){s.original(s.page)}
        }
        Spacer(Modifier.height(DesignTokens.space20.dp))
    }
}
@Composable private fun SettingsHome(s:NativeSettingsModel) {
    val query=s.search
    val profile=s.home.optJSONObject("profile") ?: JSONObject()
    SettingsGroup("") {SettingsRow(profile.optString("displayName","我的账户"),s.home.optString("email"),R.drawable.wm_user){s.open("account")};SettingsRow("本月用量","费用、用量与月度上限",R.drawable.wm_task){s.original("usage")}}
    SettingsInput("搜索设置",query){s.search=it}
    val rows=s.home.optJSONArray("categories")?.objects().orEmpty().filter{(it.optString("name")+it.optString("group")).contains(query,true)}
    if(rows.isEmpty())SettingsEmpty("没有匹配的设置","试试“外观”或“模型”。")
    rows.groupBy{it.optString("group")}.forEach{(name,categories)->SettingsGroup(name){categories.forEach{row->val id=row.optString("id");SettingsRow(row.getString("name"),when(id){"models"->s.chat.modelLabel;"appearance"->themeLabel(s.home.optJSONObject("appearance")?.optString("theme").orEmpty());"devices"->"连接、配对与待批准";"about"->BuildConfig.VERSION_NAME;else->""},settingsIcon(id)){if(id in listOf("general","models","account","devices","appearance","about"))s.open(id) else s.original(id)}}}}
    SettingsGroup("颜色模式") {SettingsTheme(s)}
    var confirm by remember {mutableStateOf(false)}
    FeedControlButton("退出登录",danger=true){confirm=true}
    if(confirm)SettingsConfirm(s,"退出登录？","这台手机需要重新登录，已有对话仍保留。","退出登录",{confirm=false}){confirm=false;s.run{s.bridge.call("logout");s.chat.bootstrap()}}
}
private fun themeLabel(value:String)=when(value){"light"->"浅色";"dark"->"深色";else->"跟随系统"}
private fun settingsIcon(id:String)=when(id){"account"->R.drawable.wm_user;"devices"->R.drawable.wm_pc;"models","assistant"->R.drawable.wm_model;"notifications"->R.drawable.wm_bell;"appearance"->R.drawable.wm_sun;"data","archived"->R.drawable.wm_history;"usage"->R.drawable.wm_task;"about"->R.drawable.wm_info;else->R.drawable.wm_settings}
@Composable private fun SettingsGeneral(s:NativeSettingsModel) {
    SettingsGroup("此设备") {listOf(Triple("system","系统状态","电脑组件、性能与运行记录"),Triple("notifications","通知","提醒、勿扰与声音"),Triple("sync","离线与同步","本机记录与同步状态"),Triple("connect","电脑账户与连接","连接自己的电脑"),Triple("updates","检查更新","当前版本 ${BuildConfig.VERSION_NAME}")).forEach{(id,name,note)->SettingsRow(name,note){s.original(id)}}}
    SettingsGroup("本机运行记录") {var records by remember{mutableStateOf(JSONObject())};LaunchedEffect(Unit){runCatching{s.chat.call("diagnostics.status")}.onSuccess{records=it}}
        SettingsNote(if(records.length()==0)"正在读取本机运行记录…" else "本机运行记录可在系统状态中查看与分享。")
        SettingsRow("查看运行记录","异常记录与诊断摘要"){s.original("system")}
        SettingsRow("打开备用界面","页面无法正常显示时使用"){s.run{s.chat.call("compat.openNative")}}
    }
}
@Composable private fun SettingsAppearance(s:NativeSettingsModel) {
    val value=s.home.optJSONObject("appearance") ?: JSONObject()
    SettingsNote("保存到这台设备。")
    SettingsGroup("颜色模式"){SettingsTheme(s)}
    SettingsGroup("阅读与输入") {
        GoalChoice("字号",value.optString("fontSize","15"),listOf("14" to "小 · 14","15" to "标准 · 15","17" to "大 · 17","19" to "特大 · 19"),!s.busy){saveAppearance(s,JSONObject().put("fontSize",it))}
        GoalChoice("代码字号",value.optString("codeFontSize","13"),listOf("12" to "小 · 12","13" to "标准 · 13","15" to "大 · 15","17" to "特大 · 17"),!s.busy){saveAppearance(s,JSONObject().put("codeFontSize",it))}
        Text("一段舒适的文字，让想法慢慢展开。",fontSize=value.optString("fontSize","15").toFloatOrNull()?.sp ?: DesignTokens.font15.sp)
    }
    SettingsGroup("强调色") {SettingsRow("主题色","浅色和深色可分别选择"){s.original("appearance")}}
    SettingsGroup("动态效果") {var reduced by remember{mutableStateOf(false)};LaunchedEffect(Unit){val result=s.bridge.call("motion");reduced=result.optBoolean("reduced")};SettingsToggle("减少动态效果","切页和回复动效更安静",reduced,!s.busy){enabled->s.run{val result=s.bridge.call("motion",JSONObject().put("preference",if(enabled)"reduce" else "full"));reduced=result.optBoolean("reduced");s.home=JSONObject(s.home.toString()).put("reducedMotion",reduced)}};FeedControlButton("恢复跟随系统",secondary=true){s.run{val result=s.bridge.call("motion",JSONObject().put("preference","system"));s.home=JSONObject(s.home.toString()).put("reducedMotion",result.optBoolean("reduced"));s.refresh()}}}
}
@Composable private fun SettingsTheme(s:NativeSettingsModel) { val selected=s.home.optJSONObject("appearance")?.optString("theme","system") ?: "system"
    NativeFilterRow("颜色模式",listOf("light" to "浅色","dark" to "深色","system" to "跟随系统"),selected,!s.busy){saveAppearance(s,JSONObject().put("theme",it))}
}
private fun saveAppearance(s:NativeSettingsModel,p:JSONObject)=s.run("已保存") {val result=s.bridge.call("appearance",p);s.home=JSONObject(s.home.toString()).put("appearance",result.getJSONObject("appearance"));val a=s.chat.call("settings.appearance");s.chat.dark=resolvedAppearanceDark(a.optString("value"),a.optBoolean("systemDark"));s.chat.textSize=result.getJSONObject("appearance").optString("fontSize","15").toFloat();s.chat.codeSize=result.getJSONObject("appearance").optString("codeFontSize","13").toFloat()}
@Composable private fun SettingsAccount(s:NativeSettingsModel) {
    val cloud=s.home.optBoolean("cloud")
    var name by remember(s.chat.owner){mutableStateOf(s.home.optJSONObject("profile")?.optString("displayName").orEmpty())}
    if(s.accountFlow.isEmpty()) {
        SettingsGroup("账户资料") {SettingsNote(s.home.optString("email"));if(!cloud&&!s.chat.standalone){SettingsInput("显示名称",name,!s.busy){name=it};FeedControlButton("保存名称",primary=true,enabled=!s.busy&&name.isNotBlank()){s.run("已保存"){s.bridge.call("profile",JSONObject().put("name",name));s.refresh()}};SettingsRow("头像","选择或修改头像"){s.original("account")}}}
        SettingsGroup("账户安全") {if(cloud)SettingsRow("换绑邮箱","新邮箱会收到验证码"){s.accountFlow="email"};SettingsRow("修改密码","修改后需要重新登录"){s.accountFlow="password"};if(cloud)SettingsRow("退出所有其他设备","当前设备继续可用"){s.accountFlow="logoutOthers"};SettingsRow("注销账号","查看云端与本机数据范围"){s.original("data")};SettingsRow("完整账户功能","账户保护与其他操作"){s.original("account")}}
    } else if(s.accountFlow=="logoutOthers") {SettingsConfirm(s,"退出所有其他设备？","其他设备需要重新登录，当前设备继续可用。","确认退出",{s.accountFlow=""}){s.run("其他设备已退出"){s.bridge.call("logoutOthers");s.accountFlow=""}}}
    else {
        var current by remember{mutableStateOf("")};var password by remember{mutableStateOf("")};var confirmation by remember{mutableStateOf("")};var email by remember{mutableStateOf("")};var code by remember{mutableStateOf("")};var sent by remember{mutableStateOf(false)}
        SettingsGroup(if(s.accountFlow=="password")"修改密码" else "换绑邮箱") {
            if(s.accountFlow=="password") {SettingsInput("当前密码",current,!s.busy,true){current=it};SettingsInput("新密码",password,!s.busy,true){password=it};SettingsInput("再次填写新密码",confirmation,!s.busy,true){confirmation=it};FeedControlButton("保存新密码",primary=true,enabled=!s.busy){if(password.length<8||password!=confirmation)s.error="新密码至少 8 位，两次填写要相同。" else s.run("密码已修改，请重新登录。"){try{s.bridge.call("password",JSONObject().put("current",current).put("password",password).put("confirmation",confirmation));s.chat.bootstrap()}finally{current="";password="";confirmation=""}}}}
            else {SettingsInput("新邮箱",email,!s.busy&&!sent){email=it};if(sent)SettingsInput("验证码",code,!s.busy){code=it};FeedControlButton(if(sent)"确认换绑" else "发送验证码",primary=true,enabled=!s.busy){s.run(if(sent)"邮箱已修改，请重新登录。" else "验证码已发送"){if(sent){s.bridge.call("emailConfirm",JSONObject().put("code",code));s.chat.bootstrap()}else{s.bridge.call("emailRequest",JSONObject().put("email",email));sent=true}}}}
        }
    }
}
@Composable private fun SettingsDevices(s:NativeSettingsModel) {
    val device=s.device
    if(device!=null) {var name by remember(device.toString()){mutableStateOf(device.optString("name"))};var confirm by remember{mutableStateOf(false)}
        val editable=device.optBoolean("editable",true)
        SettingsGroup("设备管理") {if(editable)SettingsInput("设备名称",name,!s.busy){name=it};SettingsNote(if(device.optBoolean("isCurrent",device.optBoolean("current")))"这是当前设备。" else "同一账户下登录的设备。")
            if(editable)FeedControlButton("保存名称",primary=true,enabled=!s.busy&&name.isNotBlank()){s.run("设备名称已保存"){s.bridge.call("rename",JSONObject(device.toString()).put("name",name.trim()));s.device=null;s.refresh()}}
            if(device.optBoolean("online")&&device.optString("hostId").isNotBlank())FeedControlButton("连接这台电脑",secondary=true,enabled=!s.busy){s.run("已连接"){s.bridge.call("connect",JSONObject().put("hostId",device.getString("hostId")));s.chat.bootstrap()}}
            if(editable)FeedControlButton("移除设备",danger=true,enabled=!s.busy){confirm=true}
        }
        if(confirm)SettingsConfirm(s,"移除 ${device.optString("name")}？","这台设备需要重新登录，本机内容保留。交给这台电脑的等待事项会取消；已经开始的操作会在电脑上收尾。","移除设备",{confirm=false}){confirm=false;s.run("设备已移除"){s.bridge.call("remove",JSONObject(device.toString()).put("current",device.optBoolean("isCurrent",device.optBoolean("current"))));s.device=null;s.refresh();s.chat.bootstrap()}}
        return
    }
    SettingsNote("在电脑上安装 WeftMate 并用同一个账号登录，就会出现在这里。")
    val hosts=s.directory.optJSONArray("hosts")?.objects().orEmpty();val devices=s.directory.optJSONArray("devices")?.objects().orEmpty().filter{!it.optBoolean("revoked")}
    SettingsGroup("电脑") {if(hosts.isEmpty()){if(s.chat.standalone)SettingsEmpty("还没有电脑","登录同一账号后即可连接。") else SettingsRow("当前连接的电脑",if(s.chat.connected)"查看连接详情" else "暂时不在线，可查看连接详情",R.drawable.wm_pc){s.original("connect")}};hosts.forEach{host->SettingsRow(host.optString("displayName",host.optString("name","电脑")),if(host.optBoolean("online"))"在线" else "暂时不在线",R.drawable.wm_pc){val linked=devices.find{it.optString("hostId")==host.optString("hostId")} ?: if(!s.directory.optBoolean("multiHost"))devices.singleOrNull{it.optString("name")==host.optString("name")} else null;s.device=JSONObject(host.toString()).put("id",linked?.optString("id") ?: host.optString("deviceId",host.optString("hostId"))).put("editable",s.directory.optBoolean("multiHost")||linked!=null)}}}
    SettingsGroup("已登录设备") {if(devices.isEmpty())SettingsEmpty("没有其他设备","当前手机可以继续使用。");devices.filter{row->row.optString("hostId").isBlank()||hosts.none{it.optString("hostId")==row.optString("hostId")}}.forEach{row->SettingsRow(row.optString("name","设备"),if(row.optBoolean("isCurrent",row.optBoolean("current")))"当前设备" else "已登录",R.drawable.wm_phone){s.device=row}}}
    SettingsGroup("连接与配对") {SettingsRow("连接自己的设备","选择电脑、扫描配对码或查看待批准设备"){s.original("devices")}}
}
@Composable private fun SettingsAbout(s:NativeSettingsModel) {
    var version by remember{mutableStateOf(JSONObject())};LaunchedEffect(Unit){runCatching{s.chat.call("updates.status")}.onSuccess{version=it}}
    SettingsGroup("WeftMate") {SettingsRow("原生应用",BuildConfig.VERSION_NAME){s.original("updates")};SettingsRow("界面版本",version.optString("activeVersion","内置页面")){s.original("updates")};SettingsRow("更新内容","看看有什么新东西"){s.original("releases")};SettingsRow("帮助与小技巧","找到一个技巧，马上试试"){s.original("help")};SettingsRow("服务条款","在应用内阅读"){s.original("about");s.run{s.bridge.call("legal",JSONObject().put("kind","terms"))}};SettingsRow("隐私政策","在应用内阅读"){s.original("about");s.run{s.bridge.call("legal",JSONObject().put("kind","privacy"))}}}
}
@Composable private fun SettingsServices(s:NativeSettingsModel) {
    SettingsNote(if(s.chat.standalone)"填一次密钥，就能选择这个服务的所有聊天模型。密钥保存在这台手机的安全存储中。" else "填一次密钥，就能选择这个服务的所有聊天模型。密钥安全保存在电脑上。")
    if(s.legacy){SettingsGroup("模型"){SettingsNote("这台电脑使用原有模型设置。");SettingsRow("管理模型","打开电脑已有的模型设置"){s.original("models")}};return}
    if(s.loading&&s.services.isEmpty())Box(Modifier.fillMaxWidth().height(DesignTokens.space80.dp).background(MaterialTheme.colorScheme.surfaceVariant,settingsShape))
    else if(s.services.isEmpty())SettingsGroup(""){SettingsEmpty("还没有模型服务","选一个服务并填写密钥，就能开始聊天。")}
    s.services.forEach{service->SettingsGroup(""){SettingsRow(service.optString("name"),"${service.optString("baseUrl")} · ${service.optJSONArray("models")?.length() ?: 0} 个模型",R.drawable.wm_model){s.editingService=service};SettingsNote(serviceCatalogMessage(service.optJSONObject("catalog")?.optString("status").orEmpty()))}}
    FeedControlButton("添加模型服务…",primary=true,icon=R.drawable.wm_plus,enabled=!s.busy){s.adding=true}
    if(!s.chat.standalone)SettingsRow("这台手机的模型服务","手机单独聊天时使用"){s.original("phoneModels")}
}
@Composable private fun SettingsServiceEditor(s:NativeSettingsModel) {
    val initial=s.editingService
    var saved by remember(initial?.optString("serviceId")){mutableStateOf(initial)}
    val presets=s.home.optJSONArray("presets")?.objects().orEmpty()
    var preset by remember{mutableStateOf(if(initial==null)presets.firstOrNull()?.optString("id") ?: "custom" else "custom")}
    val first=presets.firstOrNull{it.optString("id")==preset}
    var name by remember{mutableStateOf(initial?.optString("name") ?: first?.optString("name").orEmpty())}
    var address by remember{mutableStateOf(initial?.optString("baseUrl") ?: first?.optString("baseUrl").orEmpty())}
    var type by remember{mutableStateOf(initial?.optString("interfaceType") ?: "openai-compatible")}
    var key by remember{mutableStateOf("")};var manual by remember{mutableStateOf("")};var search by remember{mutableStateOf("")};var confirm by remember{mutableStateOf(false)}
    SettingsGroup(if(saved==null)"选择模型服务" else "服务设置") {
        if(saved==null)GoalChoice("服务",preset,presets.map{it.getString("id") to it.getString("name")}+listOf("custom" to "自定义"),!s.busy){id->preset=id;val p=presets.find{it.optString("id")==id};name=p?.optString("name").orEmpty();address=p?.optString("baseUrl").orEmpty();key=""}
        SettingsInput("服务名称",name,!s.busy){name=it};SettingsInput("服务地址",address,!s.busy){address=it};GoalChoice("接口类型",type,listOf("openai-compatible" to "OpenAI 兼容","anthropic" to "Claude 原生"),!s.busy){type=it}
        SettingsInput(if(saved==null)"密钥" else "密钥（留空保留原密钥）",key,!s.busy,true){key=it}
        FeedControlButton(if(s.busy)"正在查询…" else if(saved==null)"查询模型并继续" else "保存并重新查询",primary=saved==null,secondary=saved!=null,enabled=!s.busy,loading=s.busy){
            if(name.isBlank()||address.isBlank())s.error="请填写服务名称和地址。"
            else if(saved!=null&&address!=saved?.optString("baseUrl")&&key.isBlank())s.error="修改地址后，请重新填写密钥。"
            else s.run {val body=JSONObject().put("name",name.trim()).put("endpoint",address.trim()).put("interfaceType",type);if(key.isNotBlank())body.put("apiKey",key);try{val creating=saved==null;val latest=saved?.let{old->s.services.find{it.optString("serviceId")==old.optString("serviceId")}} ?: saved;val result=s.writeService("configure",latest,body);val serviceId=result.optJSONObject("service")?.stringOrEmpty("serviceId").orEmpty().ifEmpty{result.stringOrEmpty("serviceId")}.ifEmpty{latest?.stringOrEmpty("serviceId").orEmpty()};s.loadServices();saved=s.services.find{it.optString("serviceId")==serviceId} ?: s.services.find{it.optString("baseUrl").trimEnd('/')==address.trim().trimEnd('/')};if(saved==null)s.error="没有保存成功，请重试。" else if(creating){val service=saved!!;val choices=service.optJSONArray("models")?.objects().orEmpty().filter{it.optBoolean("enabled",true)};val choice=choices.find{it.optString("modelId")==service.optString("selectedModelId")} ?: choices.firstOrNull();if(choice!=null)s.chooseModel(service,choice)}}finally{key=""}}
        }
    }
    saved?.let{service->
        val current=s.services.find{it.optString("serviceId")==service.optString("serviceId")} ?: service
        SettingsGroup("查询结果") {SettingsNote(serviceCatalogMessage(current.optJSONObject("catalog")?.optString("status").orEmpty()));FeedControlButton("重新查询模型",secondary=true,enabled=!s.busy){s.run{s.writeService("refresh",current);s.loadServices()}}}
        SettingsGroup("显示的模型") {SettingsInput("搜索模型",search){search=it};val rows=current.optJSONArray("models")?.objects().orEmpty();rows.filter{(it.optString("name")+it.optString("modelId")).contains(search,true)}.forEach{model->SettingsToggle(model.optString("name",model.optString("modelId")),model.optString("modelId"),model.optBoolean("enabled",true),!s.busy){enabled->s.run("已保存"){val ids=rows.filter{if(it.optString("modelId")==model.optString("modelId"))enabled else it.optBoolean("enabled",true)}.map{it.getString("modelId")};s.writeService("update",current,JSONObject().put("enabledModelIds",JSONArray(ids)));s.loadServices()}}}}
        SettingsGroup("手填型号") {SettingsInput("模型型号",manual,!s.busy){manual=it};FeedControlButton("添加这个型号",secondary=true,enabled=!s.busy&&manual.isNotBlank()){s.run("型号已添加"){val id=manual.trim();s.writeService("update",current,JSONObject().put("modelId",id));manual="";s.loadServices();if(s.adding&&s.selected.optString("serviceId")!=current.optString("serviceId")){val service=s.services.first{it.optString("serviceId")==current.optString("serviceId")};service.optJSONArray("models")?.objects()?.find{it.optString("modelId")==id}?.let{s.chooseModel(service,it)}}}}}
        if(s.adding)SettingsGroup("新对话默认模型") {current.optJSONArray("models")?.objects().orEmpty().filter{it.optBoolean("enabled",true)}.forEach{model->FeedControlMenuItem(model.optString("name",model.optString("modelId")),enabled=!s.busy,checked=model.optString("modelId")==s.selected.optString("modelId")&&current.optString("serviceId")==s.selected.optString("serviceId")){s.select(current,model){}}};FeedControlButton("完成",primary=true,enabled=!s.busy&&current.optJSONArray("models")?.objects().orEmpty().any{it.optBoolean("enabled",true)}){s.adding=false;s.editingService=null;s.toast("模型服务已保存，可以开始聊天")}}
        if(!s.adding)FeedControlButton("删除模型服务",danger=true,enabled=!s.busy){confirm=true}
        if(confirm)SettingsConfirm(s,"删除 ${current.optString("name")}？","会停止使用这个模型服务，对话记录仍保留。","删除模型服务",{confirm=false}){confirm=false;s.run("模型服务已删除"){s.writeService("remove",current);s.loadServices();s.editingService=null}}
    }
}
@Composable internal fun SettingsGroup(title:String,content:@Composable ColumnScope.()->Unit) {Column(verticalArrangement=Arrangement.spacedBy(settingsGap)){if(title.isNotEmpty())Text(title,fontSize=DesignTokens.font13.sp,color=MaterialTheme.colorScheme.onSurfaceVariant);Column(Modifier.fillMaxWidth().border(DesignTokens.space1.dp,MaterialTheme.colorScheme.outline,settingsShape).background(MaterialTheme.colorScheme.surface,settingsShape).padding(DesignTokens.space12.dp),verticalArrangement=Arrangement.spacedBy(settingsGap),content=content)}}
@Composable private fun SettingsRow(label:String,note:String="",icon:Int?=null,action:()->Unit) {Row(Modifier.fillMaxWidth().heightIn(min=DesignTokens.space44.dp).clip(settingsShape).clickable(role=Role.Button,onClick=action).padding(vertical=settingsGap),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(DesignTokens.space12.dp)){if(icon!=null)Icon(painterResource(icon),null,Modifier.size(DesignTokens.iconTouch.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant);Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(DesignTokens.space4.dp)){Text(label,fontSize=DesignTokens.font15.sp);SettingsNote(note)};Icon(painterResource(R.drawable.wm_right),null,Modifier.size(DesignTokens.space20.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)}}
@Composable internal fun SettingsNote(text:String){if(text.isNotEmpty())Text(text,fontSize=DesignTokens.font13.sp,lineHeight=DesignTokens.font18.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)}
@Composable private fun SettingsEmpty(title:String,note:String){Column(Modifier.padding(vertical=DesignTokens.space16.dp),verticalArrangement=Arrangement.spacedBy(settingsGap)){Icon(painterResource(R.drawable.wm_settings),null,Modifier.size(DesignTokens.space24.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant);Text(title,fontSize=DesignTokens.font15.sp);SettingsNote(note)}}
@Composable internal fun SettingsInput(label:String,value:String,enabled:Boolean=true,secret:Boolean=false,change:(String)->Unit){Column(verticalArrangement=Arrangement.spacedBy(settingsGap)){SettingsNote(label);OutlinedTextField(value,change,enabled=enabled,singleLine=true,modifier=Modifier.fillMaxWidth().semantics{contentDescription=label},shape=RoundedCornerShape(DesignTokens.radius12.dp),textStyle=androidx.compose.ui.text.TextStyle(fontSize=DesignTokens.font15.sp),visualTransformation=if(secret)PasswordVisualTransformation() else VisualTransformation.None,keyboardOptions=KeyboardOptions(keyboardType=if(secret)KeyboardType.Password else KeyboardType.Text),colors=OutlinedTextFieldDefaults.colors(focusedBorderColor=MaterialTheme.colorScheme.primary,unfocusedBorderColor=MaterialTheme.colorScheme.outline,focusedContainerColor=MaterialTheme.colorScheme.surface,unfocusedContainerColor=MaterialTheme.colorScheme.surface))}}
@Composable internal fun SettingsToggle(label:String,note:String,checked:Boolean,enabled:Boolean=true,change:(Boolean)->Unit){Row(Modifier.fillMaxWidth().heightIn(min=DesignTokens.space44.dp).clip(settingsShape).clickable(enabled=enabled,role=Role.Switch){change(!checked)}.semantics{contentDescription=label;stateDescription=if(checked)"已开启" else "已关闭";toggleableState=if(checked)androidx.compose.ui.state.ToggleableState.On else androidx.compose.ui.state.ToggleableState.Off},verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(settingsGap)){Column(Modifier.weight(1f)){Text(label,fontSize=DesignTokens.font15.sp);SettingsNote(note)};Box(Modifier.width(DesignTokens.space40.dp).height(DesignTokens.space24.dp).background(if(checked)MaterialTheme.colorScheme.primary else Color(if(LocalNativeDark.current)DesignTokens.nativeDarkMuted else DesignTokens.nativeMuted),RoundedCornerShape(DesignTokens.radius999.dp)).padding(DesignTokens.space3.dp)){Box(Modifier.size(DesignTokens.space18.dp).align(if(checked)Alignment.CenterEnd else Alignment.CenterStart).background(if(checked)MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.surface,RoundedCornerShape(DesignTokens.radius999.dp)))}}}
@Composable private fun SettingsConfirm(s:NativeSettingsModel,title:String,message:String,label:String,dismiss:()->Unit,action:()->Unit) {
    val close by rememberUpdatedState(dismiss)
    val confirm by rememberUpdatedState(action)
    val data=remember(s,title,message,label){SettingsConfirmation(title,message,label,{close()},{confirm()})}
    DisposableEffect(data){s.confirmation=data;onDispose{if(s.confirmation===data)s.confirmation=null}}
}

/** One Activity window keeps the scrim and system bars in the same rendered surface. */
@Composable internal fun NativeSettingsConfirmationOverlay(data:SettingsConfirmation) {
    androidx.activity.compose.BackHandler {data.dismiss()}
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim).systemBarsPadding().imePadding().padding(DesignTokens.space16.dp).semantics{paneTitle=data.title;isTraversalGroup=true},contentAlignment=Alignment.Center) {
        Column(Modifier.widthIn(max=DesignTokens.space380.dp).fillMaxWidth().background(MaterialTheme.colorScheme.surface,settingsShape).border(DesignTokens.space1.dp,MaterialTheme.colorScheme.outline,settingsShape).padding(DesignTokens.space20.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space16.dp)) {
            Text(data.title,fontSize=DesignTokens.font17.sp,fontWeight=FontWeight.SemiBold)
            Text(data.message,fontSize=DesignTokens.font15.sp,lineHeight=DesignTokens.font24.sp)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {FeedControlButton("取消",secondary=true,action=data.dismiss);Spacer(Modifier.width(settingsGap));FeedControlButton(data.label,danger=true,action=data.confirm)}
        }
    }
}
