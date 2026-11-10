package com.memoweft.weftmate.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeRouteTest {
    private val flags = mutableSetOf<String>()
    private val state = BackState({ "calendar" in flags }, { "away" in flags }, { "goal" in flags }, { "feed" in flags })

    @Test fun backStepsOutOfInnerViewsBeforeLeavingThePage() {
        flags += setOf("calendar", "away")
        assertEquals(BackAction.CloseHealthCalendar, nativeBack("health", state))
        flags -= "calendar"
        assertEquals(BackAction.HealthHome, nativeBack("health", state))
        flags.clear()
        assertEquals(BackAction.ToChat, nativeBack("health", state))
        flags += "goal"; assertEquals(BackAction.CloseGoalsDetail, nativeBack("goals", state))
        flags += "feed"; assertEquals(BackAction.CloseFeedDetail, nativeBack("activity", state))
    }

    @Test fun innerStateOfOtherPagesNeverDecidesThisPage() {
        flags += setOf("calendar", "away", "goal", "feed")
        assertEquals(BackAction.ToChat, nativeBack("chats", state))
        assertEquals(BackAction.Settings, nativeBack("models", state))
        assertEquals(BackAction.CloseFeedWeb, nativeBack("activity-web", state))
        assertEquals(BackAction.Leave, nativeBack("chat", state))
        assertEquals(BackAction.ToChat, nativeBack("help", state))
    }

    @Test fun subPagesLightTheirParentTabAndUnknownPagesStayEmbedded() {
        assertEquals("chat", nativeRoute("chats").tab)
        assertEquals("activity", nativeRoute("activity-web").tab)
        assertEquals(null, nativeRoute("help").tab)
        val unknown = nativeRoute("backup")
        assertEquals("backup", unknown.web)
        assertEquals(RouteBar.Main, unknown.bar)
    }
}
