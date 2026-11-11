package com.memoweft.weftmate.mobile

/** How a route draws its top bar. */
internal enum class RouteBar { Main, Back, Settings, Feed, Goals, Health, Page }

/**
 * One place that says how each page is framed: top bar, title, which bottom item is lit,
 * and whether the bottom bar shows.
 */
internal data class NativeRoute(
    val id: String,
    val bar: RouteBar,
    val title: String? = null,
    val tab: String? = null,
    val bottomBar: Boolean = true,
    val frost: Boolean = false,
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
    NativeRoute("native", RouteBar.Page, bottomBar = false),
    NativeRoute("settings", RouteBar.Settings, bottomBar = false),
    NativeRoute("models", RouteBar.Settings, bottomBar = false),
    NativeRoute("activity", RouteBar.Feed, tab = "activity", frost = true),
    NativeRoute("goals", RouteBar.Goals, tab = "goals", frost = true),
    NativeRoute("health", RouteBar.Health, tab = "health", frost = true),
    NativeRoute("library", RouteBar.Main, "成果库", tab = "library", frost = true),
).associateBy { it.id }

internal fun nativeRoute(id: String) = routes[id] ?: routes.getValue("chat")

internal enum class BackAction { Page, Settings, CloseHealthCalendar, HealthHome, CloseGoalsDetail, CloseFeedDetail, ToChat, Leave }

/** Page-internal state is read lazily: a page model may not exist until its route is first opened. */
internal class BackState(
    val healthCalendar: () -> Boolean = { false },
    val healthAway: () -> Boolean = { false },
    val goalsDetail: () -> Boolean = { false },
    val feedDetail: () -> Boolean = { false },
)

/** The system back key first steps out of a page's inner view, then returns to chat; chat itself leaves the app. */
internal fun nativeBack(route: String, state: BackState): BackAction = when (route) {
    "native" -> BackAction.Page
    "settings", "models" -> BackAction.Settings
    "health" -> if (state.healthCalendar()) BackAction.CloseHealthCalendar else if (state.healthAway()) BackAction.HealthHome else BackAction.ToChat
    "goals" -> if (state.goalsDetail()) BackAction.CloseGoalsDetail else BackAction.ToChat
    "activity" -> if (state.feedDetail()) BackAction.CloseFeedDetail else BackAction.ToChat
    "chat" -> BackAction.Leave
    else -> BackAction.ToChat
}
