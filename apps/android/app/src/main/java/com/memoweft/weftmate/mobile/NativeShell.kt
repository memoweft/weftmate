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


@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable internal fun NativeShell(m: NativeChatModel, activity: NativeActivity) {
    // Observe the route here; a forwarded theme lambda must also change when navigation changes.
    val selectedTab = m.tab
    val route = nativeRoute(selectedTab)
    val settings = activity.settings
    LaunchedEffect(m.owner, m.loggedIn) { settings.reset() }
    val signedIn = m.loggedIn
    val account = m.owner
    var preview by remember(account, signedIn) { mutableStateOf<JSONObject?>(null) }
    val openedFile = preview
    NativeTheme(m.dark) {
        val contentLayer = rememberGraphicsLayer()
        val frost = remember(contentLayer) { NativeFrost(contentLayer) }
        val dockHeight = remember { mutableIntStateOf(0) }
        val density = LocalDensity.current
        LaunchedEffect(signedIn, account) { activity.feed.prepare() }
        LaunchedEffect(signedIn, account) { activity.goals.prepare() }
        LaunchedEffect(signedIn, account) { activity.health.prepare() }
        if (!signedIn) {
            AndroidView(factory = { activity.webPage("login", false) }, onRelease = { activity.parkWeb() }, modifier = Modifier.fillMaxSize())
            return@NativeTheme
        }
        CompositionLocalProvider(LocalNativeFrost provides if (route.frost) frost else null, LocalReadingSize provides m.textSize, LocalCodeSize provides m.codeSize) {
            if (route.bar == RouteBar.FullScreen) {
                AndroidView(factory = { activity.originalLibraryPage() }, onRelease = { activity.parkWeb() },
                    modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.systemBars))
                return@CompositionLocalProvider
            }
            val focus = LocalFocusManager.current
            var drawer by remember { mutableStateOf(false) }
            fun openDrawer() { focus.clearFocus(); activity.hideKeyboard(); m.focused = false; drawer = true; m.launch { m.refreshChats() } }
            fun openSettings() { focus.clearFocus(); settings.open() }
            SideEffect { activity.overlayBack = if (drawer) ({ drawer = false }) else settings.confirmation?.dismiss }
            DisposableEffect(activity) { onDispose { activity.overlayBack = null } }
            val paneAlpha = remember { Animatable(1f) }
            LaunchedEffect(selectedTab) {
                paneAlpha.snapTo(.8f)
                paneAlpha.animateTo(1f, tween(if (settings.home.optBoolean("reducedMotion")) DesignTokens.durationReduced.toInt() else DesignTokens.durationFast.toInt()))
            }
            LaunchedEffect(m.dark) { activity.reportRenderedSystemBars(m.dark) }
            val imeInsets = WindowInsets.ime
            val imeTarget = WindowInsets.imeAnimationTarget
            LaunchedEffect(m) {
                snapshotFlow { imeInsets.getBottom(density) to imeTarget.getBottom(density) }.collect { (current, target) -> frost.keyboardAnimating = current != target }
            }
            LaunchedEffect(selectedTab) {
                if (selectedTab == "models" && settings.page != "models") settings.open("models")
                if (selectedTab != "chat") settings.menuVisible = false
            }
            LaunchedEffect(selectedTab, openedFile) { if (selectedTab != "chat" || openedFile != null) { focus.clearFocus(); m.focused = false; activity.hideKeyboard() } }
            Box(
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.systemBars)
                    .then(if (android.os.Build.VERSION.SDK_INT >= 30) Modifier.imePadding() else Modifier.windowInsetsPadding(WindowInsets.imeAnimationTarget))
                    .then(if (drawer || settings.confirmation != null) Modifier.clearAndSetSemantics {} else Modifier)
            ) {
                if (selectedTab == "chat") NativeConversation(m, Modifier.fillMaxSize().frostSource(frost).alpha(paneAlpha.value), bottom = { with(density) { dockHeight.intValue.toDp() } }, onPreview = { preview = it })
                Column(Modifier.fillMaxSize()) {
                    when (route.bar) {
                        RouteBar.Settings -> NativeSettingsToolbar(settings)
                        RouteBar.Feed -> NativeFeedToolbar(activity.feed,
                            back = { if (selectedTab == "activity-web") activity.feed.closeWeb() else activity.feed.closeDetail() },
                            onDrawer = ::openDrawer, onSettings = ::openSettings)
                        RouteBar.Goals -> NativeGoalsToolbar(activity.goals, onDrawer = ::openDrawer, onSettings = ::openSettings)
                        RouteBar.Health -> NativeHealthToolbar(activity.health, onDrawer = ::openDrawer, onSettings = ::openSettings)
                        else -> NativeMainBar(m, activity, route, onDrawer = ::openDrawer, onSettings = ::openSettings)
                    }
                    val page = Modifier.weight(1f).fillMaxWidth()
                    when (selectedTab) {
                        "chat" -> Spacer(Modifier.weight(1f))
                        "chats" -> NativeChatList(m, page.alpha(paneAlpha.value))
                        "library" -> NativeLibrary(m, activity, page.frostSource(frost).alpha(paneAlpha.value), onPreview = { preview = it })
                        "activity" -> NativeFeedPage(activity.feed, Modifier.weight(1f).alpha(paneAlpha.value))
                        "activity-web" -> NativeFeedWeb(activity.feed, activity, page.alpha(paneAlpha.value))
                        "goals" -> NativeGoalsPage(activity.goals, Modifier.weight(1f).alpha(paneAlpha.value))
                        "goals-web" -> NativeGoalsWeb(activity.goals, activity, page)
                        "settings", "models" -> NativeSettingsPage(settings, Modifier.weight(1f))
                        "health" -> NativeHealthPage(activity.health, Modifier.weight(1f).alpha(paneAlpha.value))
                        "health-web" -> NativeHealthWeb(activity.health, activity, page)
                        else -> key(selectedTab) {
                            AndroidView(factory = { activity.webPage(route.web ?: selectedTab) }, onRelease = { activity.parkWeb() }, modifier = page.alpha(paneAlpha.value))
                        }
                    }
                    Column(Modifier.onSizeChanged { dockHeight.intValue = it.height }) {
                        if (selectedTab == "chat") {
                            if (m.workAndChat && m.conversationMode == "work") NativeWorkSelection(m)
                            NativeComposer(m, settings, onPreview = { preview = it })
                        }
                        if (route.bottomBar) NativeBottomBar(m, activity, route) { focus.clearFocus() }
                    }
                }
            }
            LaunchedEffect(settings.confirmation) { if (settings.confirmation != null) { focus.clearFocus(); activity.hideKeyboard() } }
            settings.confirmation?.let { NativeSettingsConfirmationOverlay(it) }
            if (selectedTab == "chat" && settings.menuVisible) NativeModelServiceOverlay(settings, with(density) { dockHeight.intValue.toDp() })
            if (drawer) NativeDrawer(m, settings) { drawer = false }
            openedFile?.let { row -> NativeFileViewer(row, m, activity, onClose = { preview = null }) }
        }
    }
}

