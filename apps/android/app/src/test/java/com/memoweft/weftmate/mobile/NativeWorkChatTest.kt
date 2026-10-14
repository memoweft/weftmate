package com.memoweft.weftmate.mobile

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeWorkChatTest {
    @Test fun personalApiSendsDedicatedAuthenticatedApprovalRequestsAndOriginalDecisionFields() {
        val host=HostIdentity("https://computer.example.test","synthetic","owner-one","computer-one","phone-one","synthetic-cookie","synthetic-csrf")
        val approvalId="00000000-0000-4000-8000-000000000001"
        var calls=0
        val transport=object:JsonTransport {
            override fun request(url:String,method:String,body:JSONObject?,headers:Map<String,String>,active:java.util.concurrent.atomic.AtomicReference<java.net.HttpURLConnection?>?,readTimeoutMs:Int):HttpReply {
                calls++;assertEquals(host.cookie,headers["Cookie"])
                if(method=="GET") {
                    assertEquals("${host.origin}/personal/v1/sessions/session-one/approvals?limit=50",url);assertNull(body)
                } else {
                    assertEquals("POST",method);assertEquals("${host.origin}/personal/v1/sessions/session-one/approvals/$approvalId",url)
                    assertEquals(host.origin,headers["Origin"]);assertEquals(host.csrf,headers["X-WeftMate-CSRF"])
                    assertEquals("original-$calls",body!!.getString("requestId"))
                    if(calls==2){assertEquals("allowed-once",body.getString("outcome"));assertEquals("conversation-category",body.getString("scope"));assertFalse(body.has("workProjectId"))}
                    if(calls==3){assertEquals("allowed-once",body.getString("outcome"));assertEquals("once",body.getString("scope"));assertEquals("project-selected",body.getString("workProjectId"))}
                    if(calls==4){assertEquals("rejected",body.getString("outcome"));assertFalse(body.has("scope"));assertFalse(body.has("workProjectId"))}
                }
                return HttpReply(200,JSONObject().put("received",true))
            }
        }
        val api=PersonalApi(transport)
        assertTrue(api.approvals(host,"session-one").getBoolean("received"))
        api.decideApproval(host,"session-one",approvalId,"original-2","allowed-once","conversation-category")
        api.decideApproval(host,"session-one",approvalId,"original-3","allowed-once","once","project-selected")
        api.decideApproval(host,"session-one",approvalId,"original-4","rejected")
        assertEquals(4,calls)
        assertThrows(IllegalArgumentException::class.java){api.decideApproval(host,"../other",approvalId,"invalid","allowed-once")}
        assertEquals(4,calls)
    }
    @Test fun nativeDecisionChecksTheCapturedAccountBeforeAndAfterTheRequest() {
        var current="account-one";val expected=current;var requests=0;var checks=0
        fun checkCurrent(){checks++;if(current!=expected)throw ApiFailure(403,"ACCOUNT_SWITCHED")}
        current="account-two"
        assertThrows(ApiFailure::class.java){checkedNativeDecisionRequest(::checkCurrent){requests++;JSONObject()}}
        assertEquals(0,requests)
        current=expected;checks=0
        assertThrows(ApiFailure::class.java){checkedNativeDecisionRequest(::checkCurrent){requests++;current="account-two";JSONObject().put("privateResult",true)}}
        assertEquals(1,requests);assertEquals(2,checks)
        current=expected;checks=0
        assertTrue(checkedNativeDecisionRequest(::checkCurrent){requests++;JSONObject().put("accepted",true)}.getBoolean("accepted"))
        assertEquals(2,checks)
    }
    @Test fun personalApiQuestionsKeepTheirDedicatedAuthenticatedRoutesAndExactAnswer() {
        val host=HostIdentity("https://computer.example.test","synthetic","owner-one","computer-one","phone-one","synthetic-cookie","synthetic-csrf")
        val rpc="00000000-0000-4000-8000-000000000001"
        val answer=JSONObject().put("answers",JSONArray().put(JSONObject().put("id","question-one").put("selected",JSONArray().put("继续"))))
        var calls=0
        val api=PersonalApi(object:JsonTransport {
            override fun request(url:String,method:String,body:JSONObject?,headers:Map<String,String>,active:java.util.concurrent.atomic.AtomicReference<java.net.HttpURLConnection?>?,readTimeoutMs:Int):HttpReply {
                calls++;assertEquals(host.cookie,headers["Cookie"])
                if(calls==1){assertEquals("GET",method);assertEquals("${host.origin}/personal/v1/sessions/session-one/questions?limit=50",url);assertNull(body)}
                else {assertEquals("POST",method);assertEquals("${host.origin}/personal/v1/sessions/session-one/questions/$rpc",url)
                    assertEquals(host.origin,headers["Origin"]);assertEquals(host.csrf,headers["X-WeftMate-CSRF"])
                    assertEquals("original-answer",body!!.getString("requestId"));assertEquals(answer.toString(),body.getJSONObject("answer").toString())}
                return HttpReply(200,JSONObject().put("received",true))
            }
        })
        assertTrue(api.questions(host,"session-one").getBoolean("received"))
        assertTrue(api.answerQuestion(host,"session-one",rpc,"original-answer",answer).getBoolean("received"))
        assertEquals(2,calls)
    }
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
