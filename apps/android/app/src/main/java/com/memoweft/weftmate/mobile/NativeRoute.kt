package com.memoweft.weftmate.mobile

/** How a route draws its top bar. */
internal enum class RouteBar { Main, Back, Settings, Feed, Goals, Health, FullScreen }

/**
 * One place that says how each page is framed: top bar, title, which bottom item is lit,
 * whether the bottom bar shows, and which embedded web page still serves it.
 */
internal data class NativeRoute(
    val id: String,
    val bar: RouteBar,
    val title: String? = null,
    val tab: String? = null,
    val bottomBar: Boolean = true,
    val frost: Boolean = false,
    val web: String? = null,
)

internal val nativeTabs = listOf(
    Triple("chat", "聊天", R.drawable.wm_chat),
    Triple("activity", "动态", R.drawable.wm_bell),
    Triple("health", "健康", R.drawable.wm_heart),
    Triple("goals", "目标", R.drawable.wm_goal),
    Triple("library", "成果库", R.drawable.wm_folder),
)

private val routes = listOf(
    NativeRoute("chat", RouteBar.Main, tab = "chat", frost = true),
    NativeRoute("chats", RouteBar.Back, "全部对话", tab = "chat"),
    NativeRoute("web-chat", RouteBar.Main, tab = "chat", web = "chat"),
    NativeRoute("web-home", RouteBar.Main, "对话", tab = "chat", web = "home"),
    NativeRoute("help", RouteBar.Main, "帮助", web = "help"),
    NativeRoute("settings", RouteBar.Settings, bottomBar = false),
    NativeRoute("models", RouteBar.Settings, bottomBar = false),
    NativeRoute("activity", RouteBar.Feed, tab = "activity", frost = true),
    NativeRoute("activity-web", RouteBar.Feed, tab = "activity"),
    NativeRoute("goals", RouteBar.Goals, tab = "goals", frost = true),
    NativeRoute("goals-web", RouteBar.Goals, tab = "goals"),
    NativeRoute("health", RouteBar.Health, tab = "health", frost = true),
    NativeRoute("health-web", RouteBar.Health, tab = "health"),
    NativeRoute("library", RouteBar.Main, "成果库", tab = "library", frost = true),
    NativeRoute("library-web", RouteBar.FullScreen, tab = "library"),
).associateBy { it.id }

/** Unknown ids are web pages the shell embeds by name under a plain top bar. */
internal fun nativeRoute(id: String) = routes[id] ?: NativeRoute(id, RouteBar.Main, "设置", web = id)

internal enum class BackAction { CloseLibraryWeb, Settings, CloseHealthWeb, CloseHealthCalendar, HealthHome, CloseGoalsWeb, CloseGoalsDetail, CloseFeedWeb, CloseFeedDetail, ToChat, Leave }

/** Page-internal state is read lazily: a page model may not exist until its route is first opened. */
internal class BackState(
    val healthCalendar: () -> Boolean = { false },
    val healthAway: () -> Boolean = { false },
    val goalsDetail: () -> Boolean = { false },
    val feedDetail: () -> Boolean = { false },
)

/** The system back key first steps out of a page's inner view, then returns to chat; chat itself leaves the app. */
internal fun nativeBack(route: String, state: BackState): BackAction = when (route) {
    "library-web" -> BackAction.CloseLibraryWeb
    "settings", "models" -> BackAction.Settings
    "health-web" -> BackAction.CloseHealthWeb
    "health" -> if (state.healthCalendar()) BackAction.CloseHealthCalendar else if (state.healthAway()) BackAction.HealthHome else BackAction.ToChat
    "goals-web" -> BackAction.CloseGoalsWeb
    "goals" -> if (state.goalsDetail()) BackAction.CloseGoalsDetail else BackAction.ToChat
    "activity-web" -> BackAction.CloseFeedWeb
    "activity" -> if (state.feedDetail()) BackAction.CloseFeedDetail else BackAction.ToChat
    "chat" -> BackAction.Leave
    else -> BackAction.ToChat
}