/** Top bar for chat and the pages without their own: drawer or back on the left, title, and the overflow menu. */
@Composable private fun NativeMainBar(m: NativeChatModel, activity: NativeActivity, route: NativeRoute, onDrawer: () -> Unit, onSettings: () -> Unit) {
    var overflow by remember { mutableStateOf(false) }
    androidx.activity.compose.BackHandler(overflow) { overflow = false }
    val library = route.id == "library"
    val focus = LocalFocusManager.current
    Row(
        Modifier.fillMaxWidth().height(DesignTokens.space80.dp).background(MaterialTheme.colorScheme.background).padding(DesignTokens.space12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (route.bar == RouteBar.Back) NativeIconButton(R.drawable.wm_back, "返回聊天", Modifier.nativeFrost(CircleShape)) { m.returnToChat() }
        else NativeIconButton(R.drawable.wm_panel, "打开侧栏", Modifier.nativeFrost(CircleShape)) { onDrawer() }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(route.title ?: m.title, fontSize = DesignTokens.font17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (route.id == "chat") Text(m.subtitle, fontSize = DesignTokens.font12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box {
            NativeIconButton(R.drawable.wm_more, "更多", Modifier.nativeFrost(CircleShape)) { overflow = true; m.refreshOfflineWorkAvailability() }
            NativeMenu(expanded = overflow, keepEditorFocus = true, onDismissRequest = { overflow = false }) {
                fun item(label: String, icon: Int, action: () -> Unit) =
                    @Composable { NativeMenuItem(text = { Text(label) }, onClick = { overflow = false; action() }, leadingIcon = { Icon(painterResource(icon), null) }) }
                if (m.running && !library) item("停止回复", R.drawable.wm_stop) { m.stop() }()
                item("设置", R.drawable.wm_settings) { onSettings() }()
                if (library) item("打开原网页成果库", R.drawable.wm_layers) { activity.originalLibrary() }()
                else {
                    item(if (m.workAndChat && m.sidebarMode == "work") "新建工作" else "新建对话", R.drawable.wm_plus) { focus.clearFocus(); activity.hideKeyboard(); m.focused = false; m.newChat() }()
                    item("完整对话功能", R.drawable.wm_chat) { m.tab = "web-chat" }()
                }
                if (route.id == "chat" && !m.connected && m.offlineWorkReady) item("交给电脑，上线后做", R.drawable.wm_clock) { m.openOfflineWork() }()
            }
        }
    }
}

@Composable private fun NativeBottomBar(m: NativeChatModel, activity: NativeActivity, route: NativeRoute, beforeSwitch: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().keyboardNavigation()
            .padding(start = DesignTokens.space12.dp, end = DesignTokens.space12.dp, top = DesignTokens.space4.dp, bottom = DesignTokens.space12.dp)
            .nativeFrost(nativePill).padding(horizontal = DesignTokens.space12.dp, vertical = DesignTokens.space4.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        nativeTabs.forEach { (id, label, icon) ->
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                val active = route.tab == id
                NativeIconButton(icon, label, Modifier.semantics { selected = active }, selected = active) { beforeSwitch(); m.focused = false; m.tab = id }
                if (id == "activity" && activity.feed.unread > 0) Box(
                    Modifier.align(Alignment.TopEnd).padding(DesignTokens.space4.dp).size(DesignTokens.space8.dp)
                        .background(MaterialTheme.colorScheme.primary, CircleShape).semantics { contentDescription = "${activity.feed.unread} 条动态未读" }
                )
            }
        }
    }
}
