package com.memoweft.weftmate.mobile

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeWorkChatTest {
    @Test fun onlyTheComputersOwnVersionOneDeclarationEnablesProductModes() {
        for (status in listOf(JSONObject(),JSONObject().put("capabilities",JSONObject().put("workAndChat",1)),
            JSONObject().put("personalCapabilities",JSONObject().put("workAndChat","1")),
            JSONObject().put("personalCapabilities",JSONObject().put("workAndChat",2)))) assertFalse(hostWorkAndChatDeclared(status))
        assertTrue(hostWorkAndChatDeclared(JSONObject().put("personalCapabilities",JSONObject().put("workAndChat",1))))
        val old=JSONObject().put("chatId","old-chat").put("projectId","old-project")
        assertSame(old,nativeModeChats(listOf(old),"chat",false).single())
        assertEquals(nativeApprovalBody("old-request","allowed-once","once").toString(),
            JSONObject().put("requestId","old-request").put("outcome","allowed-once").put("scope","once").toString())
    }
    @Test fun creatingWorkRequestsTheSelectedComputersProjectBeforeAnyMessage() = runBlocking {
        val calls=mutableListOf<Triple<String,String,JSONObject>>()
        val result=nativeCreateWork("computer-two","project-selected","stable-request","model-selected") { host,path,body ->
            calls+=Triple(host,path,body);JSONObject().put("command",JSONObject().put("sessionId","work-session"))
        }
        assertEquals(1,calls.size);assertEquals("computer-two",calls.single().first)
        assertEquals("/projects/project-selected/sessions",calls.single().second)
        assertEquals("model-selected",calls.single().third.getString("modelProfileId"))
        assertEquals("stable-request",calls.single().third.getString("requestId"))
        assertFalse(calls.single().third.has("text"));assertFalse(calls.single().third.has("mode"))
        assertEquals("work-session",result.getJSONObject("command").getString("sessionId"))
    }
    @Test fun switchApprovalIsOnceWithAProjectAndRejectionKeepsTheOriginalContract() {
        val allowed=nativeApprovalBody("original-receipt","allowed-once","once","project-selected")
        assertEquals("original-receipt",allowed.getString("requestId"))
        assertEquals("project-selected",allowed.getString("workProjectId"));assertEquals("once",allowed.getString("scope"))
        val rejected=nativeApprovalBody("reject-receipt","rejected")
        assertEquals("rejected",rejected.getString("outcome"));assertFalse(rejected.has("workProjectId"));assertFalse(rejected.has("scope"))
        assertThrows(IllegalArgumentException::class.java){nativeApprovalBody("receipt","rejected",null,"project-selected")}
        assertThrows(IllegalArgumentException::class.java){nativeApprovalBody("receipt","allowed-once","global-category","project-selected")}
    }
    @Test fun convertedMainChatMovesOnceAndRetainsTheFullLogicalHistoryAndSource() {
        val original=JSONObject().put("kind","main").put("chatId","logical-chat").put("activeSessionId","current-session")
            .put("mode","chat").put("displayTitle","小纬").put("logicalHistory",true)
        val timeline=NativeTimeline()
        val old=JSONObject().put("eventId","older-event").put("type","user.message").put("orderKey","01")
            .put("sourceRef",JSONObject().put("hostId","computer-one").put("sessionId","older-session").put("seq",9))
        timeline.merge(JSONObject().put("items",JSONArray().put(old)))
        val fresh=JSONObject().put("mode","work").put("workHostId","computer-one").put("projectId","project-selected")
            .put("workDirectory",JSONObject().put("projectId","project-selected").put("name","选好的文件夹"))
        val converted=nativeChatMetadata(original,fresh)
        assertEquals("logical-chat",converted.getString("chatId"));assertEquals("current-session",converted.getString("activeSessionId"))
        assertTrue(converted.getBoolean("logicalHistory"));assertEquals("main",converted.getString("kind"))
        assertEquals("小纬",hostChatTitle(converted));assertEquals("chat",nativeConversationMode(original))
        assertTrue(nativeModeChats(listOf(converted),"chat",true).isEmpty())
        assertSame(converted,nativeModeChats(listOf(converted),"work",true).single())
        timeline.merge(JSONObject().put("items",JSONArray().put(JSONObject().put("eventId","continued-event").put("type","assistant.message").put("orderKey","02"))))
        assertEquals(2,timeline.rows().size);assertEquals(old.toString(),timeline.rows().first().toString())
        assertEquals("logical-chat",hostChatSendTarget("main",converted.getString("chatId"),converted.getString("activeSessionId")).getString("chatId"))
    }
    @Test fun phoneReadOnlyHistoryAlwaysStaysInChatEvenIfTheComputerHasAProject() {
        assertEquals("chat",nativeConversationMode(JSONObject().put("phoneHistory",true).put("mode","work").put("projectId","old-project")))
        assertEquals("work",nativeConversationMode(JSONObject().put("chatId","old").put("projectId","project-old")))
        assertEquals("work",nativeConversationMode(JSONObject().put("chatId","revoked").put("mode","work").put("workDirectory",JSONObject.NULL)))
    }
}
